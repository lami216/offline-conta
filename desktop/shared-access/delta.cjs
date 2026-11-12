/* eslint-disable @typescript-eslint/no-require-imports */
// Same negotiated patch contract as the Android client; no accounting reducer fork.
const {canonical,hash:sha256}=require('./protocol.cjs');
const lists=new Set(['products','parties','accounts','records','categories']);
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeKey=key=>typeof key==='string'&&key.length>0&&key.length<=500&&!['__proto__','constructor','prototype'].includes(key);
const fail=()=>{throw Object.assign(Error('ONLINE_DELTA_INVALID'),{code:'ONLINE_DELTA_INVALID'});};
const viewHash=state=>sha256(canonical(state));
function applySharedDelta(state,position,response,scope){
 if(!object(response)||response.organizationId!==scope.organizationId||response.branchId!==scope.branchId||response.epoch!==position.epoch||response.fromCursor!==position.cursor||response.view!==position.view||typeof response.hasMore!=='boolean'||!Number.isSafeInteger(response.cursor)||response.cursor<position.cursor||!Array.isArray(response.patches)||response.patches.length>200||!/^[a-f0-9]{64}$/.test(response.viewHash||''))fail();
 let next=clone(state),cursor=position.cursor,hash=position.hash;
 for(const patch of response.patches){
  if(!object(patch)||patch.fromCursor!==cursor||!Number.isSafeInteger(patch.cursor)||patch.cursor<=cursor||patch.beforeHash!==hash||!/^[a-f0-9]{64}$/.test(patch.afterHash||'')||!object(patch.changes)||!object(patch.scalars)||!object(patch.scalars.set)||!Array.isArray(patch.scalars.delete))fail();
  for(const [collection,change]of Object.entries(patch.changes)){
   if(!lists.has(collection)||!object(change)||!Array.isArray(change.upserts)||!Array.isArray(change.deletes)||!Array.isArray(next[collection]))fail();
   if(Object.keys(change).some(key=>!['upserts','deletes','order'].includes(key)))fail();
   const removes=new Set(change.deletes);if(removes.size!==change.deletes.length||[...removes].some(key=>!safeKey(key)))fail();
   const upserts=new Map();for(const row of change.upserts){if(!object(row)||!safeKey(row.globalId)||upserts.has(row.globalId)||removes.has(row.globalId))fail();upserts.set(row.globalId,clone(row));}
   const seen=new Set();let rows=next[collection].filter(row=>!removes.has(row.globalId)).map(row=>{if(!safeKey(row.globalId)||seen.has(row.globalId))fail();seen.add(row.globalId);const replacement=upserts.get(row.globalId);upserts.delete(row.globalId);return replacement||row;});
   rows.push(...upserts.values());
   if(change.order!==undefined){if(!Array.isArray(change.order)||change.order.length!==rows.length||new Set(change.order).size!==rows.length)fail();const byId=new Map(rows.map(row=>[row.globalId,row]));rows=change.order.map(id=>{if(!safeKey(id)||!byId.has(id))fail();return byId.get(id);});}
   next[collection]=rows;
  }
  for(const key of patch.scalars.delete){if(!safeKey(key)||lists.has(key)||Object.hasOwn(patch.scalars.set,key))fail();delete next[key];}
  for(const [key,value]of Object.entries(patch.scalars.set)){if(!safeKey(key)||lists.has(key)||['originId','syncScope'].includes(key))fail();next[key]=clone(value);}
  if(next.originId!==state.originId||canonical(next.syncScope)!==canonical(state.syncScope)||viewHash(next)!==patch.afterHash)fail();
  cursor=patch.cursor;hash=patch.afterHash;
 }
 if(cursor!==response.cursor||hash!==response.viewHash||response.hasMore&&cursor===position.cursor)fail();
 return {state:next,cursor,hash,changed:cursor!==position.cursor};
}

module.exports={viewHash,applySharedDelta};
