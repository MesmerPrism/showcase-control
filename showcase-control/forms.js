(function(root){
 'use strict';
 const names={visual_scale:'Visual scale',minimum_m:'Minimum radius (m)',maximum_m:'Maximum radius (m)',enabled:'Size enabled',mode:'Mode',world_meters:'Size (m)',sphere_radius_percent:'Sphere radius (%)',oscillation_percent:'Size oscillation (%)',world_anchor_scale_m:'Stored anchor size (m)',draw_slots_per_oscillator:'Copies per particle (0–7)',lifetime_seconds:'Lifetime (s)',copies_per_second:'Copies per second',opacity:'Opacity',output_alpha_scale:'Output alpha scale',depth_suppression_strength:'Depth suppression',rgb_alpha_coupling:'RGB / alpha coupling',facing_attenuation_strength:'Facing attenuation',preset:'Material preset',scale_with_particle_size:'Scale with particle size',reference_radius_m:'Reference radius (m)',endpoint_gain:'Endpoint gain',midpoint_gain:'Midpoint gain',source_slot:'Source slot',target_slot:'Fixed target slot',curve:'Curve',range_min:'Range minimum',range_max:'Range maximum',cycle_multiplier:'Cycle multiplier'};
 const slots=['Breathing progress · follows input','Appearance / coupling base','Particle size','Depth wave','Spin speed','Orbit radius · follows heartbeat','Orbit angle','Animation'];
 const categories=[{id:'scale',title:'Scale & radius'},{id:'size',title:'Particle size'},{id:'orbit',title:'Orbit geometry'},{id:'tracers',title:'Tracers'},{id:'material',title:'Material & transparency'},{id:'coupling',title:'Radius coupling'},{id:'drivers',title:'Visual drivers'}];
 const category=path=>({radius:'scale',visual_scale:'scale',world_anchor_scale_m:'scale',size:'size',orbit_distance:'orbit',tracer:'tracers',material:'material',transparency:'material',color:'material',frame_extension:'coupling',driver_controls:'drivers',driver_values01:'drivers'})[path[0]];
 const driverBounds=[[0,1],[0,1],[.04,.115],[0,.1],[.1,.5],[.2,1.5],[0,Math.PI*2],[0,1]];
 const owned=path=>path[0]==='world_anchor_scale_m'||path[0]==='driver_controls'&&path[2]==='target_slot'||path[0]==='driver_values01'&&[0,5].includes(Number(path[1]));
 function catalogue(schema){const result=[];function visit(s,path){if(s.type==='object')for(const[k,v]of Object.entries(s.properties))visit(v,[...path,k]);else if(s.type==='array')for(let i=0;i<s.maxItems;i++)visit(s.prefixItems?.[i]||s.items,[...path,i]);else result.push({path,category:category(path),readOnly:owned(path),schema:s});}visit(schema,[]);return result;}
 function label(key){return names[key]||String(key).replaceAll('_',' ');}
 function form(container,schema,value,{change=()=>{},presets={}}={}){
  let presetDefinitions=presets,draft=structuredClone(value),page='scale',target=3;let presetSummary;const fields=catalogue(schema),invalid=new Set(),rawValues=new Map();
  const read=path=>path.reduce((v,k)=>v[k],draft);
  function note(parent,text){const p=document.createElement('p');p.className='hint';p.textContent=text;parent.append(p);return p;}
  function advanced(parent,title='Advanced · stored settings'){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;details.append(summary);parent.append(details);return details;}
  function build(parent,entry){
   const {path,schema:def}=entry,key=path.at(-1),current=read(path),percent=path[0]==='driver_controls'&&Number(path[1])===3&&['range_min','range_max'].includes(key),factor=percent?100:1;
   const field=document.createElement('label');field.textContent=path[0]==='driver_values01'?'Manual / base value (0–1)':label(key)+(percent?' (% of local sphere radius)':'');
   let input;
   if(def.enum){input=document.createElement('select');for(const option of def.enum){const o=document.createElement('option');o.value=option;o.textContent=String(option).replaceAll('-',' ');input.append(o);}input.value=current;}
   else{input=document.createElement('input');input.type=def.type==='boolean'?'checkbox':typeof current==='number'?'number':'text';if(input.type==='checkbox'){input.checked=current;field.className='check';}else{input.value=current*factor;input.required=true;input.step=def.type==='integer'?'1':'any';if(def.minimum!==undefined)input.min=def.minimum*factor;if(def.maximum!==undefined)input.max=def.maximum*factor;}}
   input.dataset.path=path.join('.');input.id='visual-'+path.join('-');if(rawValues.has(input.dataset.path))input.value=rawValues.get(input.dataset.path);
   input.readOnly=entry.readOnly;
   if(key==='preset')input.disabled=!presetDefinitions[current];if(def.const!==undefined){input.value=current;input.readOnly=true;}
   if(path[0]==='driver_controls'&&['range_min','range_max'].includes(key)){const limits=driverBounds[Number(path[1])];input.min=limits[0]*factor;input.max=limits[1]*factor;}
   if(input.readOnly)input.setAttribute('aria-readonly','true');
   const update=()=>{if(input.readOnly)return;rawValues.set(path.join('.'),input.value);const next=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value)/factor:input.value;
    if(input.type==='number'&&(input.value===''||!Number.isFinite(next))){invalid.add(path.join('.'));let at=draft;for(const part of path.slice(0,-1))at=at[part];at[key]=NaN;change(structuredClone(draft));return;}invalid.delete(path.join('.'));
    if(path[0]==='material'&&key==='preset'){const preset=presetDefinitions[next];if(!preset)throw Error('Preset settings are unavailable. Read current settings again.');for(const group of ['transparency','color'])for(const [field,value]of Object.entries(preset[group])){if(Object.hasOwn(draft[group],field)){draft[group][field]=value;rawValues.delete(group+'.'+field);invalid.delete(group+'.'+field);}}}
    let at=draft;for(const part of path.slice(0,-1))at=at[part];at[key]=next;if(page==='material'&&presetSummary)presetSummary.textContent=presetDescription();change(structuredClone(draft));
    if(['preset','mode','scale_with_particle_size'].includes(key))show(page,target);
   };
   input.addEventListener(input.tagName==='SELECT'||def.enum||input.type==='checkbox'?'change':'input',update);field.append(input);parent.append(field);
   if(entry.readOnly)note(parent,path[0]==='world_anchor_scale_m'?'Kept with profiles for compatibility. Sphere size follows the minimum and maximum radius above.':path[0]==='driver_values01'?'Controlled by your breathing input or heartbeat selection.':'This target number cannot be changed.');

  }
  function show(next,selected=target){page=next;target=Number(selected);container.replaceChildren();
   if(page==='drivers'){
    const field=document.createElement('label');field.textContent='Target';const select=document.createElement('select');select.id='driver-target';slots.forEach((name,i)=>{const o=document.createElement('option');o.value=i;o.textContent=name;select.append(o);});select.value=target;select.addEventListener('change',()=>show('drivers',select.value));field.append(select);container.append(field);
    note(container,`Target slot ${target}. ${['Normalized progress','Normalized appearance/base','Size fraction','Local sphere radius (%)','Spin rate','Orbit radius multiplier','Orbit angle (radians)','Normalized animation'][target]}. Use values within the allowed range for this target.`);
   }
   if(page==='scale')note(container,'The last applied sphere radius is shown below. Stored anchor size does not control it.');
   if(page==='orbit')note(container,'Heartbeat source and BPM belong to Inputs. Off uses static minimum distance; orbit angle has its own oscillator.');
   if(page==='material')presetSummary=note(container,presetDescription());
   let foldout;
   for(const entry of fields){if(entry.category!==page)continue;const p=entry.path,k=p.at(-1);if(page==='drivers'&&Number(p[1])!==target)continue;
    const inactive=page==='size'&&(k==='oscillation_percent'||k==='world_meters'&&draft.size.mode!=='world-meters'||k==='sphere_radius_percent'&&draft.size.mode!=='sphere-radius-percent')||page==='orbit'&&k==='reference_radius_m'&&draft.orbit_distance.scale_with_particle_size||page==='coupling'&&k==='midpoint_gain'&&draft.frame_extension.mode==='constant'||page==='material'&&['depth_suppression_strength','rgb_alpha_coupling','facing_attenuation_strength'].includes(k)||page==='drivers'&&(k==='source_slot'||p[0]==='driver_values01');
    if(inactive&&!foldout)foldout=advanced(container,page==='drivers'?'Source and manual/base details':'Advanced · stored settings');build(inactive?foldout:container,entry);
   }
  }
  function presetDescription(){return presetDefinitions[draft.material.preset]?'Preset'+(presetModified()?' (modified)':'')+' · choosing a preset fills its settings. You can adjust them before selecting Apply visuals.':'Preset settings are unavailable. Connect and read current settings to choose a preset. You can still edit the values below.';}
  function presetModified(){const preset=presetDefinitions[draft.material.preset];return !!preset&&['transparency','color'].some(group=>Object.entries(preset[group]).some(([key,value])=>Math.fround(draft[group][key])!==Math.fround(value)));}
  show(page);return {show,presetModified,setPresets:value=>{if(JSON.stringify(value)!==JSON.stringify(presetDefinitions)){presetDefinitions=value||{};if(page==='material')show(page,target);}},value:()=>{if(invalid.size)throw Error('Complete the numeric fields before applying visuals.');for(const [i,c] of draft.driver_controls.entries())for(const key of ['range_min','range_max'])if(c[key]<driverBounds[i][0]||c[key]>driverBounds[i][1])throw Error('This value is outside the allowed range for the selected target.');return structuredClone(draft);},replace:value=>{draft=structuredClone(value);invalid.clear();rawValues.clear();show(page,target);}};
 }
 const api={form,label,slots,categories,catalogue};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseForms=api;
})(globalThis);
