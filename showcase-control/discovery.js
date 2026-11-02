/* Nearby identity discovery only. No controller credentials or commands. */
(function(root) {
  'use strict';
  const UUID=Object.freeze({service:'9a7b2101-7d6a-4b7f-9d4a-6f7c0a020101',serial:'9a7b2101-7d6a-4b7f-9d4a-6f7c0a020102',metadata:'9a7b2101-7d6a-4b7f-9d4a-6f7c0a020103'});
  const id=value=>typeof value==='string' && /^[0-9a-f]{32}$/.test(value);
  const epoch=value=>typeof value==='string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n;
  function serialValid(value) {return typeof value==='string' && new TextEncoder().encode(value).length<=64 && !/[\u0000-\u001f\u007f]/.test(value);}
  function localEndpoint(value) {
    // Reject URL normalization (hex/short IPv4, path traversal, encoded paths).
    if(typeof value!=='string' || !/^http:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]{1,5})?\/v1\/gateway$/.test(value)) throw Error('Use the exact private IPv4 HTTP gateway address');
    const url=new URL(value),parts=url.hostname.split('.').map(Number);
    if(parts.some(n=>n>255) || !(parts[0]===10 || parts[0]===192 && parts[1]===168 || parts[0]===172 && parts[1]>=16 && parts[1]<=31) || value.match(/^http:\/\/([^/:]+)/)[1]!==url.hostname || url.port==='0') throw Error('Gateway must use a private IPv4 address');
    return url.href;
  }
  function decode(view,max) {
    if(!view || !Number.isInteger(view.byteLength) || view.byteLength>max) throw Error('Discovery read exceeds its byte limit');
    return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(view.buffer,view.byteOffset,view.byteLength));
  }
  function readSerial(view) {const value=decode(view,64);if(!serialValid(value))throw Error('Invalid headset serial');return value;}
  function parseMetadata(view,serial) {
    const m=JSON.parse(decode(view,512));
    if(!m || m.product!=='visual-showcase' || m.v!==1 || !id(m.device) || !epoch(m.epoch) || !epoch(m.native_epoch) || m.mode!=='remote' || !serialValid(m.serial) || m.serial!==serial || !Array.isArray(m.gateways) || m.gateways.length>4)throw Error('Headset discovery identity changed or is unavailable');
    return {v:1,product:'visual-showcase',device:m.device,serial:m.serial,epoch:m.epoch,native_epoch:m.native_epoch,mode:m.mode,gateways:m.gateways.map(localEndpoint)};
  }
  // A browser can return the same BluetoothDevice to either route. Keep the
  // latest claim even after release: a non-abortable old connect may settle
  // later. An active successor must survive; a retired successor leaves no
  // live route to protect and still allows abandoned late-connect cleanup.
  const gattOwners=new WeakMap();
  function claimGatt(device) {
    const owner={active:true};
    gattOwners.set(device,owner);
    return {retire(){owner.active=false;},disconnect(){
      owner.active=false;
      try {const current=gattOwners.get(device);if((current===owner || current?.active===false) && device.gatt?.connected)device.gatt.disconnect();}catch(_) {}
    }};
  }
  class Discovery {
    constructor({bluetooth=root.navigator?.bluetooth}={}) {this.bluetooth=bluetooth;this.attempt=null;}
    cancel() {this.attempt?.abort.abort(Error('Discovery cancelled or retired'));}
    find() {
      this.cancel();
      if(!this.bluetooth?.requestDevice)return Promise.reject(Error('Bluetooth discovery unavailable. Use the manual Wi-Fi address.'));
      const attempt={abort:new AbortController(),device:null};this.attempt=attempt;
      // Keep chooser invocation on the original user-gesture stack, before await.
      let choice;try {choice=this.bluetooth.requestDevice({filters:[{services:[UUID.service]}]});}catch(error){return Promise.reject(error);}
      return this.read(attempt,choice);
    }
    async read(attempt,choice) {
      const signal=attempt.abort.signal;let timer;
      const check=()=>{signal.throwIfAborted();if(this.attempt!==attempt)throw Error('Discovery retired');};
      let rejectAbort;
      const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(signal.reason);signal.addEventListener('abort',rejectAbort,{once:true});});
      const run=operation=>Promise.race([operation,aborted]);
      const release=()=>attempt.lease?.disconnect();
      try {
        attempt.device=await run(choice);check();attempt.lease=claimGatt(attempt.device);
        timer=setTimeout(()=>attempt.abort.abort(Error('Discovery timed out. Find the headset again.')),15000);
        const connection=attempt.device.gatt.connect();
        connection.then(()=>{if(signal.aborted || this.attempt!==attempt)release();},()=>{});
        const server=await run(connection);check();
        const service=await run(server.getPrimaryService(UUID.service));check();
        const serial=await run(service.getCharacteristic(UUID.serial));check();
        const metadata=await run(service.getCharacteristic(UUID.metadata));check();
        const first=readSerial(await run(serial.readValue()));check();
        const found=parseMetadata(await run(metadata.readValue()),first);check();
        if(readSerial(await run(serial.readValue()))!==first)throw Error('Headset serial changed during discovery');check();
        return {...found,bluetoothId:typeof attempt.device.id==='string'?attempt.device.id:''};
      } finally {clearTimeout(timer);signal.removeEventListener('abort',rejectAbort);release();if(this.attempt===attempt)this.attempt=null;}
    }
  }
  const STORAGE='viscereality-showcase-headset-identities-v1';
  function record(value) {
    if(!value || !id(value.device) || !serialValid(value.serial))throw Error('Invalid remembered identity');
    const clean={device:value.device,serial:value.serial,bluetoothId:typeof value.bluetoothId==='string'?value.bluetoothId.slice(0,256):''};
    if(value.gateway)clean.gateway=localEndpoint(value.gateway);
    return clean;
  }
  class Roster {
    constructor(storage) {
      this.storage=storage;this.records=[];
      try {const saved=JSON.parse(storage?.getItem(STORAGE)||'[]');if(Array.isArray(saved))for(const value of saved.slice(0,8)){try {const clean=record(value);if(!this.records.some(r=>r.device===clean.device))this.records.push(clean);}catch(_) {}}}catch(_) {}
    }
    remember(value) {
      const clean=record({device:value.device,serial:value.serial,bluetoothId:value.bluetoothId});
      const previous=this.records.find(r=>r.device===clean.device && r.serial===clean.serial);
      if(previous?.gateway)clean.gateway=previous.gateway;
      this.records=[clean,...this.records.filter(r=>r.device!==clean.device)].slice(0,8);this.save();return clean;
    }
    verified(value,url) {const clean=this.remember(value);clean.gateway=localEndpoint(url);this.save();return clean;}
    save() {try {this.storage?.setItem(STORAGE,JSON.stringify(this.records.map(record)));}catch(_) {}}
  }
  const api={UUID,Discovery,Roster,localEndpoint,readSerial,parseMetadata,serialValid,epoch,claimGatt};
  if(typeof module!=='undefined')module.exports=api;else root.ShowcaseDiscovery=api;
})(globalThis);
