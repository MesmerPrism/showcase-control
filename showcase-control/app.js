(function(){
 'use strict';
 const $=id=>document.getElementById(id),P=ShowcaseProtocol;
 let schema,editor,inputDirty=false,visualDirty=false,draftRevision=null,lastSeen=0,reading=null,joining=null,expected=null,wanted=false,lastRejoin=0;
 let storage;try{storage=localStorage;}catch(_){}
 const roster=new ShowcaseDiscovery.Roster(storage),discovery=new ShowcaseDiscovery.Discovery();
 const controller=new ShowcaseController.Controller({changed:render});
 function message(text=''){ $('message').textContent=text;$('message').hidden=!text; }
 function loadInputs(inputs){for(const [key,value]of Object.entries(inputs)){const field=$('inputs-form').elements.namedItem(key);if(field)field.type==='checkbox'?field.checked=value:field.value=value;}}
 function loadDraft(){if(!schema||!controller.current)return;loadInputs(controller.current.inputs);editor=ShowcaseForms.form($('visual-controls'),schema,controller.current.visual,{change:()=>{visualDirty=true;render();}});inputDirty=false;visualDirty=false;draftRevision=controller.current.revision;render();}
 function render(){
  const state=controller.current,conflict=!!state&&draftRevision!==null&&state.revision!==draftRevision&&(inputDirty||visualDirty),ready=!joining&&controller.ready&&!conflict;
  for(const id of ['inputs-fields','profile-fields','sensor-fields','visual-fields'])$(id).disabled=!ready;
  $('inputs-form').elements.namedItem('breath_mapping').disabled=!ready||$('inputs-form').elements.namedItem('breath_source').value==='automatic';
  $('reload-settings').disabled=!controller.gateway;
  $('disconnect').disabled=!controller.gateway&&!joining;
  $('connection-status').textContent=joining?'Connecting…':controller.ready?'Connected to showcase':controller.gateway?(controller.pending?'Checking original command outcome…':'Waiting for current headset state'):(controller.pending?'Disconnected · previous command outcome unknown':'Disconnected');
  if(conflict)message('Settings changed on the headset while you were editing. Read current settings before applying changes.');
  if(!state)return;
  const availability=state.availability;
  $('availability').textContent=availability.selected_polar_unavailable?'Selected Polar data unavailable. Radius holds its last value; the headset keeps reconnecting.':`Breathing: ${state.inputs.breath_source}${state.inputs.breath_source==='automatic'?' · '+state.automatic_phase:''}. Heartbeat: ${state.inputs.heartbeat_source}.`;
  $('freshness').textContent=lastSeen?`Last current status ${Math.max(0,Math.floor((Date.now()-lastSeen)/1000))} s ago · revision ${state.revision}${state.rendered_visual_revision===state.revision?' · visuals applied':''}`:'';
  const names=Object.keys(state.profiles),selected=$('profiles').value;
  if(JSON.stringify(names)!==JSON.stringify([...$('profiles').options].map(o=>o.value))){$('profiles').replaceChildren(...names.map(name=>new Option(name,name)));if(names.includes(selected))$('profiles').value=selected;}
  $('delete-profile').disabled=!ready||$('profiles').value==='default';
  const match=names.find(name=>JSON.stringify(state.profiles[name])===JSON.stringify(state.visual));
  $('profile-status').textContent=`${match?'Current profile: '+match:'Current visuals are modified.'} Profiles keep input selections unchanged.`;
  const polar=state.polar_setup;
  $('polar-status').textContent=polar?`Permission: ${polar.p?'granted':'needed'} · Bluetooth: ${polar.b?'on':'off'} · ${polar.c?'connected':'disconnected'} · ACC ${polar.a?'fresh':'unavailable'}${polar.sc?' · scanning':''}`:'Polar setup status unavailable.';
  if(polar){const devices=Array.isArray(polar.d)?polar.d:[],selectedPolar=$('polar-device').value;const candidates=[...new Set([...(polar.x?[polar.x]:[]),...devices])];$('polar-device').replaceChildren(new Option('Choose a discovered device',''),...candidates.map(id=>new Option(id,id)));$('polar-device').value=candidates.includes(selectedPolar)?selectedPolar:polar.x||'';}
 }
 function renderRoster(){const selected=$('roster').value;$('roster').replaceChildren(new Option('Choose a headset',''),...roster.records.map(record=>new Option(record.serial||record.device.slice(0,8),record.device)));$('roster').value=selected;}
 async function refresh(){
  const generation=controller.generation;if(joining||reading===generation||!controller.gateway)return;reading=generation;
  try{await controller.refresh();if(generation!==controller.generation||joining)return;lastSeen=Date.now();if(!inputDirty&&!visualDirty&&draftRevision!==controller.current.revision)loadDraft();render();}
  catch(error){if(generation===controller.generation&&!joining){message(error.message);render();}}
  finally{if(reading===generation)reading=null;}
 }
 async function send(op,payload){
  if(joining||!controller.ready){message('Connect and read current headset settings before making changes.');return;}
  const generation=controller.generation;
  message();try{await controller.send(op,payload);if(generation!==controller.generation||joining)return;lastSeen=Date.now();loadDraft();message('Change accepted by headset.');}
  catch(error){if(generation!==controller.generation||joining)return;message(error.message);if(!controller.pending&&!inputDirty&&!visualDirty)loadDraft();}
 }
 async function connect(url,identity){
  joining?.abort();const attempt=new AbortController();joining=attempt;controller.close();
  if(!$('trusted-lan').checked){joining=null;wanted=false;message('Confirm that you trust this local Wi-Fi network.');render();return;}
  wanted=true;message();render();
  try{
   const result=await ShowcaseJoin.localJoin({url,expected:identity,trustedLan:true,signal:attempt.signal});
   if(joining!==attempt){result.gateway.close();return;}
   expected=result.identity;$('address').value=result.url;roster.verified(result.identity,result.url);renderRoster();
   controller.bind(result.gateway,result.status);lastSeen=Date.now();loadDraft();
   if(controller.pending)await refresh();
  }catch(error){if(joining===attempt)message(error.message);}
  finally{if(joining===attempt){joining=null;render();}}
 }
 $('inputs-form').addEventListener('change',()=>{const fields=$('inputs-form').elements;if(fields.namedItem('breath_source').value==='automatic')fields.namedItem('breath_mapping').value='state';inputDirty=true;render();});
 $('inputs-form').addEventListener('submit',event=>{event.preventDefault();const fields=$('inputs-form').elements;const inputs=Object.fromEntries(['breath_source','breath_mapping','heartbeat_source','controller_projection','polar_projection'].map(key=>[key,fields.namedItem(key).value]));inputs.synthetic_bpm=Number(fields.namedItem('synthetic_bpm').value);inputs.inverted=fields.namedItem('inverted').checked;send('set-inputs',inputs);});
 $('visual-form').addEventListener('submit',event=>{event.preventDefault();try{send('apply-visual',{visual:P.visual(editor.value())});}catch(error){message(error.message);}});
 $('reload-settings').addEventListener('click',async()=>{inputDirty=false;visualDirty=false;await refresh();loadDraft();});
 $('connect').addEventListener('click',()=>connect($('address').value.trim(),expected));
 $('address').addEventListener('input',()=>{expected=null;});
 $('roster').addEventListener('change',()=>{const record=roster.records.find(r=>r.device===$('roster').value);expected=record?{device:record.device,serial:record.serial}:null;if(record?.gateway)$('address').value=record.gateway;});
 $('discover').addEventListener('click',async()=>{message();try{const found=await discovery.find();if(found.product!==P.PRODUCT)throw Error('This headset is not a showcase product');roster.remember(found);renderRoster();expected=found;if(!found.gateways.length)throw Error('Headset has no current Wi-Fi address. Connect it to the phone hotspot.');$('address').value=found.gateways[0];await connect(found.gateways[0],found);}catch(error){message(error.message);}});
 $('disconnect').addEventListener('click',()=>{wanted=false;joining?.abort();joining=null;discovery.cancel();controller.close();message('Disconnected. The headset continues independently.');});
 document.querySelectorAll('[data-op]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.op,button.dataset.op==='calibrate'?{action:button.dataset.action}:{})));
 $('polar-select').addEventListener('click',()=>send('polar-select',{device_id:$('polar-device').value}));
 $('apply-profile').addEventListener('click',()=>send('apply-profile',{name:$('profiles').value}));
 $('delete-profile').addEventListener('click',()=>send('delete-profile',{name:$('profiles').value}));
 $('profiles').addEventListener('change',render);
 $('save-profile').addEventListener('click',()=>{try{send('save-profile',{name:$('profile-name').value.trim(),visual:P.visual(editor.value())});}catch(error){message(error.message);}});
 function recover(){
  const gateway=controller.gateway;
  if(wanted&&gateway?.retired&&['transient','rejoin-needed'].includes(gateway.retirementError?.kind)&&expected&&!joining&&Date.now()-lastRejoin>6000){lastRejoin=Date.now();connect($('address').value.trim(),{device:expected.device,serial:expected.serial});}
  else refresh();
 }
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recover();});
 setInterval(()=>{if(document.visibilityState==='visible'&&wanted){recover();render();}},3000);
 Promise.all(['visual-schema.json','default-visual.json'].map(path=>fetch(path,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Offline shell incomplete');return r.json();}))).then(([definition,defaults])=>{schema=definition;P.configure(schema);editor=ShowcaseForms.form($('visual-controls'),schema,defaults);render();}).catch(error=>message(error.message));
 if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(async registration=>{
  const active=(await navigator.serviceWorker.ready).active,channel=new MessageChannel();
  const ready=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),3000);channel.port1.onmessage=({data})=>{clearTimeout(timer);resolve(data?.ready===true);};active.postMessage({type:'CHECK_SHOWCASE_SHELL'},[channel.port2]);});channel.port1.close();
  $('offline-status').textContent=ready?'Offline shell ready. Headset control still needs local Wi-Fi.':'Offline shell incomplete. Keep internet available and reopen this page.';
  if(registration.waiting)$('offline-status').textContent+=' An update is ready; close all showcase windows to apply it.';
 }).catch(()=>{$('offline-status').textContent='Offline shell unavailable.';});
 renderRoster();render();
})();
