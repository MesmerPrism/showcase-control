(function(root){
 'use strict';
 function validate(value,schema,path='settings'){
  if(schema.const!==undefined&&value!==schema.const)throw Error(`${path}: unexpected value`);
  if(schema.enum&&!schema.enum.includes(value))throw Error(`${path}: unsupported choice`);
  if(schema.type==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}: object required`);
   for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw Error(`${path}.${key}: required`);
   for(const key of Object.keys(value)){
    if(!schema.properties?.[key]){if(schema.additionalProperties===false)throw Error(`${path}.${key}: unknown field`);}
    else validate(value[key],schema.properties[key],`${path}.${key}`);
   }
  }
  if(schema.type==='array'){
   if(!Array.isArray(value)||value.length<(schema.minItems||0)||value.length>(schema.maxItems??Infinity))throw Error(`${path}: invalid array size`);
   value.forEach((v,i)=>{const child=schema.prefixItems?.[i]||schema.items;if(child===false||!child)throw Error(`${path}: unexpected item`);validate(v,child,`${path}[${i}]`);});
  }
  if(['number','integer'].includes(schema.type)&&(!Number.isFinite(value)||schema.type==='integer'&&!Number.isInteger(value)||value<schema.minimum||value>schema.maximum))throw Error(`${path}: outside allowed range`);
  if(schema.type==='boolean'&&typeof value!=='boolean')throw Error(`${path}: boolean required`);
  if(schema.type==='string'&&typeof value!=='string')throw Error(`${path}: text required`);
  return value;
 }
 const api={validate};if(typeof module!=='undefined')module.exports=api;else root.ShowcaseValidation=api;
})(globalThis);
