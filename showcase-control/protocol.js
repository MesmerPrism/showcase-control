(function(root){
  'use strict';
  const PRODUCT='visual-showcase',PREFIX='rusty.quest.visual_showcase.';
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const bounded=value=>{if(new TextEncoder().encode(JSON.stringify(value)).length>65536)throw Error('Settings are too large');return value;};
  const V=typeof module!=='undefined'?require('./validation.js'):root.ShowcaseValidation;
  let visualSchema=typeof module!=='undefined'?require('../../fixtures/native-app-builds/showcase/visual-profile.schema.json'):null;
  function configure(schema){visualSchema=schema;}
  const epoch=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const fields=new Set(['visual_scale','radius','size','world_anchor_scale_m','driver_values01','driver_controls','tracer','transparency','color','material','orbit_distance','frame_extension']);
  function visual(value){
    if(!object(value))throw Error('Visual settings must be an object');
    if(!visualSchema)throw Error('Visual controls are still loading');
    V.validate(value,visualSchema,'visual');
    if(value.radius.maximum_m<value.radius.minimum_m)throw Error('Maximum radius must be at least the minimum');
    if(value.driver_controls.some(c=>c.range_max<c.range_min))throw Error('Driver range is inverted');
    for(const key of Object.keys(value))if(!fields.has(key))throw Error(`Unknown visual setting: ${key}`);
    if(value.orbit_distance&&Object.keys(value.orbit_distance).some(k=>!['scale_with_particle_size','reference_radius_m'].includes(k)))throw Error('Heartbeat input is separate from visual profiles');
    return clone(bounded(value));
  }
  function allowsPolarDynamic(value){return value.breath_source==='polar-acc'&&value.breath_mapping==='state';}
  function inputs(value){
    const keys=['breath_source','breath_mapping','heartbeat_source','synthetic_bpm','controller_projection','polar_projection','inverted'];
    if(!object(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||!['controller','polar-acc','automatic'].includes(value.breath_source)||!['state','volume'].includes(value.breath_mapping)||!['off','polar','synthetic'].includes(value.heartbeat_source)||!Number.isFinite(value.synthetic_bpm)||value.synthetic_bpm<30||value.synthetic_bpm>240||!['dynamic-axis','fixed-orientation'].includes(value.controller_projection)||!['xz','3d','dynamic-axis','tilt-classifier','adaptive-tilt'].includes(value.polar_projection)||typeof value.inverted!=='boolean')throw Error('Complete valid input settings required');
    return clone(value);
  }
  function status(value){
    if(!object(value)||value.schema!==PREFIX+'status.v1'||value.product!==PRODUCT||!epoch(value.epoch)||!Number.isSafeInteger(value.revision)||value.revision<0||value.o?.e!==value.epoch||value.o?.s!=='observed')throw Error('Current showcase identity unavailable');
    inputs(value.inputs);
    if(!object(value.profiles)||Object.keys(value.profiles).length>16||!object(value.availability)||value.ready===false)throw Error('Incomplete showcase settings');
    for(const profile of Object.values(value.profiles))visual(profile);
    if(value.observed_at_ns!==undefined&&!/^[0-9]{1,20}$/.test(value.observed_at_ns))throw Error('Invalid native observation');
    visual(value.visual);
    return clone(bounded(value));
  }
  const OPS=new Set(['set-inputs','apply-visual','save-profile','apply-profile','delete-profile','calibrate','polar-scan','polar-connect','polar-disconnect','polar-select','polar-start-acc','polar-stop-acc']);
  function command(current,op,payload,id){
    current=status(current);
    if(!OPS.has(op)||!object(payload)||!/^[-a-zA-Z0-9_]{8,64}$/.test(id))throw Error('Unsupported showcase command');
    if(op==='apply-visual'||op==='save-profile')visual(payload.visual);
    if(op==='set-inputs')inputs(payload);
    if(op==='calibrate'&&(Object.keys(payload).join(',')!=='action'||!['start','cancel','reset'].includes(payload.action)))throw Error('Choose a calibration action');
    if(op==='polar-select'&&(Object.keys(payload).join(',')!=='device_id'||!/^[0-9A-Fa-f]{12}$/.test(payload.device_id)))throw Error('Choose a discovered Polar device');
    if(['save-profile','apply-profile','delete-profile'].includes(op)&&(typeof payload.name!=='string'||!payload.name.length||new TextEncoder().encode(payload.name).length>64||/[\u0000-\u001f\u007f]/.test(payload.name)))throw Error('Profile name must be 1–64 bytes');
    return {schema:PREFIX+'command.v1',product:PRODUCT,epoch:current.epoch,expected_revision:current.revision,id,op,payload:clone(bounded(payload))};
  }
  class Snapshots{
    accept(value){
      const next=status(value);
      if(this.current&&(next.epoch!==this.current.epoch||next.revision<this.current.revision))throw Error('Showcase changed or returned older settings; reconnect');
      if(this.current?.observed_at_ns!==undefined&&next.observed_at_ns!==undefined&&BigInt(next.observed_at_ns)<BigInt(this.current.observed_at_ns))throw Error('Older native observation');
      this.current=next;return next;
    }
  }
  const api={PRODUCT,PREFIX,configure,visual,inputs,allowsPolarDynamic,status,command,Snapshots};
  if(typeof module!=='undefined')module.exports=api;else root.ShowcaseProtocol=api;
})(globalThis);
