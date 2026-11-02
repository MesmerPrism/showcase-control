/* Shared controller boundary. Opening a route is never proof of native state. */
(function(root) {
  "use strict";
  const enc = new TextEncoder();
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
  class GatewayError extends Error {
    constructor(kind,code,message,cause) {
      super(message,cause?{cause}:undefined);this.name=cause?.name==="TimeoutError"?"TimeoutError":"GatewayError";
      this.kind=kind;this.code=code;
    }
  }
  const failure=(kind,code,message,cause)=>new GatewayError(kind,code,message,cause);
  async function abortable(operation,signal) {
    let abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});});
    // Attach to the operation even when it synchronously caused cancellation;
    // an abort-ignoring platform promise must never escape as an unhandled reject.
    try {if(signal.aborted)abort();const value=await Promise.race([operation,cancelled]);signal.throwIfAborted();return value;}
    finally {signal.removeEventListener("abort",abort);}
  }
  function endpoint(value, pageProtocol = "https:", trustedLan = false) {
    let url;
    try { url = new URL(value); }
    catch (_) { throw new Error("Enter the complete gateway address supplied during headset setup"); }
    if (url.username || url.password || url.search || url.hash || !["https:","http:"].includes(url.protocol)) throw new Error("Use the exact gateway URL without credentials or query parameters");
    const privateV4=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname);
    if (url.protocol === "http:" && (!trustedLan || !privateV4)) throw new Error("Plain HTTP requires explicit trusted-LAN consent and the headset's private IPv4 address. Browser local-network permission support is required; use Bluetooth if access is blocked.");
    return url.href;
  }
  class Gateway {
    constructor({url, controller, key, device, serial, guest=false, routeToken = "", trustedLan = false, fetcher = root.fetch.bind(root), cryptoApi = root.crypto, pageProtocol = "https:"}) {
      this.url = endpoint(url,pageProtocol,trustedLan);
      if(routeToken && new URL(this.url).protocol!=="https:") throw new Error("Relay requires HTTPS");
      if (!/^[0-9a-f]{32}$/.test(controller) || !/^[0-9a-f]{64}$/.test(key) || !/^[0-9a-f]{32}$/.test(device)) throw new Error("Enter the controller ID, device ID and controller key approved on the headset");
      if (routeToken && (!/\/v1\/relay\/[A-Za-z0-9_-]+\/exchange$/.test(new URL(this.url).pathname) || /[\r\n]/.test(routeToken))) throw new Error("Use the provisioned relay session exchange URL and token");
      Object.assign(this,{controller,key,device,serial,guest,routeToken,fetcher,cryptoApi,active:false,retired:false});
      this.lifetime=new AbortController();
      this.statusTimedOut=false;
      this.recovering=false;
    }
    async sign(text) {
      const key = await this.cryptoApi.subtle.importKey("raw",enc.encode(this.key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      return hex(new Uint8Array(await this.cryptoApi.subtle.sign("HMAC",key,enc.encode(text))));
    }
    async request(method, body, {signal} = {}) {
      const url=this.routeToken && method==="GET" ? this.url.replace(/\/exchange$/,"/identity") : this.url;
      const headers=body?{"Content-Type":"application/json"}:{};
      if(this.routeToken) headers.Authorization=`Bearer ${this.routeToken}`;
      // Relay exchanges may wait twelve seconds for the device; allow response
      // transit time without extending direct-LAN or identity request deadlines.
      const timeoutMs=this.routeToken && method==="POST" ? 15000 : 10000;
      const bounded=AbortSignal.any([this.lifetime.signal,...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]);
      try {
        bounded.throwIfAborted();
        const response=await abortable(this.fetcher(url,{method,body:body && JSON.stringify(body),headers,cache:"no-store",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",signal:bounded}),bounded);
        if(!response.ok){
          const retry=response.status===408 || response.status===429 || response.status>=500;
          throw failure(retry?"transient":"integrity",`http-${response.status}`,`Gateway unavailable (${response.status}); reconnect and read current state`);
        }
        const text=await abortable(response.text(),bounded);
        if(enc.encode(text).length>65536)throw failure("integrity","response-size","Gateway response too large");
        try {return JSON.parse(text);}catch(error){throw failure("integrity","response-json","Invalid gateway response",error);}
      } catch(error) {
        if(signal?.aborted)throw signal.reason;
        if(this.lifetime.signal.aborted)throw this.lifetime.signal.reason;
        if(error instanceof GatewayError)throw error;
        if(bounded.aborted || error?.name==="TimeoutError" || error?.name==="TypeError")throw failure("transient",bounded.aborted || error.name==="TimeoutError"?"timeout":"network",error.message,error);
        throw error;
      }
    }
    async connect({identity} = {}) {
      try {
        if(this.retired)throw new Error("Connection retired");
        const hint = identity || await this.request("GET");
        if (!hint || hint.v!==1 || hint.device!==this.device || this.serial!==undefined && hint.serial!==this.serial || !/^[1-9][0-9]{0,18}$/.test(hint.epoch)) throw failure("integrity","physical-identity","Gateway device identity does not match headset enrollment");
        if(hint.enabled!==true || hint.remote_available===false)throw failure("availability","remote-unavailable","Waiting for Remote on the headset");
        this.epoch=hint.epoch;
        const status = await this.exchange("status",{});
        if (!status?.o || !/^[1-9][0-9]{0,18}$/.test(status.o.e) || status.o.s !== "observed") throw failure("availability","native-unavailable","Fresh native runtime identity unavailable");
        if (this.retired) throw new Error("Connection retired");
        this.nativeEpoch=status.o.e;
        this.active=true;
        return status;
      } catch(error) {this.close(error);throw error;}
    }
    async exchange(action,payload,{signal,recovery=false}={}) {
      if (this.retired) throw new Error("Connection retired");
      if ((this.statusTimedOut || this.recovering) && !["status","receipt"].includes(action)) throw new Error("Connection recovering; read current status before commands");
      try {
        const lifetime=AbortSignal.any([this.lifetime.signal,...(signal?[signal]:[])]);
        lifetime.throwIfAborted();
        const nonce=hex(this.cryptoApi.getRandomValues(new Uint8Array(16))), serialized=JSON.stringify(payload);
        const mac=await abortable(this.sign(`RQG1|${this.controller}|${this.epoch}|${nonce}|${action}|${serialized}`),lifetime);
        const reply=await this.request("POST",{v:1,controller:this.controller,epoch:this.epoch,nonce,action,payload:serialized,mac},{signal});
        if (!reply || reply.v!==1 || reply.device!==this.device || reply.epoch!==this.epoch || reply.nonce!==nonce || reply.action!==action || typeof reply.payload!=="string" || !/^[0-9a-f]{64}$/.test(reply.mac||"")) throw failure("integrity","reply-binding","Gateway identity or request binding changed");
        const expected=await abortable(this.sign(`RQG1-REPLY|${this.controller}|${this.device}|${this.epoch}|${nonce}|${action}|${reply.payload}`),lifetime);
        if (expected!==reply.mac || this.retired) throw failure("integrity","reply-mac","Gateway authentication failed or connection retired");
        let result;try {result=JSON.parse(reply.payload);}catch(error){throw failure("integrity","payload-json","Invalid authenticated payload",error);}
        if(action==="status" && this.nativeEpoch){
          if(result?.o?.s!=="observed")throw failure("availability","native-unavailable","Fresh native runtime identity unavailable");
          if(result.o.e!==this.nativeEpoch)throw failure("rejoin-needed","native-lifetime","Native runtime changed; reconnect without replaying commands");
        }
        return result;
      } catch(error) {
        if(signal?.aborted && !this.retired){this.active=false;this.statusTimedOut=true;throw signal.reason;}
        if(["status","breath-monitor","receipt"].includes(action) && !this.retired && (this.active || this.recovering || this.statusTimedOut) && (error?.kind==="transient" || recovery && error?.kind==="availability")) {
          this.active=false;this.statusTimedOut=true;
        } else if(["status","breath-monitor","receipt"].includes(action) && this.guest && ["http-401","http-403"].includes(error?.code)) {
          const expired=failure("rejoin-needed","guest-expired","Guest expired or revoked; verify the same headset before joining",error);
          this.close(expired);throw expired;
        } else this.close(error);
        throw error;
      }
    }
    async recoverStatusOnce({signal}={}) {
      signal?.throwIfAborted();
      if(this.retired)return {kind:"blocked",error:this.retirementError || failure("rejoin-needed","retired","Connection retired; verify the headset before joining")};
      if(!this.epoch || !this.nativeEpoch)return {kind:"blocked",error:failure("availability","not-connected","Connect and verify a native owner before recovery")};
      if(this.recovering)return {kind:"retry",error:failure("availability","read-in-progress","Status recovery already in progress")};
      this.recovering=true;this.active=false;this.statusTimedOut=true;this.recoveredStatus=null;
      try {
        const hint=await this.request("GET",undefined,{signal});
        if(!hint || hint.v!==1 || hint.device!==this.device || this.serial!==undefined && hint.serial!==this.serial)throw failure("integrity","physical-identity","Gateway device identity or serial changed");
        // Retirement exposes zero only with explicit unavailable flags under
        // the existing gateway lifetime; it grants no native/status authority.
        const ownerUnavailable=hint.native_epoch==="0" && hint.enabled===false && hint.remote_available===false && hint.epoch===this.epoch;
        if(!/^[1-9][0-9]{0,18}$/.test(hint.epoch) || !ownerUnavailable && (this.guest || hint.native_epoch!==undefined) && !/^[1-9][0-9]{0,18}$/.test(hint.native_epoch))throw failure("integrity","identity-schema","Gateway identity lifetime is malformed");
        if(hint.epoch!==this.epoch)throw failure("rejoin-needed","gateway-lifetime","Gateway owner changed; verify the headset before joining");
        if(ownerUnavailable)throw failure("availability","native-unavailable","Waiting for an available native owner on the headset");
        if(hint.native_epoch!==undefined && hint.native_epoch!==this.nativeEpoch)throw failure("rejoin-needed","native-lifetime","Native runtime changed; verify the headset before joining");
        if(hint.enabled!==true || hint.remote_available===false)throw failure("availability","remote-unavailable","Waiting for Remote on the headset");
        if(this.guest && hint.remote_available!==true)throw failure("integrity","identity-schema","Local Remote availability is missing");
        const status=await this.exchange("status",{},{signal,recovery:true});
        if(this.retired)throw failure("rejoin-needed","retired","Connection retired");
        signal?.throwIfAborted();
        this.recoveredStatus={value:status,signal};
        return {kind:"success",value:status};
      } catch(error) {
        if(signal?.aborted)throw signal.reason;
        if(this.retired && this.lifetime.signal.aborted && !(error instanceof GatewayError))throw error;
        const typed=error instanceof GatewayError?error:failure("integrity","unexpected",error.message || "Invalid gateway recovery",error);
        if(["transient","availability"].includes(typed.kind))return {kind:"retry",error:typed};
        this.close();this.retirementError=typed;return {kind:"blocked",error:typed};
      } finally {this.recovering=false;}
    }
    acceptRecoveredStatus(status) {
      if(this.retired || this.recovering || !this.recoveredStatus || this.recoveredStatus.value!==status || this.recoveredStatus.signal?.aborted)return false;
      this.recoveredStatus=null;this.statusTimedOut=false;this.active=true;return true;
    }
    waitForRecovery(ms) {
      return new Promise((resolve,reject)=>{
        const signal=this.lifetime.signal;
        if(signal.aborted){reject(signal.reason);return;}
        const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener("abort",cancel);resolve();},ms);
        signal.addEventListener("abort",cancel,{once:true});
      });
    }
    async recoverStatus(onAttempt=()=>{}) {
      if(this.retired || !this.statusTimedOut || this.recovering) throw new Error("Status recovery unavailable");
      this.recovering=true;
      try {
        for(let attempt=1;attempt<=2;attempt++) {
          onAttempt(attempt,2);
          await this.waitForRecovery(attempt===1?1000:3000);
          if(this.retired) throw new Error("Connection retired");
          try {
            const hint=await this.request("GET");
            if(hint.v!==1 || hint.device!==this.device || hint.epoch!==this.epoch || hint.enabled!==true) throw new Error("Gateway enrollment or owner changed; reconnect manually");
            const status=await this.exchange("status",{});
            if(status.o?.s!=="observed" || status.o.e!==this.nativeEpoch || this.retired) throw new Error("Native runtime changed; reconnect without replaying commands");
            this.statusTimedOut=false;this.active=true;
            return new DataView(enc.encode(JSON.stringify(status)).buffer);
          } catch(error) {
            if(error?.name!=="TimeoutError" || this.retired || attempt===2) throw error;
          }
        }
      } catch(error) {this.close();throw error;}
      finally {this.recovering=false;}
    }
    async read(name,id) {
      const payload=await this.exchange(name,name==="receipt"?{id}:{});
      return new DataView(enc.encode(JSON.stringify(payload)).buffer);
    }
    async write(bytes) {
      if(!this.active) throw new Error("Connection unavailable; no command sent");
      const command=JSON.parse(new TextDecoder().decode(bytes));
      delete command.mac;
      this.lastId=command.id;
      return this.exchange("command",command);
    }
    close(error) { if(error instanceof GatewayError)this.retirementError=error; this.active=false; this.retired=true; this.statusTimedOut=false; this.recovering=false; this.recoveredStatus=null; this.key=""; this.routeToken=""; this.lifetime.abort(); }
  }
  const api={Gateway,GatewayError,endpoint};
  if(typeof module!=="undefined")module.exports=api;else root.ShowcaseNeutralTransport=api;
})(globalThis);
