import { computeElectricalCase } from './domain/electricalEngine.js';
export const RC45_REFERENCE_CASES = Object.freeze([
  {id:'sep-conforme',terreConfig:'separee',mode:'edf',rm:10,rni:12,rmn:19,expected:{rc:1.5,c:0.15,valid:true,ok:true,target:0.15}},
  {id:'sep-non-conforme',terreConfig:'separee',mode:'edf',rm:10,rni:12,rmn:17,expected:{rc:2.5,c:0.25,valid:true,ok:false,target:0.15}},
  {id:'sep-invalide',terreConfig:'separee',mode:'edf',rm:10,rni:12,rmn:30,expected:{valid:false,ok:false,target:0.15}}
]);
export const evaluateReferenceCase = input => computeElectricalCase(input);
function fnv1a(text){let h=0x811c9dc5;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)}return (h>>>0).toString(16).toUpperCase().padStart(8,'0')}
export function qualificationDigest(input=RC45_REFERENCE_CASES){const payload=Array.isArray(input)?input.map(c=>{const r=evaluateReferenceCase(c);return `${c.id}:${r.status}:${Number.isFinite(r.c)?r.c.toFixed(6):'NA'}`}).join('|'):JSON.stringify(input,Object.keys(input).sort());return `RC45-${fnv1a(payload)}`;}
