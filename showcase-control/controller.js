(function(root){
 'use strict';
 const P=typeof module!=='undefined'?require('./protocol.js'):root.ShowcaseProtocol;
 class Controller{
  constructor({id=()=>root.crypto.randomUUID().replaceAll('-',''),changed=()=>{}}={}){this.id=id;this.changed=changed;this.generation=0;this.ready=false;this.pending=null;this.minimumRevision=0;this.lastReceipt=null;}
  bind(gateway,value){const next=P.status(value),sameLifetime=this.current?.epoch===next.epoch,pending=this.pending&&sameLifetime?this.pending:null;this.generation++;if(this.gateway&&this.gateway!==gateway)this.gateway.close?.();this.minimumRevision=sameLifetime?this.minimumRevision:next.revision;this.gateway=gateway;this.snapshots=new P.Snapshots();this.current=this.snapshots.accept(next);this.pending=pending;this.ready=!pending&&next.revision>=this.minimumRevision;this.changed(this);}
  close(){this.generation++;this.gateway?.close?.();this.gateway=null;this.ready=false;this.changed(this);}
  receipt(value){
   const command=this.pending;
   if(!command||!value||value.schema!==P.PREFIX+'receipt.v1'||value.product!==P.PRODUCT||value.product!==command.product||value.epoch!==command.epoch||value.epoch!==this.current.epoch||value.id!==command.id)throw Error('Untrusted command outcome; original request remains unresolved');
   if(!['accepted','rejected','pending','unknown'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<command.expected_revision||(['accepted','pending'].includes(value.status)&&value.revision!==command.expected_revision+1))throw Error('Invalid command outcome revision or status; original request remains unresolved');
   if(['accepted','rejected'].includes(value.status)){this.minimumRevision=Math.max(this.minimumRevision,value.revision);this.lastReceipt={...value};this.pending=null;return value.status;}
   return 'unknown';
  }
  async send(op,payload){
   if(!this.gateway||!this.ready||this.pending)throw Error('Connection or command outcome unavailable; refresh current state');
   const generation=this.generation,command=P.command(this.current,op,payload,this.id());
   this.pending=command;this.ready=false;this.changed(this);
   try{
    const reply=await this.gateway.exchange('command',command);
    if(generation!==this.generation)return;
    const result=this.receipt(reply);
    if(result==='unknown')throw Error('Command outcome unknown; checking original request');
    await this.refresh();
    if(result==='rejected')throw Error(reply.reason||'Headset rejected the change; current settings restored');
    return reply;
   }finally{if(generation===this.generation)this.changed(this);}
  }
  async refresh(){
   if(!this.gateway)return;
   const generation=this.generation,gateway=this.gateway;
   this.ready=false;
   try{
    let value;
    if(gateway.statusTimedOut){
     const outcome=await gateway.recoverStatusOnce();
     if(outcome.kind!=='success')throw outcome.error||Error('Waiting for headset');
     value=outcome.value;
     if(generation!==this.generation)return;
     this.snapshots.accept(value);
     if(!gateway.acceptRecoveredStatus(value))throw Error('Connection recovery changed');
    }else value=await gateway.exchange('status',{});
    if(generation!==this.generation)return;
    this.current=this.snapshots.accept(value);
    if(this.current.revision<this.minimumRevision)throw Error('Waiting for current native revision after command outcome');
    if(this.pending){const receipt=await gateway.exchange('receipt',{id:this.pending.id});if(generation!==this.generation)return;this.receipt(receipt);}
    this.ready=!this.pending&&this.current.revision>=this.minimumRevision;
    this.changed(this);return this.current;
   }catch(error){if(generation===this.generation){this.ready=false;this.changed(this);}throw error;}
  }
 }
 const api={Controller};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseController=api;
})(globalThis);
