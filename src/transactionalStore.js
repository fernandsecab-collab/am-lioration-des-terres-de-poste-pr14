export function stableJson(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}
export function nextRevision(previous=[],snapshot={},actor='Utilisateur',reason='Enregistrement',at=new Date().toISOString()){
  return {number:previous.length+1,createdAt:at,actor,reason,snapshot:JSON.parse(JSON.stringify(snapshot)),immutable:true};
}
export function dedupeByUuid(records=[]){
  const map=new Map();
  for(const r of records){const id=r?.uuid||r?.id;if(!id)continue;const current=map.get(id);if(!current||String(r.updatedAt||'')>String(current.updatedAt||''))map.set(id,r)}
  return [...map.values()];
}
export function verifyAuditChain(audit=[],hashFn){
  let previousHash='GENESIS';
  for(const item of audit){const {hash,...unsigned}=item;if(unsigned.previousHash!==previousHash||hashFn(unsigned)!==hash)return false;previousHash=hash}
  return true;
}
