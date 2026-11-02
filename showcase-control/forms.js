(function(root){
 'use strict';
 const names={visual_scale:'Visual scale',radius:'Sphere radius',minimum_m:'Minimum radius (m)',maximum_m:'Maximum radius (m)',size:'Particle size',enabled:'Enabled',mode:'Mode',world_meters:'Size (m)',sphere_radius_percent:'Sphere radius (%)',oscillation_percent:'Size oscillation (%)',world_anchor_scale_m:'World anchor scale (m)',driver_values01:'Manual driver values',driver_controls:'Visual driver controls',tracer:'Tracers',draw_slots_per_oscillator:'Tracers per particle',lifetime_seconds:'Lifetime (s)',copies_per_second:'Copies per second',transparency:'Transparency',opacity:'Opacity',output_alpha_scale:'Output alpha scale',depth_suppression_strength:'Depth suppression',rgb_alpha_coupling:'RGB / alpha coupling',color:'Color',facing_attenuation_strength:'Facing attenuation',material:'Material',preset:'Preset',orbit_distance:'Orbit distance',scale_with_particle_size:'Scale with particle size',reference_radius_m:'Reference radius (m)',frame_extension:'Radius coupling',endpoint_gain:'Endpoint gain',midpoint_gain:'Midpoint gain',source_slot:'Source slot',target_slot:'Target slot',curve:'Curve',range_min:'Range minimum',range_max:'Range maximum',cycle_multiplier:'Cycle multiplier'};
 const slots=['Breathing progress · input owned','Appearance / coupling base','Particle size','Depth wave','Spin speed','Orbit radius · heartbeat event owned','Orbit angle','Animation'];
 function label(key){return names[key]||key.replaceAll('_',' ');}
 function form(container,schema,value,{change=()=>{}}={}){
  let draft=structuredClone(value);container.replaceChildren();
  const read=path=>path.reduce((v,k)=>v[k],draft);
  const write=(path,value)=>{let target=draft;for(const k of path.slice(0,-1))target=target[k];target[path.at(-1)]=value;change(draft);};
  function build(parent,definition,path,key){
   const current=read(path);
   if(definition.type==='object'||definition.type==='array'){
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=path.length===2&&path[0]==='driver_controls'?slots[key]:label(key);details.append(summary);parent.append(details);
    if(definition.type==='object')for(const [k,v]of Object.entries(definition.properties))build(details,v,[...path,k],k);
    else current.forEach((_,i)=>build(details,definition.prefixItems?.[i]||definition.items,[...path,i],i));
    return;
   }
   const field=document.createElement('label');field.textContent=path[0]==='driver_values01'?slots[key]:label(key);
   let input;
   if(definition.enum){input=document.createElement('select');for(const option of definition.enum){const element=document.createElement('option');element.value=option;element.textContent=String(option).replaceAll('-',' ');input.append(element);}input.value=current;}
   else {input=document.createElement('input');input.type=definition.type==='boolean'?'checkbox':definition.type==='number'||definition.type==='integer'?'number':'text';if(input.type==='checkbox'){input.checked=current;field.className='check';}else{input.value=current;input.required=true;if(definition.minimum!==undefined)input.min=definition.minimum;if(definition.maximum!==undefined)input.max=definition.maximum;input.step=definition.type==='integer'?'1':'any';}}
   if(definition.const!==undefined){input.value=definition.const;input.readOnly=true;}
   if(path[0]==='driver_values01'&&[0,5].includes(Number(key)))input.readOnly=true;
   input.addEventListener('change',()=>{const next=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;write(path,next);});field.append(input);parent.append(field);
  }
  for(const [key,definition]of Object.entries(schema.properties))build(container,definition,[key],key);
  return {value:()=>structuredClone(draft)};
 }
 const api={form,label,slots};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseForms=api;
})(globalThis);
