(function(root){
 'use strict';
 const clone=v=>structuredClone(v),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const pages={inputs:'inputs',polar:'inputs',calibration:'inputs',visuals:'visuals',scale:'visuals',size:'visuals',orbit:'visuals',tracers:'visuals',material:'visuals',coupling:'visuals',drivers:'visuals',profiles:'profiles',setup:'setup'};
 class Navigation{constructor(){this.page='inputs';}get primary(){return pages[this.page];}go(page){if(!Object.hasOwn(pages,page))throw Error('Unknown page');this.page=page;}back(){this.page=this.primary;}}
 class Drafts{
  constructor(){this.domains={};this.current=null;this.owner=null;}
  observe(state,owner,accepted){
   this.current=clone(state);this.owner=owner+':'+state.epoch;
   for(const domain of ['inputs','visual']){
    const old=this.domains[domain],replace=domain==='inputs'&&accepted==='set-inputs'||domain==='visual'&&['apply-visual','apply-profile'].includes(accepted);
    if(!old||!this.dirty(domain)||replace)this.revert(domain);
    else if(accepted&&old.owner===this.owner&&equal(old.baseline,state[domain])){old.revision=state.revision;old.baseline=clone(state[domain]);}
   }
  }
  value(domain){return clone(this.domains[domain].value);}
  edit(domain,change){change(this.domains[domain].value);}
  replace(domain,value){this.domains[domain].value=clone(value);}
  dirty(domain){const d=this.domains[domain];return !!d&&!equal(d.value,d.baseline);}
  conflict(domain){const d=this.domains[domain];return this.dirty(domain)&&(d.owner!==this.owner||d.revision!==this.current.revision);}
  base(domain){return this.domains[domain]?.revision;}
  revert(domain){if(!this.current)return;this.domains[domain]={value:clone(this.current[domain]),baseline:clone(this.current[domain]),revision:this.current.revision,owner:this.owner};}
 }
 const api={Drafts,Navigation,pages};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseUI=api;
})(globalThis);
