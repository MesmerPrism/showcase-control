(function(){
 'use strict';
 const $=id=>document.getElementById(id),P=ShowcaseProtocol,UI=ShowcaseUI;
 const drafts=new UI.Drafts(),navigation=new UI.Navigation(),positions=new Map();
 let schema,editor,lastSeen=0,reading=null,joining=null,expected=null,wanted=false,lastRejoin=0,boundIdentity=null,confirmation=null,originalOperation=null,originalId=null;
 let storage;try{storage=localStorage;}catch(_){}
 const roster=new ShowcaseDiscovery.Roster(storage),discovery=new ShowcaseDiscovery.Discovery();
 const controller=new ShowcaseController.Controller({changed:render});
 const titles={inputs:'Inputs',polar:'Inputs / Polar',calibration:'Inputs / Calibration',visuals:'Visuals',profiles:'Profiles',setup:'Setup',...Object.fromEntries(ShowcaseForms.categories.map(c=>[c.id,'Visuals / '+c.title]))};
 const visualPages=new Set(ShowcaseForms.categories.map(c=>c.id));
 const domain=()=>navigation.primary==='inputs'?'inputs':navigation.primary==='visuals'?'visual':null;
 const hasDraft=()=>!!drafts.current;
 function message(text=''){ $('message').textContent=text;$('message').title=text;$('message').hidden=!text; }
 function readInputs(){const fields=$('inputs-form').elements;const value=Object.fromEntries(['breath_source','breath_mapping','heartbeat_source','controller_projection','polar_projection'].map(k=>[k,fields.namedItem(k).value]));value.synthetic_bpm=Number(fields.namedItem('synthetic_bpm').value);value.inverted=fields.namedItem('inverted').checked;return value;}
 function loadInputs(inputs){for(const [key,value]of Object.entries(inputs)){const field=$('inputs-form').elements.namedItem(key);if(field)field.type==='checkbox'?field.checked=value:field.value=value;}}
 function syncDraftControls(domains=['inputs','visual']){if(!hasDraft())return;if(domains.includes('inputs'))loadInputs(drafts.value('inputs'));if(schema&&domains.includes('visual')){const visual=drafts.value('visual');if(editor)editor.replace(visual);else editor=ShowcaseForms.form($('visual-controls'),schema,visual,{presets:controller.current?.material_presets||{},change:value=>{drafts.replace('visual',value);render();},ranges:controller.current?.driver_ranges});if(visualPages.has(navigation.page))editor.show(navigation.page);}}
 function acceptedOperation(){const r=controller.lastReceipt;return originalOperation&&r?.id===originalId&&r.epoch===controller.current?.epoch&&r.status==='accepted'&&controller.current.revision>=r.revision?originalOperation:undefined;}
 function observe(accepted){
  if(!controller.current)return;
  const domains=['inputs','visual'];
  const before=hasDraft()?Object.fromEntries(domains.map(d=>[d,JSON.stringify(drafts.value(d))])):{};
  drafts.observe(controller.current,boundIdentity?.device||'unidentified',accepted);
  // A native receipt must also refresh the visible widgets. A draft already
  // equal to readback does not prove a mobile select still shows that value.
  const acceptedDomain=accepted==='set-inputs'?'inputs':['apply-visual','apply-profile'].includes(accepted)?'visual':null;
  syncDraftControls(domains.filter(d=>d===acceptedDomain||before[d]!==JSON.stringify(drafts.value(d))));
  editor?.setPresets?.(controller.current.material_presets||{});
  render();
 }
 function navigate(page){
  const scroll=$('page-scroll');positions.set(navigation.page,{...positions.get(navigation.page),top:scroll.scrollTop||0});navigation.go(page);
  document.querySelectorAll('[data-page]').forEach(node=>{const active=node.dataset.page===(visualPages.has(page)?'visual-editor':page);node.hidden=!active;node.inert=!active;});
  document.querySelectorAll('nav [data-page-link]').forEach(button=>{if(button.dataset.pageLink===navigation.primary)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('page-title').textContent=titles[page];$('back').hidden=page===navigation.primary;
  if(visualPages.has(page)&&editor)editor.show(page);
  scroll.scrollTop=positions.get(page)?.top||0;
  const focus=positions.get(page)?.focus,previous=focus&&$(focus);if(previous&&!previous.closest?.('[hidden]')&&(!previous.checkVisibility||previous.checkVisibility()))previous.focus?.({preventScroll:true});else $('page-title').focus?.({preventScroll:true});
  render();
 }
 function renderSubmittedObservations(state){
  const revision=state?.rendered_visual_revision,validRevision=Number.isSafeInteger(revision)&&revision>=0&&revision<=state.revision;
  const applying=validRevision&&revision!==state.revision;
  const radius=state?.rendered_radius_m;
  $('prepared-radius').hidden=navigation.page!=='scale';
  $('prepared-radius').textContent=validRevision&&Number.isFinite(radius)?`Last applied sphere radius: ${radius.toFixed(3)} m${applying?' · The headset is applying your changes.':''}`:'Applied sphere radius is unavailable. Read current settings again.';
  $('material-readback').hidden=navigation.page!=='material';
  if(!state||!controller.gateway||joining){$('prepared-radius').textContent='Connect to read the applied sphere radius.';$('material-readback').textContent='Connect to read the applied material.';return;}
  const material=state?.rendered_material,transparency=material?.transparency,color=material?.color;
  const coefficients=transparency&&color&&['opacity','output_alpha_scale','depth_suppression_strength','rgb_alpha_coupling'].every(k=>Number.isFinite(transparency[k]))&&Number.isFinite(color.facing_attenuation_strength);
  if(!validRevision||!material||material.source!=='submitted-private-particle-frame'||material.revision!==undefined&&material.revision!==revision||!coefficients){$('material-readback').textContent='Applied material settings are unavailable. Read current settings again.';return;}
  if(applying){$('material-readback').textContent='The headset is applying your changes.';return;}
  const draftContext=hasDraft()&&drafts.dirty('visual')?' You have unapplied visual edits.':' Changes made above take effect after Apply.';
  const blend={'src-one-one-minus-src-alpha':'Alpha over','src-alpha-one':'Additive','additive':'Additive'}[material.blend]||'Custom blending';
  $('material-readback').textContent=`Applied material: ${(material.template||'Unnamed preset').replaceAll('-',' ')}${material.modified?' (modified)':''} · ${blend} · opacity ${transparency.opacity} · output alpha ${transparency.output_alpha_scale} · depth suppression ${transparency.depth_suppression_strength} · RGB/alpha ${transparency.rgb_alpha_coupling} · facing attenuation ${color.facing_attenuation_strength}.${draftContext}`;
 }
 function render(){
  const state=controller.current,canApply=!joining&&controller.ready;
  // An ordinary poll holds the command gate until the revision is verified.
  // Keep the current editors usable so that hold does not dismiss a native picker.
  const available=canApply||(!joining&&!controller.pending&&reading?.generation===controller.generation&&reading.keepEditors);
  const activeDomain=domain(),inputConflict=hasDraft()&&drafts.conflict('inputs'),visualConflict=hasDraft()&&drafts.conflict('visual');
  $('inputs-empty').hidden=available;$('inputs-empty-message').textContent=state?'Your edits are kept while this page is open. Reconnect in Setup to make changes.':'Connect a showcase headset in Setup to read and edit its inputs.';
  $('inputs-form').hidden=!state;$('input-tools').hidden=!state;
  $('visual-empty').hidden=available&&!!editor;$('visual-empty-message').textContent=!state?'Connect a showcase headset in Setup to view and edit its visuals.':!available?'Your edits are kept while this page is open. Reconnect in Setup to make changes.':'Loading visual controls. Please keep this page open.';$('visual-connect').hidden=available;$('visual-form').hidden=!editor;
  renderSubmittedObservations(state);
  $('inputs-fields').disabled=!available||inputConflict;$('visual-fields').disabled=!available||visualConflict;$('profile-fields').disabled=!available;$('sensor-fields').disabled=!available;$('calibration-fields').disabled=!available;
  const fields=$('inputs-form').elements,automatic=fields.namedItem('breath_source').value==='automatic';
  fields.namedItem('breath_mapping').disabled=!available||inputConflict||automatic;
  $('mapping-row').hidden=automatic;$('automatic-help').hidden=!automatic;$('bpm-row').hidden=fields.namedItem('heartbeat_source').value!=='synthetic';
  $('reload-settings').disabled=!controller.gateway||!!joining;$('disconnect').disabled=!controller.gateway&&!joining;
  $('connection-status').textContent=joining?'Connecting…':available?'Connected to showcase':controller.gateway?(controller.pending?'Checking your last change…':'Waiting for current headset state'):(controller.pending?'Disconnected · last change not confirmed':'Disconnected');
  $('headset-context').textContent='Headset '+(boundIdentity?.serial||'identity unavailable');
  const actions=!!activeDomain&&['inputs','visuals',...visualPages].includes(navigation.page);
  $('domain-actions').hidden=!actions;$('apply-draft').textContent=activeDomain==='visual'?'Apply visuals':'Apply inputs';$('apply-draft').setAttribute?.('form',activeDomain==='visual'?'visual-form':'inputs-form');
  $('revert-draft').textContent=activeDomain==='visual'?'Revert visual edits':'Revert input edits';
  $('apply-draft').disabled=!canApply||!hasDraft()||drafts.conflict(activeDomain||'inputs');$('revert-draft').disabled=!hasDraft();
  const dirty=hasDraft()?['inputs','visual'].filter(d=>drafts.dirty(d)):[],conflicts=hasDraft()?['inputs','visual'].filter(d=>drafts.conflict(d)):[];
  $('draft-status').textContent=controller.pending?'Waiting for the headset to confirm your change':conflicts.length?'The headset settings changed. Read current settings, then review or revert your edits.':dirty.length?'Unapplied '+dirty.join(' and ')+' edits':state?(state.rendered_visual_revision===state.revision?'Settings applied':'The headset is applying your changes'):'Read current settings to edit.';
  document.querySelectorAll('nav [data-page-link]').forEach(button=>{const primary=button.dataset.pageLink;button.textContent=primary[0].toUpperCase()+primary.slice(1)+(dirty.includes(primary==='visuals'?'visual':primary)?' •':'');});
  if(!state)return;
  const input=state.inputs,availability=state.availability;
  $('input-context').textContent=`Applied breathing: ${input.breath_source} · Heart: ${input.heartbeat_source}${input.heartbeat_source==='synthetic'?' '+input.synthetic_bpm+' BPM':''}`;
  const missing=[];if(input.breath_source==='polar-acc'&&availability.breath===false)missing.push('Polar breath unavailable — radius held');if(input.heartbeat_source==='polar'&&availability.heartbeat===false)missing.push('Polar heartbeat unavailable — no real pulses');
  $('availability').textContent=missing.join('. ')||(availability.selected_polar_unavailable?'Selected Polar stream unavailable — check stream readiness':input.breath_source==='automatic'?'Automatic · '+(state.automatic_phase||'phase unavailable'):'Selected breathing input '+(availability.breath===true?'available':'readiness unavailable'));
  $('freshness').textContent=lastSeen?`Last current status ${Math.max(0,Math.floor((Date.now()-lastSeen)/1000))} s ago · revision ${state.revision}`:'';
  const names=Object.keys(state.profiles),selected=$('profiles').value;
  if(JSON.stringify(names)!==JSON.stringify([...$('profiles').options].map(o=>o.value))){$('profiles').replaceChildren(...names.map(name=>new Option(name,name)));if(names.includes(selected))$('profiles').value=selected;}
  $('delete-profile').disabled=!available||$('profiles').value==='default';
  const match=names.find(name=>JSON.stringify(state.profiles[name])===JSON.stringify(state.visual));
  $('profile-status').textContent=`Current visual settings ${match?'match '+match:'are custom / modified'}. ${state.rendered_visual_revision===state.revision?'Applied on the headset.':'The headset is applying your changes.'}`;
  $('visual-summary').textContent=$('profile-status').textContent+(drafts.dirty('visual')?' · Unapplied visual edits':'');
  const profile=state.profiles[$('profiles').value];$('selected-profile-summary').textContent=profile?`Radius ${profile.radius.minimum_m}–${profile.radius.maximum_m} m · ${profile.tracer.draw_slots_per_oscillator} copies per particle`:'';
  $('profile-inputs').textContent='Inputs remain: '+input.breath_source+' / '+input.heartbeat_source;
  $('apply-profile').textContent=drafts.dirty('visual')?'Apply selected profile · replace visual edits':'Apply selected profile';
  const selectedInput=hasDraft()?drafts.value('inputs'):input,calibrationBlocked=input.breath_source==='automatic'||selectedInput.breath_source!==input.breath_source||inputConflict;
  $('calibration-start').disabled=!available||calibrationBlocked;$('calibration-fields').disabled=!available||input.breath_source==='automatic';
  $('calibration-context').textContent=input.breath_source==='automatic'?'Automatic has no sensor calibration. Return to Inputs to select and apply a sensor.':`Applied target: ${input.breath_source} · ${input.breath_mapping}. ${calibrationBlocked?'Apply input selection before calibrating it.':'Calibration details are unavailable here. Follow the calibration instructions on the headset.'}`;
  $('polar-use').textContent='Used for: '+([input.breath_source==='polar-acc'?'breathing':'',input.heartbeat_source==='polar'?'heartbeat':''].filter(Boolean).join(' and ')||'neither selected input');
  const polar=state.polar_setup;
  $('polar-status').textContent=polar?`Permission: ${polar.p?'granted':'needed on headset'} · Bluetooth: ${polar.b?'on':'off'} · ${polar.c?'connected':'disconnected'} · ACC ${polar.a?'fresh':'unavailable'} · RR ${availability.heartbeat===true&&input.heartbeat_source==='polar'?'fresh':'freshness unavailable'}${polar.sc?' · scanning':''}`:'Polar setup status unavailable.';
  if(polar){const devices=Array.isArray(polar.d)?polar.d:[],selectedPolar=$('polar-device').value,candidates=[...new Set([...(polar.x?[polar.x]:[]),...devices])],existing=[...$('polar-device').options].slice(1).map(o=>o.value);if(JSON.stringify(existing)!==JSON.stringify(candidates)){$('polar-device').replaceChildren(new Option('Choose a discovered device',''),...candidates.map(id=>new Option(id,id)));$('polar-device').value=candidates.includes(selectedPolar)?selectedPolar:polar.x||'';}}

 }
 function renderRoster(){const selected=$('roster').value;$('roster').replaceChildren(new Option('Choose a headset',''),...roster.records.map(record=>new Option(record.serial||record.device.slice(0,8),record.device)));$('roster').value=selected;}
 async function refresh(){
  const generation=controller.generation;
  if(joining||reading?.generation===generation||!controller.gateway)return;
  const read={generation,keepEditors:controller.ready};
  reading=read;
  const pending=controller.pending;
  try{await controller.refresh();if(generation!==controller.generation||joining)return;lastSeen=Date.now();const accepted=acceptedOperation();observe(accepted);if(pending&&!controller.pending){message(controller.lastReceipt?.status==='rejected'?'The headset rejected your last change. Your edits are preserved.':'Your last change is confirmed. Current settings refreshed.');originalOperation=null;originalId=null;}else if(accepted){originalOperation=null;originalId=null;message('Your change is confirmed in the headset settings.');}return true;}
  catch(error){read.keepEditors=false;if(generation===controller.generation&&!joining){message(error.message);render();}return false;}
  finally{if(reading===read)reading=null;}
 }
 async function send(op,payload){
  if(joining||!controller.ready){message('Connect in Setup and read current settings before making changes.');return;}
  const d=op==='set-inputs'?'inputs':['apply-visual','save-profile'].includes(op)?'visual':null;
  if(d&&drafts.conflict(d)){message('The headset settings changed while you were editing. Read current settings, then review or revert your edits.');return;}
  const generation=controller.generation;originalOperation=op;message('Waiting for the headset to confirm your change…');
  try{const sending=controller.send(op,payload);originalId=controller.pending?.id;await sending;if(generation!==controller.generation||joining)return;lastSeen=Date.now();observe(op);originalOperation=null;originalId=null;message(op==='save-profile'?'Visual draft saved. It has not been applied.':'Your change was accepted. Current settings refreshed.');}
  catch(error){if(generation!==controller.generation||joining)return;observe();message(error.message);}
 }
 async function connect(url,identity){
  joining?.abort();const attempt=new AbortController();joining=attempt;controller.close();boundIdentity=null;
  if(!$('trusted-lan').checked){joining=null;wanted=false;message('Confirm that you trust this local Wi-Fi network.');render();return;}
  wanted=true;message();render();
  try{const result=await ShowcaseJoin.localJoin({url,expected:identity,trustedLan:true,signal:attempt.signal});if(joining!==attempt){result.gateway.close();return;}
   expected=result.identity;boundIdentity=result.identity;$('address').value=result.url;roster.verified(result.identity,result.url);renderRoster();controller.bind(result.gateway,result.status);lastSeen=Date.now();observe();
  }catch(error){if(joining===attempt)message(error.message);}finally{if(joining===attempt){joining=null;render();}}
 }
 function requestProfile(op,payload){confirmation={op,payload};const replacing=op==='save-profile'?`Replace saved profile “${payload.name}” with the visual draft?`:op==='delete-profile'?`Delete saved profile “${payload.name}”?`:`Apply “${payload.name}” and replace the current visual edits?`;$('profile-confirm').textContent=replacing;for(const id of ['profile-confirm','confirm-profile','cancel-profile'])$(id).hidden=false;}
 function clearConfirmation(){confirmation=null;for(const id of ['profile-confirm','confirm-profile','cancel-profile'])$(id).hidden=true;}
 document.addEventListener('focusin',event=>{const field=event.target;if(field.id&&field.closest?.('#page-scroll'))positions.set(navigation.page,{...positions.get(navigation.page),focus:field.id});});
 document.querySelectorAll('[data-page-link]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.pageLink)));
 $('back').addEventListener('click',()=>navigate(navigation.primary));
 $('inputs-form').addEventListener('input',()=>{if(hasDraft()){drafts.replace('inputs',readInputs());render();}});$('inputs-form').addEventListener('change',()=>{if(hasDraft()){drafts.replace('inputs',readInputs());render();}});
 $('inputs-form').addEventListener('submit',event=>{event.preventDefault();const input=readInputs();if(input.breath_source==='automatic')input.breath_mapping='state';return send('set-inputs',input);});
 $('visual-form').addEventListener('submit',event=>{event.preventDefault();try{return send('apply-visual',{visual:P.visual(editor.value())});}catch(error){message(error.message);}});
 $('revert-draft').addEventListener('click',()=>{if(!domain())return;drafts.revert(domain());syncDraftControls();message('Edits reverted to the latest headset settings.');render();});
 $('reload-settings').addEventListener('click',async()=>{const read=await refresh();if(read&&!controller.pending)message('Current settings refreshed. Your unapplied edits are preserved.');});
 $('connect').addEventListener('click',()=>connect($('address').value.trim(),expected));$('address').addEventListener('input',()=>{expected=null;});
 $('roster').addEventListener('change',()=>{const record=roster.records.find(r=>r.device===$('roster').value);expected=record?{device:record.device,serial:record.serial}:null;if(record?.gateway)$('address').value=record.gateway;});
 $('discover').addEventListener('click',async()=>{message();try{const found=await discovery.find();if(found.product!==P.PRODUCT)throw Error('This headset is not a showcase product');roster.remember(found);renderRoster();expected=found;if(!found.gateways.length)throw Error('Headset has no current Wi-Fi address. Connect it to the phone hotspot.');$('address').value=found.gateways[0];await connect(found.gateways[0],found);}catch(error){message(error.message);}});
 $('disconnect').addEventListener('click',()=>{wanted=false;joining?.abort();joining=null;discovery.cancel();controller.close();boundIdentity=null;render();message('Disconnected. Your edits stay here; the headset continues independently.');});
 document.querySelectorAll('[data-op]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.op,button.dataset.op==='calibrate'?{action:button.dataset.action}:{})));
 $('polar-select').addEventListener('click',()=>send('polar-select',{device_id:$('polar-device').value}));
 $('apply-profile').addEventListener('click',()=>{const payload={name:$('profiles').value};drafts.dirty('visual')?requestProfile('apply-profile',payload):send('apply-profile',payload);});
 $('delete-profile').addEventListener('click',()=>requestProfile('delete-profile',{name:$('profiles').value}));$('profiles').addEventListener('change',()=>{clearConfirmation();render();});
 $('save-profile').addEventListener('click',()=>{try{const payload={name:$('profile-name').value.trim(),visual:P.visual(editor.value())};if(Object.hasOwn(controller.current.profiles,payload.name))requestProfile('save-profile',payload);else send('save-profile',payload);}catch(error){message(error.message);}});
 $('confirm-profile').addEventListener('click',()=>{if(!confirmation)return;const {op,payload}=confirmation;clearConfirmation();send(op,payload);});$('cancel-profile').addEventListener('click',clearConfirmation);
 function recover(){const gateway=controller.gateway;if(wanted&&gateway?.retired&&['transient','rejoin-needed'].includes(gateway.retirementError?.kind)&&expected&&!joining&&Date.now()-lastRejoin>6000){lastRejoin=Date.now();connect($('address').value.trim(),{device:expected.device,serial:expected.serial});}else refresh();}
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recover();});setInterval(()=>{if(document.visibilityState==='visible'&&wanted){recover();render();}},3000);
 Promise.all(['visual-schema.json','default-visual.json'].map(path=>fetch(path,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Offline shell incomplete');return r.json();}))).then(([definition])=>{schema=definition;P.configure(schema);if(hasDraft())syncDraftControls();render();}).catch(error=>message(error.message));
 if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(async registration=>{const active=(await navigator.serviceWorker.ready).active,channel=new MessageChannel();const ready=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),3000);channel.port1.onmessage=({data})=>{clearTimeout(timer);resolve(data?.ready===true);};active.postMessage({type:'CHECK_SHOWCASE_SHELL'},[channel.port2]);});channel.port1.close();$('offline-status').textContent=ready?'Offline shell ready. Headset control still needs local Wi-Fi.':'Offline shell incomplete. Keep internet available and reopen this page.';if(registration.waiting)$('offline-status').textContent+=' An update is ready; close all showcase windows to apply it.';}).catch(()=>{$('offline-status').textContent='Offline shell unavailable.';});
 const viewport=globalThis.visualViewport;if(viewport){const fit=()=>document.documentElement.style.setProperty('--app-height',viewport.height+'px');viewport.addEventListener('resize',fit);fit();}
 renderRoster();navigate('inputs');
})();
