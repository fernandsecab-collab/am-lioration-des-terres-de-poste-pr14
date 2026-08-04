export const MAX_IMPORT_BYTES=25*1024*1024;
export const MAX_RECORDS_PER_IMPORT=5000;

export function sanitizeText(value,max=4000){
  return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,max);
}

export function safeJsonParse(text,{maxChars=35_000_000}={}){
  if(typeof text!=='string') throw new Error('Contenu texte attendu');
  if(text.length>maxChars) throw new Error('Fichier trop volumineux');
  const value=JSON.parse(text);
  if(!value||typeof value!=='object') throw new Error('Structure JSON invalide');
  return value;
}

export function validateRecordShape(record){
  if(!record||typeof record!=='object'||Array.isArray(record)) return {ok:false,error:'Affaire invalide'};
  const id=sanitizeText(record.uuid||record.id,160);
  if(!id) return {ok:false,error:'Identifiant d’affaire manquant'};
  return {ok:true,record:{...record,id:sanitizeText(record.id||id,160),uuid:sanitizeText(record.uuid||id,160)}};
}

export function extractImportedRecords(payload){
  let records=[];
  if(payload?.type==='SECAB_BACKUP') records=payload.records;
  else if(payload?.type==='SECAB_TERRAIN_SYNC'||payload?.type==='SECAB_DAY') records=(payload.records||[]).map(x=>x?.record||x);
  else if(payload?.record) records=[payload.record];
  else if(payload?.uuid||payload?.id) records=[payload];
  if(!Array.isArray(records)||!records.length) throw new Error('Aucune affaire SECAB reconnue');
  if(records.length>MAX_RECORDS_PER_IMPORT) throw new Error('Import trop volumineux');
  return records.map((record,index)=>{const checked=validateRecordShape(record);if(!checked.ok)throw new Error(`Affaire ${index+1} : ${checked.error}`);return checked.record});
}

export async function readJsonFile(file){
  if(!file) throw new Error('Fichier manquant');
  if(Number(file.size||0)>MAX_IMPORT_BYTES) throw new Error('Fichier supérieur à 25 Mo');
  return safeJsonParse(await file.text());
}

export function createSafeStorage(storage=localStorage){
  return {
    get(key,fallback){try{const raw=storage.getItem(key);return raw===null?fallback:JSON.parse(raw)}catch{return fallback}},
    set(key,value){try{storage.setItem(key,JSON.stringify(value));return true}catch{return false}},
    remove(key){try{storage.removeItem(key);return true}catch{return false}}
  };
}
