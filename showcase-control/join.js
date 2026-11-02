/* Product-bound local enrollment. Credentials remain only inside Gateway. */
(function(root){
 'use strict';
 const P=typeof module!=='undefined'?require('./protocol.js'):root.ShowcaseProtocol;
 function checkIdentity(v,expected){
  if(!v||v.product!==P.PRODUCT||v.v!==1||!/^[a-f0-9]{32}$/.test(v.device||'')||typeof v.serial!=='string'||new TextEncoder().encode(v.serial).length>64||!(/^[1-9][0-9]{0,18}$/.test(v.epoch)&&/^[1-9][0-9]{0,18}$/.test(v.native_epoch))||v.enabled!==true||v.remote_available!==true)throw Error('This is not an available showcase headset');
  if(expected&&(v.device!==expected.device||v.serial!==expected.serial||expected.epoch!==undefined&&v.epoch!==expected.epoch||expected.native_epoch!==undefined&&v.native_epoch!==expected.native_epoch))throw Error('Headset identity changed. Find the headset again.');
  return v;
 }
 async function localJoin({url,expected,trustedLan=false,signal,fetcher=root.fetch.bind(root),cryptoApi=root.crypto,Gateway=root.ShowcaseNeutralTransport?.Gateway,discovery=root.ShowcaseDiscovery}){
  if(!trustedLan)throw Error('Confirm trusted local Wi-Fi before connecting');
  url=discovery.localEndpoint(url);
  const lifetime=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]);let gateway;
  const run=async operation=>{
   let cancel;const aborted=new Promise((_,reject)=>{cancel=()=>reject(lifetime.reason);lifetime.addEventListener('abort',cancel,{once:true});});
   try{lifetime.throwIfAborted();const result=await Promise.race([operation,aborted]);lifetime.throwIfAborted();return result;}
   finally{lifetime.removeEventListener('abort',cancel);}
  };
  const request=async body=>{
   lifetime.throwIfAborted();
   const response=await run(fetcher(url,{method:body?'POST':'GET',body:body&&JSON.stringify(body),headers:body?{'Content-Type':'application/json'}:{},cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:lifetime}));
   lifetime.throwIfAborted();if(!response.ok)throw Error(`Headset unavailable (${response.status})`);
   const text=await run(response.text());lifetime.throwIfAborted();if(new TextEncoder().encode(text).length>4096)throw Error('Identity response too large');return JSON.parse(text);
  };
  try{
   const live=checkIdentity(await request(),expected);
   const joined=await request({v:1,product:P.PRODUCT,action:'connect',device:live.device,epoch:live.epoch});
   if(!joined||Object.keys(joined).sort().join(',')!=='controller,device,epoch,key,product,serial,v'||joined.product!==P.PRODUCT||joined.v!==1||joined.device!==live.device||joined.epoch!==live.epoch||joined.serial!==live.serial)throw Error('Showcase enrollment identity changed');
   gateway=new Gateway({url,controller:joined.controller,key:joined.key,device:joined.device,serial:live.serial,guest:true,trustedLan:true,fetcher,cryptoApi});
   // Guard every fresh identity read, including maintained Gateway recovery.
   const original=gateway.request.bind(gateway);
   gateway.request=async(method,body,options)=>{const result=await original(method,body,options);if(method==='GET'&&result.product!==P.PRODUCT)throw Error('Showcase product identity changed');return result;};
   gateway.nativeEpoch=live.native_epoch;
   const connecting=gateway.connect({identity:live});
   connecting.then(()=>{if(lifetime.aborted)gateway.close();},()=>{});
   const status=P.status(await run(connecting));
   if(status.epoch!==live.native_epoch)throw Error('Native showcase changed during connection');
   lifetime.throwIfAborted();
   return {gateway,status,url,identity:{device:live.device,serial:live.serial,epoch:live.epoch,native_epoch:live.native_epoch}};
  }catch(error){gateway?.close();throw error;}
 }
 const api={localJoin,checkIdentity};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseJoin=api;
})(globalThis);
