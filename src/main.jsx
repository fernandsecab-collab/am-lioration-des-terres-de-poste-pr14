import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType, PageBreak, ImageRun, BorderStyle, VerticalAlign } from 'docx';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { distanceMeters } from './utils/geo.js';
import { loadGovernance, saveGovernance, DEFAULT_WEIGHTS, DEFAULT_REFERENCES, DEFAULT_ROLES, validateReference, daoQuantities } from './rcGovernance.js';
import { NATIONAL_RULESET_VERSION, readinessAssessment, plainLanguageExplanation, expertExplanation, executiveSnapshot, referenceCitation } from './nationalReference.js';
import { productionReadiness, testCatalogue, PRODUCTION_CORE_VERSION } from './productionCore.js';
import { createSafeStorage, extractImportedRecords, readJsonFile } from './rc21Safety.js';
import { computeElectricalCase } from './domain/electricalEngine.js';
import { DEFAULT_RULESET } from './domain/electricalRules.js';
import { validateMeasurementProtocol, repeatabilityAssessment } from './domain/measurementProtocol.js';
import { buildAuthoritativeResult } from './domain/reportIntegrity.js';

const APP_VERSION='2.0.0-RC64';
const SAFE_STORAGE=createSafeStorage();
const UI_THEME_KEY='secab-ui-theme-v31';
const UI_THEMES=[
  {id:'titanium',name:'Titanium',subtitle:'Moderne, technique et très lisible'},
  {id:'copper',name:'Copper Engineering',subtitle:'Chaleureux, distinctif et inspiré du cuivre'},
  {id:'emerald',name:'Emerald Premium',subtitle:'Élégant, frais et confortable au quotidien'},
  {id:'slate',name:'Slate Pro',subtitle:'Sobre, robuste et orienté bureau d’études'},
  {id:'dark-navy',name:'Dark Navy Premium',subtitle:'Immersif et adapté aux faibles lumières'},
  {id:'champagne',name:'Champagne',subtitle:'Luxueux, doux et particulièrement raffiné'},
  {id:'edf-next',name:'EDF Nouvelle Génération',subtitle:'Institutionnel, actuel et identifiable'},
  {id:'black-gold',name:'Black & Gold Executive',subtitle:'Direction, prestige et accents haut de gamme'},
  {id:'volcan-electric',name:'Volcan Électrique',subtitle:'Lave, énergie et reliefs de La Réunion'},
  {id:'lagon-motion',name:'Lagon Motion',subtitle:'Turquoise lumineux, profondeur et fluidité'},
  {id:'tropical-grid',name:'Tropical Grid',subtitle:'Végétation premium et trame technique animée'},
  {id:'aurora-executive',name:'Aurora Executive',subtitle:'Direction premium, lumière polaire et verre dépoli'}
];
function initialUiTheme(){
  const saved=localStorage.getItem(UI_THEME_KEY);
  return UI_THEMES.some(x=>x.id===saved)?saved:'titanium';
}

const SecabDriveFolder = registerPlugin('SecabDriveFolder');
const SAF_FOLDER_KEY='secab-saf-drive-folder';
function utf8ToBase64(text){
  const bytes=new TextEncoder().encode(text);let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
async function chooseSecabDriveFolder(){
  if(!IS_NATIVE_ANDROID) throw new Error('Le choix du dossier Drive est disponible uniquement sur Android.');
  const result=await SecabDriveFolder.chooseFolder();
  if(result?.uri){localStorage.setItem(SAF_FOLDER_KEY,result.uri);return result}
  throw new Error('Aucun dossier sélectionné.');
}
async function savePackageToChosenDrive(name,payload){
  if(!IS_NATIVE_ANDROID) return {ok:false,reason:'not-android'};
  let uri=localStorage.getItem(SAF_FOLDER_KEY)||'';
  if(!uri){const picked=await chooseSecabDriveFolder();uri=picked.uri}
  try{return await SecabDriveFolder.saveFile({treeUri:uri,fileName:name,mimeType:'application/json',base64:utf8ToBase64(payload)})}
  catch(e){localStorage.removeItem(SAF_FOLDER_KEY);throw new Error(`Le dossier Drive n’est plus accessible. Reconfigurez-le. ${e?.message||''}`.trim())}
}
async function getSecabDriveFolderStatus(){
  if(!IS_NATIVE_ANDROID)return {configured:false,name:''};
  try{return await SecabDriveFolder.getStatus()}catch{return {configured:Boolean(localStorage.getItem(SAF_FOLDER_KEY)),name:''}}
}
async function testSecabDriveFolder(){
  const probe={type:'SECAB_SYNC_TEST',at:new Date().toISOString(),version:APP_VERSION};
  return savePackageToChosenDrive('SECAB_test_synchronisation.json',JSON.stringify(probe,null,2));
}

async function exportPackageSimple(name,payload){
  if(IS_NATIVE_ANDROID){
    try{const r=await savePackageToChosenDrive(name,payload);return {mode:'drive-folder',...r}}
    catch(e){console.warn('SAF Drive',e);const shared=await shareBlobFile(name,payload,'application/json');return {mode:shared?'share':'download',warning:e.message}}
  }
  download(name,payload,'application/json');return {mode:'download'};
}

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => `SEC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const num = v => { const raw=String(v ?? '').trim().replace(/\s+/g,'').replace(',', '.'); if(!raw) return NaN; const x=Number(raw); return Number.isFinite(x) ? x : NaN; };
const stable = (v, digits=6) => Number.isFinite(v) ? Number(v.toFixed(digits)) : NaN;
const fmt = (v, d=2) => Number.isFinite(v) ? stable(v, Math.max(d, 6)).toFixed(d).replace('.', ',') : '—';
const COUPLING_LIMIT = DEFAULT_RULESET.coupling.limit;
const ELECTRICAL_EPSILON = 1e-9;
const atMost = (value, limit) => Number.isFinite(value) && value <= limit + ELECTRICAL_EPSILON;
const safe = s => String(s || 'affaire').replace(/[\\/:*?"<>|]+/g, '-').trim();

const IS_DESKTOP = typeof window !== 'undefined' && Boolean(window.secabDesktop);
const IS_NATIVE_ANDROID = typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

async function requestAndroidLocationPermission(){
  if(!IS_NATIVE_ANDROID) return {location:'granted',coarseLocation:'granted'};
  let status=await Geolocation.checkPermissions();
  if(status.location!=='granted' && status.coarseLocation!=='granted'){
    status=await Geolocation.requestPermissions({permissions:['location','coarseLocation']});
  }
  if(status.location!=='granted' && status.coarseLocation!=='granted'){
    throw new Error('Autorisation de localisation refusée. Ouvrez Paramètres > Applications > SECAB Couplage Terrain > Autorisations > Localisation.');
  }
  return status;
}

async function getSecabPosition(){
  const startedAt=Date.now();
  const enrich=position=>({...position,__secabElapsedMs:Date.now()-startedAt,__secabSource:IS_NATIVE_ANDROID?'GPS Android':IS_DESKTOP?'Localisation Windows':'Géolocalisation système'});
  if(IS_DESKTOP && window.secabDesktop?.getLocation){
    const native=await window.secabDesktop.getLocation();
    if(native?.ok && Number.isFinite(Number(native.data?.latitude)) && Number.isFinite(Number(native.data?.longitude))){
      return enrich({coords:{latitude:Number(native.data.latitude),longitude:Number(native.data.longitude),altitude:Number(native.data.altitude||0),accuracy:Number(native.data.accuracy||0)}});
    }
    // Repli Chromium si le service de localisation Windows n'est pas disponible.
    if(navigator.geolocation){
      try{return await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve(enrich(p)),reject,{enableHighAccuracy:true,timeout:20000,maximumAge:0}))}catch{}
    }
    throw new Error(native?.error||'Localisation Windows indisponible. Activez Paramètres Windows > Confidentialité et sécurité > Localisation.');
  }
  if(IS_NATIVE_ANDROID){
    await requestAndroidLocationPermission();
    try{
      // Acquisition rapide : accepte une position récente afin de ne pas immobiliser le technicien.
      return enrich(await Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:20000,maximumAge:0}));
    }catch(firstError){
      // Repli immédiat sur la meilleure position disponible, sans attente longue.
      try{return enrich(await Geolocation.getCurrentPosition({enableHighAccuracy:false,timeout:12000,maximumAge:120000}))}
      catch{throw firstError}
    }
  }
  if(!navigator.geolocation) throw new Error('Géolocalisation indisponible sur cet appareil.');
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve(enrich(p)),reject,{enableHighAccuracy:true,timeout:20000,maximumAge:0}));
}

function gpsQuality(accuracy){
  const a=num(accuracy);
  if(!Number.isFinite(a)) return {key:'unknown',label:'Précision inconnue',icon:'⚪'};
  if(a<=3) return {key:'excellent',label:`Très bon · ±${Math.round(a)} m`,icon:'🟢'};
  if(a<=8) return {key:'good',label:`Correct · ±${Math.round(a)} m`,icon:'🟡'};
  return {key:'weak',label:`Faible · ±${Math.round(a)} m`,icon:'🔴'};
}

const DRIVE_CONFIG_KEY = 'secab-drive-sync-config';
const DEFAULT_DRIVE_CONFIG = { webAppUrl:'', folderId:'', secret:'', autoSync:true, lastPush:'', lastPull:'', status:'Non configuré' };
function getDriveConfig(){ try{return {...DEFAULT_DRIVE_CONFIG,...JSON.parse(localStorage.getItem(DRIVE_CONFIG_KEY)||'{}')}}catch{return {...DEFAULT_DRIVE_CONFIG}} }
function saveDriveConfig(c){ localStorage.setItem(DRIVE_CONFIG_KEY,JSON.stringify(c)); }
function driveConfigured(c=getDriveConfig()){ return Boolean(c.webAppUrl&&c.folderId&&c.secret); }
async function callDriveBridge(config,payload){
  if(!driveConfigured(config)) throw new Error('Connexion Google Drive non configurée.');
  const res=await fetch(config.webAppUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,folderId:config.folderId,secret:config.secret})});
  if(!res.ok) throw new Error(`Drive HTTP ${res.status}`);
  const data=await res.json();
  if(!data.ok) throw new Error(data.error||'Erreur Google Drive');
  return data;
}


const COMMUNES = ['Bras-Panon','Cilaos','Entre-Deux','L’Étang-Salé','La Plaine-des-Palmistes','La Possession','Le Port','Le Tampon','Les Avirons','Petite-Île','Saint-André','Saint-Benoît','Saint-Denis','Saint-Joseph','Saint-Leu','Saint-Louis','Saint-Paul','Saint-Philippe','Saint-Pierre','Sainte-Marie','Sainte-Rose','Sainte-Suzanne','Salazie','Trois-Bassins'];
const OUVRAGES = ['Poste HTA/BT au sol','Poste H61 sur support','Poste cabine maçonné','Poste préfabriqué','Poste intégré dans un immeuble','Armoire de coupure HTA','IACM / interrupteur aérien HTA','IA2T / IA3T','Remontée aéro-souterraine HTA','Support HTA avec parafoudre','Support mixte HTA/BT','Poteau métallique HTA','Écrans de câbles aériens','Autotransformateur HTA/HTA','Terre du neutre BT individuelle','Terre globale du neutre BT','Terre des masses HTA','Coffret réseau BT / CCPC','Autre ouvrage à vérifier'];

const EMPTY = {
  id:'', uuid:'', affaire:'Mesure', codeGdo:'', numeroPoste:'', commune:'Saint-Denis', typeOuvrage:'Poste HTA/BT au sol', terreConfig:'separee', zone:'Rurale', regime:'150 A',
  date:today(), technicien:'', responsable:'', appareil:'TERCA 3', rapport:'', marche:'', client:'', contact:'',
  rm:'', rng:'', rni:'', rmn:'', rcDirect:'', mode:'edf', resistivite:'', distance:'', protocol:{earthIsolated:false,noParasiticBond:false,auxiliariesPositioned:false,interferenceChecked:false,connectionsPhotographed:false,method:'',directRcAuthorised:false,directRcMethod:'',directRcReference:''}, repeatedMeasurements:{rm:[],rng:[],rni:[],rmn:[],rcDirect:[]}, reference:{},
  gpsLat:'', gpsLng:'', gpsOriginalLat:'', gpsOriginalLng:'', gpsAccuracy:'', gpsCapturedAt:'', gpsElapsedMs:'', gpsSource:'', observations:'', cadastre:null, contraintes:null, cadastreSync:{status:'idle',message:'',loadedAt:'',radius:150}, arcgisData:{status:'idle',message:'',loadedAt:'',webmapId:'897f5f20fed7477b881653ac31b98520',layers:[],features:[],nearest:null}, parcelStatus:{}, implantation:{orientation:0,scale:1,offsetX:0,offsetY:0,selectedSolution:'',centerLat:'',centerLng:'',analysis:[],ranking:'compromis'}, improvementTarget:'', diagnosticDecision:'', decisionStage:'', neutralApprovalConfirmed:false, existingEarthChecked:false, earthContinuityChecked:false, parasiticLinksChecked:false, measurementsConfirmed:false, neutralTargetType:'', neutralGpsLat:'', neutralGpsLng:'', neutralGpsOriginalLat:'', neutralGpsOriginalLng:'', neutralGpsAccuracy:'', neutralGpsCapturedAt:'', neutralResistivite:'', neutralTargetPhoto:null, neutralTargetLabel:'', noWorkReason:'', diagnosticTerrain:'', solutionRetenue:'', materielReprise:'', reprise:'', cout:'', costEstimate:{prices:{trenchEarth:'',trenchAsphalt:'',trenchConcrete:'',asphaltM2:'',technicians:''},quantities:{trenchEarth:'',trenchAsphalt:'',trenchConcrete:'',asphaltM2:'',technicians:''},extras:[],notes:'',updatedAt:''}, nextControl:'', statut:'À contrôler',
  measurePhotos:{ rm:null, rng:null, rni:null, rmn:null, rc:null }, photos:[], afterWorkPhoto:null, reinstatementPhoto:null, surfaceWorks:{beton:{l:'',w:'',d:''},enrobe:{l:'',w:'',d:''},bitume:{l:'',w:'',d:''},terre:{l:'',w:'',d:''},dallage:{l:'',w:'',d:''},paves:{l:'',w:'',d:''}}, execution:{status:'À préparer',startedAt:'',completedAt:'',team:'',supervisor:'',weather:'',permitChecked:false,networkMarkingChecked:false,solutionVerified:false,trenchLength:'',trenchDepth:'',conductorLength:'',connections:'',warningMesh:false,continuityChecked:false,beforeCoverPhoto:null,connectionPhoto:null,deviations:'',comments:''}, finalMeasurements:{rm:'',rng:'',rni:'',rmn:'',rcDirect:'',resistivite:''}, finalSurfaceWorks:{beton:{l:'',w:'',d:''},enrobe:{l:'',w:'',d:''},bitume:{l:'',w:'',d:''},terre:{l:'',w:'',d:''},dallage:{l:'',w:'',d:''},paves:{l:'',w:'',d:''}}, finalMeasurePhotos:{rm:null,rng:null,rni:null,rmn:null,rc:null}, validation:{technicianAt:'',managerAt:'',locked:false,lockedAt:'',lockedBy:'',unlockRequestedAt:'',unlockReason:'',unlockToken:''}, revisions:[], syncState:{status:'local',lastPush:'',lastPull:'',error:'',version:0}, audit:[], signatures:{technicien:'',responsable:'',client:''}, isTest:false, deletedAt:'', deletedReason:'', deletedBy:'', deleteExpiresAt:'', clientMassTarget:'30', clientNeutralTarget:'50', createdAt:'', updatedAt:''
};

const MEASURE_META = {
  rm:{label:'RM — Terre des masses', key:'rm'},
  rng:{label:'RNg — Terre globale du neutre', key:'rng'},
  rni:{label:'RNi — Terre individuelle du neutre', key:'rni'},
  rmn:{label:'RMN — Mesure entre terres', key:'rmn'},
  rc:{label:'Rc / écran TERCA / coefficient', key:'rcDirect'}
};

const ELECTRODES = [
  {id:'piquet3',work:1,eff:4,title:'Piquet plein inox ou cuivré — longueur 3 m',short:'Piquet vertical 3 m',factor:.34,footprint:'Très faible',material:'1 piquet de 3 m, câblette cuivre, raccord autorisé ou soudure aluminothermique',steps:['Implanter le piquet hors zone d’influence immédiate','Raccorder la câblette avec raccord autorisé','Créer un regard de visite et repérer la liaison'],svg:'piquet'},
  {id:'vertical3',work:2,eff:4,title:'Conducteur vertical — longueur 3 m',short:'Conducteur vertical 3 m',factor:.37,footprint:'Très faible',material:'Conducteur cuivre vertical 3 m, raccords et regard',steps:['Réaliser le forage ou l’enfoncement','Mettre en place le conducteur vertical','Raccorder et protéger la jonction'],svg:'vertical'},
  {id:'grille14',work:3,eff:5,title:'Grille en tranchée — largeur 1,4 m',short:'Grille 1,4 m',factor:.30,footprint:'Faible',material:'Grille cuivre, tranchée 0,40 à 0,60 m, câblette de liaison',steps:['Ouvrir la tranchée','Déployer la grille à la profondeur prescrite','Raccorder, remblayer et poser le grillage avertisseur'],svg:'grille'},
  {id:'grille24',work:4,eff:6,title:'Grille en tranchée — largeur 2,4 m',short:'Grille 2,4 m',factor:.20,footprint:'Moyenne',material:'Grille cuivre 2,4 m, câblette, raccords et grillage avertisseur',steps:['Créer une tranchée adaptée','Poser la grille sans boucle serrée','Raccorder puis recontrôler'],svg:'grille2'},
  {id:'serp10',work:4,eff:6,title:'Serpentin — 1 tranchée de 3 m, conducteur 10 m',short:'Serpentin 10 m',factor:.25,footprint:'Moyenne',material:'10 m de cuivre nu, tranchée 3 m, raccords C sertis',steps:['Créer une tranchée de 3 m','Déployer 10 m de cuivre en serpentin','Raccorder et poser le grillage avertisseur'],svg:'serpentin'},
  {id:'bff',work:5,eff:7,title:'Boucle à fond de fouille — périmètre poste 10 m',short:'Boucle fond de fouille',factor:.17,footprint:'Autour du poste',material:'Cuivre nu périphérique, raccords, regards de contrôle',steps:['Créer la boucle périphérique','Éviter les angles vifs','Raccorder à la barrette principale'],svg:'boucle'},
  {id:'serp20',work:6,eff:8,title:'Serpentin — 2 tranchées de 3 m, conducteurs 2 × 10 m',short:'Double serpentin 2 × 10 m',factor:.14,footprint:'Importante',material:'20 m de cuivre nu, deux tranchées, raccords et regards',steps:['Créer deux tranchées distinctes','Poser deux serpentins de 10 m','Interconnecter puis mesurer'],svg:'double'},
  {id:'serp30',work:7,eff:9,title:'Serpentin — 2 tranchées de 5 m, conducteurs 2 × 15 m',short:'Double serpentin 2 × 15 m',factor:.10,footprint:'Très importante',material:'30 m de cuivre nu, deux tranchées de 5 m, raccords',steps:['Créer deux tranchées de 5 m','Déployer 15 m par tranchée','Interconnecter, protéger et recontrôler'],svg:'doubleLong'},
  {id:'patte',work:8,eff:10,title:'Étoile — 3 tranchées de 10 m (patte d’oie)',short:'Patte d’oie 3 × 10 m',factor:.06,footprint:'Très importante',material:'30 m minimum de cuivre nu, trois tranchées rayonnantes, raccord central',steps:['Tracer trois axes de 10 m à environ 120°','Poser le cuivre nu dans chaque branche','Raccorder au point central et recontrôler'],svg:'patte'},
  {id:'h61-5',work:6,eff:9,title:'H61 — prise de terre multidirectionnelle 3 × 5 m + point central ≈ 3 m',short:'H61 multidirectionnelle 5 m',factor:.10,footprint:'Périphérie du massif H61',material:'Cuivre nu 25 mm², 3 brins de 5 m, point central ≈ 3 m, grillage avertisseur rouge',steps:['Réaliser la prise de terre en périphérie du massif, jamais noyée dans le béton','Répartir 3 brins de 5 m autour du support','Réaliser le point central d’environ 3 m','Relier la plateforme de manœuvre et toutes les masses au circuit de terre','Photographier avant remblaiement et établir le plan de recollement'],svg:'h61'},
  {id:'h61-10',work:8,eff:10,title:'H61 — prise de terre multidirectionnelle 3 × 10 m + point central ≈ 5 m',short:'H61 multidirectionnelle 10 m',factor:.06,footprint:'Périphérie étendue du massif H61',material:'Cuivre nu 25 mm², 3 brins de 10 m, point central ≈ 5 m, grillage avertisseur rouge',steps:['Réaliser la prise de terre en périphérie du massif, jamais noyée dans le béton','Répartir 3 brins de 10 m autour du support','Réaliser le point central d’environ 5 m','Relier la plateforme de manœuvre et toutes les masses au circuit de terre','Photographier avant remblaiement et établir le plan de recollement'],svg:'h61'}
];

function targetInterconnected(regime){ const r=DEFAULT_RULESET.interconnected[String(regime||'').trim()]; return r?Number(r.limit):NaN; }
function diagnosticInputSnapshot(m){
  return {
    terreConfig:m.terreConfig==='interconnectee'?'interconnectee':'separee',
    mode:m.mode==='direct'?'direct':'edf',
    regime:String(m.regime||'150 A').trim(),
    typeOuvrage:String(m.typeOuvrage||'').trim(),
    rm:stable(num(m.rm)),rng:stable(num(m.rng)),rni:stable(num(m.rni)),rmn:stable(num(m.rmn)),rcDirect:stable(num(m.rcDirect)),resistivite:stable(num(m.resistivite)),neutralResistivite:stable(num(m.neutralResistivite))
  };
}
function diagnosticFingerprint(m){
  const x=diagnosticInputSnapshot(m);
  return [x.terreConfig,x.mode,x.regime,normText(x.typeOuvrage),x.rm,x.rng,x.rni,x.rmn,x.rcDirect,x.resistivite,x.neutralResistivite].map(v=>Number.isNaN(v)?'—':String(v)).join('|');
}
function compute(m){
  const result=computeElectricalCase(m,DEFAULT_RULESET);
  return {...result,fingerprint:diagnosticFingerprint(m)};
}

function canRetainNoWork(m){
  const c=compute(m);
  const massTarget=configuredMassTarget(m);
  const massOk=!Number.isFinite(massTarget)||!Number.isFinite(c.rm)||atMost(c.rm,massTarget);
  return c.valid&&c.ok&&massOk;
}
function reportDecisionState(m){
  const initial=compute(m), final=computeFinal(m), selected=retainedSolutionId(m), hasFinal=final.mode==='interconnectee'?Number.isFinite(final.rng):(Number.isFinite(final.rm)&&Number.isFinite(final.rni)&&(m.mode==='direct'?Number.isFinite(final.rc):Number.isFinite(final.rmn)));
  if(!initial.valid)return {key:'invalid',label:'MESURES À REPRENDRE',detail:'Les valeurs initiales sont incomplètes ou physiquement incohérentes. Aucun résultat ni travaux ne doivent être validés.',conform:false};
  if(selected==='none')return canRetainNoWork(m)?{key:'conform',label:'INSTALLATION CONFORME',detail:'Aucun travaux n’est requis sur la base des mesures validées et des seuils configurés.',conform:true}:{key:'invalid-decision',label:'DÉCISION INCOHÉRENTE',detail:'« Aucun travaux » est interdit car les critères ne sont pas tous satisfaits.',conform:false};
  if(!selected)return {key:'pending',label:'SOLUTION À DÉFINIR',detail:'Le diagnostic est établi, mais aucune solution technique n’a encore été validée.',conform:false};
  if(!hasFinal)return {key:'works-pending-control',label:'TRAVAUX / CONTRÔLE FINAL REQUIS',detail:'La solution est retenue, mais la conformité ne pourra être conclue qu’après mesures finales complètes.',conform:false};
  if(!final.valid)return {key:'final-invalid',label:'MESURES FINALES À REPRENDRE',detail:'Les mesures finales sont physiquement incohérentes ou incomplètes.',conform:false};
  return final.ok?{key:'conform',label:'INSTALLATION CONFORME',detail:'Les mesures finales valides satisfont les critères configurés.',conform:true}:{key:'non-conform',label:'ACTION COMPLÉMENTAIRE REQUISE',detail:'Les mesures finales valides ne satisfont pas encore les critères configurés.',conform:false};
}


function unilateralImprovementLimits(m){
  const c=compute(m);
  const limit=COUPLING_LIMIT;
  const rm=c.rm, rni=c.rni, rmn=c.rmn, rc=c.rc;
  const massTarget=num(m.clientMassTarget);
  const neutralTarget=num(m.clientNeutralTarget);
  const massMin=Number.isFinite(rc)&&rc>=0?rc/limit:NaN;
  const massRequestedOk=Number.isFinite(massTarget)&&Number.isFinite(massMin)?massTarget+ELECTRICAL_EPSILON>=massMin:false;
  const neutralMin=Number.isFinite(rmn)&&Number.isFinite(rm)?Math.max(0,rmn-rm):NaN;
  const neutralMax=Number.isFinite(rmn)&&Number.isFinite(rm)?rmn-rm+2*limit*rm:NaN;
  const neutralRequestedOk=Number.isFinite(neutralTarget)&&Number.isFinite(neutralMin)&&Number.isFinite(neutralMax)?neutralTarget+ELECTRICAL_EPSILON>=neutralMin&&neutralTarget<=neutralMax+ELECTRICAL_EPSILON:false;
  return {limit,rm,rni,rmn,rc,massTarget,massMin,massMax:Number.isFinite(rm)?rm:NaN,massRequestedOk,neutralTarget,neutralMin,neutralMax,neutralRequestedOk,valid:c.mode==='separee'&&Number.isFinite(rm)&&Number.isFinite(rni)&&Number.isFinite(rmn)&&Number.isFinite(rc)&&rc>=0};
}

function SingleEarthImprovement({kind,m,update,back,next}){
  const x=unilateralImprovementLimits(m);
  const mass=kind==='mass';
  useEffect(()=>{
    const target=mass?'masses':'neutral';
    if(m.improvementTarget!==target)update({improvementTarget:target});
  },[mass,m.improvementTarget]);
  const targetKey=mass?'clientMassTarget':'clientNeutralTarget';
  const requested=mass?x.massTarget:x.neutralTarget;
  const allowed=mass?x.massRequestedOk:x.neutralRequestedOk;
  const min=mass?x.massMin:x.neutralMin;
  const max=mass?x.massMax:x.neutralMax;
  return <section className="singleEarthModule"><div className="card singleEarthHero"><div><small>ÉTUDE DE SENSIBILITÉ MATHÉMATIQUE</small><h2>{mass?'Terre des masses seule (RM)':'Terre du neutre seule (RNi)'}</h2><p>{mass?'Abaisser RM sans intervenir sur la terre du neutre.':'Abaisser RNi sans intervenir sur la terre des masses.'}</p></div><span>Coefficient limite : {fmt(COUPLING_LIMIT,2)}</span></div>
    {!mass&&<NeutralTargetSetup m={{...m,improvementTarget:'neutral'}} update={patch=>update({...patch,improvementTarget:'neutral'})}/>}
    {!x.valid?<div className="card warningBox"><h3>Mesures insuffisantes</h3><p>Ce calcul nécessite une configuration de terres séparées avec RM, RNi et RMN cohérentes. Complétez les mesures avant de dimensionner une amélioration indépendante.</p></div>:<>
    <div className="singleEarthGrid"><article className="card"><h3>Mesures utilisées</h3><div className="singleEarthValues"><p><span>RM actuelle</span><b>{fmt(x.rm,2)} Ω</b></p><p><span>RNi actuelle</span><b>{fmt(x.rni,2)} Ω</b></p><p><span>RMN actuelle</span><b>{fmt(x.rmn,2)} Ω</b></p><p><span>Rc calculée</span><b>{fmt(x.rc,3)} Ω</b></p><p><span>Coefficient actuel</span><b>{fmt(x.rc/x.rm,3)}</b></p></div></article>
    <article className="card"><h3>Exigence du client</h3><label>{mass?'RM maximale demandée':'RNi maximale demandée'}<div className="ohmInput"><input type="number" min="0" step="0.01" value={m[targetKey]??''} onChange={e=>update({[targetKey]:e.target.value})}/><span>Ω</span></div></label><div className={`singleEarthDecision ${allowed?'ok':'ko'}`}><b>{allowed?'✓ Objectif compatible':'⚠ Objectif incompatible avec la plage calculée'}</b><span>{Number.isFinite(requested)?`Valeur demandée : ${fmt(requested,2)} Ω`:'Renseignez la valeur demandée.'}</span></div></article></div>
    <article className="card singleEarthResult"><div className="panelTitle"><div><h3>Plage théorique sous hypothèse constante — sans modifier {mass?'la terre du neutre':'la terre des masses'}</h3><p>Calcul conservatif établi à partir de la série RM / RNi / RMN actuelle.</p></div><span>{mass?`${fmt(min,2)} Ω ≤ RM ≤ ${fmt(max,2)} Ω`:`${fmt(min,2)} Ω ≤ RNi ≤ ${fmt(max,2)} Ω`}</span></div>
      {mass?<><p><b>Valeur minimale de RM :</b> {fmt(min,2)} Ω. En dessous, avec Rc supposée inchangée, le coefficient Rc/RM dépasserait 0,15.</p><p><b>Valeur maximale de travail :</b> {fmt(max,2)} Ω, correspondant à la valeur actuelle. Pour satisfaire une demande « RM &lt; 30 Ω », la cible choisie doit donc rester comprise entre {fmt(min,2)} Ω et {fmt(Math.min(30,max),2)} Ω.</p><div className="formulaBox">RM minimale = Rc / 0,15 = {fmt(x.rc,3)} / 0,15 = <b>{fmt(min,2)} Ω</b></div></>:<><p><b>Valeur minimale théorique de RNi :</b> {fmt(min,2)} Ω. Une valeur inférieure rendrait Rc négative avec RMN supposée inchangée, ce qui signale que les grandeurs mutuelles ont changé et impose une nouvelle mesure.</p><p><b>Valeur maximale compatible :</b> {fmt(max,2)} Ω. Toute cible comprise entre {fmt(min,2)} Ω et {fmt(max,2)} Ω conserve un coefficient calculé inférieur ou égal à 0,15, sous l’hypothèse RM et RMN inchangées.</p><div className="formulaBox">RNi maximale = RMN − RM + 2 × 0,15 × RM = <b>{fmt(max,2)} Ω</b></div></>}
      <div className="calculationWarning"><b>Important :</b> cette étude ne constitue pas un dimensionnement ni une résistance à obtenir sur chantier. Après modification d’une prise de terre, RMN peut évoluer. Le technicien doit donc refaire RM, RNi et RMN avant de conclure à la conformité.</div></article></>}
    <div className="workflowActions"><button onClick={back}>← Retour au diagnostic</button><button disabled={!mass&&(!m.neutralTargetType||!Number.isFinite(num(m.neutralGpsLat))||!Number.isFinite(num(m.neutralGpsLng)))} onClick={()=>{if(!mass)update({improvementTarget:'neutral'});next()}}>{!mass?'Continuer avec le 2ᵉ ouvrage →':'Continuer vers l’implantation →'}</button></div></section>
}

function normText(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function isH61(m){return normText(m.typeOuvrage).includes('h61')}
function ouvrageProfile(m){
  const t=normText(m.typeOuvrage);
  if(t.includes('h61')) return {id:'h61',label:'Poste H61 sur support',massTarget:m.regime==='150 A'?10:30,massPolicy:'forced-h61',neutralPolicy:'second-ouvrage',reference:'Forme H61 imposée selon résistivité et régime HTA.'};
  if(t.includes('integre')&&t.includes('immeuble')) return {id:'building',label:'Poste intégré dans un immeuble',massTarget:30,massPolicy:'building-general-earth',neutralPolicy:'approval',reference:'Contrôle de la terre générale de l’immeuble et du collecteur des masses.'};
  if(t.includes('poste hta/bt au sol')||t.includes('cabine maconnee')||t.includes('prefabrique')) return {id:'ground-post',label:m.typeOuvrage,massTarget:30,massPolicy:'ground-loop',neutralPolicy:'second-ouvrage',reference:'Boucle/ceinture du poste à contrôler avant tout complément.'};
  if(t.includes('armoire de coupure')||t.includes('autotransformateur')) return {id:'hta-cabinet',label:m.typeOuvrage,massTarget:30,massPolicy:'reference-required',neutralPolicy:'blocked',reference:'Prescription du dossier technique/GRD obligatoire avant choix de géométrie.'};
  if(t.includes('support mixte')) return {id:'mixed-support',label:m.typeOuvrage,massTarget:30,massPolicy:'reference-required',neutralPolicy:'blocked',reference:'MALT neutre bloquée sur support mixte sauf prescription explicite du GRD.'};
  if(t.includes('terre du neutre')||t.includes('coffret reseau bt')||t.includes('ccpc')) return {id:'neutral-device',label:m.typeOuvrage,massTarget:NaN,massPolicy:'none',neutralPolicy:'current-ouvrage',reference:'Diagnostic centré sur la terre individuelle/globale du neutre.'};
  if(t.includes('iacm')||t.includes('ia2t')||t.includes('ia3t')||t.includes('remontee')||t.includes('support hta')||t.includes('poteau metallique')||t.includes('ecrans de cables')||t.includes('terre des masses hta')) return {id:'hta-other',label:m.typeOuvrage,massTarget:30,massPolicy:'reference-required',neutralPolicy:'blocked',reference:'Forme et seuil à confirmer dans le dossier technique de l’ouvrage.'};
  return {id:'unknown',label:m.typeOuvrage||'Ouvrage non identifié',massTarget:NaN,massPolicy:'reference-required',neutralPolicy:'blocked',reference:'Identification précise et validation responsable obligatoires.'};
}
function h61MassTarget(m){return m.regime==='150 A'?10:30}
function h61MandatorySolution(m){const rho=num(m.resistivite);if(!isH61(m))return null;if(!Number.isFinite(rho))return {required:true,id:'',message:'La résistivité du sol est obligatoire pour dimensionner la prise de terre H61.'};return {required:true,id:rho<=200?'h61-5':'h61-10',message:rho<=200?'ρ ≤ 200 Ω.m : 3 brins de 5 m + point central ≈ 3 m.':'ρ > 200 Ω.m : 3 brins de 10 m + point central ≈ 5 m.'}}
function configuredMassTarget(m){const p=ouvrageProfile(m);return Number.isFinite(p.massTarget)?p.massTarget:30}
function measurementIntegrity(m){
  const c=compute(m), blockers=[], warnings=[];
  if(c.mode==='separee'){
    if(!Number.isFinite(c.rm)||!Number.isFinite(c.rni)||!Number.isFinite(c.rmn)) blockers.push('RM, RNi et RMN doivent être renseignées.');
    if(Number.isFinite(c.rc)&&c.rc<0) blockers.push('Rc négative : mesures ou branchements à vérifier.');
    if(Number.isFinite(c.rc)&&Number.isFinite(c.rm)&&Number.isFinite(c.rni)&&c.rc>Math.min(c.rm,c.rni)) blockers.push('Rc dépasse la plus faible des résistances RM/RNi : série de mesures physiquement incohérente à confirmer.');
    if(Number.isFinite(c.c)&&c.c>1+ELECTRICAL_EPSILON) warnings.push('Coefficient supérieur à 1 : refaire la séquence de mesure avant toute prescription.');
  }
  blockers.push(...(c.issues||[]));
  return {ok:blockers.length===0,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)]};
}
function diagnosticStrategy(m){
  const c=compute(m), profile=ouvrageProfile(m), integrity=measurementIntegrity(m), rmTarget=configuredMassTarget(m), rmOk=Number.isFinite(c.rm)&&c.rm<=rmTarget;
  if(!integrity.ok)return {kind:'verify-measures',target:'verify',rmOk,rmTarget,profile,title:'Mesures à contrôler avant décision',reason:'Aucune recommandation automatique n’est autorisée tant que la cohérence des mesures n’est pas confirmée.',steps:integrity.blockers};
  if(profile.massPolicy==='reference-required')return {kind:'reference-required',target:'approval',rmOk,rmTarget,profile,title:'Prescription ouvrage à confirmer',reason:profile.reference,steps:['Joindre le dossier technique ou la prescription EDF SEI','Faire valider le type de prise de terre par le responsable','Renseigner ensuite la solution imposée dans le dossier']};
  if(c.mode==='interconnectee')return {kind:c.ok?'none':'global',target:c.ok?'none':'global',rmOk,rmTarget,profile,title:c.ok?'Aucun travail nécessaire':'Terre globale interconnectée à traiter',reason:c.diagnostic,steps:c.ok?[]:['Contrôler continuité et équipotentialité','Appliquer le seuil du régime renseigné','Reprendre RNg après travaux']};
  if(!Number.isFinite(c.c))return {kind:'incomplete',target:'verify',rmOk,rmTarget,profile,title:'Mesures à compléter',reason:c.diagnostic,steps:['Compléter RM, RNi et RMN','Joindre les photos des écrans de mesure']};
  if(c.ok&&rmOk)return {kind:'none',target:'none',rmOk,rmTarget,profile,title:'Installation conforme',reason:'RM et coefficient de couplage sont conformes.',steps:[]};
  if(profile.id==='neutral-device')return {kind:'neutral-current',target:'neutral',rmOk:true,rmTarget,profile,title:'Terre du neutre à traiter sur l’ouvrage identifié',reason:'Le diagnostic concerne directement cet ouvrage neutre. La solution sera implantée au droit de l’ouvrage actuel.',steps:['Mesurer la résistivité au droit de l’ouvrage','Vérifier la MALT existante et les raccordements','Appliquer la forme autorisée par le dossier BT','Reprendre RNi/RMN après travaux']};
  if(!rmOk){
    if(profile.massPolicy==='forced-h61')return {kind:'forced-h61',target:'masses',rmOk,rmTarget,profile,title:'Remise en conformité obligatoire de la terre des masses H61',reason:`RM = ${fmt(c.rm,2)} Ω dépasse la cible ${fmt(rmTarget,0)} Ω. La forme H61 est imposée et les solutions génériques sont interdites.`,steps:['Renseigner la résistivité du sol','Appliquer la prise multidirectionnelle H61 imposée','Photographier avant remblaiement','Reprendre RM, RNi, RMN et le coefficient après travaux']};
    if(profile.massPolicy==='ground-loop')return {kind:'ground-loop',target:'masses',rmOk,rmTarget,profile,title:'Remise en conformité de la terre des masses du poste au sol',reason:`RM = ${fmt(c.rm,2)} Ω dépasse la cible ${fmt(rmTarget,0)} Ω. Contrôler d’abord la boucle et la ceinture équipotentielle ; le complément ne doit pas être choisi comme une électrode générique isolée.`,steps:['Contrôler présence et continuité de la boucle de fond de fouille','Contrôler la ceinture équipotentielle et les raccordements des masses','Réparer la boucle si elle est absente ou discontinue','Ajouter un complément uniquement selon prescription du dossier','Reprendre toutes les mesures après travaux']};
    if(profile.massPolicy==='building-general-earth')return {kind:'building-earth',target:'masses',rmOk,rmTarget,profile,title:'Terre générale de l’immeuble à contrôler',reason:'Aucune patte d’oie ou électrode extérieure générique ne doit être proposée automatiquement autour du local.',steps:['Contrôler la prise générale de terre de l’immeuble','Contrôler la continuité radier/plancher vers le collecteur des masses','Faire prescrire toute amélioration par le responsable/GRD','Reprendre les mesures après correction']};
  }
  if(!c.ok){
    if(profile.neutralPolicy==='blocked')return {kind:'neutral-blocked',target:'approval',rmOk,rmTarget,profile,title:'Couplage non conforme — intervention neutre non autorisée automatiquement',reason:profile.reference,steps:['Rechercher les liaisons parasites','Confirmer les mesures','Obtenir une prescription EDF SEI avant toute modification']};
    return {kind:'coupling-neutral',target:'neutral',rmOk,rmTarget,profile,title:'RM conforme — traiter la cause du couplage',reason:`RM = ${fmt(c.rm,2)} Ω est conforme. Diminuer RM seule peut dégrader c = Rc/RM. La séquence professionnelle impose d’abord le contrôle des interconnexions, puis l’étude de la terre du neutre.`,steps:['Contrôler les liaisons parasites et éléments métalliques enterrés','Confirmer RM, RNi et RMN','Identifier la première MALT du neutre','Géolocaliser la 2ᵉ émergence ou le 2ᵉ support si l’intervention est validée','Mesurer la résistivité au nouvel emplacement','Obtenir la validation EDF SEI avant travaux']};
  }
  return {kind:'review',target:'approval',rmOk,rmTarget,profile,title:'Analyse responsable requise',reason:'Les résultats ne correspondent pas à un parcours automatique connu.',steps:['Faire valider le diagnostic par le responsable']};
}
function solutionMetrics(m,s,target='masses'){
  const c=compute(m);
  const rho=target==='neutral'?num(m.neutralResistivite||m.resistivite):num(m.resistivite);
  const initial=target==='neutral'?c.rni:c.rm;
  const estimate=estimatedCouplingForSolution(m,{...s,target});
  return {...s,target,rho,initial,electrode:estimate.estimatedEarth,after:estimate.estimatedEarth,gain:Number.isFinite(initial)&&Number.isFinite(estimate.estimatedEarth)?initial-estimate.estimatedEarth:NaN,cAfterIfRcConstant:estimate.value,estimatedCoeff:estimate.value,estimatedRc:estimate.estimatedRc,estimateMin:estimate.minCoeff,estimateMax:estimate.maxCoeff,automatic:false,requiresApproval:true,verdict:Number.isFinite(estimate.value)?`${estimate.label} — c indicatif ${fmt(estimate.value,3)}.`:'Estimation indisponible.',planningOnly:true};
}

function solutionTechnicalJustification(m,sol){
  const c=compute(m), final=computeFinal(m);
  const refs=technicalReferences(m,sol);
  const ref=refs[0]?.title||'Référentiel technique à valider';
  if(!sol){
    if(!canRetainNoWork(m))return {simple:'Aucune solution ne peut être conclue tant que les mesures ne sont pas valides et conformes.',professional:'Le dossier ne satisfait pas les conditions permettant de conserver l’installation sans travaux.',reference:ref,validation:'Décision technique à reprendre.'};
    return {simple:'Les mesures valides satisfont les critères configurés ; aucune nouvelle prise de terre n’est justifiée.',professional:'La conservation de l’installation repose sur des mesures cohérentes, sur le respect des seuils configurés et sur la traçabilité du contrôle.',reference:ref,validation:'Aucun travaux retenu sur la base des mesures validées.'};
  }
  const geometry=sol.id==='patte'||sol.id==='h61-10'||sol.id==='h61-5'
    ? 'La géométrie multidirectionnelle augmente la longueur de conducteur en contact avec le sol et répartit la dispersion autour de l’ouvrage.'
    : sol.id.includes('serp')||sol.id.includes('grille')||sol.id==='bff'
      ? 'La longueur de conducteur enterré et sa répartition augmentent la surface de contact avec le terrain.'
      : 'L’électrode verticale augmente la surface conductrice utile avec une faible emprise au sol.';
  const electrical=sol.target==='neutral'
    ? 'L’objectif est de réduire l’influence commune entre la terre du neutre et la terre des masses. Aucun coefficient futur n’est annoncé : il devra être recalculé à partir de RM, RNi et RMN mesurées après travaux.'
    : 'L’objectif est d’améliorer la prise de terre traitée. La baisse réelle ne peut pas être garantie par un facteur théorique générique et doit être vérifiée par mesure après travaux.';
  return {
    simple:`${geometry} ${electrical}`,
    professional:`La solution constitue une prescription de mise en œuvre et non un résultat électrique garanti. La conformité définitive repose exclusivement sur des mesures finales valides et sur les seuils documentaires configurés.`,
    reference:ref,
    validation:Number.isFinite(final.c)?`Mesure finale enregistrée : c = ${fmt(final.c,3)} (${final.valid?(atMost(final.c,COUPLING_LIMIT)?'seuil satisfait':'seuil non satisfait'):'mesures incohérentes'}).`:'Mesures finales non enregistrées : aucune conformité définitive ne peut être prononcée.'
  };
}


function expertRiskNarrative(m){
  const c=compute(m), target=configuredMassTarget(m);
  if(c.ok)return {need:'Les mesures enregistrées satisfont les critères techniques configurés pour cet ouvrage ; aucune correction n’est justifiée à ce stade.',risk:'Le maintien en l’état reste acceptable sous réserve de la validité des mesures, de la continuité des raccordements et de l’absence de modification ultérieure de l’installation.',benefit:'La conservation de l’installation évite des travaux inutiles tout en maintenant une traçabilité complète du contrôle.'};
  if(c.mode==='separee'&&Number.isFinite(c.c)&&!atMost(c.c,COUPLING_LIMIT))return {need:`Le coefficient de couplage mesuré (${fmt(c.c,3)}) dépasse le seuil de ${fmt(COUPLING_LIMIT,2)} : l’influence électrique entre la terre des masses et la terre du neutre doit être réduite.`,risk:'Sans correction, une influence commune excessive peut subsister lors d’un défaut et empêcher l’installation d’atteindre les critères techniques attendus par le gestionnaire de réseau.',benefit:'La solution proposée vise à diminuer l’influence commune entre les prises de terre et à créer une marge mesurable sous le seuil applicable.'};
  if(Number.isFinite(c.rm)&&c.rm>target)return {need:`La résistance de la terre des masses RM (${fmt(c.rm,2)} Ω) dépasse la cible configurée de ${fmt(target,0)} Ω : sa capacité de dispersion doit être améliorée.`,risk:'Sans intervention, la dispersion du courant de défaut peut rester insuffisante et la valeur de terre demeurer hors de l’objectif technique retenu pour l’ouvrage.',benefit:'L’augmentation de la surface conductrice en contact avec le sol vise à réduire RM et à améliorer la dispersion du courant de défaut.'};
  return {need:'Les mesures présentent un écart par rapport aux critères enregistrés et nécessitent une analyse corrective.',risk:'Sans vérification ou correction, l’installation peut rester techniquement non validée.',benefit:'La solution proposée vise à retrouver une situation mesurable, documentée et conforme aux critères applicables.'};
}
function reportGlossary(){return [
  ['RM — Terre des masses','Résistance de la prise de terre reliée aux masses métalliques accessibles de l’ouvrage.'],
  ['RNi — Terre individuelle du neutre','Résistance de la prise de terre du neutre considérée séparément du réseau interconnecté.'],
  ['RMN — Mesure entre les terres','Mesure réalisée entre la terre des masses et la terre du neutre, utilisée pour déterminer leur influence commune.'],
  ['Rc — Résistance de couplage','Valeur calculée représentant la partie d’influence électrique commune entre les prises de terre.'],
  ['Coefficient de couplage c','Rapport Rc/RM. Plus il est faible, plus l’influence entre les terres est limitée ; le seuil configuré dans le logiciel est ≤ 0,15.'],
  ['RNg — Terre globale du neutre','Résistance résultante de l’ensemble des terres du neutre interconnectées sur le réseau.'],
  ['ρ — Résistivité du sol','Caractéristique du terrain, exprimée en Ω.m, qui influence directement la performance d’une prise de terre.']
]}
const COPPER_PER_TRENCH_M=3;
function copperFromTrench(trenchLength){return Math.max(0,Number(trenchLength||0))*COPPER_PER_TRENCH_M}
function jobQuantities(m,sol){
  const cs=costSummary(m), q=cs.rows.reduce((a,r)=>(a[r.key]=Number(r.qty||0),a),{}), impl=m.implantation||{};
  const trench=Number(q.earth||0)+Number(q.asphalt||0)+Number(q.concrete||0);
  // Règle métier SECAB : 1 mètre linéaire de tranchée correspond à 3 mètres de cuivre.
  const copper=copperFromTrench(trench);
  const area=Number(q.asphaltArea||0);
  const stakes=Number(sol?.stakes||sol?.piquets||(/piquet/i.test(sol?.title||'')?1:(/patte|h61/i.test(sol?.id||'')?3:0)));
  const technicians=Number(q.technicians||m.costEstimate?.quantities?.technicians||2);
  const hours=Number(m.execution?.durationHours||Math.max(2,Math.round((trench/8+stakes*.75+1)*2)/2));
  return {trench,copper,stakes,area,technicians,hours,orientation:Number(impl.orientation||0),parcels:(impl.analysis?.parcels||[]).map(x=>x.id)};
}
function technicalReferences(m,sol){
  const governance=loadGovernance();
  const valid=(governance.references||[]).filter(r=>validateReference(r).ok);
  if(valid.length)return valid.map(r=>({title:r.title,version:r.index||r.version||r.effectiveDate,scope:r.scope,location:r.location,status:'Référence documentaire validée dans l’administration'}));
  return [{title:'Référentiel technique à valider',version:'Non validé',scope:'Aucune référence normative ne doit être affirmée sans document contrôlé',location:'Administration > Références',status:'Émission officielle bloquée tant que le référentiel n’est pas validé'}];
}

function auditTimeline(m){
  const base=[
    {date:m.createdAt||m.date,actor:m.technicien||'Opérateur',action:'Création et identification de l’affaire'},
    {date:m.updatedAt||m.date,actor:m.technicien||'Opérateur',action:'Enregistrement des mesures et du diagnostic'},
    ...(m.solutionRetenue?[{date:m.updatedAt||m.date,actor:m.responsable||m.technicien||'Responsable',action:`Solution retenue : ${m.solutionRetenue}`}]:[]),
    ...(m.finalMeasurements&&Object.values(m.finalMeasurements).some(Boolean)?[{date:m.execution?.completedAt||m.updatedAt,actor:m.technicien||'Opérateur',action:'Mesures finales et contrôle après travaux'}]:[])
  ];
  return [...base,...(m.auditLog||[]).map(x=>({date:x.date||x.at,actor:x.actor||x.user||'Utilisateur',action:x.action||x.label||'Modification'}))].filter(x=>x.date||x.action).slice(-12);
}
function expertiseAssessment(m,sol){
  const c=compute(m), final=computeFinal(m), q=qualityAssessment(m), est=sol?estimatedCouplingForSolution(m,sol):null, costs=costSummary(m), qty=jobQuantities(m,sol);
  const margin=Number.isFinite(est?.value)?COUPLING_LIMIT-est.value:NaN;
  const maxCost=Math.max(costs.total,1), timePenalty=Math.min(28,qty.hours*2), impactPenalty=Math.min(30,qty.trench*.7+qty.area*.4);
  const scores={
    technical:sol?Math.max(40,Math.min(90,72-Number(sol.work||5)+Math.round(q.score*.12))):(c.ok?90:50),
    execution:sol?Math.max(40,Math.min(98,96-Number(sol.work||5)*4-timePenalty*.25)):98,
    time:Math.max(35,Math.min(99,100-timePenalty)),
    cost:costs.total>0?Math.max(35,Math.min(99,100-(costs.total/maxCost)*20-Number(sol?.work||0)*2)):70,
    impact:Math.max(35,Math.min(99,100-impactPenalty)),
    evidence:Math.max(30,Math.min(100,q.score)),
    robustness:sol?Math.max(40,Math.min(90,78-Number(sol.work||5)*2-(Number(m.resistivite||0)>1000?10:0))):(c.ok?90:50),
    maintainability:sol?.id?.includes('piquet')?76:sol?90:95
  };
  const weights={technical:.24,execution:.11,time:.10,cost:.12,impact:.10,evidence:.13,robustness:.12,maintainability:.08};
  const overall=Math.round(Object.entries(scores).reduce((a,[k,v])=>a+v*weights[k],0));
  const level=overall>=90?'Très fort':overall>=78?'Fort':overall>=65?'Modéré':'À consolider';
  const rejected=rankedApplicableSolutions(m).filter(x=>x.id!==sol?.id&&x.id!=='none').slice(0,3).map(x=>({title:x.title,reason:Number(x.work||0)>Number(sol?.work||99)?'Mise en œuvre plus lourde, durée et impact terrain supérieurs pour un faisabilité comparable.':Number(x.eff||0)<Number(sol?.eff||0)?'Performance électrique estimée inférieure dans les conditions renseignées.':'Solution techniquement possible mais moins favorable selon le classement multicritère.'}));
  const limits=[];
  if(!Number.isFinite(num(m.resistivite)))limits.push('Résistivité du sol non mesurée : l’estimation de performance est moins précise.');
  if(!(m.measurePhotos&&Object.keys(m.measurePhotos).length))limits.push('Les preuves photographiques des mesures initiales sont incomplètes.');
  if(!Number.isFinite(final.c))limits.push('La conformité définitive reste à confirmer par les mesures après travaux.');
  if(Number(m.gpsAccuracy||999)>10)limits.push('La précision GPS enregistrée est supérieure à 10 m.');
  return {scores,weights,overall,level,margin,rejected,limits,quantities:qty,costTotal:costs.total,reason:sol?'Le score compare uniquement la faisabilité, les contraintes d’exécution, le coût saisi, l’impact terrain, les preuves disponibles et la maintenabilité. Il ne prédit pas la résistance finale ni la conformité électrique.':'Aucune intervention n’est retenue car les mesures satisfont les critères enregistrés et aucune correction n’est justifiée.',trace:{software:`Mesure & amélioration des terres de poste de transformation V${APP_VERSION}`,engine:'Moteur déterministe et multicritère — règles V2.0',fingerprint:diagnosticFingerprint(m),generated:new Date().toLocaleString('fr-FR'),source:'Référentiel documentaire validé dans l’administration + données mesurées de l’affaire',cartography:m.mapProvider||'IGN / Géoportail prioritaire',coordinates:`${m.gpsLat||'—'} / ${m.gpsLng||'—'} (précision ${m.gpsAccuracy||'—'} m)`,operator:m.technicien||'Non renseigné'}};
}

function vegetalEarthAdvice(m,sol){
  const rho=sol?.target==='neutral'?num(m.neutralResistivite||m.resistivite):num(m.resistivite);
  if(!Number.isFinite(rho)||rho<=0)return {level:'unknown',label:'À déterminer',required:false,volume:NaN,reason:'Mesurer la résistivité du sol avant de décider un apport de terre végétale.',warning:'Aucune recommandation automatique sans résistivité mesurée.'};
  const baseVolume=sol?.id==='patte'||sol?.id==='h61-10'?1.2:sol?.id==='serp30'||sol?.id==='serp20'?0.9:sol?.id==='bff'?0.8:sol?.id?.includes('grille')?0.6:0.35;
  if(rho<=300)return {level:'none',label:'Non nécessaire',required:false,volume:0,reason:`Résistivité ${fmt(rho,0)} Ω.m : aucun apport spécifique n’est recommandé par défaut.`,warning:'Conserver le terrain naturel s’il est homogène, humide et exempt de matériaux isolants.'};
  if(rho<=700)return {level:'check',label:'À prévoir seulement si le terrain est sec, rocheux ou remblayé',required:false,volume:baseVolume*.5,reason:`Résistivité ${fmt(rho,0)} Ω.m : amélioration locale possible, sans caractère automatique.`,warning:'La terre végétale ne remplace jamais une géométrie réglementaire ni la mesure finale.'};
  if(rho<=1500)return {level:'recommended',label:'Conseillé localement',required:false,volume:baseVolume,reason:`Résistivité élevée (${fmt(rho,0)} Ω.m) : prévoir un remplacement local du remblai autour de l’électrode si autorisé.`,warning:'Validation technique requise ; éviter les produits corrosifs ou non prescrits.'};
  return {level:'strong',label:'Fortement recommandé sous validation technique',required:true,volume:baseVolume*1.5,reason:`Résistivité très élevée (${fmt(rho,0)} Ω.m) : un apport local de terre végétale humide et non caillouteuse est recommandé en complément de la géométrie retenue.`,warning:'Résultat non garanti : reprendre obligatoirement les mesures après travaux.'};
}
function solutionComparison(m,sol){
  const initial=compute(m), final=computeFinal(m);
  const isNeutral=sol?.target==='neutral';
  const initialValue=isNeutral?initial.rni:initial.rm;
  const simulated=Number(sol?.after);
  const finalValue=isNeutral?final.rni:final.rm;
  const simError=Number.isFinite(simulated)&&Number.isFinite(finalValue)?finalValue-simulated:NaN;
  const initialCoeff=initial.c, finalCoeff=final.c;
  const estimate=estimatedCouplingForSolution(m,sol);
  return {initial,final,isNeutral,initialValue,simulated,finalValue,simError,initialCoeff,finalCoeff,estimatedRc:estimate.estimatedRc,estimatedCoeff:estimate.value,estimateLabel:estimate.label,estimateAssumption:estimate.assumption};
}
function estimatedCouplingForSolution(m,sol){
  const c=compute(m),factor=Number(sol?.factor);
  if(c.mode!=='separee'||!Number.isFinite(c.rm)||!Number.isFinite(c.rni)||!Number.isFinite(c.rmn)||!Number.isFinite(factor))return {value:NaN,estimatedRc:NaN,estimatedEarth:NaN,minCoeff:NaN,maxCoeff:NaN,label:'Estimation indisponible',assumption:'Mesures initiales ou modèle de solution insuffisants.'};
  const isNeutral=sol?.target==='neutral',estimatedEarth=Math.max(.05,(isNeutral?c.rni:c.rm)*factor),rm=isNeutral?c.rm:estimatedEarth,rni=isNeutral?estimatedEarth:c.rni,estimatedRc=Math.max(0,(rm+rni-c.rmn)/2),value=estimatedRc/rm,uncertainty=.30;
  return {value,estimatedRc,estimatedEarth,minCoeff:Math.max(0,value*(1-uncertainty)),maxCoeff:value*(1+uncertainty),label:value<=COUPLING_LIMIT?'Objectif théoriquement atteignable':'Objectif probablement non atteint',assumption:'Pré-estimation indicative fondée sur la géométrie type et l’hypothèse que RMN reste stable. Marge d’incertitude ±30 %. Les mesures finales restent obligatoires.'};
}
function ultimateDecouplingSolution(m){
  const c=compute(m), target=couplingTargetPlan(m);
  const rm=Number.isFinite(c.rm)?c.rm:NaN;
  const rcMax=Number.isFinite(rm)?0.15*rm:NaN;
  const estimatedRc=NaN;
  const after=NaN;
  return {
    id:'ultimate-decoupling',
    work:10,
    eff:10,
    title:'Procédure renforcée de découplage — déplacement de la terre du neutre',
    short:'Découplage renforcé du neutre',
    factor:.03,
    footprint:'Nouvel emplacement indépendant, hors zone d’influence commune',
    material:'Prise de terre du neutre dédiée, conducteur de liaison, regard, repérage et dossier de validation EDF SEI',
    steps:[
      'Contrôler puis supprimer toutes les liaisons parasites entre masses, neutre et éléments métalliques enterrés',
      'Confirmer RM, RNi et RMN par mesures séparées avant toute intervention',
      'Identifier la première MALT du neutre et l’ouvrage autorisé de report',
      'Déplacer la terre du neutre vers la 2ᵉ émergence ou le 2ᵉ support validé par EDF SEI',
      'Implanter une prise du neutre dédiée à distance suffisante de la terre des masses et hors zone d’influence commune',
      'Mesurer la résistivité au nouvel emplacement et adapter la géométrie de l’électrode',
      'Reprendre RM, RNi et RMN après travaux puis recalculer Rc et le coefficient',
      'Augmenter encore l’éloignement ou revoir le cheminement si le coefficient final reste ≥ 0,15'
    ],
    svg:'patte',
    target:'neutral',
    electrode:NaN,
    after,
    gain:NaN,
    cAfterIfRcConstant:NaN,
    automatic:false,
    requiresApproval:true,
    ultimate:true,
    recommended:true,
    estimatedRc,
    targetRc:target?.rcMax,
    verdict:'Solution de dernier recours : validation EDF SEI et mesures finales obligatoires.'
  };
}
function solutionMeetsCouplingTarget(m,sol){
  const c=compute(m);
  if(c.mode!=='separee'||!Number.isFinite(c.c)||atMost(c.c,COUPLING_LIMIT))return true;
  const estimate=estimatedCouplingForSolution(m,sol);
  return Number.isFinite(estimate.value)&&atMost(estimate.value,COUPLING_LIMIT);
}
function rankedApplicableSolutions(m){
  const strategy=diagnosticStrategy(m), h61=h61MandatorySolution(m), c=compute(m);
  let candidates=[];
  if(strategy.kind==='forced-h61') candidates=h61?.id?ELECTRODES.filter(s=>s.id===h61.id).map(s=>({...solutionMetrics(m,s,'masses'),mandatory:true,recommended:true})):[];
  else if(strategy.kind==='ground-loop'){
    const ids=['bff','grille14','serp10','grille24','serp20','serp30','patte'];
    candidates=ids.map((id,i)=>({...solutionMetrics(m,ELECTRODES.find(s=>s.id===id),'masses'),recommended:i===0,conditional:i>0,note:i===0?'Priorité : réparer ou compléter la boucle/ceinture existante.':'Complément progressif uniquement après contrôle de la boucle et validation du dossier technique.'}));
  } else if(strategy.kind==='global'){
    const ids=['piquet3','vertical3','grille14','serp10','grille24','serp20','serp30','patte'];
    candidates=ids.map((id,i)=>({...solutionMetrics(m,ELECTRODES.find(s=>s.id===id),'masses'),recommended:i===0}));
  } else if(['coupling-neutral','neutral-current'].includes(strategy.kind)){
    const type=strategy.kind==='neutral-current'?'current':m.neutralTargetType;
    const ids=type==='second-support'?['piquet3','vertical3','serp10','grille14','serp20','patte']:
      type==='second-emergence'?['grille14','serp10','grille24','serp20','serp30','patte','piquet3']:
      ['piquet3','vertical3','grille14','serp10','grille24','serp20','serp30','patte'];
    candidates=ids.map((id,i)=>{const r=solutionMetrics(m,ELECTRODES.find(s=>s.id===id),'neutral');return {...r,recommended:i===0,note:type==='second-support'?'Classement adapté à un support BT aérien.':type==='second-emergence'?'Classement adapté à une émergence BT souterraine.':'Classement provisoire à confirmer après identification de l’ouvrage neutre.'}});
  }
  if(c.mode==='separee'&&Number.isFinite(c.c)&&c.c>COUPLING_LIMIT+ELECTRICAL_EPSILON){
    if(['incomplete','reference-required','neutral-blocked','review'].includes(strategy.kind))return [];
    candidates=candidates.map(sol=>({...sol,couplingQualified:false,note:`${sol.note?sol.note+' ':''}Performance électrique non prédictible : choix à valider par le responsable, puis contrôle final obligatoire.`}));
  }
  return candidates.sort((a,b)=>(Number(b.recommended)-Number(a.recommended))||((Number.isFinite(a.estimatedCoeff)?a.estimatedCoeff:99)-(Number.isFinite(b.estimatedCoeff)?b.estimatedCoeff:99))||(Number(a.work)-Number(b.work))||String(a.id).localeCompare(String(b.id)));
}
function estimateSolutions(m){return rankedApplicableSolutions(m).filter(s=>s.target==='masses')}
function neutralSolutions(m){return rankedApplicableSolutions(m).filter(s=>s.target==='neutral')}
function requiredPhotoKeys(m){ return m.terreConfig==='interconnectee' ? ['rm','rng'] : (m.mode==='direct'?['rm','rc']:['rm','rni','rmn']); }
function distanceAlert(m){const d=num(m.distance);return Number.isFinite(d)&&d>0&&d<8?`ATTENTION — distance entre terres ${fmt(d,2)} m inférieure à 8 m : non-conformité potentielle à vérifier sur site.`:'';}
function couplingAdvice(m){const c=compute(m),st=diagnosticStrategy(m);if(c.mode!=='separee'||!Number.isFinite(c.rm)||!Number.isFinite(c.rc))return '';const rcMax=COUPLING_LIMIT*c.rm,gap=Math.max(0,c.rc-rcMax);return `${st.reason} Rc actuel : ${fmt(c.rc,3)} Ω ; Rc maximal visé : ${fmt(rcMax,3)} Ω ; réduction minimale à obtenir : ${fmt(gap,3)} Ω. Une valeur finale ne peut être validée qu’après une nouvelle mesure.`;}
function couplingTargetPlan(m){
  const c=compute(m), strategy=diagnosticStrategy(m);
  if(c.mode!=='separee' || !Number.isFinite(c.rm) || c.rm<=0 || !Number.isFinite(c.rc)) return null;
  const coefficientTarget=COUPLING_LIMIT;
  const rcMax=coefficientTarget*c.rm;
  const rcReduction=Math.max(0,c.rc-rcMax);
  const rmnMinimum=Number.isFinite(c.rni)?c.rni+0.70*c.rm:NaN;
  const rmTarget=Number.isFinite(strategy.rmTarget)?strategy.rmTarget:NaN;
  let priority='Contrôler les mesures et la configuration avant prescription.';
  let actions=[];
  if(strategy.target==='neutral'){
    priority='RM est conforme : ne pas diminuer RM par défaut. Traiter d’abord la cause du couplage et la terre du neutre à l’emplacement autorisé.';
    actions=[
      'Contrôler les liaisons parasites et les éléments métalliques enterrés.',
      'Confirmer RM, RNi et RMN puis identifier la première MALT du neutre.',
      'Géolocaliser la 2ᵉ émergence ou le 2ᵉ support autorisé et mesurer la résistivité à cet endroit.',
      'Choisir la forme compatible avec cet ouvrage et obtenir la validation EDF SEI.',
      'Après travaux, mesurer de nouveau RM, RNi et RMN puis recalculer Rc et c.'
    ];
  } else if(strategy.target==='masses'){
    priority='RM n’est pas conforme à la cible de l’ouvrage : remettre d’abord la terre des masses en conformité avec la forme imposée ou prescrite.';
    actions=[
      `Atteindre la cible RM de l’ouvrage${Number.isFinite(rmTarget)?` : ≤ ${fmt(rmTarget,0)} Ω`:''}.`,
      'Respecter la géométrie propre à l’ouvrage ; ne pas choisir une électrode générique si une forme est imposée.',
      'Après correction de RM, refaire RM, RNi et RMN : une baisse de RM seule ne garantit pas l’amélioration du coefficient.'
    ];
  }
  return {coefficientTarget,rcMax,rcReduction,rmnMinimum,rmTarget,priority,actions};
}

function useLocal(key,initial){ const [v,setV]=useState(()=>SAFE_STORAGE.get(key,initial)); useEffect(()=>{SAFE_STORAGE.set(key,v)},[key,v]); return [v,setV]; }
const STATUSES=['Brouillon','Mesures terminées','Travaux à réaliser','Travaux terminés','À contrôler','Validé','Archivé'];
function normalizeRecord(r){return {...EMPTY,...r,measurePhotos:{...EMPTY.measurePhotos,...(r.measurePhotos||{})},finalMeasurements:{...EMPTY.finalMeasurements,...(r.finalMeasurements||{})},finalMeasurePhotos:{...EMPTY.finalMeasurePhotos,...(r.finalMeasurePhotos||{})},surfaceWorks:{...EMPTY.surfaceWorks,...(r.surfaceWorks||{})},execution:{...EMPTY.execution,...(r.execution||{})},validation:{...EMPTY.validation,...(r.validation||{})},syncState:{...EMPTY.syncState,...(r.syncState||{})},revisions:Array.isArray(r.revisions)?r.revisions:[],audit:Array.isArray(r.audit)?r.audit:[]};}
function finalRecord(m){return {...m,...(m.finalMeasurements||{}),measurePhotos:m.finalMeasurePhotos||{}};}
function computeFinal(m){return compute(finalRecord(m));}
function auditEntry(action,detail=''){return {at:new Date().toISOString(),action,detail};}
function download(name,data,type='application/octet-stream'){ const a=document.createElement('a');a.href=typeof data==='string'&&data.startsWith('data:')?data:URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>{if(a.href.startsWith('blob:'))URL.revokeObjectURL(a.href)},1000); }
function makeSyncPackage(records,slot='manual'){const exportedAt=new Date().toISOString();return {type:'SECAB_TERRAIN_SYNC',version:'55.0.0',slot,exportedAt,count:records.length,records:records.map(packageRecord)};}
async function shareBlobFile(name,payload,mime='application/json'){const file=new File([payload],name,{type:mime});if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({title:'Transfert SECAB vers bureau',text:'Importer ce fichier dans Mesure & amélioration des terres de poste de transformation — Bureau.',files:[file]});return true}download(name,payload,mime);return false;}
function isWeekday(d=new Date()){const n=d.getDay();return n>=1&&n<=5;}
function reminderSlot(d=new Date()){if(!isWeekday(d))return '';const mins=d.getHours()*60+d.getMinutes();if(mins>=12*60&&mins<14*60)return '12h';if(mins>=16*60&&mins<19*60)return '16h';return '';}
function dataUrlBytes(data){ return Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0)); }

function openSecabDb(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined') return reject(new Error('IndexedDB indisponible'));
    const req=indexedDB.open('secab-couplage-expert',2);
    req.onupgradeneeded=()=>{const db=req.result;
      if(!db.objectStoreNames.contains('records'))db.createObjectStore('records',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
      if(!db.objectStoreNames.contains('pendingSync'))db.createObjectStore('pendingSync',{keyPath:'uuid'});
      if(!db.objectStoreNames.contains('syncLog'))db.createObjectStore('syncLog',{keyPath:'id',autoIncrement:true});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function mirrorRecordsToIndexedDB(records){
  try{const db=await openSecabDb();const tx=db.transaction(['records','meta'],'readwrite'),store=tx.objectStore('records');store.clear();records.forEach(r=>store.put(r));tx.objectStore('meta').put({key:'lastMirrorAt',value:new Date().toISOString(),count:records.length});tx.oncomplete=()=>db.close();}catch(e){console.warn('IndexedDB mirror',e)}
}
async function queuePendingSync(record,reason='auto'){try{const db=await openSecabDb();const tx=db.transaction(['pendingSync','syncLog'],'readwrite');tx.objectStore('pendingSync').put({uuid:record.uuid||record.id,record,reason,queuedAt:new Date().toISOString(),attempts:0});tx.objectStore('syncLog').add({at:new Date().toISOString(),level:'warning',action:'Mise en attente Drive',uuid:record.uuid||record.id,detail:reason});tx.oncomplete=()=>db.close();}catch(e){console.warn(e)}}
async function clearPendingSync(uuids=[]){try{const db=await openSecabDb();const tx=db.transaction('pendingSync','readwrite');uuids.forEach(x=>tx.objectStore('pendingSync').delete(x));tx.oncomplete=()=>db.close();}catch(e){console.warn(e)}}
async function getPendingSync(){try{const db=await openSecabDb();return await new Promise((resolve,reject)=>{const tx=db.transaction('pendingSync','readonly'),q=tx.objectStore('pendingSync').getAll();q.onsuccess=()=>{db.close();resolve(q.result||[])};q.onerror=()=>reject(q.error)})}catch{return []}}
async function writeSyncLog(level,action,detail='',uuid=''){try{const db=await openSecabDb();const tx=db.transaction('syncLog','readwrite');tx.objectStore('syncLog').add({at:new Date().toISOString(),level,action,detail,uuid});tx.oncomplete=()=>db.close();}catch{}}

function allRecordPhotos(record){
  const out=[];
  const add=(key,v)=>{if(v&&v.data)out.push({key,name:v.name||`${key}.jpg`,data:v.data,label:v.label||key})};
  Object.entries(record.measurePhotos||{}).forEach(([k,v])=>add(`mesure_${k}`,v));
  Object.entries(record.finalMeasurePhotos||{}).forEach(([k,v])=>add(`final_${k}`,v));
  (record.photos||[]).forEach((v,i)=>add(`generale_${i+1}`,v));
  add('apres_travaux',record.afterWorkPhoto); add('refection_terminee',record.reinstatementPhoto);
  return out;
}
async function archiveRecordDurably(record){
  try{
    if(IS_DESKTOP&&window.secabDesktop?.archiveRecord){return await window.secabDesktop.archiveRecord(record)}
    const {Filesystem,Directory}=await import('@capacitor/filesystem');
    const uuid=record.uuid||record.id; const base=`SECAB-Couplage-Expert/affaires/${uuid}`;
    await Filesystem.mkdir({path:`${base}/photos`,directory:Directory.Data,recursive:true}).catch(()=>{});
    const clean={...record,measurePhotos:{},finalMeasurePhotos:{},photos:[],afterWorkPhoto:null,reinstatementPhoto:null};
    await Filesystem.writeFile({path:`${base}/affaire.json`,directory:Directory.Data,data:JSON.stringify(clean,null,2),recursive:true});
    for(const ph of allRecordPhotos(record)){
      const b64=String(ph.data).split(',')[1]||'';
      await Filesystem.writeFile({path:`${base}/photos/${safe(ph.key+'-'+ph.name)}`,directory:Directory.Data,data:b64,recursive:true});
    }
    await Filesystem.writeFile({path:`${base}/backup-${Date.now()}.json`,directory:Directory.Data,data:JSON.stringify(clean),recursive:true});
    return {ok:true,path:base};
  }catch(e){console.warn('Archivage durable',e);return {ok:false,error:e.message}}
}
function revisionSnapshot(record,reason,author){const clean={...record};delete clean.revisions;return {number:(record.revisions?.length||0)+1,at:new Date().toISOString(),reason,author,snapshot:clean};}


const EARTH_M=6378137;
function toLocal(lng,lat,cLng,cLat){const x=(lng-cLng)*Math.PI/180*EARTH_M*Math.cos(cLat*Math.PI/180);const y=(lat-cLat)*Math.PI/180*EARTH_M;return [x,y]}
function toLngLat(x,y,cLng,cLat){return [cLng+x/(EARTH_M*Math.cos(cLat*Math.PI/180))*180/Math.PI,cLat+y/EARTH_M*180/Math.PI]}
function rotatePt([x,y],deg){const a=deg*Math.PI/180;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]}
function pointInRing(pt,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];const hit=((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi||1e-12)+xi);if(hit)inside=!inside}return inside}
function pointInGeom(pt,g){if(!g)return false;if(g.type==='Polygon')return g.coordinates.some((r,i)=>i===0?pointInRing(pt,r):false);if(g.type==='MultiPolygon')return g.coordinates.some(poly=>pointInRing(pt,poly[0]));return false}
function parcelProps(f){return f?.properties||{}}
function firstProp(p,keys){for(const k of keys){const v=p?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim()}return ''}
function parcelSection(f){const p=parcelProps(f);return firstProp(p,['section','SECTION','code_section','codeSection','nom_section','prefixe','PREFIXE'])}
function parcelNumber(f){const p=parcelProps(f);return firstProp(p,['numero','NUMERO','num_parcelle','numero_parcelle','parcelle','PARCELLE','idu','IDU'])}
function parcelLabel(f,i=0){
  const p=parcelProps(f), section=parcelSection(f), raw=parcelNumber(f);
  let numero=raw;
  // PCI peut retourner un identifiant complet (code commune + préfixe + section + numéro).
  if(raw && raw.length>4 && /^\\d*[A-Za-z0-9]+$/.test(raw)) numero=raw.slice(-4);
  const label=[section,numero].filter(Boolean).join(' ').trim();
  return label||firstProp(p,['id','ID','fid','objectid'])||`PARCELLE-${i+1}`;
}
function parcelId(f,i){return parcelLabel(f,i)}
function parcelInfo(f,i=0){
  const p=parcelProps(f);
  return {
    id:parcelLabel(f,i),
    section:parcelSection(f),
    numero:parcelNumber(f),
    commune:firstProp(p,['nom_com','nom_commune','commune','NOM_COM','NOM_COMMUNE']),
    insee:firstProp(p,['code_insee','code_insee_commune','insee','CODE_INSEE']),
    surface:firstProp(p,['contenance','surface','surface_m2','SUPERFICIE','contenance_m2']),
    prefixe:firstProp(p,['prefixe','PREFIXE']),
    raw:p
  };
}
function htmlEsc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
function ringCentroid(ring){
  const pts=(ring||[]).filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));
  if(!pts.length)return null;
  let area=0,cx=0,cy=0;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const [x0,y0]=pts[j],[x1,y1]=pts[i],cross=x0*y1-x1*y0;area+=cross;cx+=(x0+x1)*cross;cy+=(y0+y1)*cross;
  }
  if(Math.abs(area)<1e-12){return [pts.reduce((a,p)=>a+Number(p[0]),0)/pts.length,pts.reduce((a,p)=>a+Number(p[1]),0)/pts.length]}
  return [cx/(3*area),cy/(3*area)];
}
function featureCentroid(feature){
  const rings=geometryRings(feature?.geometry);if(!rings.length)return null;
  const largest=[...rings].sort((a,b)=>Math.abs(ringArea(b))-Math.abs(ringArea(a)))[0];
  return ringCentroid(largest);
}
function ringArea(ring){let a=0;for(let i=0,j=(ring||[]).length-1;i<(ring||[]).length;j=i++)a+=(Number(ring[j]?.[0])||0)*(Number(ring[i]?.[1])||0)-(Number(ring[i]?.[0])||0)*(Number(ring[j]?.[1])||0);return a/2}
function focusedCadastreFeatures(m,analysis,maxRadius=350){
  const fs=m.cadastre?.features||[];if(!fs.length)return [];
  const anchor=implantationAnchor(m),cLat=num(m.implantation?.centerLat||(anchor.valid?anchor.lat:m.gpsLat)),cLng=num(m.implantation?.centerLng||(anchor.valid?anchor.lng:m.gpsLng)),hits=new Set((analysis?.parcels||[]).map(x=>x.id));
  if(!Number.isFinite(cLat)||!Number.isFinite(cLng))return fs.slice(0,80);
  return fs.filter((f,i)=>{if(hits.has(parcelLabel(f,i)))return true;const c=featureCentroid(f);if(!c)return false;return distanceMeters(cLng,cLat,c[0],c[1])<=maxRadius}).slice(0,120);
}
async function fileToOptimizedPhoto(file){
  if(!file)throw new Error('Aucune photo sélectionnée.');
  const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Lecture de la photo impossible.'));r.readAsDataURL(file)});
  if(!String(file.type||'').startsWith('image/'))return {name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,data:raw,thumbnail:raw,caption:''};
  try{
    const bitmap=typeof createImageBitmap==='function'?await createImageBitmap(file):null;
    const img=bitmap||await new Promise((resolve,reject)=>{const x=new Image();x.onload=()=>resolve(x);x.onerror=()=>reject(new Error('Décodage image impossible'));x.src=raw});
    const sourceW=img.width||img.naturalWidth,sourceH=img.height||img.naturalHeight;
    const render=(max,quality)=>{const ratio=Math.min(1,max/Math.max(sourceW,sourceH)),w=Math.max(1,Math.round(sourceW*ratio)),h=Math.max(1,Math.round(sourceH*ratio));const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});ctx.drawImage(img,0,0,w,h);return canvas.toDataURL('image/jpeg',quality)};
    // Miniature légère pour l'interface, image optimisée séparée pour le rapport.
    const thumbnail=render(520,.72);
    await new Promise(resolve=>setTimeout(resolve,0));
    const data=sourceW>4096||sourceH>4096?render(4096,.94):raw;
    try{bitmap?.close?.()}catch{}
    const photoId=`${String(file.name||'photo')}:${Number(file.lastModified||0)}:${Number(file.size||0)}`;
    return {photoId,name:String(file.name||'photo.jpg').replace(/\.[^.]+$/,'.jpg'),type:'image/jpeg',size:Math.round(data.length*.75),lastModified:file.lastModified,data,thumbnail,caption:'',originalSize:file.size,width:sourceW,height:sourceH};
  }catch{const photoId=`${String(file.name||'photo')}:${Number(file.lastModified||0)}:${Number(file.size||0)}`;return {photoId,name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,data:raw,thumbnail:raw,caption:''}}
}
function FastPhotoPicker({title,required,value,onChange,label}){
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState('');
  useEffect(()=>()=>{if(preview?.startsWith('blob:'))URL.revokeObjectURL(preview)},[preview]);
  async function take(e){const f=e.target.files?.[0];if(!f)return;const local=URL.createObjectURL(f);setPreview(local);setBusy(true);try{const photo=await fileToOptimizedPhoto(f);onChange(label?{...photo,label}:photo)}catch(err){alert(err?.message||'Impossible de charger la photo.')}finally{setBusy(false);e.target.value=''}}
  const src=preview||(value?.thumbnail||value?.data||'');
  return <div className={`workPhoto ${required&&!value?'missingPhoto':''} ${busy?'photoProcessing':''}`}><div><b>{title}</b><span>{busy?'Optimisation en cours…':required?'Photo obligatoire':'Photo facultative'}</span></div>{src&&<img src={src} loading="eager" decoding="async"/>}<div className="photoPickerActions"><label className="photoBtn">📷 Appareil photo<input type="file" accept="image/*" capture="environment" onChange={take}/></label><label className="photoBtn secondary">🖼 Galerie<input type="file" accept="image/*" onChange={take}/></label></div>{value&&<><button onClick={()=>download(value.name||'photo.jpg',value.data)}>Original</button><button className="danger" onClick={()=>{setPreview('');onChange(null)}}>Retirer</button></>}</div>
}

function landRule(status){if(status==='Privé')return {need:'OUI',label:'Convention ou servitude à vérifier avant travaux'};if(['Commune','Département','État','ONF'].includes(status))return {need:'À VÉRIFIER',label:'Autorisation d’occupation du gestionnaire à obtenir'};if(status==='EDF / Enedis')return {need:'NON*',label:'Vérifier l’emprise et les droits existants'};if(status==='Domaine public routier')return {need:'À VÉRIFIER',label:'Permission de voirie / arrêté selon travaux'};return {need:'À VÉRIFIER',label:'Propriétaire et droits existants non renseignés'}}
function retainedSolutionId(m){
  // RC57 : toutes les sources historiques sont examinées ; un ancien champ
  // incohérent ne masque plus la solution réellement enregistrée.
  const raws=[m?.solutionRetenue,m?.solutionRetenueId,m?.selectedSolutionId,m?.diagnostic?.selectedSolution,m?.diagnostic?.solutionRetenue,m?.implantation?.selectedSolution,m?.implantation?.solutionSnapshot?.id,m?.diagnosticSolution].filter(v=>v!==undefined&&v!==null&&String(v)!=='');
  const norm=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const catalog=[...rankedApplicableSolutions(m),...ELECTRODES];
  for(const raw of raws){
    const value=typeof raw==='object'?(raw.id||raw.value||raw.title||''):String(raw||'').trim();
    if(value==='none')return 'none';
    if(!value)continue;
    const direct=catalog.find(x=>x?.id===value);if(direct)return direct.id;
    const n=norm(value);
    const byTitle=catalog.find(x=>norm(x?.title)===n||norm(x?.short)===n||n.includes(norm(x?.title))||norm(x?.title).includes(n));if(byTitle)return byTitle.id;
    if(n.includes('patte')||n.includes('etoile'))return 'patte';
    if(n.includes('serp'))return n.includes('30')?'serp30':n.includes('20')?'serp20':'serp10';
    if(n.includes('piquet'))return 'piquet3';if(n.includes('vertical'))return 'vertical3';
  }
  return '';
}
function retainedSolutionObject(m){
  const id=retainedSolutionId(m);if(!id||id==='none')return null;
  const live=[...rankedApplicableSolutions(m),...ELECTRODES].find(x=>x?.id===id);
  if(live)return live;
  const snap=m?.implantation?.solutionSnapshot;
  return snap?.id===id?{id,title:snap.title||'Solution enregistrée',desc:snap.desc||'Solution récupérée depuis le dossier.',length:Number(snap.length||30),arms:Number(snap.arms||3),svg:snap.svg||'patte',target:snap.target||m?.improvementTarget||'masses'}:null;
}
function solutionTargetsNeutral(m){
  const sol=retainedSolutionObject(m);
  if(sol?.target)return sol.target==='neutral';
  if(m?.implantation?.solutionSnapshot?.target)return m.implantation.solutionSnapshot.target==='neutral';
  return m?.improvementTarget==='neutral';
}
function canonicalSolutionPatch(m,solutionId,extra={}){
  const id=retainedSolutionId({...m,solutionRetenue:solutionId})||String(solutionId||'');
  const implantation=defaultImplantationForSolution({...m,solutionRetenue:id},id);
  return {
    solutionRetenue:id,
    solutionRetenueId:id,
    selectedSolutionId:id,
    diagnosticSolution:id,
    diagnostic:{...(m?.diagnostic||{}),selectedSolution:id,solutionRetenue:id},
    implantation:{...implantation,selectedSolution:id,solutionSnapshot:{...m?.implantation?.solutionSnapshot,id,title:(rankedApplicableSolutions(m).find(x=>x.id===id)||ELECTRODES.find(x=>x.id===id))?.title||m?.implantation?.solutionSnapshot?.title||'',target:(rankedApplicableSolutions(m).find(x=>x.id===id)||m?.implantation?.solutionSnapshot)?.target||m?.improvementTarget||'masses'},...(extra.implantation||{})},
    ...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='implantation'))
  };
}
function sourceGpsAnchor(m){
  const neutral=solutionTargetsNeutral(m);
  const lat=num(neutral?m?.neutralGpsLat:m?.gpsLat),lng=num(neutral?m?.neutralGpsLng:m?.gpsLng);
  return {type:neutral?'neutral':'masses',lat,lng,valid:Number.isFinite(lat)&&Number.isFinite(lng)};
}
function implantationAnchor(m){
  const neutral=solutionTargetsNeutral(m), source=sourceGpsAnchor(m), imp=m?.implantation||{};
  const manualLat=num(imp.manualAnchorLat),manualLng=num(imp.manualAnchorLng);
  const manual=Number.isFinite(manualLat)&&Number.isFinite(manualLng);
  const lat=manual?manualLat:source.lat,lng=manual?manualLng:source.lng;
  return {
    type:neutral?'neutral':'masses',
    lat,lng,
    valid:Number.isFinite(lat)&&Number.isFinite(lng),
    label:neutral?(m?.neutralTargetLabel||'2ᵉ ouvrage neutre'):(m?.typeOuvrage||'Poste HTA/BT'),
    source:manual?'Position corrigée manuellement':(neutral?'Nouvelle géolocalisation du 2ᵉ ouvrage':'Géolocalisation du poste'),
    manuallyAdjusted:manual,
    gpsLat:source.lat,gpsLng:source.lng,
    accuracy:neutral?m?.neutralGpsAccuracy:m?.gpsAccuracy,
    resistivity:neutral?m?.neutralResistivite:m?.resistivite
  };
}
function connectionAnchor(m){
  const imp=m?.implantation||{}, mode=imp.connectionMode||'auto';
  const postLat=num(m?.gpsLat),postLng=num(m?.gpsLng),neutralLat=num(m?.neutralGpsLat),neutralLng=num(m?.neutralGpsLng);
  const manualLat=num(imp.connectionLat),manualLng=num(imp.connectionLng);
  if(mode==='manual'&&Number.isFinite(manualLat)&&Number.isFinite(manualLng))return {mode:'manual',lat:manualLat,lng:manualLng,label:'Point de raccordement manuel',valid:true};
  if(mode==='neutral'&&Number.isFinite(neutralLat)&&Number.isFinite(neutralLng))return {mode:'neutral',lat:neutralLat,lng:neutralLng,label:m?.neutralTargetLabel||'2ᵉ ouvrage neutre',valid:true};
  if(mode==='masses'&&Number.isFinite(postLat)&&Number.isFinite(postLng))return {mode:'masses',lat:postLat,lng:postLng,label:m?.typeOuvrage||'Poste HTA/BT',valid:true};
  const neutral=solutionTargetsNeutral(m);
  if(neutral&&Number.isFinite(neutralLat)&&Number.isFinite(neutralLng))return {mode:'auto',lat:neutralLat,lng:neutralLng,label:m?.neutralTargetLabel||'2ᵉ ouvrage neutre',valid:true};
  if(Number.isFinite(postLat)&&Number.isFinite(postLng))return {mode:'auto',lat:postLat,lng:postLng,label:m?.typeOuvrage||'Poste HTA/BT',valid:true};
  return {mode,label:'Point de raccordement indisponible',valid:false,lat:NaN,lng:NaN};
}
function anchorKey(m){const a=sourceGpsAnchor(m);return `${a.type}:${Number.isFinite(a.lat)?a.lat.toFixed(7):''}:${Number.isFinite(a.lng)?a.lng.toFixed(7):''}`}
function defaultImplantationForSolution(m,solutionId){
  const current=m?.implantation||{},anchor=implantationAnchor(m),key=anchorKey(m);
  // RC64 : une modification manuelle de la position de l'ouvrage ne doit jamais
  // écraser la position déjà choisie pour la prise de terre. Le centre enregistré
  // reste l'unique source géométrique, sans recentrage ni saut automatique.
  const hasCenter=Number.isFinite(num(current.centerLat))&&Number.isFinite(num(current.centerLng));
  return {...current,selectedSolution:solutionId,anchorType:anchor.type,anchorLabel:anchor.label,anchorKey:key,
    centerLat:hasCenter?String(current.centerLat):(anchor.valid?String(anchor.lat):''),
    centerLng:hasCenter?String(current.centerLng):(anchor.valid?String(anchor.lng):''),
    orientation:Number(current.orientation||0),scale:Number(current.scale||1),
    offsetX:Number(current.offsetX||0),offsetY:Number(current.offsetY||0),
    placementConfirmed:Boolean(current.placementConfirmed)};
}
function makeSerpentine(totalLength,trenchLength,rows=1,rowGap=3){
  const lines=[];
  for(let r=0;r<rows;r++){
    const points=[],waves=Math.max(5,Math.round(totalLength/1.5)),amp=Math.max(.35,Math.min(1.15,trenchLength/5));
    for(let i=0;i<=waves*8;i++){
      const t=i/(waves*8),x=t*trenchLength,y=r*rowGap+Math.sin(t*waves*Math.PI*2)*amp;
      points.push([x,y]);
    }
    lines.push(points);
  }
  return lines;
}
function solutionShape(id,angle=0,scale=1,offsetX=0,offsetY=0){
  const transform=p=>{const [x,y]=rotatePt(p,angle);return [x*scale+offsetX,y*scale+offsetY]}, lines=[];
  if(id==='piquet3'||id==='vertical3'){
    const circle=[];for(let i=0;i<=28;i++){const a=i/28*Math.PI*2;circle.push([Math.cos(a)*.50,Math.sin(a)*.50])}
    lines.push(circle,[[-.85,0],[.85,0]],[[0,-.85],[0,.85]]);
  }
  if(id==='grille14'){
    lines.push([[-.7,-.7],[.7,-.7],[.7,.7],[-.7,.7],[-.7,-.7]], [[-.7,0],[.7,0]], [[0,-.7],[0,.7]]);
  }
  if(id==='grille24'){
    lines.push([[-1.2,-1.2],[1.2,-1.2],[1.2,1.2],[-1.2,1.2],[-1.2,-1.2]], [[-1.2,-.4],[1.2,-.4]], [[-1.2,.4],[1.2,.4]], [[-.4,-1.2],[-.4,1.2]], [[.4,-1.2],[.4,1.2]]);
  }
  if(id==='serp10') lines.push(...makeSerpentine(10,3,1,0));
  if(id==='bff') lines.push([[-5,-3],[5,-3],[5,3],[-5,3],[-5,-3]], [[-4.5,-2.5],[4.5,-2.5],[4.5,2.5],[-4.5,2.5],[-4.5,-2.5]]);
  if(id==='serp20') lines.push(...makeSerpentine(10,3,2,3));
  if(id==='serp30') lines.push(...makeSerpentine(15,5,2,5));
  if(id==='patte') lines.push([[0,0],[10,0]],[[0,0],[-5,8.66]],[[0,0],[-5,-8.66]]);
  if(id==='h61-5') lines.push([[0,0],[5,0]],[[0,0],[-2.5,4.33]],[[0,0],[-2.5,-4.33]],[[0,0],[0,-3]]);
  if(id==='h61-10') lines.push([[0,0],[10,0]],[[0,0],[-5,8.66]],[[0,0],[-5,-8.66]],[[0,0],[0,-5]]);
  if(id==='neutral-relocate') lines.push([[0,0],[3,0]],[[0,0],[-1.5,2.6]],[[0,0],[-1.5,-2.6]]);
  if(id==='neutral-check') lines.push([[0,0],[1,0]]);
  return lines.map(line=>line.map(transform));
}

function sampleLines(lines,step=1){const out=[];for(const line of lines){for(let i=0;i<line.length-1;i++){const a=line[i],b=line[i+1],d=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(d/step));for(let k=0;k<=n;k++){const t=k/n;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}}}return out}
function analyzeImplantation(m,solution,angle){
  const anchor=implantationAnchor(m),neutralTarget=anchor.type==='neutral';
  const baseLat=anchor.valid?anchor.lat:m.gpsLat, baseLng=anchor.valid?anchor.lng:m.gpsLng;
  const lat=num(m.implantation?.centerLat||baseLat),lng=num(m.implantation?.centerLng||baseLng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!m.cadastre?.features)return {lines:[],shapeLines:[],connector:[],parcels:[],convention:'PLAN / GPS MANQUANT'};
  const scale=Math.max(.25,Math.min(3,Number(m.implantation?.scale||1)));
  // RC64 : centerLat/centerLng sont désormais l'unique position réelle de la prise
  // de terre. offsetX/offsetY restent des informations de métrage par rapport à
  // l'ouvrage, mais ne sont plus réinjectés dans la géométrie (ancien double déplacement).
  const shapeLocal=solutionShape(solution.id,angle,scale,0,0).map(line=>line.map(([x,y])=>[m.implantation?.mirrorX?-x:x,m.implantation?.mirrorY?-y:y]));
  const shapeGeo=shapeLocal.map(line=>line.map(([x,y])=>toLngLat(x,y,lng,lat)));
  // Le raccordement arrive exactement au centre choisi librement par l'utilisateur.
  const connectionTarget=[lng,lat];
  const connection=connectionAnchor(m);
  const connectorGeo=(connection.valid&&distanceMeters(connection.lng,connection.lat,connectionTarget[0],connectionTarget[1])>.05)
    ? [[[connection.lng,connection.lat],connectionTarget]]
    : [];
  const geoLines=[...shapeGeo];
  const samples=sampleLines(shapeLocal,.35).map(([x,y])=>toLngLat(x,y,lng,lat));
  const hits=[];
  m.cadastre.features.forEach((f,i)=>{
    const info=parcelInfo(f,i), id=info.id;
    if(samples.some(pt=>pointInGeom(pt,f.geometry))){
      let lengthM=0;
      for(const line of shapeLocal)for(let j=0;j<line.length-1;j++){
        const a=line[j],b=line[j+1],mid=toLngLat((a[0]+b[0])/2,(a[1]+b[1])/2,lng,lat);
        if(pointInGeom(mid,f.geometry)) lengthM+=Math.hypot(b[0]-a[0],b[1]-a[1]);
      }
      hits.push({id,feature:f,info,status:m.parcelStatus?.[id]||'Non renseigné',lengthM:Math.round(lengthM*10)/10});
    }
  });
  const rules=hits.map(x=>landRule(x.status));
  const conv=rules.some(x=>x.need==='OUI')?'OUI':rules.some(x=>x.need==='À VÉRIFIER')?'À VÉRIFIER':hits.length?'NON*':'HORS PARCELLE / À VÉRIFIER';
  return {lines:geoLines,shapeLines:shapeGeo,connector:connectorGeo,connection,parcels:hits,convention:conv,ruleText:[...new Set(rules.map(x=>x.label))].join(' · '),target:[lng,lat]}
}
function geoBounds(fc,extra=[]){let xs=[],ys=[];(fc?.features||[]).forEach(f=>{const walk=c=>Array.isArray(c?.[0])?c.forEach(walk):(xs.push(c[0]),ys.push(c[1]));walk(f.geometry?.coordinates)});extra.flat(3).forEach((v,i,a)=>{});for(const line of extra)for(const p of line){xs.push(p[0]);ys.push(p[1])}if(!xs.length)return [55.44,-20.9,55.46,-20.88];return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}
function pathForRing(r,b,w=900,h=560,pad=25){const [minX,minY,maxX,maxY]=b,s=Math.min((w-2*pad)/(maxX-minX||1),(h-2*pad)/(maxY-minY||1));return r.map((p,i)=>`${i?'L':'M'} ${pad+(p[0]-minX)*s} ${h-pad-(p[1]-minY)*s}`).join(' ')+' Z'}
function linePath(line,b,w=900,h=560,pad=25){const [minX,minY,maxX,maxY]=b,s=Math.min((w-2*pad)/(maxX-minX||1),(h-2*pad)/(maxY-minY||1));return line.map((p,i)=>`${i?'L':'M'} ${pad+(p[0]-minX)*s} ${h-pad-(p[1]-minY)*s}`).join(' ')}

function allCoords(fc){
  const out=[];
  const walk=c=>{
    if(!Array.isArray(c)) return;
    if(c.length>=2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) { out.push([Number(c[0]),Number(c[1])]); return; }
    c.forEach(walk);
  };
  (fc?.features||[]).forEach(f=>walk(f?.geometry?.coordinates));
  return out;
}
function bbox(points){
  const valid=(points||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!valid.length) return [55.44,-20.90,55.46,-20.88];
  let minX=Math.min(...valid.map(p=>p[0])), maxX=Math.max(...valid.map(p=>p[0]));
  let minY=Math.min(...valid.map(p=>p[1])), maxY=Math.max(...valid.map(p=>p[1]));
  if(minX===maxX){minX-=.0001;maxX+=.0001} if(minY===maxY){minY-=.0001;maxY+=.0001}
  const dx=(maxX-minX)*.08,dy=(maxY-minY)*.08;
  return [minX-dx,minY-dy,maxX+dx,maxY+dy];
}
function geometryRings(geometry){
  if(!geometry) return [];
  if(geometry.type==='Polygon') return geometry.coordinates||[];
  if(geometry.type==='MultiPolygon') return (geometry.coordinates||[]).flat();
  return [];
}



async function reportUiError(error, context='renderer'){
  const payload={at:new Date().toISOString(),context,message:String(error?.message||error),stack:String(error?.stack||''),userAgent:navigator?.userAgent||'',version:APP_VERSION};
  console.error('SECAB error',payload);
  try{if(IS_DESKTOP&&window.secabDesktop?.reportError)await window.secabDesktop.reportError(payload)}catch{}
  try{localStorage.setItem('secab-last-ui-error',JSON.stringify(payload))}catch{}
}

class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null,details:''}}
  static getDerivedStateFromError(error){return {error}}
  componentDidCatch(error,info){this.setState({details:info?.componentStack||''});reportUiError(error,this.props.name||'module')}
  render(){
    if(this.state.error){const message=String(this.state.error?.message||this.state.error||'Erreur inconnue');const diagnostic=`${this.state.error?.stack||message}
${this.state.details||''}`;return <section className="card fatalErrorCard"><h2>Module momentanément indisponible</h2><div className="status ko">L’erreur a été isolée : les autres données du logiciel restent conservées.</div><p className="fatalErrorMessage"><b>Détail :</b> {message}</p><details open><summary>Diagnostic technique</summary><pre>{diagnostic}</pre></details><div className="actions"><button onClick={()=>this.setState({error:null,details:''})}>Réessayer</button><button className="secondaryAction" onClick={()=>location.reload()}>Recharger le logiciel</button><button className="secondaryAction" onClick={()=>navigator.clipboard?.writeText(diagnostic)}>Copier le diagnostic</button></div></section>}
    return this.props.children;
  }
}



function mergeIncomingRecords(existing,incoming){
  const map=new Map(existing.map(x=>[x.uuid||x.id,x]));
  let created=0,updated=0,ignored=0,conflicts=0;
  for(const raw of incoming||[]){
    const x=normalizeRecord(raw),key=x.uuid||x.id;if(!key)continue;
    const old=map.get(key);
    if(!old){map.set(key,{...x,syncState:{...(x.syncState||{}),status:'synced',lastPull:new Date().toISOString()}});created++;continue}
    const incomingTime=String(x.updatedAt||x.exportedAt||''),oldTime=String(old.updatedAt||'');
    if(incomingTime>oldTime){
      if(old.syncState?.status==='pending'){map.set(key,{...old,syncState:{...(old.syncState||{}),status:'conflict',error:'Version terrain plus récente reçue alors que des modifications bureau sont en attente'},remoteConflict:x});conflicts++}
      else{map.set(key,{...x,syncState:{...(x.syncState||{}),status:'synced',lastPull:new Date().toISOString()}});updated++}
    }else ignored++;
  }
  return {records:[...map.values()],created,updated,ignored,conflicts};
}

function qualityAssessment(m){
  const initial=compute(m), final=computeFinal(m);
  const measureKeys=m.terreConfig==='interconnectee'?['rm','rng']:(m.mode==='direct'?['rm','rcDirect']:['rm','rni','rmn']);
  const measurePhotos=m.measurePhotos||{}, finalPhotos=m.finalMeasurePhotos||{};
  const photoCount=Object.values(measurePhotos).filter(Boolean).length;
  const finalPhotoCount=Object.values(finalPhotos).filter(Boolean).length+(m.afterWorkPhoto?1:0);
  const noWork=m.solutionRetenue==='none';
  const checks=[
    {id:'identification',label:'Identification',tab:'identification',ok:Boolean(m.affaire&&m.commune&&m.typeOuvrage&&m.technicien)},
    {id:'terrain',label:'Terrain / GPS',tab:'terrain',ok:Boolean(Number.isFinite(Number(m.gpsLat))&&Number.isFinite(Number(m.gpsLng)))},
    {id:'mesures',label:'Mesures initiales',tab:'mesures',ok:measureKeys.every(k=>Number.isFinite(Number(m[k]))&&Number(m[k])>0)},
    {id:'photos',label:'Photos de mesure',tab:'mesures',ok:photoCount>=measureKeys.length},
    {id:'diagnostic',label:'Diagnostic',tab:'solutions',ok:Boolean(m.solutionRetenue)},
    {id:'implantation',label:'Implantation',tab:'implantation',ok:noWork||Boolean(m.implantation?.placementConfirmed)},
    {id:'controle',label:'Contrôle final',tab:'controleFinal',ok:noWork||Boolean(Number.isFinite(final.rm)&&final.rm>0&&finalPhotoCount>0)},
    {id:'rapport',label:'Dossier prêt',tab:'rapport',ok:Boolean((noWork||final.ok||initial.ok)&&m.rapport)}
  ];
  const score=Math.round(checks.filter(x=>x.ok).length/checks.length*100);
  const anomalies=[];
  if(measureKeys.some(k=>m[k]!==''&&!Number.isFinite(Number(m[k]))))anomalies.push('Une valeur de mesure n’est pas numérique.');
  if(initial.mode==='separee'&&Number.isFinite(initial.rc)&&initial.rc<0)anomalies.push('Rc calculée négative : reprendre RM, RNi et RMN.');
  if(Number.isFinite(initial.c)&&initial.c>1)anomalies.push('Coefficient de couplage supérieur à 1 : cohérence des mesures à vérifier.');
  if(m.distanceTerres!==''&&Number(m.distanceTerres)<8)anomalies.push('Distance entre terres inférieure à 8 m.');
  if(m.implantation?.placementConfirmed&&m.implantation?.savedAt&&m.updatedAt&&new Date(m.implantation.savedAt)<new Date(m.updatedAt)&&!noWork)anomalies.push('Le dossier a changé depuis le dernier enregistrement de l’implantation.');
  if(!noWork&&m.solutionRetenue&&!m.implantation?.placementConfirmed)anomalies.push('La solution retenue n’est pas encore positionnée sur la carte.');
  if(m.syncState?.status==='conflict')anomalies.push('Conflit de synchronisation Google Drive à résoudre.');
  const level=score>=88&&anomalies.length===0?'ready':score>=63?'warning':'blocked';
  return {score,checks,anomalies,level,initial,final,photoCount,finalPhotoCount};
}


function dossierConfidence(m){
  const q=qualityAssessment(m), gate=clientReleaseGateLite(m);
  let score=q.score;
  if(!compute(m).valid)score=Math.min(score,35);
  if(m.syncState?.status==='conflict')score=Math.min(score,45);
  if(!officialReferenceGate().ready)score=Math.min(score,70);
  if(!gate.ready)score=Math.min(score,84);
  const level=score>=90?'ÉLEVÉ':score>=70?'MOYEN':'FAIBLE';
  return {score,level,detail:level==='ÉLEVÉ'?'Données complètes, cohérentes et preuves disponibles.':level==='MOYEN'?'Dossier exploitable sous réserve des contrôles signalés.':'Données insuffisantes ou incohérentes : aucune conclusion client ne doit être émise.'};
}
function clientReleaseGateLite(m){
  const initial=compute(m), final=computeFinal(m), noWork=retainedSolutionId(m)==='none';
  return {ready:Boolean(initial.valid&&(noWork?canRetainNoWork(m):(final.valid&&final.ok)))};
}


function officialReferenceGate(){
  const refs=loadGovernance().references||DEFAULT_REFERENCES;
  const valid=refs.filter(ref=>validateReference(ref).ok);
  const invalid=refs.filter(ref=>!validateReference(ref).ok);
  return {ready:valid.length>0&&invalid.length===0,valid,invalid};
}

function finalizationGate(m){
  const noWork=retainedSolutionId(m)==='none';
  const initial=compute(m), final=computeFinal(m);
  const checks=[
    {id:'identification',tab:'identification',label:'Identification de l’affaire',ok:Boolean(m.affaire&&m.commune&&m.typeOuvrage)},
    {id:'gps',tab:'terrain',label:'GPS de l’ouvrage',ok:Number.isFinite(num(m.gpsLat))&&Number.isFinite(num(m.gpsLng))},
    {id:'initial',tab:'mesures',label:'Mesures initiales exploitables',ok:initial.mode==='interconnectee'?Number.isFinite(initial.rm)&&Number.isFinite(initial.rng):Number.isFinite(initial.rm)&&Number.isFinite(initial.rni)&&(m.mode==='direct'?Number.isFinite(initial.rc):Number.isFinite(initial.rmn))},
    {id:'photos',tab:'mesures',label:'Photos des mesures initiales',ok:Object.values(m.measurePhotos||{}).filter(Boolean).length>=2},
    {id:'solution',tab:'solutions',label:'Décision technique validée',ok:Boolean(retainedSolutionId(m))},
    {id:'implantation',tab:'implantation',label:'Implantation enregistrée',ok:noWork||Boolean(m.implantation?.placementConfirmed)},
    {id:'travaux',tab:'travaux',label:'Exécution des travaux tracée',ok:noWork||Boolean(m.execution?.completedAt&&m.execution?.beforeCoverPhoto&&m.execution?.continuityChecked)},
    {id:'final',tab:'controleFinal',label:'Mesures finales renseignées',ok:noWork||Number.isFinite(final.rm)},
    {id:'finalPhoto',tab:'controleFinal',label:'Photo de contrôle final',ok:noWork||Boolean(m.afterWorkPhoto||Object.values(m.finalMeasurePhotos||{}).some(Boolean))},
    {id:'references',tab:'administration',label:'Référentiel officiel complet',ok:officialReferenceGate().ready},
  ];
  const missing=checks.filter(x=>!x.ok);
  return {checks,missing,ready:missing.length===0};
}


function clientReleaseGate(m){
  const initial=compute(m), final=computeFinal(m), decision=reportDecisionState(m);
  const noWork=retainedSolutionId(m)==='none';
  const expectedInitial=m.terreConfig==='interconnectee'?['rm','rng']:(m.mode==='direct'?['rm','rni','rc']:['rm','rni','rmn']);
  const expectedFinal=m.terreConfig==='interconnectee'?['rm','rng']:(m.mode==='direct'?['rm','rni','rc']:['rm','rni','rmn']);
  const initialPhotos=expectedInitial.filter(k=>Boolean(m.measurePhotos?.[k])).length;
  const finalPhotos=expectedFinal.filter(k=>Boolean(m.finalMeasurePhotos?.[k])).length;
  const checks=[
    {id:'identity',tab:'identification',label:'Client, affaire, ouvrage, commune, date et technicien renseignés',ok:Boolean(m.client&&m.affaire&&m.typeOuvrage&&m.commune&&m.date&&m.technicien)},
    {id:'device',tab:'identification',label:'Appareil de mesure identifié',ok:Boolean(String(m.appareil||'').trim())},
    {id:'gps',tab:'terrain',label:'Position GPS exploitable',ok:Number.isFinite(num(m.gpsLat))&&Number.isFinite(num(m.gpsLng))},
    {id:'initial',tab:'mesures',label:'Mesures initiales complètes et physiquement cohérentes',ok:Boolean(initial.valid)},
    {id:'initialProofs',tab:'mesures',label:'Preuves photographiques des mesures initiales',ok:initialPhotos>=expectedInitial.length},
    {id:'decision',tab:'solutions',label:'Décision technique cohérente avec le diagnostic',ok:!['invalid','invalid-decision','pending'].includes(decision.key)},
    {id:'implantation',tab:'implantation',label:'Implantation validée ou absence de travaux justifiée',ok:noWork?canRetainNoWork(m):Boolean(m.implantation?.placementConfirmed)},
    {id:'execution',tab:'travaux',label:'Travaux réellement exécutés et tracés',ok:noWork||Boolean(m.execution?.completedAt&&m.execution?.solutionVerified&&m.execution?.continuityChecked&&m.execution?.beforeCoverPhoto)},
    {id:'final',tab:'controleFinal',label:'Contrôle final complet, cohérent et conforme',ok:noWork||Boolean(final.valid&&final.ok)},
    {id:'finalProofs',tab:'controleFinal',label:'Preuves photographiques du contrôle final',ok:noWork||finalPhotos>=expectedFinal.length},
    {id:'reference',tab:'administration',label:'Référentiel officiel complet et en vigueur',ok:officialReferenceGate().ready},
    {id:'reportRef',tab:'identification',label:'Référence du rapport renseignée',ok:Boolean(String(m.rapport||'').trim())},
    {id:'managerVisa',tab:'rapport',label:'Visa responsable renseigné',ok:Boolean(m.responsable||m.signatures?.responsable||m.validation?.managerAt)}
  ];
  const missing=checks.filter(x=>!x.ok);
  return {ready:missing.length===0,checks,missing,decision,initial,final};
}

function assertClientRelease(m){
  const gate=clientReleaseGate(m);
  // RC55 : le bureau doit pouvoir éditer un rapport de travail même incomplet.
  // Les contrôles restent affichés dans le rapport et la clôture définitive demeure bloquée.
  // Sur le terrain, les obligations restent strictement inchangées.
  if(gate.ready||IS_DESKTOP)return {...gate,draft:!gate.ready};
  const details=gate.missing.map(x=>`• ${x.label}`).join('\n');
  throw new Error(`Émission terrain bloquée :\n${details}`);
}

function FinalizationPanel({m,onNavigate}){
  const gate=finalizationGate(m);
  return <section className={`finalizationPanel ${gate.ready?'ready':'blocked'}`}>
    <div className="finalizationPanelHead"><div><small>CONTRÔLE AVANT CLÔTURE</small><h3>{gate.ready?'Dossier prêt à être enregistré':'Clôture bloquée : informations manquantes'}</h3><p>{gate.ready?'Les contrôles essentiels sont validés. Une révision horodatée sera créée à l’enregistrement.':`${gate.missing.length} contrôle(s) doivent être complétés avant la clôture définitive.`}</p></div><span className="finalizationBadge">{gate.checks.filter(x=>x.ok).length}/{gate.checks.length}</span></div>
    <div className="finalizationChecks">{gate.checks.map(x=><button key={x.id} className={x.ok?'ok':'ko'} onClick={()=>!x.ok&&onNavigate?.(x.tab)}><span>{x.ok?'✓':'!'}</span><b>{x.label}</b><small>{x.ok?'Validé':'Ouvrir l’étape'}</small></button>)}</div>
  </section>
}

function QualityStrip({m,setTab}){
  const q=qualityAssessment(m); const [open,setOpen]=useState(false);
  return <section className={`qualityStrip ${q.level}`}><button className="qualitySummary" onClick={()=>setOpen(x=>!x)}><span className="qualityRing" style={{'--score':`${q.score*3.6}deg`}}><b>{q.score}%</b></span><span><small>QUALITÉ DU DOSSIER</small><strong>{q.level==='ready'?'Prêt pour validation':q.level==='warning'?'Dossier à compléter':'Contrôles requis'}</strong><em>{q.checks.filter(x=>x.ok).length}/{q.checks.length} étapes complètes · {q.anomalies.length} anomalie(s)</em></span><i>{open?'−':'+'}</i></button>{open&&<div className="qualityDetails"><div className="qualityChecklist">{q.checks.map(x=><button key={x.id} className={x.ok?'done':'todo'} onClick={()=>setTab(x.tab)}><span>{x.ok?'✓':'!'}</span><b>{x.label}</b><small>{x.ok?'Complet':'À compléter'}</small></button>)}</div><div className="qualityAlerts"><h4>Contrôle automatique</h4>{q.anomalies.length?q.anomalies.map((a,i)=><p key={i}>⚠ {a}</p>):<p className="qualityOk">✓ Aucune incohérence bloquante détectée.</p>}</div></div>}</section>
}


// RC19 : contraste 100 % statique via CSS. Aucun audit DOM, MutationObserver ou calcul de luminance à l'exécution.

function DesktopAuthGate({onAuthenticated}){
  const [status,setStatus]=useState({loading:true,initialized:false});
  const [mode,setMode]=useState('login');
  const [form,setForm]=useState({username:'',displayName:'',password:'',confirm:''});
  const [error,setError]=useState('');
  useEffect(()=>{window.secabDesktop.authStatus().then(r=>{setStatus({loading:false,initialized:Boolean(r?.initialized)});setMode(r?.initialized?'login':'bootstrap')}).catch(e=>setError(e.message))},[]);
  const submit=async e=>{e.preventDefault();setError('');try{
    if(mode==='bootstrap'){
      if(form.password!==form.confirm)throw new Error('Les mots de passe ne correspondent pas.');
      const created=await window.secabDesktop.bootstrapAdmin({username:form.username,displayName:form.displayName,password:form.password});
      if(!created?.ok)throw new Error(created?.error||'Création impossible');
    }
    const result=await window.secabDesktop.login({username:form.username,password:form.password});
    if(!result?.ok)throw new Error(result?.error||'Connexion impossible');
    onAuthenticated({token:result.token,user:result.user});
  }catch(e){setError(e.message)}};
  if(status.loading)return <div className="authShell"><div className="authCard"><h1>Mesure & amélioration des terres de poste de transformation</h1><p>Initialisation sécurisée de la base métier…</p></div></div>;
  return <div className="authShell"><form className="authCard" onSubmit={submit}><img src="./secab-logo.jpg"/><small>COUPLAGE EXPERT · SQLITE PRO</small><h1>{mode==='bootstrap'?'Créer le compte administrateur':'Connexion sécurisée'}</h1><p>{mode==='bootstrap'?'Première ouverture : créez le compte maître nominatif.':'Accédez aux dossiers selon votre rôle.'}</p>{error&&<div className="authError">{error}</div>}<label>Identifiant<input autoFocus value={form.username} onChange={e=>setForm({...form,username:e.target.value})} required minLength="3"/></label>{mode==='bootstrap'&&<label>Nom complet<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} required minLength="2"/></label>}<label>Mot de passe<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required minLength="8"/></label>{mode==='bootstrap'&&<label>Confirmer<input type="password" value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})} required minLength="8"/></label>}<button type="submit">{mode==='bootstrap'?'Créer et ouvrir le logiciel':'Se connecter'}</button><em>5 échecs verrouillent le compte pendant 15 minutes.</em></form></div>;
}

function App(){
  const seed=[{...EMPTY,id:uid(),uuid:uid(),affaire:'POKOLBIN',codeGdo:'97420P7733',commune:'Saint-Denis',rapport:'R-2026-001',rm:'4.28',rni:'247',rmn:'246.9',resistivite:'98.6',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
  const [uiTheme,setUiTheme]=useState(initialUiTheme); const [storedRecords,setStoredRecords]=useLocal('secab-premium-v24-records',seed); const [driveConfig,setDriveConfigState]=useLocal(DRIVE_CONFIG_KEY,DEFAULT_DRIVE_CONFIG); const records=useMemo(()=>storedRecords.map(normalizeRecord),[storedRecords]); const activeRecords=useMemo(()=>records.filter(r=>!r.deletedAt),[records]); const setRecords=updater=>setStoredRecords(old=>typeof updater==='function'?updater(old.map(normalizeRecord)):updater); const [current,setCurrent]=useState(activeRecords[0]?.id||records[0]?.id); const [tab,setTab]=useState('dashboard'); const [savedAt,setSavedAt]=useState(Date.now()); const [syncReminder,setSyncReminder]=useState(''); const [simpleSyncSummary,setSimpleSyncSummary]=useState({lastScan:'',lastResult:'',imported:0,errors:0}); const [driveFolderStatus,setDriveFolderStatus]=useState({checked:false,configured:Boolean(localStorage.getItem(SAF_FOLDER_KEY)),name:''}); const [authSession,setAuthSession]=useState(null); const [sqliteHydrated,setSqliteHydrated]=useState(!IS_DESKTOP); const [sqliteState,setSqliteState]=useState({status:IS_DESKTOP?'initialisation':'local',error:''}); const sqliteSnapshots=useRef(new Map());
  const m=records.find(x=>x.id===current)||activeRecords[0]||records[0]||{...EMPTY,id:uid(),uuid:uid()};
  useEffect(()=>{document.documentElement.dataset.theme=uiTheme;localStorage.setItem(UI_THEME_KEY,uiTheme)},[uiTheme]);
  useEffect(()=>{if(!IS_DESKTOP||authSession)return;let cancelled=false;(async()=>{try{const result=await window.secabDesktop.autoSession();if(!result?.ok)throw new Error(result?.error||'Ouverture locale impossible');if(!cancelled)setAuthSession({token:result.token,user:result.user,automatic:true})}catch(e){setSqliteState({status:'erreur',error:e.message});reportUiError(e,'auto-session')}})();return()=>{cancelled=true}},[authSession]);
  useEffect(()=>{const onError=e=>reportUiError(e.error||new Error(e.message||'Erreur JavaScript'),'global');const onReject=e=>reportUiError(e.reason||new Error('Promesse rejetée'),'unhandledrejection');window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onReject);return()=>{window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onReject)}},[]);
  useEffect(()=>{const click=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;b.classList.remove('justClicked');void b.offsetWidth;b.classList.add('justClicked');window.setTimeout(()=>b.classList.remove('justClicked'),900)};document.addEventListener('click',click);return()=>document.removeEventListener('click',click)},[]);
  useEffect(()=>{if(!IS_DESKTOP||!authSession?.token)return;let cancelled=false;(async()=>{setSqliteState({status:'chargement',error:''});try{const result=await window.secabDesktop.listSqliteRecords({includeDeleted:true,limit:20000});if(!result?.ok)throw new Error(result?.error||'Lecture SQLite impossible');const fromDb=(result.rows||[]).map(x=>normalizeRecord(x.record));if(cancelled)return;if(fromDb.length){setStoredRecords(fromDb);setCurrent(fromDb.find(x=>!x.deletedAt)?.id||fromDb[0]?.id)}else{for(const record of records)await window.secabDesktop.saveSqliteRecord({token:authSession.token,record,reason:'Migration initiale du stockage local'});}sqliteSnapshots.current=new Map((fromDb.length?fromDb:records).map(r=>[r.uuid||r.id,JSON.stringify(r)]));setSqliteHydrated(true);setSqliteState({status:'prêt',error:''});setSavedAt(Date.now())}catch(e){setSqliteState({status:'erreur',error:e.message});reportUiError(e,'sqlite-hydration')}})();return()=>{cancelled=true}},[authSession?.token]);
  useEffect(()=>{if(!IS_DESKTOP||!sqliteHydrated||!authSession?.token)return;const timer=setTimeout(async()=>{let saved=0;try{for(const record of records){const key=record.uuid||record.id;const snapshot=JSON.stringify(record);if(sqliteSnapshots.current.get(key)===snapshot)continue;const result=await window.secabDesktop.saveSqliteRecord({token:authSession.token,record,reason:record.validation?.locked?'Révision / clôture':'Sauvegarde automatique'});if(!result?.ok)throw new Error(result?.error||`Échec SQLite ${key}`);sqliteSnapshots.current.set(key,snapshot);saved++;}if(saved){setSavedAt(Date.now());setSqliteState({status:'prêt',error:''})}}catch(e){setSqliteState({status:'erreur',error:e.message});reportUiError(e,'sqlite-autosave')}},1400);return()=>clearTimeout(timer)},[storedRecords,sqliteHydrated,authSession?.token]);
  useEffect(()=>{if(!IS_DESKTOP||!window.secabDesktop?.createBackup)return;const backup=()=>window.secabDesktop.createBackup({version:APP_VERSION,records,driveConfig,createdAt:new Date().toISOString()}).catch(e=>reportUiError(e,'auto-backup'));const id=setInterval(backup,10*60*1000);const onVisibility=()=>{if(document.visibilityState==='hidden')backup()};document.addEventListener('visibilitychange',onVisibility);return()=>{clearInterval(id);document.removeEventListener('visibilitychange',onVisibility);backup()}},[storedRecords,driveConfig]);
  const update=p=>{if(!IS_DESKTOP&&m.validation?.locked){alert('Cette affaire est verrouillée après enregistrement. Demandez une autorisation de réouverture à votre responsable.');return}const now=new Date().toISOString();setRecords(rs=>rs.map(r=>r.id===m.id?{...r,...p,updatedAt:now}:r));setSavedAt(Date.now())};
  const add=()=>{const x={...EMPTY,id:uid(),uuid:uid(),rapport:`R-${new Date().getFullYear()}-${String(activeRecords.length+1).padStart(3,'0')}`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};setRecords(rs=>[x,...rs]);setCurrent(x.id);setTab('identification')};
  const moveRecordToTrash=async(record,source='interface')=>{
    if(!record||record.deletedAt)return;
    const label=record.codeGdo||record.numeroPoste||record.rapport||record.affaire||'cette affaire';
    if(!window.confirm(`Mettre ${label} dans la corbeille ?\n\nElle sera immédiatement retirée des listes actives, de la carte et du reporting. Elle restera restaurable depuis Administratif.`))return;
    const now=new Date().toISOString();
    const expiry=new Date(Date.now()+30*86400000).toISOString();
    const reason=`Mise en corbeille depuis ${source}`;
    const deleted={...record,deletedAt:now,deletedReason:reason,deletedBy:authSession?.user?.displayName||record.responsable||record.technicien||'Utilisateur SECAB',deleteExpiresAt:expiry,updatedAt:now,syncState:{...(record.syncState||{}),status:'pending',error:''},audit:[...(record.audit||[]),auditEntry('Mise en corbeille',reason)]};
    setRecords(rs=>rs.map(r=>((r.id===record.id)||((r.uuid||'')&&(r.uuid===record.uuid)))?deleted:r));
    const next=activeRecords.find(r=>r.id!==record.id&&(!record.uuid||r.uuid!==record.uuid));
    setCurrent(next?.id||'');
    setTab('registre');
    setSavedAt(Date.now());
    if(IS_DESKTOP&&authSession?.token&&window.secabDesktop?.saveSqliteRecord){
      try{const result=await window.secabDesktop.saveSqliteRecord({token:authSession.token,record:deleted,reason:'Mise en corbeille immédiate'});if(!result?.ok)throw new Error(result?.error||'Écriture SQLite impossible');sqliteSnapshots.current.set(deleted.uuid||deleted.id,JSON.stringify(deleted))}catch(e){reportUiError(e,'trash-immediate-sqlite');alert(`Affaire mise en corbeille localement, mais la sauvegarde SQLite doit être vérifiée : ${e.message}`)}
    }
    if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'trashRecord',uuid:deleted.uuid||deleted.id,record:packageRecord(deleted)})}catch(e){console.warn('Drive corbeille',e)}}
  };
  useEffect(()=>{const id=setTimeout(()=>mirrorRecordsToIndexedDB(records),1200);return()=>clearTimeout(id)},[storedRecords]);
  useEffect(()=>{const check=()=>{if(IS_DESKTOP)return;const slot=reminderSlot();if(!slot)return;const key=`secab-sync-${today()}-${slot}`;if(!localStorage.getItem(key))setSyncReminder(slot)};check();const id=setInterval(check,60000);return()=>clearInterval(id)},[]);
  useEffect(()=>{const retry=async()=>{if(!driveConfigured(driveConfig)||!navigator.onLine)return;const pending=IS_DESKTOP&&authSession?.token?await window.secabDesktop.getPendingSqliteSync(250):await getPendingSync();const rows=IS_DESKTOP?(pending?.rows||[]):pending;if(!rows.length)return;try{await pushDrive(rows.map(x=>normalizeRecord(x.payload||x.record)),'reprise-automatique')}catch{}};window.addEventListener('online',retry);const id=setInterval(retry,5*60*1000);retry();return()=>{window.removeEventListener('online',retry);clearInterval(id)}},[driveConfig.webAppUrl,driveConfig.folderId,driveConfig.secret,authSession?.token]);
  useEffect(()=>{if(IS_DESKTOP||!driveConfigured(driveConfig))return;const poll=async()=>{try{const r=await callDriveBridge(driveConfig,{action:'listUnlockAuthorizations'});const auths=r.records||[];if(!auths.length)return;setRecords(rs=>rs.map(rec=>{const a=auths.find(x=>x.uuid===(rec.uuid||rec.id));if(!a||!rec.validation?.locked)return rec;return {...rec,validation:{...(rec.validation||{}),locked:false,managerAt:a.authorizedAt,unlockToken:a.token,unlockRequestedAt:'',unlockReason:''},audit:[...(rec.audit||[]),auditEntry('Déverrouillage Drive appliqué',`Autorisation ${a.responsable||'responsable'}`)]}}))}catch(e){console.warn('Polling déverrouillage',e)}};poll();const id=setInterval(poll,5*60*1000);return()=>clearInterval(id)},[driveConfig.webAppUrl,driveConfig.folderId,driveConfig.secret]);

  useEffect(()=>{if(!IS_NATIVE_ANDROID)return;getSecabDriveFolderStatus().then(x=>setDriveFolderStatus({checked:true,configured:Boolean(x?.configured),name:x?.name||''})).catch(()=>setDriveFolderStatus({checked:true,configured:Boolean(localStorage.getItem(SAF_FOLDER_KEY)),name:''}))},[]);

  useEffect(()=>{
    if(!IS_DESKTOP||!window.secabDesktop?.scanSimpleSyncFolder)return;
    let stopped=false;
    const scan=async()=>{try{const result=await window.secabDesktop.scanSimpleSyncFolder();if(stopped)return;if(!result?.ok){setSimpleSyncSummary(x=>({...x,lastScan:new Date().toISOString(),lastResult:result?.error||'Dossier non configuré',errors:(x.errors||0)+1}));return}let summary={created:0,updated:0,ignored:0,conflicts:0};if(result.records?.length){setRecords(old=>{const merged=mergeIncomingRecords(old,result.records);summary=merged;return merged.records});setSavedAt(Date.now())}setSimpleSyncSummary({lastScan:result.config?.lastScan||new Date().toISOString(),lastResult:result.config?.lastResult||'Aucune nouveauté',imported:(result.records||[]).length,errors:(result.errors||[]).length,created:summary.created||0,updated:summary.updated||0,ignored:summary.ignored||0,conflicts:summary.conflicts||0})}catch(e){console.warn('Synchronisation dossier Drive',e);setSimpleSyncSummary(x=>({...x,lastScan:new Date().toISOString(),lastResult:e.message,errors:(x.errors||0)+1}))}};
    scan();const timer=setInterval(scan,10000);return()=>{stopped=true;clearInterval(timer)};
  },[]);
  const pushDrive=async(list=records,reason='manual')=>{if(!driveConfigured(driveConfig))throw new Error('Google Drive non configuré');const now=new Date().toISOString();try{const payload=list.map(packageRecord);const result=await callDriveBridge(driveConfig,{action:'push',records:payload,reason});await clearPendingSync(list.map(r=>r.uuid||r.id));if(IS_DESKTOP&&authSession?.token)await window.secabDesktop.completeSqliteSync(authSession.token,list.map(r=>r.uuid||r.id));setRecords(rs=>rs.map(r=>list.some(x=>(x.uuid||x.id)===(r.uuid||r.id))?{...r,syncState:{...(r.syncState||{}),status:'synced',lastPush:now,error:'',version:(r.syncState?.version||0)+1}}:r));const next={...driveConfig,lastPush:now,status:`${result.created||0} créée(s), ${result.updated||0} mise(s) à jour, ${result.unchanged||0} inchangée(s)`};setDriveConfigState(next);saveDriveConfig(next);await writeSyncLog('success','Synchronisation Drive',next.status);return result}catch(e){for(const r of list)await queuePendingSync(r,reason);if(IS_DESKTOP&&authSession?.token)await window.secabDesktop.failSqliteSync(authSession.token,list.map(r=>r.uuid||r.id),e.message);setRecords(rs=>rs.map(r=>list.some(x=>(x.uuid||x.id)===(r.uuid||r.id))?{...r,syncState:{...(r.syncState||{}),status:'pending',error:e.message}}:r));await writeSyncLog('error','Échec synchronisation Drive',e.message);throw e}};
  const exportTerrainDay=async(slot='manual')=>{const todays=activeRecords.filter(r=>String(r.date||r.updatedAt||'').slice(0,10)===today()||String(r.updatedAt||'').slice(0,10)===today());const selected=todays.length?todays:activeRecords;const name=`SECAB_transfert_terrain_${today()}_${slot}.secabday`;const payload=JSON.stringify(makeSyncPackage(selected,slot),null,2);try{await exportPackageSimple(name,payload)}catch{download(name,payload,'application/json')}if(slot!=='manual')localStorage.setItem(`secab-sync-${today()}-${slot}`,new Date().toISOString());setSyncReminder('')};
  const finalizeAndNew=async()=>{
    const gate=finalizationGate(m);
    if(!gate.ready){
      const first=gate.missing[0];
      alert(`Clôture impossible. Complétez d’abord : ${gate.missing.map(x=>x.label).join(' · ')}`);
      if(first?.tab)setTab(first.tab);
      return;
    }
    const now=new Date().toISOString();
    const rev=revisionSnapshot(m,!IS_DESKTOP?'Clôture terrain':'Enregistrement bureau',!IS_DESKTOP?(m.technicien||'Technicien terrain'):(m.responsable||'Bureau SECAB'));
    const final={...m,statut:computeFinal(m).ok||compute(m).ok?'Validé':m.statut==='Brouillon'?'À contrôler':m.statut,validation:{...(m.validation||{}),technicianAt:m.validation?.technicianAt||now,locked:!IS_DESKTOP,lockedAt:!IS_DESKTOP?now:(m.validation?.lockedAt||''),lockedBy:!IS_DESKTOP?(m.technicien||'Technicien terrain'):(m.validation?.lockedBy||'')},revisions:[...(m.revisions||[]),rev],syncState:{...(m.syncState||{}),status:driveConfigured(driveConfig)?'pending':'local',error:''},audit:[...(m.audit||[]),auditEntry('Affaire enregistrée et clôturée sur le terminal',!IS_DESKTOP?'Affaire verrouillée pour le technicien':'Enregistrement bureau')],updatedAt:now};
    setRecords(rs=>rs.map(r=>r.id===m.id?final:r));
    await archiveRecordDurably(final);
    if(driveConfigured(driveConfig)&&driveConfig.autoSync) pushDrive([final],'finalisation').catch(e=>console.warn('Drive sync différée',e));
    const packageName=`${safe(final.codeGdo||final.numeroPoste||final.affaire||final.uuid)}_${safe(final.uuid)}.secabpkg`;
    const packagePayload=JSON.stringify(packageRecord(final),null,2);
    let transferMessage='Affaire enregistrée localement.';
    try{
      const transfer=await exportPackageSimple(packageName,packagePayload);
      if(transfer.mode==='drive-folder') transferMessage='Affaire enregistrée sur le téléphone et déposée dans le dossier Google Drive sélectionné.';
      else if(transfer.mode==='share') transferMessage='Affaire enregistrée sur le téléphone. Le menu de partage a été ouvert.';
    }catch(e){transferMessage=`Affaire enregistrée localement, mais transfert Drive non réalisé : ${e.message}`;}
    const x={...EMPTY,id:uid(),uuid:uid(),rapport:`R-${new Date().getFullYear()}-${String(activeRecords.length+1).padStart(3,'0')}`,createdAt:now,updatedAt:now};
    setRecords(rs=>[x,...rs.map(r=>r.id===m.id?final:r)]);setCurrent(x.id);setTab('identification');setSavedAt(Date.now());alert(transferMessage);
  };
  const reportingRecords=useMemo(()=>activeRecords.filter(r=>!r.isTest),[activeRecords]); const stats=useMemo(()=>({total:reportingRecords.length,ok:reportingRecords.filter(r=>compute(r).ok).length,ko:reportingRecords.filter(r=>!compute(r).ok).length}),[reportingRecords]);
  const [globalQuery,setGlobalQuery]=useState('');
  const [registryFocus,setRegistryFocus]=useState('all');
  const globalResults=useMemo(()=>{const q=globalQuery.trim().toLowerCase();if(!q)return [];return activeRecords.filter(r=>[r.numeroPoste,r.codeGdo,r.rapport,r.affaire,r.commune,r.typeOuvrage,r.technicien,r.uuid,r.client,r.marche].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,12)},[activeRecords,globalQuery]);
  const workflow=[['identification','1','Identification'],['terrain','2','Terrain / GPS'],['mesures','3','Mesures'],['solutions','4','Diagnostic'],['implantation','5','Implantation'],...(IS_DESKTOP?[['couts','6','Coût estimatif']]:[]),['travaux',IS_DESKTOP?'7':'6','Travaux'],['controleFinal',IS_DESKTOP?'8':'7','Contrôle final'],['rapport',IS_DESKTOP?'9':'8','Rapport']];
  const workflowIndex=workflow.findIndex(([k])=>k===tab);
  useEffect(()=>{if(IS_DESKTOP)window.__SECAB_AUTH_SESSION__=authSession;return()=>{if(IS_DESKTOP)delete window.__SECAB_AUTH_SESSION__}},[authSession]);
  if(IS_DESKTOP&&!authSession)return <div className="authShell"><div className="authCard"><img src="./secab-logo.jpg"/><small>SQLITE PRO</small><h1>Mesure & amélioration des terres de poste de transformation</h1><p>Ouverture automatique du logiciel…</p></div></div>;
  if(IS_DESKTOP&&!sqliteHydrated)return <div className="authShell"><div className="authCard"><h1>Ouverture de la base SQLite</h1><p>{sqliteState.error||'Chargement et contrôle des dossiers…'}</p></div></div>;
  return <div className={`app ${tab==='implantation'?'implantationMode':''}`}>{IS_NATIVE_ANDROID&&driveFolderStatus.checked&&!driveFolderStatus.configured&&<div className="syncReminderOverlay"><div className="syncReminderCard setupDriveCard"><h2>📁 Configuration unique Google Drive</h2><p>Sélectionnez le dossier partagé réservé à ce technicien :</p><p><b>mesure & amélioration 26 / Synchronisation / A_importer / Technicien</b></p><p>Cette autorisation sera mémorisée. Ensuite, chaque affaire clôturée sera déposée automatiquement dans ce dossier.</p><button onClick={async()=>{try{const r=await chooseSecabDriveFolder();setDriveFolderStatus({checked:true,configured:true,name:r.name||'Dossier Google Drive'});await testSecabDriveFolder();alert('Dossier configuré et test d’écriture réussi.')}catch(e){alert(e.message)}}}>Choisir le dossier et tester</button><button className="secondaryAction" onClick={()=>setDriveFolderStatus(x=>({...x,checked:false}))}>Configurer plus tard</button></div></div>}{syncReminder&&<div className="syncReminderOverlay"><div className="syncReminderCard"><h2>🔄 Transfert des données de {syncReminder}</h2><p>Exportez maintenant les affaires du jour pour les transmettre au logiciel bureau. Le fichier généré contient les données et les photos originales.</p><button onClick={async()=>{try{if(driveConfigured(driveConfig)){const todays=activeRecords.filter(r=>String(r.date||r.updatedAt||'').slice(0,10)===today()||String(r.updatedAt||'').slice(0,10)===today());await pushDrive(todays.length?todays:activeRecords,syncReminder);localStorage.setItem(`secab-sync-${today()}-${syncReminder}`,new Date().toISOString());setSyncReminder('');alert('Synchronisation Google Drive terminée sans doublon.')}else await exportTerrainDay(syncReminder)}catch(e){alert(e.message)}}}>{driveConfigured(driveConfig)?'Synchroniser maintenant vers Google Drive':'Exporter et partager vers le bureau'}</button><button className="secondaryAction" onClick={()=>setSyncReminder('')}>Me le rappeler plus tard</button></div></div>}<aside><div className="brand"><img src="./secab-logo.jpg"/><div><b>SECAB</b><span>Mesure & amélioration des terres de poste de transformation · V{APP_VERSION}</span></div></div><button className="new" onClick={add}>＋ Nouvelle affaire</button>{[['dashboard','Accueil'],['identification','1. Identification'],['terrain','2. Terrain / GPS'],['mesures','3. Mesures & photos'],['solutions','4. Diagnostic & solutions'],['ameliorationMasses','4A. Amélioration RM seule'],['ameliorationNeutre','4B. Amélioration RN seule'],['implantation','5. Carte & implantation'],...(IS_DESKTOP?[['couts','6. Coût estimatif']]:[]),['travaux',IS_DESKTOP?'7. Travaux':'6. Travaux'],['controleFinal',IS_DESKTOP?'8. Contrôle final':'7. Contrôle final'],['rapport',IS_DESKTOP?'9. Rapport premium':'8. Rapport premium'],['historique','Historique / restauration'],['registre','Registre'],...(IS_DESKTOP?[['synchronisation','☁ Synchronisation'],['reporting','📊 Reporting']]:[]),...(!IS_DESKTOP||['responsable','administrateur'].includes(authSession?.user?.role)?[['administration','⚙ Administratif']]:[])].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>{if(k==='ameliorationNeutre')update({improvementTarget:'neutral'});if(k==='ameliorationMasses')update({improvementTarget:'masses'});setTab(k)}}>{l}</button>)}</aside><main><header><div><h1>{m.affaire||'Nouvelle affaire'}</h1><p>{m.typeOuvrage||'Type d’ouvrage à renseigner'} · {m.commune} <span className="platformBadge">{IS_DESKTOP?'Mode bureau':'Mode terrain'}</span> <span className={`saveBadge ${sqliteState.status==='erreur'?'saveError':''}`}>{IS_DESKTOP?`SQLite ${sqliteState.status}`:'✓ Local'} ·  {new Date(savedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span> {IS_DESKTOP&&authSession?.user&&<span className="userBadge">{authSession.user.displayName}</span>} <span className={`syncPill ${m.syncState?.status||'local'}`}>{m.syncState?.status==='synced'?'☁ Drive à jour':m.syncState?.status==='pending'?'⏳ Envoi en attente':m.syncState?.status==='conflict'?'⚠ Conflit Drive':'💾 Local'}</span></p></div><div className="globalSearchWrap"><input value={globalQuery} onChange={e=>setGlobalQuery(e.target.value)} placeholder="🔎 N° poste, GDO, commune, rapport..."/>{globalQuery&&<div className="globalSearchResults">{globalResults.length?globalResults.map(r=><button key={r.id} onClick={()=>{setCurrent(r.id);setTab('rapport');setGlobalQuery('')}}><b>{r.numeroPoste||r.codeGdo||r.rapport||'Affaire'}</b><span>{r.codeGdo||'Sans GDO'} · {r.commune||'—'} · {r.typeOuvrage||'—'}</span></button>):<p>Aucune affaire trouvée.</p>}</div>}</div><label className="headerThemePicker"><span>Thème</span><select value={uiTheme} onChange={e=>setUiTheme(e.target.value)}>{UI_THEMES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><select value={m.id} onChange={e=>setCurrent(e.target.value)}>{activeRecords.map(r=><option key={r.id} value={r.id}>{r.rapport||r.uuid} · {r.affaire||'Sans affaire'}</option>)}</select>{m?.id&&!m.deletedAt&&<button type="button" className="danger compactDanger headerTrashButton" onClick={()=>moveRecordToTrash(m,`onglet ${tab}`)}>🗑 Mettre dans la corbeille</button>}</header>{m.validation?.locked&&!IS_DESKTOP&&<div className="lockedBanner"><b>🔒 Affaire verrouillée après enregistrement</b><span>Lecture seule. Une autorisation du responsable est nécessaire pour reprendre la saisie.</span></div>}{workflowIndex>=0&&<nav className="workflowStepper">{workflow.map(([k,n,l],i)=><button key={k} className={`${tab===k?'active ':''}${i<workflowIndex?'done':''}`} onClick={()=>setTab(k)}><span>{i<workflowIndex?'✓':n}</span><b>{l}</b></button>)}</nav>}{workflowIndex>=0&&<QualityStrip m={m} setTab={setTab}/>} {tab==='dashboard'&&<Dashboard stats={stats} records={activeRecords} setCurrent={setCurrent} setTab={setTab} setRegistryFocus={setRegistryFocus}/>} {tab==='identification'&&<Identification m={m} update={update} next={()=>setTab('terrain')}/>} {tab==='terrain'&&<Terrain m={m} update={update} next={()=>setTab('mesures')} back={()=>setTab('identification')}/>} {tab==='mesures'&&<Measures m={m} update={update} next={()=>setTab('solutions')} back={()=>setTab('terrain')}/>} {tab==='solutions'&&<ErrorBoundary><Solutions m={m} update={update} next={()=>setTab('implantation')} nextNoWork={()=>setTab('controleFinal')} back={()=>setTab('mesures')}/></ErrorBoundary>} {tab==='ameliorationMasses'&&<ErrorBoundary><SingleEarthImprovement kind="mass" m={m} update={update} back={()=>setTab('solutions')} next={()=>setTab('implantation')}/></ErrorBoundary>} {tab==='ameliorationNeutre'&&<ErrorBoundary><SingleEarthImprovement kind="neutral" m={m} update={update} back={()=>setTab('solutions')} next={()=>setTab('implantation')}/></ErrorBoundary>} {tab==='implantation'&&<ErrorBoundary><Implantation m={m} update={update} next={()=>setTab(IS_DESKTOP?'couts':(retainedSolutionId(m)==='none'?'rapport':'travaux'))} back={()=>setTab('solutions')}/></ErrorBoundary>} {tab==='travaux'&&<ErrorBoundary><WorkExecution m={m} update={update} next={()=>setTab('controleFinal')} back={()=>setTab(IS_DESKTOP?'couts':'implantation')}/></ErrorBoundary>} {tab==='controleFinal'&&<FinalControl m={m} update={update} next={()=>setTab('rapport')} back={()=>setTab('implantation')}/>} {tab==='historique'&&<ErrorBoundary><HistoryRecovery m={m} setRecords={setRecords}/></ErrorBoundary>} {tab==='registre'&&<ErrorBoundary><Registry records={activeRecords} allRecords={records} setRecords={setRecords} active={m} exportTerrainDay={exportTerrainDay} driveConfig={driveConfig} setDriveConfigState={setDriveConfigState} pushDrive={pushDrive} simpleSyncSummary={simpleSyncSummary} driveFolderStatus={driveFolderStatus} setDriveFolderStatus={setDriveFolderStatus} initialFocus={registryFocus} setInitialFocus={setRegistryFocus} setCurrent={setCurrent} setTab={setTab} onTrash={moveRecordToTrash}/></ErrorBoundary>} {tab==='couts'&&IS_DESKTOP&&<ErrorBoundary><DesktopCosting m={m} update={update} back={()=>setTab('implantation')} next={()=>setTab(retainedSolutionId(m)==='none'?'rapport':'travaux')}/></ErrorBoundary>} {tab==='synchronisation'&&IS_DESKTOP&&<ErrorBoundary><SyncCenter records={records} setRecords={setRecords} pushDrive={pushDrive} setCurrent={setCurrent} setTab={setTab}/></ErrorBoundary>} {tab==='reporting'&&IS_DESKTOP&&<Reporting records={reportingRecords} setCurrent={setCurrent} setTab={setTab}/>} {tab==='administration'&&<Administration records={records} setRecords={setRecords} driveConfig={driveConfig} authSession={authSession} uiTheme={uiTheme} setUiTheme={setUiTheme} onTrash={moveRecordToTrash}/>} {tab==='rapport'&&<><Report m={m}/><FinalizationPanel m={m} onNavigate={setTab}/><div className="workflowActions noPrint finalSaveBar"><button onClick={()=>setTab(m.solutionRetenue==='none'?'solutions':'controleFinal')}>← Étape précédente</button><button className="secondaryAction" onClick={()=>setTab('registre')}>Registre / synchronisation</button><button className="finalSaveButton" disabled={!finalizationGate(m).ready} title={!finalizationGate(m).ready?'Complétez les contrôles obligatoires avant la clôture':''} onClick={finalizeAndNew}>💾 Enregistrer définitivement et créer une nouvelle affaire</button></div></>}</main></div>
}


function HistoryRecovery({m,setRecords}){
  const revisions=[...(m.revisions||[])].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  const audit=[...(m.audit||[])].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,80);
  const createSnapshot=()=>{
    const reason=prompt('Motif de la sauvegarde :','Sauvegarde manuelle avant modification')||'Sauvegarde manuelle';
    const author=m.responsable||m.technicien||'Utilisateur SECAB';
    const rev=revisionSnapshot(m,reason,author);
    setRecords(rs=>rs.map(r=>r.id===m.id?{...r,revisions:[...(r.revisions||[]),rev],audit:[...(r.audit||[]),auditEntry('Révision manuelle créée',reason)],updatedAt:new Date().toISOString()}:r));
  };
  const restore=rev=>{
    if(!rev?.snapshot)return;
    if(!confirm(`Restaurer la révision n°${rev.number} du ${new Date(rev.at).toLocaleString('fr-FR')} ? Une sauvegarde de l’état actuel sera créée automatiquement.`))return;
    const now=new Date().toISOString();
    setRecords(rs=>rs.map(r=>{
      if(r.id!==m.id)return r;
      const safety=revisionSnapshot(r,'Sauvegarde automatique avant restauration',m.responsable||m.technicien||'Utilisateur SECAB');
      const restored=normalizeRecord({...rev.snapshot,id:r.id,uuid:r.uuid||rev.snapshot.uuid,createdAt:r.createdAt||rev.snapshot.createdAt});
      return {...restored,revisions:[...(r.revisions||[]),safety],audit:[...(r.audit||[]),auditEntry('Révision restaurée',`Révision n°${rev.number} · ${rev.reason||'sans motif'}`)],updatedAt:now,syncState:{...(restored.syncState||{}),status:'pending',error:''}};
    }));
    alert('Révision restaurée. Le dossier est marqué comme à synchroniser.');
  };
  const exportRevision=rev=>download(`SECAB_${safe(m.codeGdo||m.rapport||m.affaire||'affaire')}_revision_${rev.number}.json`,JSON.stringify(rev,null,2),'application/json');
  return <section className="historyPage">
    <div className="historyHero"><div><small>TRAÇABILITÉ ET REPRISE</small><h2>Historique de l’affaire</h2><p>Consultez les révisions, créez un point de sauvegarde et restaurez un état antérieur sans perdre la version actuelle.</p></div><button onClick={createSnapshot}>＋ Créer une révision maintenant</button></div>
    <div className="historyKpis"><div><small>Révisions disponibles</small><strong>{revisions.length}</strong></div><div><small>Événements d’audit</small><strong>{m.audit?.length||0}</strong></div><div><small>Dernière modification</small><strong>{m.updatedAt?new Date(m.updatedAt).toLocaleString('fr-FR'):'—'}</strong></div><div><small>État Drive</small><strong>{m.syncState?.status||'local'}</strong></div></div>
    <div className="historyColumns">
      <article className="historyPanel"><div className="historyPanelHead"><h3>Révisions enregistrées</h3><span>{revisions.length} version(s)</span></div>{revisions.length?<div className="revisionList">{revisions.map(rev=><div className="revisionCard" key={`${rev.number}-${rev.at}`}><div className="revisionNumber">V{rev.number}</div><div className="revisionInfo"><b>{rev.reason||'Révision'}</b><span>{new Date(rev.at).toLocaleString('fr-FR')} · {rev.author||'Utilisateur SECAB'}</span><small>{rev.snapshot?.affaire||m.affaire||'Affaire'} · {rev.snapshot?.codeGdo||m.codeGdo||'Sans GDO'} · {rev.snapshot?.commune||m.commune||'Commune non renseignée'}</small></div><div className="revisionActions"><button className="secondaryAction" onClick={()=>exportRevision(rev)}>Exporter</button><button onClick={()=>restore(rev)}>Restaurer</button></div></div>)}</div>:<div className="emptyHistory"><b>Aucune révision disponible</b><p>Créez une première sauvegarde manuelle ou clôturez le dossier pour générer automatiquement une révision.</p></div>}</article>
      <article className="historyPanel"><div className="historyPanelHead"><h3>Journal d’activité</h3><span>80 derniers événements</span></div>{audit.length?<div className="auditTimeline">{audit.map((entry,i)=><div className="auditItem" key={`${entry.at}-${i}`}><i></i><div><b>{entry.action||entry.label||'Modification'}</b><span>{entry.detail||entry.reason||'—'}</span><small>{entry.at?new Date(entry.at).toLocaleString('fr-FR'):'Date inconnue'}</small></div></div>)}</div>:<div className="emptyHistory"><b>Aucun événement d’audit</b><p>Les sauvegardes, clôtures, restaurations et synchronisations apparaîtront ici.</p></div>}</article>
    </div>
  </section>
}


const SYNC_COMPARE_FIELDS=[
  ['affaire','Nature de l’affaire'],['codeGdo','Code GDO'],['numeroPoste','N° poste'],['commune','Commune'],['typeOuvrage','Type d’ouvrage'],
  ['technicien','Technicien'],['statut','Statut'],['rm','RM'],['rng','RNG'],['rni','RNi'],['rmn','RMN'],['rcDirect','RC mesuré'],
  ['solutionRetenue','Solution retenue'],['updatedAt','Dernière modification']
];
function syncValue(v){if(v===null||v===undefined||v==='')return '—';if(typeof v==='object')return JSON.stringify(v);return String(v)}
function mergeConflictRecords(local,remote){
  const merged={...remote,...local};
  for(const [key] of SYNC_COMPARE_FIELDS){if((local[key]===undefined||local[key]===null||local[key]==='')&&remote[key]!==undefined)merged[key]=remote[key]}
  merged.measurePhotos={...(remote.measurePhotos||{}),...(local.measurePhotos||{})};
  merged.finalMeasurements={...(remote.finalMeasurements||{}),...(local.finalMeasurements||{})};
  merged.finalMeasurePhotos={...(remote.finalMeasurePhotos||{}),...(local.finalMeasurePhotos||{})};
  merged.implantation={...(remote.implantation||{}),...(local.implantation||{})};
  merged.photos=[...(remote.photos||[]),...(local.photos||[])].filter((x,i,a)=>a.findIndex(y=>(y?.name||y?.data)===(x?.name||x?.data))===i);
  merged.id=local.id;merged.uuid=local.uuid||remote.uuid;merged.createdAt=local.createdAt||remote.createdAt;
  merged.updatedAt=new Date().toISOString();
  merged.remoteConflict=null;
  merged.syncState={...(local.syncState||{}),status:'pending',error:'Conflit fusionné localement — synchronisation requise'};
  merged.revisions=[...(local.revisions||[])];
  merged.audit=[...(local.audit||[]),auditEntry('Conflit Drive fusionné','Les données distantes ont complété les champs locaux vides.')];
  return normalizeRecord(merged);
}
function SyncCenter({records,setRecords,pushDrive,setCurrent,setTab}){
  const conflicts=records.filter(r=>!r.deletedAt&&r.syncState?.status==='conflict');
  const pending=records.filter(r=>!r.deletedAt&&r.syncState?.status==='pending');
  const synced=records.filter(r=>!r.deletedAt&&r.syncState?.status==='synced');
  const [busy,setBusy]=useState(false);
  const resolve=(record,mode)=>{
    const remote=record.remoteConflict;
    if(mode==='remote'&&!remote)return;
    setRecords(rs=>rs.map(r=>{
      if(r.id!==record.id)return r;
      if(mode==='local')return {...r,remoteConflict:null,syncState:{...(r.syncState||{}),status:'pending',error:''},audit:[...(r.audit||[]),auditEntry('Conflit Drive résolu','Version locale conservée')]};
      if(mode==='remote'){
        const restored=normalizeRecord({...remote,id:r.id,uuid:r.uuid||remote.uuid,createdAt:r.createdAt||remote.createdAt});
        return {...restored,remoteConflict:null,revisions:[...(r.revisions||[])],audit:[...(r.audit||[]),auditEntry('Conflit Drive résolu','Version terrain / distante conservée')],syncState:{...(restored.syncState||{}),status:'synced',lastPull:new Date().toISOString(),error:''}};
      }
      return mergeConflictRecords(r,remote||{});
    }));
  };
  const retryAll=async()=>{if(!pending.length)return;setBusy(true);try{await pushDrive(pending,'centre-synchronisation');alert(`${pending.length} affaire(s) synchronisée(s).`)}catch(e){alert(e.message)}finally{setBusy(false)}};
  return <section className="syncCenterPage">
    <div className="syncCenterHero"><div><small>CENTRE DE SYNCHRONISATION</small><h2>Échanges terrain ↔ bureau</h2><p>Contrôlez les affaires en attente, résolvez les conflits sans perdre de données et relancez les transmissions Google Drive.</p></div><button disabled={busy||!pending.length} onClick={retryAll}>{busy?'Synchronisation…':`☁ Synchroniser les ${pending.length} attente(s)`}</button></div>
    <div className="syncCenterKpis"><div><small>À jour</small><strong>{synced.length}</strong></div><div><small>En attente</small><strong>{pending.length}</strong></div><div className={conflicts.length?'danger':''}><small>Conflits à traiter</small><strong>{conflicts.length}</strong></div><div><small>Total actif</small><strong>{records.filter(r=>!r.deletedAt).length}</strong></div></div>
    {conflicts.length?<div className="conflictList">{conflicts.map(r=>{const remote=r.remoteConflict||{};const differences=SYNC_COMPARE_FIELDS.filter(([k])=>syncValue(r[k])!==syncValue(remote[k]));return <article className="conflictCard" key={r.id}><div className="conflictHead"><div><span>⚠ CONFLIT DRIVE</span><h3>{r.codeGdo||r.numeroPoste||r.rapport||'Affaire sans référence'}</h3><p>{r.commune||'Commune non renseignée'} · {differences.length} différence(s) détectée(s)</p></div><button className="secondaryAction" onClick={()=>{setCurrent(r.id);setTab('historique')}}>Voir l’historique</button></div><div className="conflictCompare"><div className="compareTitle"><b>Champ</b><b>Version bureau</b><b>Version terrain / Drive</b></div>{differences.map(([k,label])=><div className="compareRow" key={k}><span>{label}</span><em>{syncValue(r[k])}</em><em>{syncValue(remote[k])}</em></div>)}</div><div className="conflictActions"><button className="secondaryAction" onClick={()=>resolve(r,'local')}>Conserver la version bureau</button><button onClick={()=>resolve(r,'merge')}>Fusion sécurisée</button><button className="danger" onClick={()=>resolve(r,'remote')}>Conserver la version terrain</button></div><p className="mergeHint"><b>Fusion sécurisée :</b> conserve les données bureau et complète uniquement les champs vides avec les données terrain. Les photos sont regroupées sans doublon.</p></article>})}</div>:<div className="syncEmptyState"><span>✓</span><h3>Aucun conflit de synchronisation</h3><p>Les échanges terrain et bureau ne présentent actuellement aucune divergence à arbitrer.</p></div>}
    <article className="syncQueuePanel"><div><h3>File d’attente</h3><p>Affaires modifiées localement qui doivent encore être transmises.</p></div>{pending.length?<div className="syncQueueList">{pending.map(r=><button key={r.id} onClick={()=>{setCurrent(r.id);setTab('rapport')}}><b>{r.codeGdo||r.numeroPoste||r.rapport||'Affaire'}</b><span>{r.commune||'—'} · {r.syncState?.error||'Transmission en attente'}</span><em>Ouvrir →</em></button>)}</div>:<p className="syncQueueEmpty">Aucune affaire en attente.</p>}</article>
  </section>
}

function Dashboard({stats,records,setCurrent,setTab,setRegistryFocus}){
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const visible=records.filter(r=>{
    const c=compute(r), photos=Object.values(r.measurePhotos||{}).filter(Boolean).length;
    const matchFilter=filter==='all'||(filter==='ok'&&c.ok)||(filter==='ko'&&!c.ok)||(filter==='photos'&&photos>0);
    const q=query.trim().toLowerCase();
    const matchQuery=!q||[r.affaire,r.codeGdo,r.numeroPoste,r.commune,r.rapport,r.typeOuvrage,r.technicien,r.uuid,r.marche,r.client].some(v=>String(v||'').toLowerCase().includes(q));
    return matchFilter&&matchQuery;
  });
  const openRegistry=(key)=>{setFilter(key);setRegistryFocus?.(key);setTab('registre')};
  const card=(label,val,key)=> <button className={`kpi ${filter===key?'kpiActive':''}`} onClick={()=>openRegistry(key)} title={`Ouvrir le registre filtré : ${label}`}><span>{label}</span><b>{val}</b></button>;
  return <section className="grid"><div className="hero"><div><small>SECAB COUPLAGE EXPERT</small><h2>Contrôle, diagnostic et amélioration des mises à la terre</h2><p>Application terrain Android et logiciel bureau Windows. Calculs exécutés selon le référentiel validé pour le dossier.</p></div><div className="formula"><b>Couplage séparé</b><span>Rc = (RM + RNi − RMN) / 2</span><span>c = Rc / RM</span><em>Conforme si c &lt; 0,15</em></div></div>
  {card('Affaires',stats.total,'all')}{card('Conformes',stats.ok,'ok')}{card('Non conformes',stats.ko,'ko')}<div className="kpi dateTimeKpi"><span>Date et heure</span><b>{new Date().toLocaleDateString('fr-FR')}</b><em>{new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</em></div>
  <div className="card wide"><div className="recordsToolbar"><div><h2>Affaires en mémoire</h2><p>{visible.length} affaire(s) affichée(s)</p></div><input className="quickSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Recherche rapide : n° poste, GDO, affaire, commune, rapport, technicien..."/></div>
  {visible.length?visible.map(r=>{const c=compute(r);return <button className="recordRow" key={r.id} onClick={()=>{setCurrent(r.id);setTab('rapport')}}><b>{r.affaire||'Sans affaire'}</b><span>{r.commune}</span><span>{r.terreConfig==='interconnectee'?'Interconnectée':'Séparée'}</span><span className={c.ok?'okText':'koText'}>{c.ok?'Conforme':'À traiter'}</span><em>Ouvrir le rapport →</em></button>}):<p className="emptyState">Aucune affaire ne correspond à la recherche.</p>}</div></section>
}

const COMMUNE_MAP_POSITIONS={"Le Port":[157,169],"La Possession":[224,177],"Saint-Paul":[186.9,264.0],"Trois-Bassins":[184,361],"Saint-Leu":[188.8,406.7],"Les Avirons":[224,484],"L’Étang-Salé":[225,524],"Saint-Louis":[289.5,490.4],"Saint-Pierre":[346.2,575.8],"Petite-Île":[438,615],"Saint-Joseph":[518.6,604.3],"Saint-Philippe":[628.8,566.1],"Sainte-Rose":[648.3,453.2],"La Plaine-des-Palmistes":[490,404],"Saint-Benoît":[565.1,308.3],"Bras-Panon":[542,239],"Saint-André":[539.2,177.2],"Sainte-Suzanne":[487,151],"Sainte-Marie":[403.6,167.2],"Saint-Denis":[315.0,145.3],"Salazie":[369.4,278.1],"Cilaos":[324.8,391.7],"Entre-Deux":[365,487],"Le Tampon":[424.9,506.0]};
const COMMUNE_MAP_PATHS={"Le Port":"M 139 143 L 141 147 L 140 155 L 138 157 L 137 168 L 132 178 L 138 192 L 151 193 L 166 194 L 179 194 L 181 190 L 183 180 L 188 155 L 191 151 L 188 147 L 173 144 L 168 147 L 159 146 L 156 143 L 147 141 Z","La Possession":"M 233 112 L 223 124 L 214 128 L 204 141 L 191 147 L 191 151 L 188 155 L 192 161 L 183 180 L 181 190 L 210 194 L 218 197 L 235 214 L 236 219 L 243 222 L 241 220 L 242 215 L 248 214 L 249 220 L 246 221 L 246 223 L 250 224 L 255 229 L 259 229 L 261 233 L 265 235 L 270 248 L 269 253 L 265 258 L 268 266 L 268 275 L 271 277 L 267 281 L 272 286 L 272 289 L 277 291 L 283 298 L 282 305 L 270 321 L 273 321 L 285 333 L 292 327 L 304 328 L 304 324 L 313 319 L 327 321 L 321 318 L 314 310 L 314 307 L 308 302 L 308 299 L 315 295 L 319 290 L 318 260 L 327 254 L 325 250 L 326 244 L 316 228 L 308 223 L 303 217 L 300 217 L 299 221 L 264 222 L 257 221 L 256 219 L 253 221 L 250 220 L 251 212 L 257 212 L 263 215 L 286 214 L 287 212 L 282 208 L 267 209 L 264 207 L 264 193 L 267 188 L 266 179 L 268 177 L 252 158 L 252 152 L 249 151 L 251 149 L 249 139 L 245 136 L 239 126 L 236 112 Z","Saint-Paul":"M 72 268 L 73 275 L 80 285 L 77 297 L 77 314 L 83 320 L 86 327 L 109 347 L 122 345 L 137 337 L 145 336 L 168 327 L 184 327 L 193 330 L 224 329 L 237 335 L 244 333 L 261 334 L 268 336 L 269 340 L 275 346 L 288 354 L 291 354 L 319 338 L 319 332 L 325 326 L 314 323 L 309 325 L 309 329 L 305 332 L 293 332 L 290 336 L 284 337 L 271 325 L 267 324 L 266 318 L 274 310 L 279 299 L 268 291 L 263 281 L 265 277 L 263 271 L 264 267 L 259 259 L 265 251 L 262 237 L 259 237 L 258 233 L 252 232 L 245 226 L 237 225 L 233 221 L 231 215 L 228 212 L 225 213 L 225 209 L 216 201 L 209 198 L 179 194 L 166 183 L 160 181 L 145 182 L 137 180 L 141 191 L 141 207 L 139 219 L 135 228 L 128 236 L 107 249 L 89 249 L 81 260 Z","Trois-Bassins":"M 111 351 L 111 355 L 117 360 L 120 367 L 126 370 L 129 377 L 139 376 L 149 369 L 159 368 L 174 360 L 205 354 L 234 355 L 241 359 L 254 358 L 269 360 L 272 363 L 278 363 L 284 357 L 272 348 L 269 348 L 264 340 L 260 338 L 245 337 L 242 339 L 236 339 L 223 333 L 194 334 L 182 331 L 169 331 L 157 335 L 166 339 L 166 343 L 163 345 L 154 344 L 153 342 L 157 340 L 153 337 L 152 343 L 150 342 L 150 339 L 141 340 L 127 347 L 126 350 L 121 349 Z","Saint-Leu":"M 272 366 L 256 362 L 240 363 L 232 358 L 205 358 L 196 361 L 184 361 L 179 365 L 175 364 L 167 367 L 161 372 L 155 372 L 154 374 L 150 373 L 140 380 L 136 379 L 130 381 L 129 389 L 131 394 L 139 397 L 146 407 L 146 435 L 144 447 L 140 456 L 144 459 L 147 471 L 151 476 L 151 482 L 160 491 L 165 491 L 174 501 L 180 504 L 182 493 L 188 485 L 187 482 L 191 481 L 193 477 L 192 469 L 210 445 L 227 430 L 233 420 L 236 421 L 236 419 L 243 413 L 248 402 L 255 399 L 266 388 L 266 380 L 270 377 L 273 368 Z","Les Avirons":"M 266 396 L 252 404 L 247 414 L 225 436 L 224 439 L 229 437 L 232 440 L 232 444 L 229 446 L 217 444 L 213 449 L 219 451 L 218 455 L 212 456 L 210 453 L 209 456 L 204 458 L 201 465 L 198 467 L 197 479 L 186 494 L 184 504 L 193 508 L 208 510 L 212 514 L 213 505 L 216 504 L 217 496 L 216 489 L 211 487 L 213 478 L 218 472 L 229 466 L 235 457 L 232 454 L 227 457 L 223 454 L 226 453 L 227 450 L 239 449 L 239 441 L 244 428 L 248 424 L 251 424 L 253 420 L 251 418 L 252 416 L 255 416 L 262 411 Z","L’Étang-Salé":"M 243 450 L 243 454 L 237 460 L 234 468 L 220 475 L 224 479 L 222 480 L 218 478 L 216 485 L 218 485 L 221 490 L 220 504 L 216 512 L 217 520 L 211 520 L 205 513 L 193 512 L 186 509 L 186 512 L 191 515 L 196 528 L 194 536 L 200 541 L 224 544 L 246 550 L 242 546 L 242 542 L 250 532 L 251 523 L 254 520 L 253 509 L 251 506 L 245 506 L 243 503 L 237 505 L 231 504 L 230 497 L 228 503 L 223 499 L 228 493 L 235 497 L 238 496 L 239 498 L 242 496 L 244 498 L 250 498 L 249 484 L 252 464 L 250 459 L 244 454 Z","Saint-Louis":"M 272 396 L 269 399 L 266 412 L 256 420 L 254 426 L 255 435 L 251 438 L 247 448 L 248 453 L 254 457 L 256 462 L 253 493 L 258 514 L 258 519 L 254 526 L 254 533 L 251 540 L 247 542 L 247 545 L 268 567 L 283 557 L 299 555 L 319 548 L 325 538 L 322 532 L 327 528 L 330 518 L 327 509 L 328 504 L 325 500 L 327 472 L 329 469 L 327 461 L 328 447 L 322 444 L 317 445 L 315 443 L 305 442 L 302 437 L 298 436 L 295 433 L 294 428 L 291 427 L 276 411 L 276 401 Z","Saint-Pierre":"M 271 570 L 280 584 L 296 593 L 317 595 L 323 600 L 322 603 L 324 606 L 328 606 L 327 609 L 343 614 L 348 613 L 353 621 L 370 620 L 386 629 L 390 629 L 396 633 L 405 634 L 407 627 L 406 623 L 414 601 L 413 593 L 415 590 L 427 582 L 440 580 L 447 575 L 451 575 L 449 572 L 459 564 L 467 551 L 477 549 L 477 544 L 474 535 L 462 545 L 455 548 L 448 560 L 440 564 L 439 568 L 436 566 L 432 569 L 428 569 L 422 577 L 412 579 L 405 584 L 387 566 L 378 565 L 378 562 L 385 557 L 383 553 L 374 549 L 365 540 L 364 533 L 349 516 L 345 516 L 339 519 L 339 533 L 335 534 L 334 540 L 326 549 L 308 557 L 284 561 Z","Petite-Île":"M 477 553 L 471 554 L 463 566 L 457 570 L 453 578 L 447 579 L 442 584 L 430 585 L 418 592 L 416 610 L 410 623 L 409 635 L 411 637 L 418 639 L 423 645 L 432 644 L 442 648 L 448 648 L 454 645 L 454 638 L 459 635 L 461 631 L 462 621 L 461 605 L 457 602 L 460 582 L 466 576 L 466 572 L 469 574 L 473 571 Z","Saint-Joseph":"M 511 448 L 499 459 L 493 462 L 481 486 L 481 500 L 477 505 L 476 513 L 479 523 L 478 535 L 481 545 L 481 557 L 477 572 L 471 579 L 466 580 L 461 600 L 465 603 L 466 631 L 458 641 L 465 649 L 475 653 L 476 656 L 483 661 L 493 660 L 498 656 L 518 657 L 522 663 L 525 663 L 536 656 L 549 657 L 560 647 L 579 648 L 582 645 L 582 636 L 577 630 L 574 618 L 574 607 L 576 604 L 562 572 L 562 564 L 566 557 L 568 538 L 561 532 L 557 525 L 554 499 L 526 496 L 523 494 L 522 490 L 530 478 L 530 465 L 522 454 Z","Saint-Philippe":"M 558 499 L 561 523 L 565 531 L 574 537 L 571 542 L 570 558 L 567 561 L 566 571 L 580 603 L 578 619 L 581 629 L 586 636 L 585 649 L 597 648 L 612 641 L 633 639 L 638 634 L 653 637 L 663 633 L 683 617 L 692 602 L 687 583 L 689 556 L 685 546 L 687 534 L 685 524 L 686 512 Z","Sainte-Rose":"M 711 389 L 704 385 L 694 383 L 689 376 L 679 369 L 666 369 L 661 364 L 655 350 L 650 345 L 636 358 L 633 366 L 626 374 L 627 380 L 625 383 L 630 386 L 630 390 L 627 393 L 628 397 L 623 403 L 619 404 L 619 411 L 613 417 L 608 417 L 586 427 L 582 431 L 582 435 L 578 435 L 574 438 L 560 436 L 560 439 L 556 440 L 554 445 L 536 461 L 534 465 L 534 479 L 527 492 L 688 508 L 691 483 L 697 473 L 697 467 L 709 456 L 709 435 L 711 433 L 718 434 L 721 432 L 718 425 L 718 412 L 720 408 L 712 398 Z","La Plaine-des-Palmistes":"M 448 374 L 449 378 L 454 379 L 457 382 L 455 389 L 462 395 L 462 399 L 465 403 L 463 413 L 467 417 L 467 421 L 475 421 L 476 425 L 484 430 L 489 429 L 490 426 L 493 430 L 499 429 L 503 418 L 509 414 L 515 413 L 533 447 L 538 449 L 537 452 L 541 451 L 545 444 L 549 444 L 556 434 L 560 432 L 569 435 L 573 434 L 579 429 L 579 424 L 582 426 L 593 420 L 535 350 L 525 343 L 514 347 L 511 353 L 511 358 L 495 362 L 486 370 L 479 369 L 474 374 L 470 375 L 465 369 L 459 368 Z","Saint-Benoît":"M 647 343 L 641 337 L 637 327 L 622 313 L 611 297 L 611 282 L 605 277 L 600 265 L 587 259 L 583 254 L 583 249 L 579 241 L 579 234 L 568 238 L 559 238 L 552 248 L 549 248 L 552 260 L 546 265 L 537 268 L 531 266 L 525 268 L 518 267 L 512 269 L 508 274 L 496 274 L 496 278 L 491 280 L 489 288 L 479 301 L 473 305 L 472 309 L 469 310 L 461 324 L 454 325 L 430 311 L 426 311 L 417 316 L 411 316 L 407 321 L 398 323 L 395 320 L 392 330 L 388 334 L 382 335 L 381 338 L 377 339 L 368 352 L 375 361 L 379 380 L 393 377 L 408 378 L 409 376 L 412 378 L 416 375 L 422 377 L 426 376 L 427 379 L 437 379 L 455 365 L 466 365 L 470 370 L 473 370 L 477 365 L 485 366 L 492 359 L 505 356 L 513 342 L 522 339 L 529 340 L 539 348 L 597 417 L 611 414 L 616 408 L 616 401 L 620 400 L 624 391 L 620 382 L 621 374 L 630 363 L 632 354 L 639 352 Z","Bras-Panon":"M 577 206 L 567 206 L 555 212 L 548 212 L 532 203 L 524 203 L 515 206 L 514 209 L 502 219 L 492 219 L 490 225 L 486 228 L 476 231 L 460 229 L 462 231 L 461 233 L 450 239 L 446 239 L 444 244 L 440 248 L 435 249 L 432 254 L 428 269 L 431 269 L 435 276 L 435 299 L 431 307 L 442 312 L 452 320 L 459 320 L 459 317 L 467 306 L 485 287 L 490 272 L 499 269 L 503 271 L 517 263 L 533 262 L 536 264 L 548 259 L 545 246 L 550 245 L 550 241 L 554 239 L 556 235 L 568 234 L 570 231 L 578 230 Z","Saint-André":"M 577 196 L 563 169 L 544 149 L 541 143 L 522 131 L 508 128 L 508 139 L 512 139 L 514 143 L 519 145 L 525 152 L 524 160 L 517 166 L 515 172 L 507 176 L 498 175 L 496 178 L 488 182 L 485 187 L 481 188 L 480 191 L 477 190 L 470 193 L 467 196 L 467 199 L 464 200 L 454 212 L 454 215 L 450 220 L 455 224 L 472 228 L 486 223 L 487 218 L 491 215 L 500 215 L 513 203 L 521 200 L 536 200 L 549 208 L 554 208 L 566 202 L 577 202 Z","Sainte-Suzanne":"M 504 127 L 495 127 L 466 110 L 459 112 L 451 111 L 451 117 L 446 127 L 446 141 L 452 153 L 452 159 L 442 170 L 437 184 L 424 208 L 424 212 L 414 228 L 415 230 L 426 231 L 444 219 L 467 190 L 484 183 L 487 178 L 500 169 L 503 172 L 512 169 L 515 162 L 521 158 L 521 154 L 518 153 L 517 148 L 513 148 L 510 143 L 504 142 Z","Sainte-Marie":"M 445 107 L 429 105 L 423 109 L 416 109 L 373 95 L 376 104 L 375 113 L 377 116 L 377 124 L 384 136 L 384 140 L 373 152 L 371 163 L 366 172 L 365 183 L 361 185 L 362 214 L 349 220 L 348 226 L 350 228 L 345 232 L 371 224 L 382 225 L 387 233 L 411 227 L 433 183 L 437 170 L 448 157 L 442 137 L 443 123 L 447 116 Z","Saint-Denis":"M 262 93 L 257 96 L 254 101 L 244 105 L 239 111 L 245 128 L 253 137 L 253 144 L 256 150 L 255 155 L 264 164 L 264 167 L 269 170 L 272 176 L 268 205 L 280 204 L 286 206 L 291 211 L 304 213 L 310 220 L 318 224 L 326 238 L 329 240 L 332 236 L 339 233 L 344 226 L 346 217 L 358 212 L 356 209 L 358 202 L 356 187 L 358 182 L 361 181 L 361 170 L 368 158 L 368 152 L 371 146 L 375 145 L 380 139 L 373 123 L 370 95 L 358 99 L 335 97 L 316 83 L 305 89 L 287 86 L 274 91 Z","Salazie":"M 455 228 L 446 222 L 429 234 L 414 234 L 410 232 L 391 237 L 386 237 L 379 228 L 372 228 L 342 239 L 334 240 L 329 245 L 331 256 L 323 261 L 322 293 L 313 302 L 317 301 L 317 305 L 322 313 L 325 313 L 326 316 L 331 317 L 334 321 L 345 327 L 350 333 L 350 337 L 357 339 L 365 348 L 377 333 L 388 329 L 394 315 L 397 315 L 401 319 L 409 312 L 422 310 L 427 305 L 431 298 L 431 276 L 424 270 L 428 253 L 434 245 L 437 245 L 440 240 L 443 239 L 444 236 L 454 232 Z","Cilaos":"M 333 325 L 324 332 L 325 337 L 322 341 L 307 349 L 302 354 L 295 356 L 290 360 L 286 360 L 276 371 L 274 380 L 270 381 L 270 386 L 279 399 L 280 410 L 298 427 L 300 433 L 303 433 L 307 438 L 324 440 L 329 443 L 337 438 L 349 436 L 361 427 L 368 406 L 369 392 L 375 382 L 375 375 L 369 359 L 361 352 L 354 342 L 346 339 L 344 331 Z","Entre-Deux":"M 392 382 L 377 385 L 372 397 L 372 407 L 363 431 L 346 442 L 338 442 L 332 447 L 330 457 L 333 470 L 330 476 L 329 499 L 332 503 L 334 516 L 331 530 L 329 532 L 329 538 L 331 537 L 332 531 L 336 529 L 336 516 L 347 512 L 350 508 L 355 506 L 355 495 L 364 495 L 367 492 L 368 487 L 378 483 L 380 468 L 377 467 L 376 463 L 378 461 L 377 457 L 382 454 L 383 436 L 390 431 L 399 433 L 400 423 L 396 418 L 393 395 L 389 387 L 392 386 Z","Le Tampon":"M 445 379 L 440 382 L 427 384 L 418 379 L 412 382 L 398 382 L 395 391 L 397 394 L 397 404 L 400 409 L 400 417 L 404 422 L 402 437 L 400 439 L 397 439 L 394 436 L 387 438 L 387 453 L 381 463 L 384 467 L 383 483 L 379 487 L 371 490 L 371 493 L 367 498 L 361 499 L 362 504 L 352 512 L 359 523 L 368 532 L 369 538 L 373 539 L 374 544 L 380 545 L 382 549 L 386 550 L 389 555 L 387 562 L 405 579 L 411 575 L 420 573 L 426 565 L 430 565 L 430 561 L 433 563 L 444 558 L 451 546 L 462 540 L 474 530 L 475 524 L 472 514 L 474 503 L 477 499 L 478 482 L 487 464 L 493 457 L 507 445 L 515 444 L 525 451 L 529 457 L 534 458 L 534 454 L 527 445 L 518 426 L 514 425 L 515 422 L 512 418 L 508 419 L 503 429 L 505 431 L 497 434 L 483 434 L 476 431 L 472 425 L 465 424 L 458 412 L 461 403 L 451 390 L 452 383 L 447 382 Z"};
function choroplethColor(value,min,max){if(!value)return '#eef2f6';const t=max===min?.35:(value-min)/(max-min);const hue=120*(1-t);const light=86-54*t;return `hsl(${hue} 78% ${light}%)`;}
function recordDateValue(r){const raw=r.date||r.validation?.lockedAt||r.updatedAt||r.createdAt;const d=raw?new Date(raw):null;return d&&!Number.isNaN(d.getTime())?d:null}
function meaningfulRecord(r){return Boolean(r.codeGdo||r.rm||r.rng||r.rni||r.rmn||r.rcDirect||r.validation?.locked||r.statut&&r.statut!=='Brouillon')}
function percent(n,d){return d?Math.round(n*1000/d)/10:0}
function countPhotos(r){return Object.values(r.measurePhotos||{}).filter(Boolean).length+(r.photos||[]).length+(r.afterWorkPhoto?1:0)+(r.reinstatementPhoto?1:0)}

function CommuneMapLabel({name,x,y,count}){
  const words=String(name).replace('La Plaine-des-Palmistes','La Plaine-des- Palmistes').split(/[- ]/).filter(Boolean);
  const split=String(name).length>13;
  const midpoint=Math.ceil(words.length/2);
  const line1=split?words.slice(0,midpoint).join(' '):name;
  const line2=split?words.slice(midpoint).join(' '):'';
  return <g className="communeLabelGroup" aria-label={`${name}${count?` : ${count} affaire(s)`:''}`}>
    <text className="mapCityLabel" x={x} y={line2?y-9:y-3} textAnchor="middle"><tspan x={x}>{line1}</tspan>{line2&&<tspan x={x} dy="11">{line2}</tspan>}</text>
    {count>0&&<><circle className="mapCountCircle" cx={x} cy={y+(line2?20:14)} r="13"/><text className="mapCountLabel" x={x} y={y+(line2?25:19)} textAnchor="middle">{count}</text></>}
  </g>
}
function Reporting({records,setCurrent,setTab}){
  const base=useMemo(()=>records.filter(r=>!r.deletedAt&&!r.isTest&&meaningfulRecord(r)),[records]);
  const dates=base.map(recordDateValue).filter(Boolean).sort((a,b)=>a-b);
  const [from,setFrom]=useState(dates[0]?.toISOString().slice(0,10)||'');
  const [to,setTo]=useState(new Date().toISOString().slice(0,10));
  const [commune,setCommune]=useState('Toutes');
  const [technicien,setTechnicien]=useState('Tous');
  const [nature,setNature]=useState('Toutes');
  const [status,setStatus]=useState('Tous');
  const [ouvrage,setOuvrage]=useState('Tous');
  const [focus,setFocus]=useState('all');
  const [selectedCommune,setSelectedCommune]=useState('');
  const detailRef=useRef(null);
  const technicians=[...new Set(base.map(r=>r.technicien).filter(Boolean))].sort();
  const ouvrages=[...new Set(base.map(r=>r.typeOuvrage).filter(Boolean))].sort();
  const focusMatch=r=>{
    const compliant=computeFinal(r).ok||compute(r).ok;
    if(focus==='conformes')return compliant;
    if(focus==='nonConformes')return !compliant;
    if(focus==='travaux')return Boolean(r.solutionRetenue&&r.solutionRetenue!=='none');
    if(focus==='sansTravaux')return r.solutionRetenue==='none';
    if(focus==='controleFinal')return Object.values(r.finalMeasurements||{}).some(Boolean);
    if(focus==='synced')return r.syncState?.status==='synced';
    if(focus==='pending')return ['pending','conflict'].includes(r.syncState?.status);
    if(focus==='photos')return countPhotos(r)>0;
    if(focus==='distance')return Boolean(distanceAlert(r));
    if(focus==='locked')return Boolean(r.validation?.locked);
    return true;
  };
  const filtered=useMemo(()=>base.filter(r=>{const d=recordDateValue(r),ds=d?.toISOString().slice(0,10)||'';return (!from||ds>=from)&&(!to||ds<=to)&&(commune==='Toutes'||r.commune===commune)&&(technicien==='Tous'||r.technicien===technicien)&&(nature==='Toutes'||r.affaire===nature)&&(status==='Tous'||r.statut===status)&&(ouvrage==='Tous'||r.typeOuvrage===ouvrage)&&focusMatch(r)}),[base,from,to,commune,technicien,nature,status,ouvrage,focus]);
  const total=filtered.length, ok=filtered.filter(r=>computeFinal(r).ok||compute(r).ok).length, ko=total-ok;
  const withWorks=filtered.filter(r=>r.solutionRetenue&&r.solutionRetenue!=='none').length;
  const noWorks=filtered.filter(r=>r.solutionRetenue==='none').length;
  const finalControlled=filtered.filter(r=>Object.values(r.finalMeasurements||{}).some(Boolean)).length;
  const locked=filtered.filter(r=>r.validation?.locked).length;
  const synced=filtered.filter(r=>r.syncState?.status==='synced').length;
  const pending=filtered.filter(r=>['pending','conflict'].includes(r.syncState?.status)).length;
  const distanceWarnings=filtered.filter(r=>distanceAlert(r)).length;
  const photos=filtered.reduce((a,r)=>a+countPhotos(r),0);
  const communes=COMMUNES.map(name=>{const rows=filtered.filter(r=>r.commune===name),co=rows.filter(r=>computeFinal(r).ok||compute(r).ok).length;return {name,total:rows.length,ok:co,ko:rows.length-co,works:rows.filter(r=>r.solutionRetenue&&r.solutionRetenue!=='none').length}}).filter(x=>x.total).sort((a,b)=>b.total-a.total);
  const statusRows=STATUSES.map(name=>({name,total:filtered.filter(r=>r.statut===name).length})).filter(x=>x.total);
  const natureRows=['Mesure','Amélioration','Mesure et amélioration'].map(name=>({name,total:filtered.filter(r=>r.affaire===name).length})).filter(x=>x.total);
  const ouvrageRows=[...new Set(filtered.map(r=>r.typeOuvrage).filter(Boolean))].map(name=>({name,total:filtered.filter(r=>r.typeOuvrage===name).length})).sort((a,b)=>b.total-a.total).slice(0,8);
  const techRows=technicians.map(name=>({name,total:filtered.filter(r=>r.technicien===name).length,ok:filtered.filter(r=>r.technicien===name&&(computeFinal(r).ok||compute(r).ok)).length})).filter(x=>x.total).sort((a,b)=>b.total-a.total);
  const selected=communes.find(x=>x.name===selectedCommune);
  const positiveCounts=communes.map(x=>x.total).filter(n=>n>0);
  const minCommuneCount=positiveCounts.length?Math.min(...positiveCounts):0, maxCommuneCount=positiveCounts.length?Math.max(...positiveCounts):0;
  const reset=()=>{setFrom(dates[0]?.toISOString().slice(0,10)||'');setTo(new Date().toISOString().slice(0,10));setCommune('Toutes');setTechnicien('Tous');setNature('Toutes');setStatus('Tous');setOuvrage('Tous');setFocus('all');setSelectedCommune('')};
  const jumpToDetails=()=>setTimeout(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),30);
  const selectFocus=f=>{setFocus(f);jumpToDetails()};
  const exportCsv=()=>{const cols=['rapport','codeGdo','numeroPoste','affaire','date','commune','typeOuvrage','technicien','statut','conformite','rm','rng','rni','rmn','rc','coefficient','solution','photos','sync'];const rows=[cols.join(';'),...filtered.map(r=>{const c=compute(r);return [r.rapport,r.codeGdo,r.numeroPoste,r.affaire,r.date,r.commune,r.typeOuvrage,r.technicien,r.statut,(computeFinal(r).ok||c.ok)?'Conforme':'Non conforme',r.rm,r.rng,r.rni,r.rmn,fmt(c.rc,3),fmt(c.c,4),r.solutionRetenue==='none'?'Aucun travaux':(ELECTRODES.find(x=>x.id===r.solutionRetenue)?.title||r.solutionRetenue),countPhotos(r),r.syncState?.status].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')})];download(`SECAB_reporting_${from||'debut'}_${to||'fin'}.csv`,rows.join('\n'),'text/csv;charset=utf-8')};
  const exportExcel=()=>{
    const details=filtered.map(r=>{const c=compute(r),cf=computeFinal(r);return {
      'Date':recordDateValue(r)?.toLocaleDateString('fr-FR')||'', 'Rapport':r.rapport||'', 'Code GDO':r.codeGdo||'', 'N° poste':r.numeroPoste||'', 'Nature':r.affaire||'', 'Commune':r.commune||'', 'Type ouvrage':r.typeOuvrage||'', 'Technicien':r.technicien||'', 'Statut':r.statut||'', 'Conformité':(cf.ok||c.ok)?'Conforme':'Non conforme',
      'RM (Ω)':r.rm||'', 'RNg (Ω)':r.rng||'', 'RNi (Ω)':r.rni||'', 'RMN (Ω)':r.rmn||'', 'Rc (Ω)':Number.isFinite(c.rc)?c.rc:'', 'Coefficient':Number.isFinite(c.c)?c.c:'', 'Distance terres (m)':r.distance||'', 'Alerte < 8 m':distanceAlert(r)?'Oui':'Non',
      'Solution':r.solutionRetenue==='none'?'Aucun travaux':(ELECTRODES.find(x=>x.id===r.solutionRetenue)?.title||r.solutionRetenue||''), 'Photos':countPhotos(r), 'Synchronisation':r.syncState?.status||'local', 'Parcelles':(r.implantation?.analysis||[]).map(x=>x.parcelle||x.numero).filter(Boolean).join(', '), 'Dernière mise à jour':r.updatedAt||''
    }});
    const summary=[
      {'Indicateur':'Période','Valeur':`${from||'Début'} au ${to||'Aujourd’hui'}`},{'Indicateur':'Affaires','Valeur':total},{'Indicateur':'Conformes','Valeur':ok},{'Indicateur':'Non conformes','Valeur':ko},{'Indicateur':'Taux de conformité (%)','Valeur':percent(ok,total)},{'Indicateur':'Travaux proposés','Valeur':withWorks},{'Indicateur':'Aucun travaux','Valeur':noWorks},{'Indicateur':'Contrôles finaux','Valeur':finalControlled},{'Indicateur':'Synchronisées','Valeur':synced},{'Indicateur':'En attente / conflits','Valeur':pending},{'Indicateur':'Photos archivées','Valeur':photos},{'Indicateur':'Alertes distance < 8 m','Valeur':distanceWarnings}
    ];
    const wb=XLSX.utils.book_new();
    const wsDash=XLSX.utils.json_to_sheet(summary); wsDash['!cols']=[{wch:32},{wch:24}]; XLSX.utils.book_append_sheet(wb,wsDash,'Tableau de bord');
    const wsDetails=XLSX.utils.json_to_sheet(details); wsDetails['!freeze']={xSplit:0,ySplit:1}; wsDetails['!autofilter']={ref:wsDetails['!ref']}; XLSX.utils.book_append_sheet(wb,wsDetails,'Toutes les affaires');
    const addSheet=(name,rows)=>{const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:30},{wch:14},{wch:14},{wch:18}];XLSX.utils.book_append_sheet(wb,ws,name)};
    addSheet('Par commune',communes.map(x=>({'Commune':x.name,'Affaires':x.total,'Conformes':x.ok,'Non conformes':x.ko,'Avec travaux':x.works})));
    addSheet('Par technicien',techRows.map(x=>({'Technicien':x.name,'Affaires':x.total,'Conformes':x.ok,'Taux conformité (%)':percent(x.ok,x.total)})));
    addSheet('Par ouvrage',ouvrageRows.map(x=>({'Type ouvrage':x.name,'Affaires':x.total})));
    addSheet('Par statut',statusRows.map(x=>({'Statut':x.name,'Affaires':x.total,'Part (%)':percent(x.total,total)})));
    XLSX.writeFile(wb,`SECAB_reporting_${from||'debut'}_${to||'fin'}.xlsx`,{compression:true});
  };
  const exportWord=async()=>{
    const cell=(text,bold=false)=>new TableCell({children:[new Paragraph({children:[new TextRun({text:String(text??'—'),bold})]})]});
    const table=(headers,rows)=>new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:headers.map(h=>cell(h,true))}),...rows.map(row=>new TableRow({children:row.map(v=>cell(v))}))]});
    const children=[
      new Paragraph({text:'SECAB COUPLAGE EXPERT',heading:HeadingLevel.TITLE,alignment:AlignmentType.CENTER}),
      new Paragraph({text:'Reporting client — Contrôles et améliorations des mises à la terre',heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER}),
      new Paragraph({text:`Période : ${from||'Début'} au ${to||'Aujourd’hui'} · Édité le ${new Date().toLocaleString('fr-FR')}`,alignment:AlignmentType.CENTER}),
      new Paragraph({text:'Synthèse exécutive',heading:HeadingLevel.HEADING_1}),
      new Paragraph(`Sur la période, ${total} affaire(s) ont été analysée(s) dans ${communes.length} commune(s). Le taux de conformité est de ${percent(ok,total)} %. ${ko} affaire(s) sont non conformes ou à vérifier, ${withWorks} comportent une solution de travaux et ${noWorks} ne nécessitent aucune intervention.`),
      table(['Indicateur','Valeur'],[['Affaires',total],['Conformes',ok],['Non conformes',ko],['Taux de conformité',`${percent(ok,total)} %`],['Travaux proposés',withWorks],['Contrôles finaux',finalControlled],['Photos archivées',photos],['Alertes distance < 8 m',distanceWarnings],['Synchronisées',synced],['En attente / conflits',pending]]),
      new Paragraph({text:'Répartition par commune',heading:HeadingLevel.HEADING_1}),
      table(['Commune','Affaires','Conformes','Non conformes','Avec travaux'],communes.map(x=>[x.name,x.total,x.ok,x.ko,x.works])),
      new Paragraph({text:'Production par technicien',heading:HeadingLevel.HEADING_1}),
      table(['Technicien','Affaires','Conformes','Taux'],techRows.map(x=>[x.name,x.total,x.ok,`${percent(x.ok,x.total)} %`])),
      new Paragraph({children:[new PageBreak()]}),
      new Paragraph({text:'Détail des affaires',heading:HeadingLevel.HEADING_1}),
      table(['Date','GDO','N° poste','Commune','Nature','Ouvrage','Technicien','Résultat'],[...filtered].map(r=>{const c=compute(r);return [recordDateValue(r)?.toLocaleDateString('fr-FR')||'—',r.codeGdo||'—',r.numeroPoste||'—',r.commune||'—',r.affaire||'—',r.typeOuvrage||'—',r.technicien||'—',(computeFinal(r).ok||c.ok)?'Conforme':'Non conforme']}))
    ];
    const doc=new Document({sections:[{properties:{},children}]});
    const blob=await Packer.toBlob(doc); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`SECAB_reporting_${from||'debut'}_${to||'fin'}.docx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const openRows=communeName=>{setCommune(communeName);setSelectedCommune(communeName);jumpToDetails()};
  const kpi=(label,value,sub,cls='',action='all')=><button type="button" className={`reportKpi ${cls} ${focus===action?'selectedMetric':''}`} onClick={()=>selectFocus(action)}><span>{label}</span><b>{value}</b><em>{sub}</em><small>Voir les affaires →</small></button>;
  return <section className="reportingModule reportingPrintArea">
    <div className="reportingHero"><div><small>REPORTING CLIENT · SECAB COUPLAGE EXPERT</small><h2>Tableau de bord des contrôles et améliorations de prises de terre</h2><p>Données vivantes issues du registre bureau et des synchronisations terrain.</p></div><div className="reportingPeriod"><b>Période analysée</b><span>{from||'Début'} → {to||'Aujourd’hui'}</span><em>Édité le {new Date().toLocaleString('fr-FR')}</em></div></div>
    <div className="reportFilters noPrint"><label>Du<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Au<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Select label="Commune" value={commune} onChange={v=>{setCommune(v);setSelectedCommune(v==='Toutes'?'':v)}} options={['Toutes',...COMMUNES]}/><Select label="Technicien" value={technicien} onChange={setTechnicien} options={['Tous',...technicians]}/><Select label="Nature" value={nature} onChange={setNature} options={['Toutes','Mesure','Amélioration','Mesure et amélioration']}/><Select label="Statut" value={status} onChange={setStatus} options={['Tous',...STATUSES]}/><Select label="Ouvrage" value={ouvrage} onChange={setOuvrage} options={['Tous',...ouvrages]}/><button className="secondaryAction" onClick={reset}>Réinitialiser</button></div>
    <div className="reportActions noPrint"><button onClick={()=>window.print()}>🖨 Imprimer / PDF</button><button onClick={exportCsv}>⬇ CSV détaillé</button><button onClick={exportExcel}>📊 Export Excel</button><button onClick={exportWord}>📝 Export Word</button><button className="secondaryAction" onClick={()=>setTab('registre')}>Ouvrir le registre</button></div>
    <div className="reportKpiGrid">{kpi('Affaires analysées',total,`${communes.length} commune(s)`,'','all')}{kpi('Conformes',ok,`${percent(ok,total)} %`,'good','conformes')}{kpi('Non conformes',ko,`${percent(ko,total)} %`,'bad','nonConformes')}{kpi('Travaux proposés',withWorks,`${percent(withWorks,total)} % des affaires`,'','travaux')}{kpi('Aucun travaux',noWorks,`${percent(noWorks,total)} %`,'good','sansTravaux')}{kpi('Contrôles finaux',finalControlled,`${percent(finalControlled,total)} % réalisés`,'','controleFinal')}{kpi('Affaires synchronisées',synced,`${pending} en attente / conflit`,'','synced')}{kpi('Photos archivées',photos,`${total?Math.round(photos/total):0} par affaire en moyenne`,'','photos')}</div>
    <div className="reportingLayout">
      <article className="reportPanel mapPanel"><div className="panelTitle"><div><h3>Répartition géographique — La Réunion</h3><p>Cliquez sur une commune pour afficher ses affaires.</p></div><span>{total} affaire(s)</span></div><div className="reunionMap choroplethMap"><svg viewBox="0 0 790 735" role="img" aria-label="Carte graduée des affaires par commune à La Réunion">{COMMUNES.map(name=>{const pos=COMMUNE_MAP_POSITIONS[name],row=communes.find(x=>x.name===name),d=COMMUNE_MAP_PATHS[name];if(!pos||!d)return null;const fill=row?choroplethColor(row.total,minCommuneCount,maxCommuneCount):'#eef2f6',x=pos[0],y=pos[1];return <g key={name} className={`communeShape ${selectedCommune===name?'selected':''} ${row?'hasData':'empty'}`} onClick={()=>row&&openRows(name)}><title>{row?`${name} : ${row.total} affaire(s), ${row.ko} non conforme(s)`: `${name} : aucune affaire sur la période`}</title><path d={d} fill={fill}/><CommuneMapLabel name={name} x={x} y={y} count={row?.total||0}/></g>})}</svg><div className="mapScaleLegend"><span>Nombre d’affaires</span><div className="mapGradient"></div><b>{minCommuneCount||0}</b><b>{maxCommuneCount||0}</b><em>Vert clair = minimum · Rouge foncé = maximum</em></div></div>{selected&&<button className="communeFocus communeFocusButton" onClick={jumpToDetails}><h4>{selected.name}</h4><div><b>{selected.total}</b><span>affaires</span></div><div><b>{selected.ok}</b><span>conformes</span></div><div><b>{selected.ko}</b><span>non conformes</span></div><div><b>{selected.works}</b><span>avec travaux</span></div></button>}</article>
      <article className="reportPanel"><div className="panelTitle"><div><h3>Performance par commune</h3><p>Volumes et conformité. Cliquez sur une ligne.</p></div></div><div className="barList">{communes.slice(0,12).map(x=><button key={x.name} className="barRow" onClick={()=>openRows(x.name)}><span>{x.name}</span><div><i style={{width:`${percent(x.total,Math.max(...communes.map(c=>c.total),1))}%`}}></i></div><b>{x.total}</b><em>{x.ko} NC</em></button>)}</div></article>
    </div>
    <div className="reportingThree">
      <article className="reportPanel"><h3>Répartition par statut</h3><div className="donutLegend">{statusRows.map(x=><button type="button" key={x.name} className="metricLine" onClick={()=>{setStatus(x.name);jumpToDetails()}}><span>{x.name}</span><b>{x.total}</b><em>{percent(x.total,total)} %</em></button>)}</div></article>
      <article className="reportPanel"><h3>Nature des interventions</h3><div className="barList compact">{natureRows.map(x=><button type="button" className="barRow" key={x.name} onClick={()=>{setNature(x.name);jumpToDetails()}}><span>{x.name}</span><div><i style={{width:`${percent(x.total,total)}%`}}></i></div><b>{x.total}</b><em>{percent(x.total,total)} %</em></button>)}</div><div className="reportMiniStats"><button type="button" onClick={()=>selectFocus('distance')}>⚠ Distances &lt; 8 m <b>{distanceWarnings}</b></button><button type="button" onClick={()=>selectFocus('locked')}>🔒 Verrouillées <b>{locked}</b></button><button type="button" onClick={()=>selectFocus('pending')}>☁ À synchroniser / conflits <b>{pending}</b></button></div></article>
      <article className="reportPanel"><h3>Production par technicien</h3><div className="rankList">{techRows.slice(0,10).map((x,i)=><button type="button" key={x.name} onClick={()=>{setTechnicien(x.name);jumpToDetails()}}><b>#{i+1}</b><span>{x.name}</span><em>{x.total} affaires · {percent(x.ok,x.total)} % conformes</em></button>)}</div></article>
    </div>
    <div className="reportingLayout lower">
      <article className="reportPanel"><h3>Principaux types d’ouvrages</h3><div className="barList">{ouvrageRows.map(x=><button type="button" className="barRow" key={x.name} onClick={()=>{setOuvrage(x.name);jumpToDetails()}}><span>{x.name}</span><div><i style={{width:`${percent(x.total,Math.max(...ouvrageRows.map(o=>o.total),1))}%`}}></i></div><b>{x.total}</b><em>Voir</em></button>)}</div></article>
      <article className="reportPanel reportingConclusions"><h3>Synthèse client automatique</h3><p><button className="inlineMetric" onClick={()=>selectFocus('all')}><b>{total}</b> affaire(s)</button> ont été analysée(s) sur la période sélectionnée, réparties sur <b>{communes.length}</b> commune(s).</p><p>Le taux de conformité s’établit à <button className="inlineMetric" onClick={()=>selectFocus('conformes')}><b>{percent(ok,total)} %</b></button>. <button className="inlineMetric" onClick={()=>selectFocus('nonConformes')}><b>{ko}</b> affaire(s)</button> nécessitent une vérification ou une amélioration.</p><p><button className="inlineMetric" onClick={()=>selectFocus('travaux')}><b>{withWorks}</b> affaire(s)</button> comportent une solution de travaux et <button className="inlineMetric" onClick={()=>selectFocus('sansTravaux')}><b>{noWorks}</b></button> ont été conservées sans intervention.</p><p><button className="inlineMetric" onClick={()=>selectFocus('controleFinal')}><b>{finalControlled}</b> contrôle(s) final(aux)</button> ont été renseigné(s). <button className="inlineMetric" onClick={()=>selectFocus('distance')}><b>{distanceWarnings}</b> affaire(s)</button> présentent une alerte de distance inférieure à 8 m.</p><p>État de transmission : <button className="inlineMetric" onClick={()=>selectFocus('synced')}><b>{synced}</b> synchronisée(s)</button>, <button className="inlineMetric" onClick={()=>selectFocus('pending')}><b>{pending}</b> en attente ou en conflit</button>.</p></article>
    </div>
    <article ref={detailRef} className="reportPanel reportingTable" id="reporting-details"><div className="panelTitle"><div><h3>Détail des affaires</h3><p>{filtered.length} ligne(s) correspondant aux filtres actifs. Cliquez sur une affaire pour ouvrir son rapport.</p></div><button className="secondaryAction noPrint" onClick={reset}>Afficher toutes les affaires</button></div><div className="tableScroll"><table><thead><tr><th>Date</th><th>GDO</th><th>N° poste</th><th>Commune</th><th>Nature</th><th>Ouvrage</th><th>Technicien</th><th>Résultat</th><th>Statut</th></tr></thead><tbody>{[...filtered].sort((a,b)=>(recordDateValue(b)?.getTime()||0)-(recordDateValue(a)?.getTime()||0)).map(r=><tr key={r.id} onClick={()=>{setCurrent(r.id);setTab('rapport')}}><td>{recordDateValue(r)?.toLocaleDateString('fr-FR')||'—'}</td><td>{r.codeGdo||'—'}</td><td>{r.numeroPoste||'—'}</td><td>{r.commune||'—'}</td><td>{r.affaire||'—'}</td><td>{r.typeOuvrage||'—'}</td><td>{r.technicien||'—'}</td><td className={(computeFinal(r).ok||compute(r).ok)?'okText':'koText'}>{(computeFinal(r).ok||compute(r).ok)?'Conforme':'Non conforme'}</td><td>{r.statut||'—'}</td></tr>)}</tbody></table></div></article>
  </section>
}

function Field({label,value,onChange,type='text',disabled=false}){const [draft,setDraft]=useState(value??'');useEffect(()=>setDraft(value??''),[value]);const commit=()=>{if(String(draft)!==String(value??''))onChange(draft)};return <label>{label}<input type={type} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){commit();e.currentTarget.blur()}}}/></label>}
function Select({label,value,onChange,options}){return <label>{label}<select value={value||''} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select></label>}

function Identification({m,update,next}){ const setConfig=v=>update({terreConfig:v,rng:v==='interconnectee'?m.rng:'',rni:v==='separee'?m.rni:'',rmn:v==='separee'?m.rmn:'',rcDirect:v==='separee'?m.rcDirect:''}); const ready=Boolean(m.affaire&&m.codeGdo&&m.commune&&m.typeOuvrage&&m.technicien); return <section className="card guidedCard"><div className="stepTitle"><span>1</span><div><h2>Identification de l’affaire</h2><p>Le type d’affaire décrit l’intervention ; le code GDO identifie le chantier réalisé.</p></div></div><div className="form"><Select label="Affaire / nature de l’intervention" value={m.affaire} onChange={v=>update({affaire:v})} options={['Mesure','Amélioration','Mesure et amélioration']}/><Field label="Code GDO / référence chantier" value={m.codeGdo} onChange={v=>update({codeGdo:v})}/><Field label="Numéro de poste / repère ouvrage" value={m.numeroPoste} onChange={v=>update({numeroPoste:v})}/><Select label="Commune" value={m.commune} onChange={v=>update({commune:v})} options={COMMUNES}/><Select label="Type d’ouvrage" value={m.typeOuvrage} onChange={v=>update({typeOuvrage:v})} options={OUVRAGES}/><Select label="Régime" value={m.regime} onChange={v=>update({regime:v})} options={['150 A','300 A','1000 A','NC']}/><Field label="Technicien" value={m.technicien} onChange={v=>update({technicien:v})}/><Field label="Appareil de mesure" value={m.appareil} onChange={v=>update({appareil:v})}/><label className="testToggle"><input type="checkbox" checked={Boolean(m.isTest)} onChange={e=>update({isTest:e.target.checked})}/><span><b>Affaire de test</b><small>Exclue du reporting et supprimable en lot depuis Administration.</small></span></label></div><h3>Configuration des prises de terre</h3><div className="choice"><button className={m.terreConfig==='interconnectee'?'selected':''} onClick={()=>setConfig('interconnectee')}>Interconnectées</button><button className={m.terreConfig==='separee'?'selected':''} onClick={()=>setConfig('separee')}>Séparées</button></div><p className="hint">Le choix détermine automatiquement les champs de mesure demandés.</p><div className="workflowActions"><span className={ready?'readyText':'warningText'}>{ready?'✓ Identification complète':IS_DESKTOP?'Informations incomplètes — navigation autorisée au bureau':'Compléter nature, code GDO, commune, ouvrage et technicien'}</span><button disabled={!ready && !IS_DESKTOP} onClick={next}>{IS_DESKTOP?'Ouvrir Terrain / GPS (facultatif) →':'Continuer vers Terrain / GPS →'}</button></div></section> }


function ReferenceDiagram({solutionId,title,m}){
  const ref=m?.reference||{}, valid=String(ref.status||'').toUpperCase()==='VALIDE'&&ref.id&&ref.index&&ref.location;
  const memoIds=new Set(['bff','grille14','grille24','patte','piquet3','serp10','serp20','serp30','vertical3']);
  const hasMemo=memoIds.has(solutionId);
  const caption=valid?`${ref.issuer||'Référentiel'} — ${ref.title||ref.id} — indice ${ref.index} — ${ref.location}`:'Illustration issue du mémento technique intégré. Référence documentaire à valider avant émission client.';
  if(hasMemo)return <figure className="referenceDiagram memoReferenceDiagram"><div className="memoImageFrame"><img src={`./b1323/${solutionId}.png`} alt={`Schéma mémento — ${title}`} loading="lazy" decoding="async"/></div><figcaption><b>{title}</b><span>{caption}</span></figcaption></figure>;
  const sol=ELECTRODES.find(x=>x.id===solutionId)||{id:solutionId},lines=solutionShape(sol.id,0,1,0,0),pts=lines.flat(),xs=pts.map(x=>x[0]),ys=pts.map(x=>x[1]),minX=Math.min(...xs,-1),maxX=Math.max(...xs,1),minY=Math.min(...ys,-1),maxY=Math.max(...ys,1),pad=1.4,vb=`${minX-pad} ${minY-pad} ${Math.max(3,maxX-minX+2*pad)} ${Math.max(3,maxY-minY+2*pad)}`;
  return <figure className="referenceDiagram"><svg className="generatedSolutionSvg" viewBox={vb}><rect x={minX-pad} y={minY-pad} width={Math.max(3,maxX-minX+2*pad)} height={Math.max(3,maxY-minY+2*pad)} fill="#f8fafc"/><circle cx={minX-.65} cy={(minY+maxY)/2} r=".25" fill="#facc15" stroke="#111827" strokeWidth=".08"/><line x1={minX-.4} y1={(minY+maxY)/2} x2={minX} y2={(minY+maxY)/2} stroke="#f97316" strokeWidth=".16"/>{lines.map((line,i)=><polyline key={i} points={line.map(p=>p.join(',')).join(' ')} fill="none" stroke="#dc2626" strokeWidth=".18" strokeLinecap="round" strokeLinejoin="round"/>)}</svg><figcaption><b>{title}</b><span>Schéma de principe généré pour cette géométrie. Référentiel à valider avant émission client.</span></figcaption></figure>;
}
function Measures({m,update,next,back}){
  const c=compute(m);
  const requiredKeys=requiredPhotoKeys(m);
  const updateValue=(key,value)=>update({[key]:value});
  const updateMode=mode=>update({mode,rcDirect:mode==='direct'?m.rcDirect:''});
  const fields=m.terreConfig==='interconnectee'
    ? [{key:'rng',label:'RNg — Terre globale du neutre (Ω)'}]
    : [
        {key:'rm',label:'RM — Terre des masses (Ω)'},
        {key:'rni',label:'RNi — Terre individuelle du neutre (Ω)'},
        {key:'rmn',label:'RMN — Mesure entre terres (Ω)'},
        ...(m.mode==='direct'?[{key:'rcDirect',label:'Rc mesurée directement (Ω)'}]:[]),
      ];
  const numericReady=fields.every(f=>Number.isFinite(num(m[f.key])));
  const photosReady=requiredKeys.every(k=>Boolean(m.measurePhotos?.[k]));
  const canContinue=IS_DESKTOP || (numericReady && photosReady && !c.issues?.length);
  return <section className="card guidedCard measuresPage">
    <div className="stepTitle"><span>3</span><div><h2>Mesures et photos</h2><p>Renseignez les valeurs réellement relevées sur site. Les photos restent obligatoires sur l’application terrain avant le diagnostic.</p></div></div>
    {m.terreConfig==='separee' && <>
      <div className="choice compactChoice">
        <button className={m.mode!=='direct'?'selected':''} onClick={()=>updateMode('edf')}>Calcul EDF avec RM, RNi et RMN</button>
        <button className={m.mode==='direct'?'selected':''} onClick={()=>updateMode('direct')}>Rc obtenue par méthode directe autorisée</button>
      </div>
      {m.mode==='direct' && <div className="calculationWarning"><b>Mode encadré :</b> renseigner la méthode, la référence qui l’autorise et confirmer le protocole. RM reste obligatoire pour calculer c = Rc / RM.</div>}
    </>}
    <div className="form measuresForm">
      {fields.map(f=><Field key={f.key} label={f.label} value={m[f.key]} onChange={v=>updateValue(f.key,v)}/>) }
      <Field label="Résistivité du sol (Ω.m)" value={m.resistivite} onChange={v=>updateValue('resistivite',v)}/>
      {m.terreConfig==='separee'&&<Field label="Distance entre terres (m)" value={m.distance} onChange={v=>updateValue('distance',v)}/>} 
    </div>
    <div className={`measureResult ${c.ok?'ok':'ko'}`}>
      <h3>Résultat calculé</h3>
      {m.terreConfig==='interconnectee'
        ? <><p>RNg : <b>{fmt(c.rng,2)} Ω</b></p><p>Cible : ≤ {fmt(c.target,2)} Ω</p><strong>{Number.isFinite(c.rng)?(c.ok?'CONFORME':'NON CONFORME'):'MESURE À COMPLÉTER'}</strong></>
        : <><p>Rc : <b>{fmt(c.rc,3)} Ω</b></p><p>Coefficient c = Rc / RM : <b>{fmt(c.c,4)}</b></p><p>Objectif : ≤ 0,150</p><strong>{Number.isFinite(c.c)?(c.ok?'CONFORME':'NON CONFORME'):'MESURES À COMPLÉTER'}</strong></>}
      {distanceAlert(m)&&<p className="warningText">{distanceAlert(m)}</p>}
      {(c.issues||[]).map(x=><p className="warningText" key={x}>{x}</p>)}
    </div>
    <PlanAction m={m} update={update} field="surfaceWorks" title="Quantités prévisionnelles pour l’étude (m³)"/>
    <h3>Photos des mesures</h3>
    <div className="measurePhotosGrid">{requiredKeys.map(k=><PhotoField key={k} m={m} update={update} photoKey={k}/>)}</div>
    <div className="workflowActions">
      <button className="secondaryAction" onClick={back}>← Retour Terrain / GPS</button>
      <span className={canContinue?'readyText':'warningText'}>{canContinue?'✓ Mesures prêtes pour le diagnostic':`À compléter : ${!numericReady?'valeurs de mesure ':''}${!photosReady?'photos obligatoires ':''}${c.issues?.length?'cohérence des mesures':''}`}</span>
      <button disabled={!canContinue} onClick={next}>Continuer vers Diagnostic →</button>
    </div>
  </section>
}

function PhotoField({m,update,photoKey}){ const meta=MEASURE_META[photoKey], p=m.measurePhotos?.[photoKey]; async function take(e){const f=e.target.files?.[0];if(!f)return;const photo=await fileToOptimizedPhoto(f);update({measurePhotos:{...m.measurePhotos,[photoKey]:{...photo,label:meta.label}}});e.target.value=''} return <div className="measurePhoto"><div><b>{meta.label}</b><span>{p?'Photo originale jointe':'Photo obligatoire'}</span></div>{p&&<img src={p.thumbnail||p.data} loading="eager" decoding="async"/>}<label className="photoBtn">📷 Prendre la photo<input type="file" accept="image/*" capture="environment" onChange={take}/></label><label className="photoBtn secondary">🖼 Galerie<input type="file" accept="image/*" onChange={take}/></label>{p&&<><button onClick={()=>download(p.name||`${photoKey}.jpg`,p.data)}>Télécharger l’original</button><button className="danger" onClick={()=>update({measurePhotos:{...m.measurePhotos,[photoKey]:null}})}>Retirer</button></>}</div> }
function NeutralTargetSetup({m,update}){
  const [busy,setBusy]=useState(false);
  const capture=async()=>{setBusy(true);try{const p=await getSecabPosition();const lat=String(p.coords.latitude),lng=String(p.coords.longitude);update({neutralGpsLat:lat,neutralGpsLng:lng,neutralGpsOriginalLat:lat,neutralGpsOriginalLng:lng,neutralGpsAccuracy:String(Math.round(p.coords.accuracy||0)),neutralGpsCapturedAt:new Date().toISOString(),neutralGpsManual:false,neutralMapFocusNonce:Date.now()})}catch(e){alert(`Géolocalisation du nouvel emplacement impossible : ${e.message}`)}finally{setBusy(false)}};
  return <div className="card neutralTargetSetup"><h2>Nouvel emplacement obligatoire — terre du neutre</h2><p>L’amélioration doit être implantée au niveau de la 2ᵉ émergence BT souterraine ou du 2ᵉ support BT aérien, et non au poste.</p><div className="choice"><button className={m.neutralTargetType==='second-emergence'?'selected':''} onClick={()=>update({neutralTargetType:'second-emergence',neutralTargetLabel:'2ᵉ émergence BT souterraine'})}>2ᵉ émergence BT souterraine</button><button className={m.neutralTargetType==='second-support'?'selected':''} onClick={()=>update({neutralTargetType:'second-support',neutralTargetLabel:'2ᵉ support BT aérien'})}>2ᵉ support BT aérien</button></div><div className="form"><Field label="Résistivité du sol au nouvel emplacement (Ω.m)" value={m.neutralResistivite} onChange={v=>update({neutralResistivite:v})}/><Field label="Latitude nouvel emplacement" value={m.neutralGpsLat} onChange={v=>update({neutralGpsLat:v})}/><Field label="Longitude nouvel emplacement" value={m.neutralGpsLng} onChange={v=>update({neutralGpsLng:v})}/></div><div className="actions"><button onClick={capture} disabled={busy}>{busy?'Acquisition…':'📍 Géolocaliser le 2ᵉ ouvrage'}</button></div><NeutralTargetLocationMap m={m} update={update}/><div className="neutralReadiness"><h3>État du nouvel emplacement</h3><p className={m.neutralTargetType?'done':'pending'}>{m.neutralTargetType?'✓':'○'} Ouvrage cible sélectionné</p><p className={Number.isFinite(num(m.neutralGpsLat))&&Number.isFinite(num(m.neutralGpsLng))?'done':'pending'}>{Number.isFinite(num(m.neutralGpsLat))&&Number.isFinite(num(m.neutralGpsLng))?'✓':'○'} Nouvelle géolocalisation enregistrée</p><p className={Number.isFinite(num(m.neutralResistivite))&&num(m.neutralResistivite)>0?'done':'pending'}>{Number.isFinite(num(m.neutralResistivite))&&num(m.neutralResistivite)>0?'✓':'○'} Nouvelle résistivité enregistrée</p><p className={m.neutralTargetPhoto?'done':'pending'}>{m.neutralTargetPhoto?'✓':'○'} Photo du nouvel ouvrage — requise seulement pour continuer</p></div><WorkPhoto title="Photo de la 2ᵉ émergence / du 2ᵉ support" required={true} value={m.neutralTargetPhoto} onChange={v=>update({neutralTargetPhoto:v})}/><p className="hint">La géolocalisation et la résistivité permettent d’afficher les solutions. La photo est obligatoire uniquement avant le passage à l’implantation.</p></div>
}
function H61Diagram({longBranch,central}){return <svg className="h61Diagram" viewBox="-12 -12 24 24" aria-label="Prise de terre multidirectionnelle H61"><circle cx="0" cy="0" r="1" fill="#12315f"/><line x1="0" y1="0" x2={longBranch} y2="0"/><line x1="0" y1="0" x2={-longBranch/2} y2={longBranch*.866}/><line x1="0" y1="0" x2={-longBranch/2} y2={-longBranch*.866}/><line x1="0" y1="0" x2="0" y2={central}/><text x={longBranch*.55} y="-1">{longBranch} m</text><text x="1" y={central*.65}>{central} m</text></svg>}
function DecisionSteps({strategy,m,update}){return <div className="decisionSteps"><h3>Parcours professionnel imposé</h3>{(strategy.steps||[]).map((x,i)=><div className="decisionStep" key={x}><span>{i+1}</span><p>{x}</p></div>)}{strategy.kind==='verify-measures'&&<label className="confirmLine"><input type="checkbox" checked={Boolean(m.measurementsConfirmed)} onChange={e=>update({measurementsConfirmed:e.target.checked})}/> Mesures refaites et confirmées par le technicien</label>}{strategy.kind==='coupling-neutral'&&<div className="mandatoryChecks"><label><input type="checkbox" checked={Boolean(m.parasiticLinksChecked)} onChange={e=>update({parasiticLinksChecked:e.target.checked})}/> Liaisons parasites contrôlées</label><label><input type="checkbox" checked={Boolean(m.earthContinuityChecked)} onChange={e=>update({earthContinuityChecked:e.target.checked})}/> Continuité et séparation vérifiées</label><label><input type="checkbox" checked={Boolean(m.neutralApprovalConfirmed)} onChange={e=>update({neutralApprovalConfirmed:e.target.checked})}/> Validation EDF SEI obtenue pour intervenir sur le neutre</label></div>}</div>}

function NationalExpertPanel({m,c,sol}){
  const ready=readinessAssessment(m,c);
  const expert=expertExplanation(m,c,sol);
  return <div className={`nationalExpertPanel ${ready.status}`}>
    <div className="nationalExpertTitle"><div><small>ASSISTANT MÉTIER · {NATIONAL_RULESET_VERSION}</small><h3>{ready.status==='blocked'?'Diagnostic suspendu':ready.status==='review'?'Diagnostic à confirmer':'Diagnostic exploitable'}</h3></div><span>{ready.status==='blocked'?'STOP':ready.status==='review'?'VÉRIFIER':'PRÊT'}</span></div>
    <p className="nationalSimpleText">{plainLanguageExplanation(m,c)}</p>
    {ready.blockers.length>0&&<div className="nationalStop"><b>Le logiciel ne recommande pas de travaux pour le moment.</b><ul>{ready.blockers.map(x=><li key={x}>{x}</li>)}</ul></div>}
    {ready.warnings.length>0&&<div className="nationalWarnings"><b>Points à confirmer</b><ul>{ready.warnings.map(x=><li key={x}>{x}</li>)}</ul></div>}
    <details><summary>Lecture professionnelle et raisonnement</summary><p><b>Base :</b> {expert.basis}</p><p><b>Choix :</b> {expert.choice}</p><p><b>Limites :</b> {expert.limits}</p><p><b>Contrôle attendu :</b> {expert.verification}</p></details>
  </div>
}

function Solutions({m,update,next,nextNoWork,back}){
  const c=compute(m), strategy=diagnosticStrategy(m), h61=h61MandatorySolution(m);
  const sols=rankedApplicableSolutions(m);
  const mandatory=sols.length===1&&(sols[0].mandatory||strategy.kind==='forced-h61');
  const noWork=m.solutionRetenue==='none';
  const neutralNeedsSecond=['coupling-neutral','neutral-current'].includes(strategy.kind);
  // Les prérequis d'affichage des solutions sont distincts des prérequis
  // permettant de passer à l'implantation. La photo ne bloque jamais le calcul
  // ni l'affichage des solutions ; elle devient obligatoire uniquement au passage
  // vers l'étape suivante.
  const neutralSolutionMissing=neutralNeedsSecond?[
    !m.neutralTargetType?'Choisir le 2ᵉ ouvrage (émergence ou support)':null,
    !Number.isFinite(num(m.neutralGpsLat))||!Number.isFinite(num(m.neutralGpsLng))?'Géolocaliser le 2ᵉ ouvrage':null,
    !Number.isFinite(num(m.neutralResistivite))||num(m.neutralResistivite)<=0?'Renseigner une résistivité valide au nouvel emplacement':null,
    !m.parasiticLinksChecked?'Confirmer le contrôle des liaisons parasites':null,
    !m.earthContinuityChecked?'Confirmer la continuité et la séparation des terres':null,
    !m.neutralApprovalConfirmed?'Confirmer la validation EDF SEI':null
  ].filter(Boolean):[];
  const neutralReadyForSolutions=!neutralNeedsSecond||neutralSolutionMissing.length===0;
  const neutralContinueMissing=neutralNeedsSecond?[
    ...neutralSolutionMissing,
    !m.neutralTargetPhoto?'Ajouter la photo obligatoire du 2ᵉ ouvrage avant de poursuivre':null
  ].filter(Boolean):[];
  const neutralReadyToContinue=!neutralNeedsSecond||neutralContinueMissing.length===0;
  const decisionBlocked=['verify-measures','incomplete','reference-required','neutral-blocked','review','building-earth'].includes(strategy.kind)||(strategy.kind==='forced-h61'&&!h61?.id)||(strategy.kind==='coupling-neutral'&&!neutralReadyForSolutions);
  useEffect(()=>{
    const patch={improvementTarget:strategy.target,diagnosticDecision:strategy.kind};
    if(strategy.kind==='none') Object.assign(patch,{solutionRetenue:'none',implantation:{...(m.implantation||{}),selectedSolution:'none',analysis:[]}});
    else if(mandatory&&!decisionBlocked){const only=sols[0];Object.assign(patch,{solutionRetenue:only.id,reprise:only.steps.join(' · '),materielReprise:only.material,implantation:defaultImplantationForSolution(m,only.id)});}
    else if(m.solutionRetenue&&m.solutionRetenue!=='none'&&!sols.some(x=>x.id===m.solutionRetenue)) Object.assign(patch,{solutionRetenue:'',implantation:{...(m.implantation||{}),selectedSolution:'',analysis:[]}});
    if(m.improvementTarget!==patch.improvementTarget||m.diagnosticDecision!==patch.diagnosticDecision||('solutionRetenue' in patch&&m.solutionRetenue!==patch.solutionRetenue))update(patch);
  },[strategy.kind,m.typeOuvrage,m.regime,m.resistivite,m.neutralTargetType,m.neutralGpsLat,m.neutralGpsLng,m.neutralResistivite,m.neutralTargetPhoto,m.neutralApprovalConfirmed,m.parasiticLinksChecked,m.earthContinuityChecked,sols.map(x=>x.id).join('|')]);
  const toggleNoWork=()=>{if(noWork){update({solutionRetenue:'',noWorkReason:'',reprise:'',materielReprise:'',implantation:{...(m.implantation||{}),selectedSolution:'',analysis:[]}});return}if(!canRetainNoWork(m)){alert('Décision refusée : « Aucun travaux » est autorisé uniquement lorsque les mesures sont complètes, physiquement cohérentes et conformes à tous les seuils configurés.');return}const reason=prompt('Motif de conservation de l’installation — saisir la justification technique :','Mesures valides et critères satisfaits.')||'';if(!reason.trim())return;update({solutionRetenue:'none',noWorkReason:reason,reprise:'Aucun travaux nécessaires — critères validés',materielReprise:'Aucun',implantation:{...(m.implantation||{}),selectedSolution:'none',analysis:[]}})};
  const selectSolution=(sol)=>update(canonicalSolutionPatch(m,sol.id,{reprise:sol.steps.join(' · '),materielReprise:sol.material,implantation:{placementConfirmed:false,savedAt:''}}));
  const chosenId=retainedSolutionId(m); const chosen=sols.find(s=>s.id===chosenId)||null;
  return <section className="solutionsPage"><div className="card diagnosticHeaderCard"><h2>Diagnostic et décision automatique</h2><NationalExpertPanel m={m} c={c} sol={sols[0]||null}/><div className={`status ${c.ok?'ok':'ko'}`}>{c.diagnostic}</div><div className="strategyCard"><b>{strategy.title}</b><p>{strategy.reason}</p><span>Ouvrage reconnu : {strategy.profile.label}</span><span>Règle appliquée : {strategy.profile.reference}</span>{Number.isFinite(strategy.rmTarget)&&<span>Cible RM : {fmt(strategy.rmTarget,0)} Ω · RM {strategy.rmOk?'conforme':'non conforme'}</span>}</div>{c.mode==='separee'&&Number.isFinite(c.rc)&&<><div className="couplingAdvice"><h3>Analyse du coefficient</h3><p>{couplingAdvice(m)}</p></div>{couplingTargetPlan(m)&&<div className="couplingTargetPlan"><h3>Objectif technique et séquence à suivre</h3><div className="targetKpis"><span>Coefficient actuel <b>{fmt(c.c,4)}</b></span><span>Coefficient cible <b>≤ 0,150</b></span><span>Rc actuel <b>{fmt(c.rc,3)} Ω</b></span><span>Rc maximal visé <b>{fmt(couplingTargetPlan(m).rcMax,3)} Ω</b></span><span>Réduction minimale de Rc <b>{fmt(couplingTargetPlan(m).rcReduction,3)} Ω</b></span>{Number.isFinite(couplingTargetPlan(m).rmnMinimum)&&<span>RMN minimale indicative avec RNi inchangée <b>≥ {fmt(couplingTargetPlan(m).rmnMinimum,2)} Ω</b></span>}</div><p><b>Priorité :</b> {couplingTargetPlan(m).priority}</p><ol>{couplingTargetPlan(m).actions.map(a=><li key={a}>{a}</li>)}</ol><small>RNi seule ne garantit jamais le coefficient. Seules les mesures finales RM, RNi et RMN permettent de conclure.</small></div>}</>}{distanceAlert(m)&&<div className="status ko">⚠ {distanceAlert(m)}</div>}<DecisionSteps strategy={strategy} m={m} update={update}/>{isH61(m)&&strategy.kind==='forced-h61'&&<div className={`status ${h61?.id?'ok':'ko'}`}><b>Poste H61 — une seule forme réglementaire proposée</b><span>{h61?.message}</span><small>Les autres géométries restent volontairement indisponibles pour ce parcours.</small></div>}<div className="noWorkChoice"><h3>Dérogation responsable</h3><p>Cette action n’est pas une solution technique automatique. Elle exige un motif et reste tracée dans le rapport.</p><button type="button" className={noWork?'selected toggleDecision':''} onClick={toggleNoWork}>{noWork?'✓ Dérogation enregistrée — cliquer pour annuler':'Retenir exceptionnellement aucun travail'}</button>{noWork&&<p><b>Motif :</b> {m.noWorkReason}</p>}</div></div>
  {!noWork&&neutralNeedsSecond&&<NeutralTargetSetup m={m} update={update}/>} 
  {!noWork&&!decisionBlocked&&sols.length>0&&<div className="card rankedSolutions"><div className="rankedSolutionsHead"><div><h2>Travaux estimés pour atteindre le coefficient cible</h2><p>Une seule liste de prescriptions, classée selon le coefficient indicatif, l’emprise et le niveau de travaux. La solution retenue n’est plus répétée sous la liste.</p></div><span>{strategy.target==='neutral'?'Action automatique : terre du neutre':'Action automatique : terre des masses'}</span></div><div className="solutionGrid">{sols.map((sol,i)=><article key={sol.id} className={`solution optionSolution ${chosenId===sol.id?'selectedSolution':''}`}><div className="solutionHead"><span>#{i+1} · Niveau travaux {sol.work}/8</span><b>{sol.title}</b></div><ReferenceDiagram solutionId={sol.id} title={sol.title} m={m}/>{sol.recommended&&<div className="recommendationBadge">Meilleur point de départ</div>}{sol.conditional&&<div className="conditionalBadge">Après contrôle / prescription</div>}{sol.ultimate&&<div className="ultimateSolutionBadge">PROCÉDURE RENFORCÉE DE DERNIER RECOURS</div>}<p><b>Emprise :</b> {sol.footprint}</p><p><b>Matériel :</b> {sol.material}</p><ol>{sol.steps.map(x=><li key={x}>{x}</li>)}</ol><div className="values"><span>Niveau de travaux <b>{sol.work}/8</b></span><span>Faisabilité terrain <b>{sol.feasibilityScore??'À évaluer'}</b></span><span>Coefficient indicatif <b>{Number.isFinite(sol.estimatedCoeff)?`≈ ${fmt(sol.estimatedCoeff,3)}`:'À calculer'}</b></span><span>Référentiel <b>{m.reference?.status==='VALIDE'?'Validé pour le dossier':'À valider'}</b></span></div><SolutionPerformancePanel m={m} sol={sol}/><VegetalEarthPanel m={m} sol={sol}/>{sol.note&&<p className="solutionNote">{sol.note}</p>}<button type="button" className={chosenId===sol.id?'selected':''} onClick={()=>selectSolution(sol)}>{chosenId===sol.id?'✓ Solution retenue':'Choisir cette solution'}</button></article>)}</div></div>}
  {!noWork&&chosen&&<><div className="card retainedSolutionSummary"><div><small>SOLUTION RETENUE</small><h2>{chosen.title}</h2><p>{chosen.target==='neutral'?'Implantation sur le 2ᵉ ouvrage neutre géolocalisé':'Implantation sur la terre des masses du poste'}</p></div><div className="retainedSolutionKpis"><span>Coefficient cible <b>≤ 0,150</b></span><span>Rc maximal visé <b>≤ {fmt(couplingTargetPlan(m)?.rcMax,3)} Ω</b></span><span>Contrôle final <b>RM, RNi et RMN obligatoires</b></span></div></div><div className="card chosenSolutionCard"><h2>Prescription à exécuter</h2><textarea value={m.diagnosticTerrain||''} onChange={e=>update({diagnosticTerrain:e.target.value})} placeholder="Observations complémentaires du technicien"/><textarea value={m.reprise||''} onChange={e=>update({reprise:e.target.value})} placeholder="Travaux à réaliser"/></div><PlanAction m={m} update={update} field="surfaceWorks" title="Plan d’action prévisionnel et quantités de réfection avant travaux"/></>}
  {!noWork&&!chosen&&(!sols.length||decisionBlocked)&&<div className="card blockedDecision"><h3>Aucune solution sélectionnable pour l’instant</h3><p>Le parcours est volontairement bloqué tant que les conditions professionnelles ne sont pas toutes remplies.</p>{neutralSolutionMissing.length>0&&<div className="missingRequirements"><b>Éléments restant à compléter pour afficher les solutions :</b><ul>{neutralSolutionMissing.map(item=><li key={item}>{item}</li>)}</ul></div>}<p className="blockedHint">Une fois ces éléments renseignés, les solutions compatibles avec le 2ᵉ ouvrage apparaîtront automatiquement, classées du moins de travaux au plus important.</p></div>}
  <div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour Mesures</button><span className={noWork||(chosen&&!decisionBlocked&&neutralReadyToContinue)?'readyText':'warningText'}>{noWork?'✓ Dérogation enregistrée':chosen&&!decisionBlocked&&!neutralReadyToContinue?'Photo du 2ᵉ ouvrage obligatoire avant l’implantation':chosen&&!decisionBlocked?'✓ Solution retenue — implantation disponible':'Choisir une solution ou terminer le parcours'}</span><button disabled={!noWork&&(!chosen||decisionBlocked||!neutralReadyToContinue)} onClick={()=>{if(noWork){nextNoWork();return}if(!neutralReadyToContinue){alert(`Impossible de poursuivre vers l’implantation :\n- ${neutralContinueMissing.join('\n- ')}`);return}next()}}>{noWork?'Passer directement au contrôle final →':'Continuer vers Implantation →'}</button></div></section>
}


function SolutionPerformancePanel({m,sol,detailed=false}){const x=solutionComparison(m,sol),metric=x.isNeutral?'RNi':'RM',finalAvailable=Number.isFinite(x.finalValue)&&x.finalValue>0,estimate=estimatedCouplingForSolution(m,sol),targetOk=Number.isFinite(estimate.value)&&estimate.value<=COUPLING_LIMIT;return <div className={`solutionPerformance ${detailed?'detailed':''}`}><h4>Estimation des travaux et contrôle final</h4><div className="performanceGrid"><div><span>Mesure initiale {metric}</span><b>{fmt(x.initialValue,2)} Ω</b></div><div><span>{metric} indicative après travaux</span><b>{Number.isFinite(estimate.estimatedEarth)?`≈ ${fmt(estimate.estimatedEarth,2)} Ω`:'À calculer'}</b></div><div><span>Coefficient indicatif</span><b className={targetOk?'estimateOk':'estimateKo'}>{Number.isFinite(estimate.value)?`≈ ${fmt(estimate.value,3)}`:'Indisponible'}</b></div><div><span>Plage avec incertitude</span><b>{Number.isFinite(estimate.minCoeff)?`${fmt(estimate.minCoeff,3)} à ${fmt(estimate.maxCoeff,3)}`:'—'}</b></div><div><span>Mesure réelle finale {metric}</span><b>{finalAvailable?`${fmt(x.finalValue,2)} Ω`:'Non mesurée'}</b></div><div><span>Coefficient final mesuré</span><b>{Number.isFinite(x.finalCoeff)?fmt(x.finalCoeff,4):'À recalculer'}</b></div></div><p className="simulationDisclaimer"><b>{estimate.label}.</b> {estimate.assumption}</p></div>}
function VegetalEarthPanel({m,sol,detailed=false}){
  const a=vegetalEarthAdvice(m,sol);
  return <div className={`vegetalEarthPanel ${a.level} ${detailed?'detailed':''}`}><div><span>Apport de terre végétale</span><b>{a.label}</b></div><p>{a.reason}</p>{Number.isFinite(a.volume)&&a.volume>0&&<p><b>Volume indicatif :</b> environ {fmt(a.volume,2)} m³ autour de l’électrode, à ajuster aux terrassements réels.</p>}<small>{a.warning}</small></div>
}
function WorkPhoto({title,required,value,onChange}){return <FastPhotoPicker title={title} required={required} value={value} onChange={onChange}/> }
const WORK_TYPES=[['beton','Béton'],['enrobe','Enrobé'],['bitume','Bitume'],['terre','Terre / terrain naturel'],['dallage','Dallage'],['paves','Pavés']];
function workVolume(x){const l=num(x?.l),w=num(x?.w),d=num(x?.d);return [l,w,d].every(Number.isFinite)?l*w*d:0}
function PlanAction({m,update,field='surfaceWorks',title='Plan d’action et quantités de réfection'}){const works=m[field]||{};const change=(key,sub,val)=>update({[field]:{...works,[key]:{...(works[key]||{}),[sub]:val}}});return <div className="card planAction"><h2>🚧 {title}</h2><p className="hint">Ces quantités sont indépendantes des quantités finales. Renseigner longueur, largeur et profondeur/épaisseur prévues ou réellement exécutées selon l’étape.</p><div className="workGrid">{WORK_TYPES.map(([key,label])=>{const x=works[key]||{};return <article key={key} className={key==='terre'?'earthWork':''}><h3>{label}</h3><div className="miniForm"><Field label="Longueur (m)" value={x.l} onChange={v=>change(key,'l',v)}/><Field label="Largeur (m)" value={x.w} onChange={v=>change(key,'w',v)}/><Field label="Profondeur / épaisseur (m)" value={x.d} onChange={v=>change(key,'d',v)}/></div><b>Quantité calculée : {fmt(workVolume(x),3)} m³</b></article>})}</div></div>}

const COST_ITEMS=[
  ['trenchEarth','Terrassement en terre','ml','Prix du linéaire terrassement terre'],
  ['trenchAsphalt','Terrassement enrobé + réfection provisoire','ml','Prix du linéaire terrassement enrobé + réfection provisoire'],
  ['trenchConcrete','Terrassement béton','ml','Prix du linéaire terrassement béton'],
  ['asphaltM2','Réfection définitive en enrobé','m²','Prix au m² d’enrobé'],
  ['technicians','Techniciens mobilisés','forfait','Prix des techniciens mobilisés']
];
const COST_UNITS=['ml','m','m²','m³','u','h','jour','forfait','kg','t','lot','%'];
const makeExtraCost=()=>({id:`EXTRA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,label:'Prix supplémentaire',unit:'forfait',qty:'1',price:''});
function normalizedExtraCosts(ce){
  if(Array.isArray(ce?.extras))return ce.extras;
  const legacyPrice=ce?.prices?.supplement,legacyQty=ce?.quantities?.supplementQty;
  return legacyPrice||legacyQty?[{...makeExtraCost(),label:'Prix supplémentaire',unit:'forfait',qty:legacyQty||'1',price:legacyPrice||''}]:[];
}
function money(v){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(v)||0)}
function suggestedCostQuantities(m){
  const sol=rankedApplicableSolutions(m).find(x=>x.id===retainedSolutionId(m))||ELECTRODES.find(x=>x.id===retainedSolutionId(m));
  const design=sol?smartDesignFor(m,sol):null;
  const earth=Number(m.execution?.trenchLength)||Number(design?.trenchLengthM)||Number(design?.lengthM)||0;
  const asphalt=Number(m.surfaceWorks?.enrobe?.l)||0;
  const concrete=Number(m.surfaceWorks?.beton?.l)||0;
  const asphaltM2=(Number(m.surfaceWorks?.enrobe?.l)||0)*(Number(m.surfaceWorks?.enrobe?.w)||0);
  return {trenchEarth:earth,trenchAsphalt:asphalt,trenchConcrete:concrete,asphaltM2,technicians:1,supplementQty:1};
}
function costSummary(m){
  const ce=m.costEstimate||{}, prices=ce.prices||{}, q={...suggestedCostQuantities(m),...(ce.quantities||{})};
  const rows=COST_ITEMS.map(([key,label,unit])=>{const qty=Number(q[key]||0);const price=Number(prices[key]||0);return {key,label,unit,qty,price,total:qty*price}});
  const extras=normalizedExtraCosts(ce).map(x=>({...x,qty:Number(x.qty||0),price:Number(x.price||0),total:Number(x.qty||0)*Number(x.price||0)}));
  return {rows,extras,total:[...rows,...extras].reduce((a,x)=>a+x.total,0)};
}
function reliabilityAssessment(m,sol){
  const x=solutionComparison(m,sol), rho=Number(m.resistivite||m.neutralResistivite||0), coeff=x.estimatedCoeff;
  const margin=Number.isFinite(coeff)?Math.max(0,(COUPLING_LIMIT-coeff)/COUPLING_LIMIT):0;
  const rhoPenalty=rho>1000?25:rho>700?18:rho>300?9:0;
  const measurementPenalty=(compute(m).issues||[]).length*12;
  const score=Math.max(35,Math.min(98,Math.round(70+margin*28-rhoPenalty-measurementPenalty)));
  const sensitivity=score>=90?'Faible':score>=75?'Modérée':'Élevée';
  const robustness=score>=90?'Très robuste':score>=80?'Robuste':score>=65?'À confirmer':'Faible';
  return {score,sensitivity,robustness,margin:margin*100,label:score>=90?'Confiance très élevée':score>=80?'Confiance élevée':score>=65?'Confiance moyenne':'Confiance faible'};
}
function DesktopCosting({m,update,next,back}){
  if(!IS_DESKTOP)return null;
  const current=m.costEstimate||{}, prices=current.prices||{}, defaults=suggestedCostQuantities(m), quantities={...defaults,...(current.quantities||{})}, extras=normalizedExtraCosts(current), summary=costSummary({...m,costEstimate:{...current,prices,quantities,extras}});
  const saveCost=(patch)=>update({costEstimate:{...current,prices,quantities,extras,...patch,updatedAt:new Date().toISOString()}});
  const setPrice=(k,v)=>saveCost({prices:{...prices,[k]:v}});
  const setQty=(k,v)=>saveCost({quantities:{...quantities,[k]:v}});
  const resetQty=()=>saveCost({quantities:{...defaults}});
  const addExtra=()=>saveCost({extras:[...extras,makeExtraCost()]});
  const updateExtra=(id,patch)=>saveCost({extras:extras.map(x=>x.id===id?{...x,...patch}:x)});
  const removeExtra=id=>saveCost({extras:extras.filter(x=>x.id!==id)});
  const retained=rankedApplicableSolutions(m).find(s=>s.id===retainedSolutionId(m));
  const planning=jobQuantities({...m,costEstimate:{...current,prices,quantities,extras}},retained);
  return <section className="costingPage"><div className="internalOnlyBanner"><b>INTERNE SECAB — NON INTÉGRÉ AU RAPPORT CLIENT</b><span>Estimation chantier, organisation, coûts et quantitatifs réservés au bureau.</span></div><div className="internalPlanningGrid"><div><small>Tranchée totale</small><b>{fmt(planning.trench,1)} m</b></div><div><small>Cuivre automatique</small><b>{fmt(planning.copper,1)} m</b><span>Ratio fixe 1:3</span></div><div><small>Piquets</small><b>{planning.stakes}</b></div><div><small>Durée interne</small><b>{fmt(planning.hours,1)} h</b></div><div><small>Équipe interne</small><b>{planning.technicians}</b></div></div><div className="costingHero"><div><small>VERSION BUREAU UNIQUEMENT</small><h2>Chiffrage prévisionnel de la solution</h2><p>Tous les prix restent saisis manuellement. Les quantités sont préremplies depuis l’implantation et restent modifiables.</p></div><div className="costGrandTotal"><span>TOTAL ESTIMATIF</span><strong>{money(summary.total)}</strong><small>HT — selon prix saisis</small></div></div><div className="costingToolbar"><button onClick={resetQty}>↻ Reprendre les quantités de l’affaire</button><button className="addCostButton" onClick={addExtra}>＋ Ajouter un prix supplémentaire</button><span>Solution : <b>{ELECTRODES.find(x=>x.id===retainedSolutionId(m))?.title||'Non retenue'}</b></span></div><div className="costTableWrap"><table className="costTable"><thead><tr><th>Poste</th><th>Unité</th><th>Quantité</th><th>Prix unitaire / forfait</th><th>Total</th><th>Action</th></tr></thead><tbody>{COST_ITEMS.map(([key,label,unit,priceLabel])=>{const row=summary.rows.find(x=>x.key===key);return <tr key={key}><td><b>{label}</b><small>{priceLabel}</small></td><td>{unit}</td><td><input inputMode="decimal" value={quantities[key]??''} onChange={e=>setQty(key,e.target.value)} aria-label={`Quantité ${label}`}/></td><td><div className="moneyInput"><span>€</span><input inputMode="decimal" value={prices[key]??''} onChange={e=>setPrice(key,e.target.value)} aria-label={priceLabel}/></div></td><td><strong>{money(row?.total)}</strong></td><td><span className="fixedCostBadge">Fixe</span></td></tr>})}{extras.map(extra=><tr key={extra.id} className="extraCostRow"><td><input className="costLabelInput" value={extra.label||''} onChange={e=>updateExtra(extra.id,{label:e.target.value})} placeholder="Désignation du prix supplémentaire" aria-label="Désignation du prix supplémentaire"/></td><td><select value={extra.unit||'forfait'} onChange={e=>updateExtra(extra.id,{unit:e.target.value})} aria-label="Unité du prix supplémentaire">{COST_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></td><td><input inputMode="decimal" value={extra.qty??''} onChange={e=>updateExtra(extra.id,{qty:e.target.value})} aria-label={`Quantité ${extra.label||'supplément'}`}/></td><td><div className="moneyInput"><span>€</span><input inputMode="decimal" value={extra.price??''} onChange={e=>updateExtra(extra.id,{price:e.target.value})} aria-label={`Prix ${extra.label||'supplément'}`}/></div></td><td><strong>{money(Number(extra.qty||0)*Number(extra.price||0))}</strong></td><td><button className="deleteCostButton" onClick={()=>removeExtra(extra.id)} aria-label={`Supprimer ${extra.label||'ce prix'}`}>✕ Supprimer</button></td></tr>)}</tbody><tfoot><tr><td colSpan="5">TOTAL GÉNÉRAL ESTIMATIF</td><td>{money(summary.total)}</td></tr></tfoot></table></div>{!extras.length&&<div className="emptyExtraCosts">Aucun prix supplémentaire. Utilisez « Ajouter un prix supplémentaire » pour créer autant de lignes que nécessaire.</div>}<label className="costNotes"><span>Observations / hypothèses de prix</span><textarea value={current.notes||''} onChange={e=>saveCost({notes:e.target.value})} placeholder="Préciser les hypothèses, les exclusions ou le mode de calcul des techniciens mobilisés..."/></label><div className="costWarning">Ce chiffrage est une aide à l’étude interne. Il ne modifie jamais le diagnostic électrique ni la conformité finale.</div><div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour Carte & implantation</button><button onClick={next}>Continuer vers Travaux →</button></div></section>
}
function premiumWordCell(text,{fill='FFFFFF',color='102342',bold=false,size=20,align=AlignmentType.LEFT,width}={}){
  return new TableCell({
    width:width?{size:width,type:WidthType.PERCENTAGE}:undefined,
    shading:{fill},verticalAlign:VerticalAlign.CENTER,
    margins:{top:140,bottom:140,left:160,right:160},
    borders:{top:{style:BorderStyle.SINGLE,size:1,color:'D9E2EC'},bottom:{style:BorderStyle.SINGLE,size:1,color:'D9E2EC'},left:{style:BorderStyle.SINGLE,size:1,color:'D9E2EC'},right:{style:BorderStyle.SINGLE,size:1,color:'D9E2EC'}},
    children:[new Paragraph({alignment:align,children:[new TextRun({text:String(text??'—'),bold,color,size,font:'Aptos'})]})]
  });
}
async function fetchBytes(url){const r=await fetch(url);if(!r.ok)throw new Error(`Image introuvable : ${url}`);return new Uint8Array(await r.arrayBuffer())}
async function dataUrlImageBytes(value){
  if(!value)return null;
  if(String(value).startsWith('data:'))return dataUrlBytes(value);
  try{return await fetchBytes(value)}catch{return null}
}
async function canvasIllustration(kind,m){
  const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=700;const ctx=canvas.getContext('2d');
  const navy='#071b39',blue='#0f69d5',cyan='#24a8ff',gold='#f0b429',green='#179b55',light='#f5f8fc';
  ctx.fillStyle=light;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=navy;ctx.fillRect(0,0,canvas.width,95);ctx.fillStyle='#fff';ctx.font='700 38px Segoe UI';ctx.fillText(kind==='schema'?'SCHÉMA DE PRINCIPE — PRISE DE TERRE':'SYNTHÈSE DES MESURES',55,62);
  if(kind==='schema'){
    ctx.fillStyle='#dce5ef';ctx.fillRect(95,215,310,245);ctx.strokeStyle=navy;ctx.lineWidth=8;ctx.strokeRect(95,215,310,245);
    ctx.fillStyle=navy;ctx.font='700 31px Segoe UI';ctx.fillText('POSTE HTA/BT',135,335);
    ctx.strokeStyle=gold;ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(405,338);ctx.lineTo(665,338);ctx.stroke();
    ctx.fillStyle=gold;ctx.beginPath();ctx.arc(690,338,22,0,Math.PI*2);ctx.fill();
    const branches=[[1060,338],[875,145],[875,535]];ctx.strokeStyle=green;ctx.lineWidth=14;ctx.lineCap='round';branches.forEach(([x,y])=>{ctx.beginPath();ctx.moveTo(690,338);ctx.lineTo(x,y);ctx.stroke()});
    ctx.fillStyle=navy;ctx.font='600 27px Segoe UI';ctx.fillText('Liaison cuivre',455,300);ctx.fillText('Patte d’oie / solution retenue',820,625);
    ctx.font='24px Segoe UI';ctx.fillStyle='#50647b';ctx.fillText(`Implantation : ${m.solutionRetenue||'à confirmer'} · contrôle final obligatoire`,95,650);
  }else{
    const c=compute(m), final=computeFinal(m);const vals=[['RM initiale',Number(m.rm)||0,blue],['RN initiale',Number(m.rni||m.rng)||0,green],['RM finale',Number(m.finalMeasurements?.rm)||0,gold],['RN finale',Number(m.finalMeasurements?.rni||m.finalMeasurements?.rng)||0,cyan]];
    const max=Math.max(10,...vals.map(x=>x[1]));ctx.font='600 24px Segoe UI';
    vals.forEach((v,i)=>{const x=120+i*300,h=(v[1]/max)*360;ctx.fillStyle=v[2];ctx.fillRect(x,540-h,165,h);ctx.fillStyle=navy;ctx.fillText(v[0],x,585);ctx.font='700 31px Segoe UI';ctx.fillText(`${fmt(v[1],2)} Ω`,x,625);ctx.font='600 24px Segoe UI'});
    ctx.fillStyle=navy;ctx.font='700 28px Segoe UI';ctx.fillText(`Coefficient initial : ${Number.isFinite(c.c)?fmt(c.c,3):'—'}   ·   Coefficient final : ${Number.isFinite(final.c)?fmt(final.c,3):'—'}   ·   Objectif ≤ 0,150`,70,150);
  }
  return dataUrlBytes(canvas.toDataURL('image/png'));
}
async function waitForReportAssets(root){
  try{await document.fonts?.ready}catch{}
  const images=[...root.querySelectorAll('img')];
  await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,2500)})));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
async function capturePremiumReportPages(){
  const root=document.querySelector('.premiumReportPages');
  if(!root)throw new Error('Aperçu du rapport introuvable. Ouvrez d’abord l’onglet Rapport premium.');
  await waitForReportAssets(root);
  const pages=[...root.querySelectorAll(':scope > .a4ReportPage')];
  if(!pages.length)throw new Error('Aucune page de rapport à exporter.');
  const previousScroll={x:window.scrollX,y:window.scrollY};
  const captures=[];
  document.documentElement.classList.add('secab-report-capture');
  try{
    for(const page of pages){
      const canvas=await html2canvas(page,{scale:2,useCORS:true,allowTaint:false,backgroundColor:'#ffffff',logging:false,windowWidth:page.scrollWidth,windowHeight:page.scrollHeight,scrollX:0,scrollY:-window.scrollY,onclone:doc=>{doc.documentElement.classList.add('secab-report-capture-clone')}});
      captures.push(dataUrlBytes(canvas.toDataURL('image/png',1)));
    }
  }finally{
    document.documentElement.classList.remove('secab-report-capture');
    window.scrollTo(previousScroll.x,previousScroll.y);
  }
  return captures;
}
async function buildWordReport(m){
  try{
    const captures=await capturePremiumReportPages();
    const children=[];
    captures.forEach((bytes,index)=>{
      children.push(new Paragraph({spacing:{before:0,after:0,line:1},alignment:AlignmentType.CENTER,children:[new ImageRun({data:bytes,transformation:{width:794,height:1123},type:'png'})]}));
      if(index<captures.length-1)children.push(new Paragraph({children:[new PageBreak()]}));
    });
    const doc=new Document({
      creator:'SECAB',
      title:`Rapport premium ${m.rapport||m.affaire||m.uuid}`,
      description:'Copie visuelle exacte de l’aperçu du rapport SECAB',
      sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:0,right:0,bottom:0,left:0,header:0,footer:0,gutter:0}}},children}]
    });
    const blob=await Packer.toBlob(doc);
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`${safe(m.rapport||m.affaire||m.uuid)}_Rapport_Identique_Apercu_SECAB.docx`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){console.error(e);alert(`Export Word impossible : ${e.message}`)}
}


function WorkExecution({m,update,next,back}){
  const e={...EMPTY.execution,...(m.execution||{})};
  const set=(patch)=>update({execution:{...e,...patch}});
  const noWork=retainedSolutionId(m)==='none';
  const checks=[
    ['permitChecked','Autorisation / convention vérifiée'],
    ['networkMarkingChecked','Marquage-piquetage et réseaux existants vérifiés'],
    ['solutionVerified','Implantation et solution contrôlées avant ouverture'],
    ['warningMesh','Grillage avertisseur posé'],
    ['continuityChecked','Continuité électrique contrôlée avant remblaiement']
  ];
  const complete=noWork||Boolean(e.startedAt&&e.completedAt&&e.team&&e.supervisor&&e.beforeCoverPhoto&&e.continuityChecked);
  const closeWorks=()=>set({status:'Travaux terminés',completedAt:e.completedAt||new Date().toISOString().slice(0,16),comments:e.comments});
  return <section className="card guidedCard workExecution"><div className="stepTitle"><span>{IS_DESKTOP?'7':'6'}</span><div><h2>Exécution et traçabilité des travaux</h2><p>Enregistrer les intervenants, les contrôles avant remblaiement, les dimensions réellement exécutées et les écarts au plan.</p></div></div>
    <div className="executionHero"><div><small>SOLUTION À RÉALISER</small><h3>{ELECTRODES.find(x=>x.id===retainedSolutionId(m))?.title||'Solution retenue'}</h3><p>Implantation : ΔX {Math.round(Number(m.implantation?.offsetX||0))} m · ΔY {Math.round(Number(m.implantation?.offsetY||0))} m · orientation {Number(m.implantation?.orientation||0)}°</p></div><span className={`executionStatus ${e.status==='Travaux terminés'?'done':''}`}>{e.status}</span></div>
    <div className="form executionForm"><Field label="Début des travaux" type="datetime-local" value={e.startedAt} onChange={v=>set({startedAt:v,status:'En cours'})}/><Field label="Fin des travaux" type="datetime-local" value={e.completedAt} onChange={v=>set({completedAt:v})}/><Field label="Équipe / agents" value={e.team} onChange={v=>set({team:v})}/><Field label="Chef d’équipe / responsable" value={e.supervisor} onChange={v=>set({supervisor:v})}/><Select label="Conditions météo" value={e.weather} onChange={v=>set({weather:v})} options={['','Sec / favorable','Humide','Pluie faible','Pluie forte','Vent fort']}/><Select label="État d’avancement" value={e.status} onChange={v=>set({status:v})} options={['À préparer','En cours','Suspendu','Travaux terminés','À reprendre']}/></div>
    <div className="executionGrid"><div className="executionChecklist"><h3>Contrôles chantier</h3>{checks.map(([k,label])=><label key={k} className={e[k]?'checked':''}><input type="checkbox" checked={Boolean(e[k])} onChange={x=>set({[k]:x.target.checked})}/><span>{e[k]?'✓':'!'}</span><b>{label}</b></label>)}</div><div className="executionMeasures"><h3>Réalisé sur le terrain</h3><Field label="Longueur de tranchée (m)" type="number" value={e.trenchLength} onChange={v=>set({trenchLength:v,conductorLength:copperFromTrench(v)})}/><Field label="Profondeur moyenne (m)" type="number" value={e.trenchDepth} onChange={v=>set({trenchDepth:v})}/><Field label="Longueur de cuivre calculée (m) — ratio 1:3" type="number" value={copperFromTrench(e.trenchLength)} onChange={()=>{}}/><small className="copperRuleHint">Calcul automatique : 1 m de tranchée = 3 m de cuivre. Exemple : 10 m de tranchée = 30 m de cuivre.</small><Field label="Raccordements / connexions réalisés" value={e.connections} onChange={v=>set({connections:v})}/></div></div>
    <div className="executionPhotos"><FastPhotoPicker title="Photo obligatoire avant remblaiement" required value={e.beforeCoverPhoto} onChange={v=>set({beforeCoverPhoto:v})} label="Prise de terre avant remblaiement"/><FastPhotoPicker title="Photo des raccordements" required={false} value={e.connectionPhoto} onChange={v=>set({connectionPhoto:v})} label="Raccordements de la prise de terre"/></div>
    <div className="executionNotes"><label><span>Écarts par rapport au plan d’implantation</span><textarea value={e.deviations||''} onChange={x=>set({deviations:x.target.value})} placeholder="Décrire tout déplacement, modification de longueur, obstacle ou changement de solution..."/></label><label><span>Observations chantier</span><textarea value={e.comments||''} onChange={x=>set({comments:x.target.value})} placeholder="Matériel utilisé, difficulté rencontrée, réserve, action complémentaire..."/></label></div>
    <div className="executionClose"><div><b>{complete?'Dossier travaux complet':'Traçabilité chantier incomplète'}</b><p>{complete?'Les éléments nécessaires au contrôle final sont enregistrés.':'Renseigner l’équipe, les dates, la photo avant remblaiement et le contrôle de continuité.'}</p></div><button onClick={closeWorks} disabled={!e.startedAt||!e.team||!e.beforeCoverPhoto}>✓ Marquer les travaux terminés</button></div>
    <div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour {IS_DESKTOP?'Coût estimatif':'Implantation'}</button><span className={complete?'readyText':'warningText'}>{complete?'✓ Exécution documentée':IS_DESKTOP?'Informations incomplètes — navigation autorisée au bureau':'Traçabilité obligatoire avant le contrôle final'}</span><button disabled={!complete&&!IS_DESKTOP} onClick={next}>Passer au contrôle final →</button></div>
  </section>
}

function FinalControl({m,update,next,back}){
  const fm=m.finalMeasurements||{}, final=computeFinal(m), initial=compute(m), required=m.terreConfig==='interconnectee'?['rm','rng']:(m.mode==='direct'?['rm','rc']:['rm','rni','rmn']);
  const set=(k,v)=>update({finalMeasurements:{...fm,[k]:v}});
  const photoSet=(k,v)=>update({finalMeasurePhotos:{...(m.finalMeasurePhotos||{}),[k]:v}});
  const complete=required.every(k=>Number.isFinite(num(k==='rc'?fm.rcDirect:fm[k]))) && Boolean(m.afterWorkPhoto);
  const validateTech=()=>update({statut:'À contrôler',validation:{...(m.validation||{}),technicianAt:new Date().toISOString()},audit:[...(m.audit||[]),auditEntry('Contrôle final renseigné',`Conclusion ${final.ok?'conforme':'non conforme'}`)]});
  return <section className="card guidedCard"><div className="stepTitle"><span>6</span><div><h2>Contrôle final après travaux</h2><p>Comparer les valeurs initiales et finales, documenter les travaux et préparer la validation bureau.</p></div></div>
    <div className="comparisonBanner"><div><span>Avant travaux</span><b>{initial.ok?'Conforme':'Non conforme'}</b><small>{initial.mode==='separee'?`c ${fmt(initial.c,4)}`:`RNg ${fmt(initial.rng,2)} Ω`}</small></div><div className="arrowCompare">→</div><div className={final.ok?'finalOk':'finalKo'}><span>Après travaux</span><b>{final.ok?'Conforme':'À reprendre'}</b><small>{final.mode==='separee'?`c ${fmt(final.c,4)}`:`RNg ${fmt(final.rng,2)} Ω`}</small></div></div>
    {final.mode==='separee'&&<div className={`finalCoefficientCard ${final.ok?'ok':'ko'}`}><span>Nouveau coefficient de couplage</span><strong>{fmt(final.c,4)}</strong><b>{final.ok?'CONFORME':'NON CONFORME'}</b><small>Objectif : c &lt; 0,150 · amélioration {Number.isFinite(initial.c)&&Number.isFinite(final.c)&&initial.c!==0?fmt((1-final.c/initial.c)*100,1):'—'} %</small></div>}
    <div className="finalComparisonTable"><div><b>Paramètre</b><b>Avant</b><b>Après</b><b>Évolution</b></div>{[['RM',initial.rm,final.rm],['RNi',initial.rni,final.rni],['RMN',initial.rmn,final.rmn],['Rc',initial.rc,final.rc],['Coefficient',initial.c,final.c]].filter(([,a,b])=>Number.isFinite(a)||Number.isFinite(b)).map(([label,a,b])=><div key={label}><span>{label}</span><span>{fmt(a,label==='Coefficient'?4:2)}</span><span>{fmt(b,label==='Coefficient'?4:2)}</span><span>{Number.isFinite(a)&&a!==0&&Number.isFinite(b)?`${fmt((b-a)/a*100,1)} %`:'—'}</span></div>)}</div>
    <div className="measureColumns"><div><h3>Mesures finales</h3><div className="form"><Field label="RM final (Ω)" value={fm.rm} onChange={v=>set('rm',v)}/>{m.terreConfig==='interconnectee'?<Field label="RNg final (Ω)" value={fm.rng} onChange={v=>set('rng',v)}/>:m.mode==='direct'?<Field label="Rc final direct TERCA (Ω)" value={fm.rcDirect} onChange={v=>set('rcDirect',v)}/>:<><Field label="RNi final (Ω)" value={fm.rni} onChange={v=>set('rni',v)}/><Field label="RMN final (Ω)" value={fm.rmn} onChange={v=>set('rmn',v)}/></>}<Field label="Résistivité finale / contrôle (Ω.m)" value={fm.resistivite} onChange={v=>set('resistivite',v)}/></div><div className={`status ${final.ok?'ok':'ko'}`}>{final.diagnostic}</div></div>
    <div><h3>Photos du contrôle final</h3>{required.map(k=><FinalPhoto key={k} m={m} photoKey={k} value={m.finalMeasurePhotos?.[k]} onChange={v=>photoSet(k,v)}/>)}</div></div>
    <PlanAction m={m} update={update} field="finalSurfaceWorks" title="Quantités réellement réalisées après travaux"/><div className="afterPhotos"><WorkPhoto title="Photo après travaux" required value={m.afterWorkPhoto} onChange={v=>update({afterWorkPhoto:v})}/><WorkPhoto title="Photo de la réfection définitive" required={false} value={m.reinstatementPhoto} onChange={v=>update({reinstatementPhoto:v})}/></div>
    <div className="validationStrip"><Select label="Statut de l’affaire" value={m.statut} onChange={v=>update({statut:v,audit:[...(m.audit||[]),auditEntry('Changement de statut',v)]})} options={STATUSES}/><div><b>Visa technicien</b><p>{m.validation?.technicianAt?new Date(m.validation.technicianAt).toLocaleString('fr-FR'):'Non validé'}</p><button onClick={validateTech}>Valider le contrôle terrain</button></div></div>
    <div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour Travaux</button><span className={complete?'readyText':'warningText'}>{complete?'✓ Contrôle final complet':IS_DESKTOP?'Données finales incomplètes — navigation autorisée au bureau':'Mesures finales et photo après travaux requises'}</span><button disabled={!complete&&!IS_DESKTOP} onClick={next}>Ouvrir le rapport final →</button></div>
  </section>
}
function FinalPhoto({m,photoKey,value,onChange}){const label=`${MEASURE_META[photoKey]?.label||photoKey} — après travaux`;return <FastPhotoPicker title={label} required={false} value={value} onChange={onChange} label={label}/> }

function gpsBufferPolygon(lng,lat,radiusM=50,steps=32){
  const ring=[];
  const latRad=lat*Math.PI/180;
  for(let i=0;i<=steps;i++){
    const a=2*Math.PI*i/steps;
    const dx=Math.cos(a)*radiusM, dy=Math.sin(a)*radiusM;
    ring.push([lng+dx/(EARTH_M*Math.cos(latRad))*180/Math.PI,lat+dy/EARTH_M*180/Math.PI]);
  }
  return {type:'Polygon',coordinates:[ring]};
}
function cadastreCommuneName(fc){
  const p=fc?.features?.[0]?.properties||{};
  return p.nom_com||p.nom_commune||p.commune||p.libcom||p.libelle_commune||'';
}
async function fetchGeoJson(url){const r=await fetch(url,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`Service cartographique : erreur ${r.status}`);return r.json();}
async function requestCartography(lng,lat,radiusM=50){
  const geom=gpsBufferPolygon(lng,lat,radiusM);
  if(window.secabDesktop?.fetchCartography){
    const result=await window.secabDesktop.fetchCartography({geom,radiusM,lng,lat});
    if(!result?.ok)throw new Error(result?.error||'Services cartographiques indisponibles');
    return result.data;
  }
  const g=encodeURIComponent(JSON.stringify(geom));
  const endpoints={
    cadastre:`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${g}&source_ign=PCI&_limit=300`,
    documents:`https://apicarto.ign.fr/api/gpu/document?geom=${g}`,
    zones:`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${g}`,
    prescriptionsSurf:`https://apicarto.ign.fr/api/gpu/prescription-surf?geom=${g}`,
    prescriptionsLin:`https://apicarto.ign.fr/api/gpu/prescription-lin?geom=${g}`
  };
  const entries=await Promise.all(Object.entries(endpoints).map(async([k,u])=>{try{return [k,await fetchGeoJson(u)]}catch(e){return [k,{type:'FeatureCollection',features:[],error:e.message}]}}));
  return Object.fromEntries(entries);
}
async function requestCadastre(lng,lat,radiusM=50){return (await requestCartography(lng,lat,radiusM)).cadastre;}


const EDF_ARCGIS_PORTAL='https://edfseicorseore.maps.arcgis.com';
const EDF_ARCGIS_WEBMAP_ID='897f5f20fed7477b881653ac31b98520';
function arcgisItemDataUrl(itemId=EDF_ARCGIS_WEBMAP_ID){return `${EDF_ARCGIS_PORTAL}/sharing/rest/content/items/${encodeURIComponent(itemId)}/data?f=json`;}
function arcgisItemInfoUrl(itemId=EDF_ARCGIS_WEBMAP_ID){return `${EDF_ARCGIS_PORTAL}/sharing/rest/content/items/${encodeURIComponent(itemId)}?f=json`;}
function flattenArcgisLayers(layers=[],parent=''){
  const out=[];
  for(const l of layers||[]){
    const title=[parent,l.title||l.name||'Couche ArcGIS'].filter(Boolean).join(' / ');
    if(l.url)out.push({title,url:l.url,id:l.id,visibility:l.visibility!==false});
    if(Array.isArray(l.layers))out.push(...flattenArcgisLayers(l.layers,title));
  }
  return out;
}
function arcgisServiceLayerUrls(layer){
  const u=String(layer?.url||'').replace(/\/$/,'');
  if(!u)return [];
  if(/\/(FeatureServer|MapServer)\/\d+$/i.test(u))return [{...layer,url:u}];
  return [{...layer,url:u,serviceRoot:true}];
}
function arcgisGeometryPoint(geometry){
  if(!geometry)return null;
  if(geometry.type==='Point')return geometry.coordinates;
  const pts=[];const walk=c=>{if(!Array.isArray(c))return;if(c.length>=2&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))pts.push([Number(c[0]),Number(c[1])]);else c.forEach(walk)};walk(geometry.coordinates);
  if(!pts.length)return null;
  return [pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length];
}
function arcgisFeatureDistance(feature,lng,lat){const p=arcgisGeometryPoint(feature?.geometry);return p?distanceMeters(lng,lat,p[0],p[1]):Infinity;}
function arcgisFirstAttr(attrs,keys){const low={};Object.entries(attrs||{}).forEach(([k,v])=>low[String(k).toLowerCase()]=v);for(const k of keys){const v=low[k.toLowerCase()];if(v!==undefined&&v!==null&&String(v).trim())return String(v).trim()}return ''}
function arcgisFeatureSummary(feature){const a=feature?.properties||{};return {
  numeroPoste:arcgisFirstAttr(a,['numero_poste','num_poste','n_poste','poste','code_poste','id_poste','nom_poste','repere','ouvrage']),
  codeGdo:arcgisFirstAttr(a,['code_gdo','numero_gdo','num_gdo','gdo','affaire']),
  nom:arcgisFirstAttr(a,['nom','name','libelle','designation','ouvrage','poste']),
  commune:arcgisFirstAttr(a,['commune','nom_commune','nom_com','libcom']),
  type:arcgisFirstAttr(a,['type','type_ouvrage','nature','categorie','classe'])
}}
async function fetchArcgisJson(url,opts={}){const r=await fetch(url,{...opts,headers:{accept:'application/json',...(opts.headers||{})}});if(!r.ok)throw new Error(`ArcGIS HTTP ${r.status}`);const j=await r.json();if(j?.error)throw new Error(j.error.message||'Erreur ArcGIS');return j;}
async function requestArcgisNetwork(lng,lat,radiusM=100,itemId=EDF_ARCGIS_WEBMAP_ID){
  if(window.secabDesktop?.fetchArcgis){const result=await window.secabDesktop.fetchArcgis({lng,lat,radiusM,itemId,portal:EDF_ARCGIS_PORTAL});if(!result?.ok)throw new Error(result?.error||'ArcGIS indisponible');return result.data;}
  const info=await fetchArcgisJson(arcgisItemInfoUrl(itemId));
  const webmap=await fetchArcgisJson(arcgisItemDataUrl(itemId));
  const refs=flattenArcgisLayers(webmap.operationalLayers||[]).filter(x=>x.visibility!==false);
  const features=[],layers=[];
  for(const ref of refs.slice(0,30)){
    try{
      let targets=[];
      if(/\/(FeatureServer|MapServer)\/\d+$/i.test(ref.url)){targets=[ref]}
      else{
        const meta=await fetchArcgisJson(`${String(ref.url).replace(/\/$/,'')}?f=json`);
        targets=(meta.layers||[]).slice(0,50).map(x=>({title:`${ref.title} / ${x.name||x.id}`,url:`${String(ref.url).replace(/\/$/,'')}/${x.id}`}));
      }
      for(const t of targets){
        try{
          const q=new URLSearchParams({f:'geojson',where:'1=1',geometry:`${lng},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(radiusM),units:'esriSRUnit_Meter',outFields:'*',returnGeometry:'true',outSR:'4326',resultRecordCount:'100'});
          const fc=await fetchArcgisJson(`${t.url}/query?${q.toString()}`);
          const fs=(fc.features||[]).map(f=>({...f,properties:{...(f.properties||{}),__secabLayer:t.title,__secabLayerUrl:t.url}}));
          if(fs.length){layers.push({title:t.title,url:t.url,count:fs.length});features.push(...fs)}
        }catch(e){layers.push({title:t.title,url:t.url,count:0,error:e.message})}
      }
    }catch(e){layers.push({title:ref.title,url:ref.url,count:0,error:e.message})}
  }
  features.forEach(f=>{f.properties={...(f.properties||{}),__secabDistanceM:Math.round(arcgisFeatureDistance(f,lng,lat)*10)/10}});
  features.sort((a,b)=>(a.properties?.__secabDistanceM??Infinity)-(b.properties?.__secabDistanceM??Infinity));
  const likely=features.filter(f=>/poste|hta|bt|transform|ouvrage/i.test(`${f.properties?.__secabLayer||''} ${Object.values(f.properties||{}).join(' ')}`));
  const nearest=likely[0]||features[0]||null;
  return {item:{id:itemId,title:info.title||'Carte EDF SEI',owner:info.owner||'',modified:info.modified||null},layers,features,nearest,loadedAt:new Date().toISOString(),radiusM};
}


function Terrain({m,update,next,back}){
  const [mapLoading,setMapLoading]=useState(false);
  const [gpsLoading,setGpsLoading]=useState(false);
  async function captureAndLoad(p){
    const lat=p.coords.latitude,lng=p.coords.longitude,accuracy=Math.round(p.coords.accuracy||0),radius=Number(m.cadastreSync?.radius||50);
    update({gpsLat:lat.toFixed(7),gpsLng:lng.toFixed(7),gpsAccuracy:accuracy,gpsCapturedAt:new Date().toISOString(),gpsElapsedMs:String(p.__secabElapsedMs||''),gpsSource:p.__secabSource||'',cadastreSync:{...(m.cadastreSync||{}),status:'loading',message:'Position enregistrée. Cadastre et réseau EDF SEI chargés en arrière-plan…',radius},arcgisData:{...(m.arcgisData||{}),status:'loading',message:'Recherche du réseau EDF SEI / ArcGIS en arrière-plan…',webmapId:EDF_ARCGIS_WEBMAP_ID}});
    setMapLoading(true);
    try{const [data,arcResult]=await Promise.all([requestCartography(lng,lat,radius),requestArcgisNetwork(lng,lat,Math.max(100,radius*2)).catch(error=>({error:error.message,layers:[],features:[],nearest:null,loadedAt:new Date().toISOString()}))]);const cadastre=data.cadastre||{type:'FeatureCollection',features:[]};const contraintes={type:'FeatureCollection',features:[...(data.documents?.features||[]),...(data.zones?.features||[]),...(data.prescriptionsSurf?.features||[]),...(data.prescriptionsLin?.features||[])]};const commune=cadastreCommuneName(cadastre);const arcNearest=arcResult?.nearest||null;const arcSummary=arcNearest?arcgisFeatureSummary(arcNearest):{};update({cadastre,contraintes,cartographyData:data,arcgisData:{status:arcResult?.error?'error':'ready',message:arcResult?.error||`${arcResult.features?.length||0} objet(s) EDF SEI détecté(s) dans ${arcResult.layers?.filter(x=>x.count).length||0} couche(s)`,loadedAt:arcResult.loadedAt||new Date().toISOString(),webmapId:EDF_ARCGIS_WEBMAP_ID,layers:arcResult.layers||[],features:arcResult.features||[],nearest:arcNearest,item:arcResult.item||null},cadastreSync:{status:'ready',message:`${cadastre.features?.length||0} parcelle(s), ${contraintes.features?.length||0} contrainte(s) chargée(s)`,loadedAt:new Date().toISOString(),radius,source:'IGN API Carto — Cadastre PCI + Géoportail de l’Urbanisme'},...(commune&&COMMUNES.includes(commune)?{commune}:{}),...(arcSummary.numeroPoste&&!m.numeroPoste?{numeroPoste:arcSummary.numeroPoste}:{}),...(arcSummary.codeGdo&&!m.codeGdo?{codeGdo:arcSummary.codeGdo}:{}),implantation:{...(m.implantation||{}),centerLat:String(lat),centerLng:String(lng)}})}catch(e){update({cadastreSync:{...(m.cadastreSync||{}),status:'error',message:e.message||'Chargement cartographique impossible'},arcgisData:{...(m.arcgisData||{}),status:'error',message:e.message||'ArcGIS indisponible'}})}finally{setMapLoading(false)}
  }
  async function gps(){
    setGpsLoading(true);
    try{
      const position=await getSecabPosition();
      const {latitude,longitude,accuracy}=position.coords;
      update({gpsLat:latitude.toFixed(7),gpsLng:longitude.toFixed(7),gpsOriginalLat:latitude.toFixed(7),gpsOriginalLng:longitude.toFixed(7),gpsAccuracy:Math.max(0,Math.round(accuracy||0)),gpsCapturedAt:new Date().toISOString(),gpsElapsedMs:String(position.__secabElapsedMs||''),gpsSource:position.__secabSource||'',gpsManuallyAdjusted:false,gpsManualLat:'',gpsManualLng:'',implantation:{...(m.implantation||{}),anchorLat:'',anchorLng:'',anchorManuallyAdjusted:false,centerLat:String(latitude),centerLng:String(longitude),placementConfirmed:false}});
      // La carte, le cadastre et ArcGIS continuent ensuite sans bloquer le parcours terrain.
      captureAndLoad(position);
    }
    catch(e){alert(IS_DESKTOP?'Géolocalisation indisponible sur ce poste. Saisissez les coordonnées si nécessaire.':(e?.message||'GPS indisponible ou refusé'))}
    finally{setGpsLoading(false)}
  }
  async function add(e){
    const fs=[...(e.target.files||[])];if(!fs.length)return;
    try{const arr=[];for(const f of fs)arr.push(await fileToOptimizedPhoto(f));update({photos:[...(m.photos||[]),...arr]})}
    catch(err){console.error(err);alert(`Photo non ajoutée : ${err?.message||'erreur inconnue'}`)}
    finally{e.target.value=''}
  }
  const gpsReady=Boolean(m.gpsLat&&m.gpsLng);
  const gpsState=gpsQuality(m.gpsAccuracy);
  return <section className="grid two">
    <div className="card"><h2>Terrain / GPS</h2>
      <div className="modeNotice">{IS_DESKTOP?'💻 Mode bureau : géolocalisation Windows disponible. Le GPS reste facultatif et les coordonnées restent modifiables manuellement.':'📱 Mode terrain : capture GPS requise avant la poursuite.'}</div>
      <button onClick={gps} disabled={gpsLoading}>📍 {gpsLoading?'Acquisition GPS rapide…':IS_DESKTOP?'Géolocaliser ce PC':'Capturer le GPS maintenant'}</button>
      {IS_DESKTOP&&<div className="form desktopGps"><Field label="Latitude (facultative)" value={m.gpsLat} onChange={v=>update({gpsLat:v})}/><Field label="Longitude (facultative)" value={m.gpsLng} onChange={v=>update({gpsLng:v})}/><Field label="Précision GPS (m)" value={m.gpsAccuracy} onChange={v=>update({gpsAccuracy:v})}/></div>}
      <div className={`gpsQuickStatus ${gpsState.key}`}><strong>{gpsState.icon} {gpsState.label}</strong><span>{m.gpsLat||'—'}, {m.gpsLng||'—'}{m.gpsElapsedMs?` · obtenu en ${(Number(m.gpsElapsedMs)/1000).toFixed(1)} s`:''}</span><small>La précision n’empêche jamais de poursuivre. Repositionnez le point sur la carte uniquement si nécessaire.</small></div><div className={`mapLoadSummary ${m.cadastreSync?.status||'idle'}`}><b>{m.cadastreSync?.status==='ready'?'✓ Données cartographiques prêtes':m.cadastreSync?.status==='loading'?'⏳ Chargement cartographique':'Carte non chargée'}</b><span>{m.cadastreSync?.message||'Le cadastre, les parcelles et les contraintes d’urbanisme seront récupérés automatiquement avec le GPS.'}</span></div>
      {gpsReady&&<div className="terrainInlineMap"><div className="terrainMapHeader"><div><h3>Géolocalisation du poste</h3><p>Le GPS place d’abord le poste. Glissez le symbole électrique, ou cliquez directement sur la carte, pour positionner le poste exactement sur l’ouvrage réel.</p></div><div className="terrainHeaderActions"><span className={`mapStatusBadge ${m.cadastreSync?.status||'idle'}`}>{m.cadastreSync?.status==='ready'?'Données prêtes':m.cadastreSync?.status==='loading'?'Chargement…':'Position GPS'}</span>{m.gpsOriginalLat&&m.gpsOriginalLng&&<button type="button" className="secondaryAction" onClick={()=>update({gpsLat:m.gpsOriginalLat,gpsLng:m.gpsOriginalLng,gpsManuallyAdjusted:false,implantation:{...(m.implantation||{}),centerLat:m.gpsOriginalLat,centerLng:m.gpsOriginalLng},gpsMapFocusNonce:Date.now()})}>Recentrer sur le GPS</button>}</div></div><LiveMap key={`terrain-${m.gpsMapFocusNonce||m.gpsCapturedAt||m.gpsOriginalLat||'map'}`} focusNonce={m.gpsMapFocusNonce||m.gpsCapturedAt} m={{...m,improvementTarget:'masses',implantation:{...(m.implantation||{}),centerLat:m.gpsLat,centerLng:m.gpsLng,manualAnchorLat:'',manualAnchorLng:'',anchorLocked:false}}} analysis={{lines:[],parcels:[]}} showCadastre={false} showArcgis={true} anchorDraggable={true} anchorSnap={false} clickToPlaceAnchor={true} onMoveAnchor={(lat,lng)=>update({gpsLat:lat.toFixed(7),gpsLng:lng.toFixed(7),gpsManuallyAdjusted:true,implantation:{...(m.implantation||{}),centerLat:String(lat),centerLng:String(lng)}})}/><div className="terrainMapFooter"><span>⚡ Poste déplaçable librement</span><span>Précision GPS : {m.gpsAccuracy||'—'} m</span><span>{m.gpsManuallyAdjusted?'Position corrigée manuellement':'Position GPS d’origine'}</span></div></div>}
      <ArcgisNetworkPanel m={m} update={update}/>
      <textarea placeholder="Observations terrain" value={m.observations||''} onChange={e=>update({observations:e.target.value})}/>
      <div className="terrainPhotoActions"><label className="photoBtn">📷 Appareil photo<input type="file" accept="image/*" capture={IS_DESKTOP?undefined:'environment'} onChange={add}/></label><label className="photoBtn secondary">🖼 Galerie<input type="file" accept="image/*" multiple onChange={add}/></label></div>
    </div>
    <div className="card"><h2>Photos complémentaires</h2><div className="photos">{(m.photos||[]).map((p,i)=><figure key={i}><img src={p.data}/><input value={p.caption||''} placeholder="Légende" onChange={e=>{const a=[...m.photos];a[i]={...a[i],caption:e.target.value};update({photos:a})}}/><button onClick={()=>download(p.name,p.data)}>Original</button><button className="danger" onClick={()=>update({photos:m.photos.filter((_,x)=>x!==i)})}>Retirer</button></figure>)}</div></div>
    {IS_NATIVE_ANDROID&&<div className="card driveFolderCard"><h3>📁 Dossier d’envoi vers le bureau</h3><p>Choisissez une seule fois le dossier Google Drive <b>Synchronisation / A_importer</b>. Les prochaines affaires y seront déposées automatiquement.</p><div className="actions"><button type="button" onClick={async()=>{try{const r=await chooseSecabDriveFolder();alert(`Dossier mémorisé : ${r.name||'Google Drive'}`)}catch(e){alert(e.message)}}}>Choisir ou changer le dossier Drive</button><span className={localStorage.getItem(SAF_FOLDER_KEY)?'readyText':'warningText'}>{localStorage.getItem(SAF_FOLDER_KEY)?'✓ Dossier autorisé':'Dossier non configuré'}</span></div></div>}
    <div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour Identification</button><span className={gpsReady?'readyText':IS_DESKTOP?'desktopInfo':'warningText'}>{gpsReady?`✓ GPS capturé rapidement · précision ${m.gpsAccuracy||'—'} m`:IS_DESKTOP?'GPS non renseigné — étape facultative au bureau':'Capturer la position avant de continuer'}</span><button disabled={!gpsReady&&!IS_DESKTOP} onClick={next}>{IS_DESKTOP&&!gpsReady?'Passer aux mesures →':'Continuer vers Mesures →'}</button></div>
  </section>
}


function ArcgisNetworkPanel({m,update}){
  const a=m.arcgisData||{};const nearest=a.nearest||null;const sum=nearest?arcgisFeatureSummary(nearest):{};
  const attrs=nearest?.properties||{};
  const apply=()=>{const patch={};if(sum.numeroPoste)patch.numeroPoste=sum.numeroPoste;if(sum.codeGdo)patch.codeGdo=sum.codeGdo;if(sum.commune&&COMMUNES.includes(sum.commune))patch.commune=sum.commune;if(Object.keys(patch).length)update(patch);else alert('Aucun numéro de poste ou code GDO identifiable dans les attributs publics de cet objet.')};
  return <div className={`arcgisPanel ${a.status||'idle'}`}><div className="arcgisHead"><div><b>Réseau EDF SEI / ArcGIS</b><span>Webmap {a.webmapId||EDF_ARCGIS_WEBMAP_ID}</span></div><strong>{a.status==='ready'?'Connecté':a.status==='loading'?'Recherche…':a.status==='error'?'Indisponible':'En attente GPS'}</strong></div><p>{a.message||'La carte publique EDF SEI sera interrogée automatiquement autour de la position.'}</p>{nearest&&<div className="arcgisNearest"><h3>Objet réseau le plus proche</h3><div className="arcgisFacts"><span><b>Couche</b>{attrs.__secabLayer||'—'}</span><span><b>Distance</b>{Number.isFinite(num(attrs.__secabDistanceM))?`${attrs.__secabDistanceM} m`:'—'}</span><span><b>Poste / repère</b>{sum.numeroPoste||sum.nom||'Non publié'}</span><span><b>Code GDO</b>{sum.codeGdo||'Non publié'}</span><span><b>Type</b>{sum.type||'—'}</span><span><b>Commune</b>{sum.commune||m.commune||'—'}</span></div><button type="button" onClick={apply}>Utiliser les informations disponibles</button><details><summary>Voir tous les attributs publics</summary><div className="arcgisAttrs">{Object.entries(attrs).filter(([k])=>!k.startsWith('__secab')).slice(0,40).map(([k,v])=><p key={k}><b>{k}</b><span>{String(v??'—')}</span></p>)}</div></details></div>}</div>
}

function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function featureCollection(name,features){return {type:'FeatureCollection',name,crs:{type:'name',properties:{name:'urn:ogc:def:crs:OGC:1.3:CRS84'}},features}}
function qgisProjectXml(m,layers){
  const layerXml=layers.map((l,i)=>`<maplayer type="vector" geometry="${l.geometry}" simplifyDrawingHints="1"><id>${l.id}</id><datasource>./${l.file}</datasource><layername>${xmlEsc(l.name)}</layername><provider encoding="UTF-8">ogr</provider><renderer-v2 type="singleSymbol"><symbols><symbol type="${l.symbol}" name="0"><layer class="${l.symbol==='line'?'SimpleLine':l.symbol==='marker'?'SimpleMarker':'SimpleFill'}" enabled="1"/></symbol></symbols></renderer-v2></maplayer>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><qgis projectname="SECAB_${xmlEsc(m.affaire||m.uuid)}" version="3.34"><title>Mesure & amélioration des terres de poste de transformation — ${xmlEsc(m.affaire||m.uuid)}</title><projectCrs><spatialrefsys><authid>EPSG:4326</authid><description>WGS 84</description></spatialrefsys></projectCrs><layer-tree-group name="Mesure & amélioration des terres de poste de transformation">${layers.map(l=>`<layer-tree-layer id="${l.id}" name="${xmlEsc(l.name)}" checked="Qt::Checked"/>`).join('')}</layer-tree-group><projectlayers>${layerXml}</projectlayers><properties><Paths><Absolute type="bool">false</Absolute></Paths></properties></qgis>`;
}

function NeutralTargetLocationMap({m,update}){
  const lat=num(m.neutralGpsLat),lng=num(m.neutralGpsLng),postLat=num(m.gpsLat),postLng=num(m.gpsLng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return <div className="neutralMapPlaceholder"><b>Carte du nouvel emplacement</b><span>Géolocalisez le 2ᵉ ouvrage pour afficher sa position sur le plan.</span></div>;
  const targetRecord={...m,improvementTarget:'neutral',postGpsLat:m.gpsLat,postGpsLng:m.gpsLng,gpsLat:lat,gpsLng:lng,neutralGpsLat:lat,neutralGpsLng:lng,cadastre:null,arcgisData:null,implantation:{...(m.implantation||{}),centerLat:lat,centerLng:lng}};
  const distance=Number.isFinite(postLat)&&Number.isFinite(postLng)?distanceMeters(postLng,postLat,lng,lat):NaN;
  return <div className="neutralLocationMapCard"><div className="neutralMapHeader"><div><h3>Carte du 2ᵉ ouvrage</h3><p>{m.neutralTargetLabel||'2ᵉ ouvrage neutre'} · géolocalisez puis glissez le symbole, ou cliquez sur la carte, jusqu’à sa position physique exacte</p></div><div className="neutralHeaderActions"><b>{Number.isFinite(distance)?`${fmt(distance,1)} m du poste`:'Distance au poste à calculer'}</b>{m.neutralGpsOriginalLat&&m.neutralGpsOriginalLng&&<button type="button" className="secondaryAction" onClick={()=>update({neutralGpsLat:m.neutralGpsOriginalLat,neutralGpsLng:m.neutralGpsOriginalLng,neutralGpsManual:false,neutralMapFocusNonce:Date.now(),implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:m.neutralGpsOriginalLat,centerLng:m.neutralGpsOriginalLng,placementConfirmed:false}})}>Recentrer sur le GPS</button>}</div></div><LiveMap key={`neutral-${m.neutralMapFocusNonce||m.neutralGpsCapturedAt||`${lat}-${lng}`}`} focusNonce={m.neutralMapFocusNonce||m.neutralGpsCapturedAt} preferredZoom={18} m={targetRecord} analysis={{lines:[],parcels:[]}} showCadastre={false} showArcgis={false} anchorDraggable={true} anchorSnap={false} clickToPlaceAnchor={true} onMoveAnchor={(newLat,newLng)=>update({neutralGpsLat:String(newLat.toFixed(7)),neutralGpsLng:String(newLng.toFixed(7)),neutralGpsManual:true,implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:String(newLat.toFixed(7)),centerLng:String(newLng.toFixed(7)),placementConfirmed:false}})}/><div className="meterNudge neutralMeterNudge"><button type="button" onClick={()=>{const p=toLngLat(-1,0,lng,lat);update({neutralGpsLat:p[1].toFixed(7),neutralGpsLng:p[0].toFixed(7),neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLat:p[1].toFixed(7),centerLng:p[0].toFixed(7),placementConfirmed:false}})}}>← 1 m</button><button type="button" onClick={()=>{const p=toLngLat(0,1,lng,lat);update({neutralGpsLat:p[1].toFixed(7),neutralGpsLng:p[0].toFixed(7),neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLat:p[1].toFixed(7),centerLng:p[0].toFixed(7),placementConfirmed:false}})}}>↑ 1 m</button><button type="button" onClick={()=>{const p=toLngLat(0,-1,lng,lat);update({neutralGpsLat:p[1].toFixed(7),neutralGpsLng:p[0].toFixed(7),neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLat:p[1].toFixed(7),centerLng:p[0].toFixed(7),placementConfirmed:false}})}}>↓ 1 m</button><button type="button" onClick={()=>{const p=toLngLat(1,0,lng,lat);update({neutralGpsLat:p[1].toFixed(7),neutralGpsLng:p[0].toFixed(7),neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLat:p[1].toFixed(7),centerLng:p[0].toFixed(7),placementConfirmed:false}})}}>1 m →</button></div><div className="neutralMapCoordinates"><span>Latitude <b>{fmt(lat,7)}</b></span><span>Longitude <b>{fmt(lng,7)}</b></span><span>Position <b>{m.neutralGpsManual?'Corrigée manuellement':'Issue du GPS'}</b></span><span>Fond de carte <b>Plan IGN / orthophoto / OSM</b></span></div></div>
}

function LiveMap({m,analysis={lines:[],parcels:[],connector:[]},onMoveCenter,onMoveAnchor,onMoveConnection,onParcelSelect,showCadastre=true,showArcgis=true,editable=false,schemaOnly=false,anchorDraggable=false,anchorSnap=true,clickToPlaceAnchor=false,annotations=[],onAnnotationsChange,onSelectionChange,focusNonce='',preferredZoom=18}){
  const el=useRef(null),mapRef=useRef(null),baseLayersRef=useRef({}),groupsRef=useRef({}),drawStateRef=useRef({mode:'move',points:[]}),selectedRef=useRef(''),clipboardRef=useRef(null),historyRef=useRef({past:[],future:[],current:annotations||[]}),[mapError,setMapError]=useState('');
  const safeAnalysis={lines:Array.isArray(analysis?.lines)?analysis.lines:[],parcels:Array.isArray(analysis?.parcels)?analysis.parcels:[],connector:Array.isArray(analysis?.connector)?analysis.connector:[]};
  const setAnnotations=(next,{record=true}={})=>{const value=typeof next==='function'?next(historyRef.current.current||[]):next;if(record){historyRef.current.past.push(historyRef.current.current||[]);historyRef.current.future=[]}historyRef.current.current=value||[];onAnnotationsChange?.(value||[])};
  const undo=()=>{const h=historyRef.current;if(!h.past.length)return;h.future.push(h.current);h.current=h.past.pop();onAnnotationsChange?.(h.current)};
  const redo=()=>{const h=historyRef.current;if(!h.future.length)return;h.past.push(h.current);h.current=h.future.pop();onAnnotationsChange?.(h.current)};
  const cloneAnnotation=(a,dx=1,dy=-1)=>{const shift=([la,lo])=>{const c=toLngLat(dx,dy,Number(lo),Number(la));return [c[1],c[0]]};const out={...a,id:crypto.randomUUID?.()||String(Date.now()+Math.random())};if(Array.isArray(a.points))out.points=a.points.map(shift);if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lng))){const p=shift([a.lat,a.lng]);out.lat=p[0];out.lng=p[1]}return out};
  useEffect(()=>{historyRef.current.current=annotations||[]},[JSON.stringify(annotations||[])]);
  useEffect(()=>{
    if(!el.current||mapRef.current)return;
    try{
      const anchor=implantationAnchor(m),baseLat=anchor.valid?anchor.lat:m.gpsLat,baseLng=anchor.valid?anchor.lng:m.gpsLng,lat=num(m.implantation?.centerLat||baseLat),lng=num(m.implantation?.centerLng||baseLng);
      const map=L.map(el.current,{zoomControl:true,attributionControl:true,maxZoom:22,doubleClickZoom:false}).setView([Number.isFinite(lat)?lat:-20.89,Number.isFinite(lng)?lng:55.47],Number.isFinite(lat)?preferredZoom:10);
      // RC59 : retour aux panes Leaflet natifs. Les ouvrages utilisent markerPane,
      // sans couche spéciale ni empilement CSS forcé.
      const osm=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxNativeZoom:19,maxZoom:22,attribution:'© OpenStreetMap'}),ignPlan=L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',{maxNativeZoom:19,maxZoom:22,attribution:'© IGN Géoplateforme'}),ignOrtho=L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',{maxNativeZoom:19,maxZoom:22,attribution:'© IGN Orthophotographies'}),satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxNativeZoom:19,maxZoom:22,attribution:'Imagerie satellite © Esri'}),googleSatellite=L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{subdomains:['mt0','mt1','mt2','mt3'],maxNativeZoom:20,maxZoom:22,attribution:'© Google'}),googleHybrid=L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{subdomains:['mt0','mt1','mt2','mt3'],maxNativeZoom:20,maxZoom:22,attribution:'© Google'});
      baseLayersRef.current={ignPlan,ignOrtho,satellite,googleSatellite,googleHybrid,osm};
      const preferredBase=showCadastre?ignPlan:ignPlan;
      preferredBase.addTo(map);
      let baseFallbackUsed=false;
      const fallbackToOsm=()=>{if(baseFallbackUsed||map.hasLayer(osm))return;baseFallbackUsed=true;try{Object.values(baseLayersRef.current).forEach(layer=>{if(layer!==osm&&map.hasLayer(layer))map.removeLayer(layer)});osm.addTo(map)}catch{}};
      preferredBase.on('tileerror',fallbackToOsm);
      ignOrtho.on('tileerror',fallbackToOsm);
      satellite.on('tileerror',()=>{if(!map.hasLayer(ignOrtho)){map.addLayer(ignOrtho)}});googleSatellite.on('tileerror',()=>{if(!map.hasLayer(ignOrtho)){map.addLayer(ignOrtho)}});googleHybrid.on('tileerror',()=>{if(!map.hasLayer(ignPlan)){map.addLayer(ignPlan)}});
      const groups={landmarks:L.layerGroup().addTo(map),cadastre:L.layerGroup().addTo(map),networks:L.layerGroup().addTo(map),photos:L.layerGroup().addTo(map),implantation:L.layerGroup().addTo(map),annotations:L.layerGroup().addTo(map),measures:L.layerGroup().addTo(map)};groupsRef.current=groups;
      L.control.layers({'Plan IGN (Géoportail)':ignPlan,'Orthophoto IGN (Géoportail)':ignOrtho,'Google Satellite':googleSatellite,'Google Hybride':googleHybrid,'Satellite HD Esri':satellite,'OpenStreetMap':osm},{'Repères des ouvrages':groups.landmarks,'Parcelles cadastrales':groups.cadastre,'Réseaux existants / contraintes':groups.networks,'Implantation métier':groups.implantation,'Annotations et mesures':groups.annotations,'Photos géolocalisées':groups.photos},{position:'topright',collapsed:true}).addTo(map);
      const scale=L.control.scale({metric:true,imperial:false,position:'bottomleft',maxWidth:180}).addTo(map);
      const status=L.control({position:'bottomright'});status.onAdd=()=>{const d=L.DomUtil.create('div','secabMapStatus');d.innerHTML='<b>Échelle réelle</b><span>Coordonnées curseur</span>';map.on('zoomend',()=>{d.innerHTML=`<b>Zoom ${map.getZoom()} · dessin métrique</b><span>Déplacement optimisé</span>`});return d};status.addTo(map);
      if(clickToPlaceAnchor&&onMoveAnchor){map.on('click',e=>{if(e.originalEvent?.target?.closest?.('.leaflet-control'))return;onMoveAnchor(Number(e.latlng.lat.toFixed(7)),Number(e.latlng.lng.toFixed(7)))})}
      // RC62 : aucun magnétisme cartographique. Les clics et glissés conservent
      // exactement la position du curseur, y compris à proximité d'une limite cadastrale.
      const snapPoint=latlng=>latlng;
      const finishMode=()=>{drawStateRef.current={mode:'move',points:[]};map.getContainer().style.cursor='grab'};
      if(editable&&!schemaOnly){
        const toolbar=L.control({position:'topleft'});
        toolbar.onAdd=()=>{
          const box=L.DomUtil.create('div','leaflet-bar secabMapToolbar v72');
          box.innerHTML='<button data-mode=move title="Déplacer / sélectionner">✋</button><button data-mode=text title="Texte">T</button><button data-mode=line title="Distance">╱</button><button data-mode=polyline title="Polyligne">〽</button><button data-mode=area title="Surface / périmètre">⬠</button><button data-mode=rectangle title="Rectangle">▭</button><button data-mode=circle title="Cercle">◯</button><button data-mode=piquet title="Piquet de terre">⚑</button><button data-mode=cable title="Conducteur cuivre">⌁</button><button data-mode=trench title="Tranchée / TPC">▰</button><button data-mode=symbol title="Bibliothèque symboles EDF">⚡</button><button data-action=undo title="Annuler (Ctrl+Z)">↶</button><button data-action=redo title="Rétablir (Ctrl+Y)">↷</button><button data-action=copy title="Copier sélection">⧉</button><button data-action=paste title="Coller">▣</button><button data-action=clear title="Tout effacer">🗑</button><button data-action=fit title="Voir tout">⌂</button>';
          L.DomEvent.disableClickPropagation(box);
          box.querySelectorAll('button').forEach(btn=>{
            btn.type='button';
            L.DomEvent.on(btn,'click',ev=>{
              L.DomEvent.stop(ev);
              const mode=btn.dataset.mode,action=btn.dataset.action;
              if(mode){
                drawStateRef.current={mode,points:[]};
                box.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===btn));
                map.getContainer().style.cursor=mode==='move'?'grab':'crosshair';
                if(map.__secabDrawInfo)map.__secabDrawInfo.innerHTML=`<b>Outil actif : ${btn.title}</b><span>${['polyline','area'].includes(mode)?'Cliquez point par point puis double-cliquez pour terminer.':'Cliquez sur la carte pour placer le premier point.'}</span>`;
              }
              if(action==='undo')undo();
              if(action==='redo')redo();
              if(action==='copy'){
                const a=(historyRef.current.current||[]).find(x=>x.id===selectedRef.current);
                if(a)clipboardRef.current={...a};else alert('Sélectionnez d’abord un objet sur la carte.');
              }
              if(action==='paste'&&clipboardRef.current)setAnnotations([...(historyRef.current.current||[]),cloneAnnotation(clipboardRef.current)]);
              if(action==='clear'&&confirm('Effacer tous les objets et annotations ?'))setAnnotations([]);
              if(action==='fit'){
                const ls=[];Object.values(groupsRef.current).forEach(gr=>gr.eachLayer(x=>ls.push(x)));
                const fg=L.featureGroup(ls);try{map.fitBounds(fg.getBounds().pad(.2),{maxZoom:19})}catch{map.setView([lat,lng],17)}
              }
            });
          });
          return box;
        };
        toolbar.addTo(map);
        const drawInfo=L.control({position:'topleft'});drawInfo.onAdd=()=>{const d=L.DomUtil.create('div','secabDrawInfo');d.innerHTML='<b>COMMANDE : SÉLECTION</b><span>Raccourcis : L ligne · P polyligne · C cercle · M déplacer · T texte · Suppr · Échap</span>';map.__secabDrawInfo=d;return d};drawInfo.addTo(map);
        map.on('dblclick',e=>{const st=drawStateRef.current;if(['polyline','area'].includes(st.mode)&&st.points.length>1){L.DomEvent.stop(e);const type=st.mode==='area'?'area':'polyline';setAnnotations([...(historyRef.current.current||[]),{id:crypto.randomUUID?.()||String(Date.now()),type,points:[...st.points]}]);finishMode()}});
        map.on('click',e=>{const st=drawStateRef.current;if(st.mode==='move')return;const p=snapPoint(e.latlng);if(map.__secabDrawInfo)map.__secabDrawInfo.innerHTML=`<b>Outil actif : ${st.mode}</b><span>Point ${st.points.length+1} enregistré.</span>`;if(st.mode==='text'){const text=prompt('Texte à placer :','');if(text)setAnnotations([...(historyRef.current.current||[]),{id:crypto.randomUUID?.()||String(Date.now()),type:'text',lat:p.lat,lng:p.lng,text}]);finishMode();return}if(st.mode==='piquet'){const label=prompt('Repère du piquet :',`P${(historyRef.current.current||[]).filter(x=>x.type==='piquet').length+1}`)||'Piquet',depth=Number(prompt('Longueur du piquet (m) :','3')||3);setAnnotations([...(historyRef.current.current||[]),{id:crypto.randomUUID?.()||String(Date.now()),type:'piquet',lat:p.lat,lng:p.lng,label,depth,diameterMm:16,material:'Cuivre'}]);finishMode();return}if(st.mode==='symbol'){const type=prompt('Symbole EDF : POSTE, SUPPORT, EMERGENCE, TPC, COFFRET, PIQUET','POSTE');if(type)setAnnotations([...(historyRef.current.current||[]),{id:crypto.randomUUID?.()||String(Date.now()),type:'symbol',symbol:String(type).toUpperCase(),lat:p.lat,lng:p.lng,label:String(type).toUpperCase()}]);finishMode();return}if(['polyline','area'].includes(st.mode)){st.points.push([p.lat,p.lng]);return}if(['line','rectangle','circle','cable','trench'].includes(st.mode)){st.points.push([p.lat,p.lng]);if(st.points.length===2){const payload={id:crypto.randomUUID?.()||String(Date.now()),type:st.mode,points:[...st.points]};if(st.mode==='cable'){payload.sectionMm2=Number(prompt('Section cuivre (mm²) :','25')||25);payload.label='Conducteur cuivre'}if(st.mode==='trench'){payload.widthM=Number(prompt('Largeur (m) :','0.40')||.4);payload.depthM=Number(prompt('Profondeur (m) :','0.70')||.7);payload.label='Tranchée / TPC'}if(st.mode==='circle')payload.radius=map.distance(L.latLng(st.points[0]),L.latLng(st.points[1]));setAnnotations([...(historyRef.current.current||[]),payload]);finishMode()}}});
        const key=e=>{const k=e.key.toLowerCase();if(e.key==='Escape'){drawStateRef.current={mode:'move',points:[]};map.getContainer().style.cursor='grab';if(map.__secabDrawInfo)map.__secabDrawInfo.innerHTML='<b>Commande annulée</b><span>Mode sélection actif.</span>';return}if((e.key==='Delete'||e.key==='Backspace')&&selectedRef.current){e.preventDefault();setAnnotations((historyRef.current.current||[]).filter(x=>x.id!==selectedRef.current));selectedRef.current='';onSelectionChange?.('');return}if(!(e.ctrlKey||e.metaKey)&&!e.altKey&&['l','p','c','m','t'].includes(k)){const modes={l:'line',p:'polyline',c:'circle',m:'move',t:'text'};drawStateRef.current={mode:modes[k],points:[]};map.getContainer().style.cursor=modes[k]==='move'?'grab':'crosshair';if(map.__secabDrawInfo)map.__secabDrawInfo.innerHTML=`<b>COMMANDE ${k.toUpperCase()}</b><span>${modes[k]==='polyline'?'Cliquez les sommets puis double-cliquez.':'Cliquez sur le plan.'} · Échap pour annuler</span>`;return}if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo()}if((e.ctrlKey||e.metaKey)&&k==='c'){const a=(historyRef.current.current||[]).find(x=>x.id===selectedRef.current);if(a)clipboardRef.current={...a}}if((e.ctrlKey||e.metaKey)&&k==='v'&&clipboardRef.current){e.preventDefault();setAnnotations([...(historyRef.current.current||[]),cloneAnnotation(clipboardRef.current)])}};window.addEventListener('keydown',key);map.__secabKey=key;
      }
      mapRef.current=map;setTimeout(()=>map.invalidateSize(),50);
      return()=>{if(map.__secabKey)window.removeEventListener('keydown',map.__secabKey);try{map.remove()}catch{};mapRef.current=null}
    }catch(e){console.error(e);setMapError(e?.message||'Carte indisponible')}
  },[]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const anchor=implantationAnchor(m),baseLat=anchor.valid?anchor.lat:m.gpsLat,baseLng=anchor.valid?anchor.lng:m.gpsLng;
    const lat=num(m.implantation?.centerLat||baseLat),lng=num(m.implantation?.centerLng||baseLng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    // RC64 : le recentrage est uniquement déclenché à la demande (capture GPS, bouton
    // de recentrage ou rechargement de carte). Une modification de coordonnées issue
    // d'un glisser-déposer ne doit jamais déplacer la carte ni donner un effet d'aimantation.
    const id=setTimeout(()=>{
      try{
        map.invalidateSize({pan:false});
        const targetZoom=Math.max(Number(map.getZoom()||0),Number(preferredZoom||18));
        map.setView([lat,lng],targetZoom,{animate:false});
      }catch{}
    },60);
    return()=>clearTimeout(id);
  },[focusNonce,preferredZoom]);
  useEffect(()=>{
    const map=mapRef.current,g=groupsRef.current;if(!map||!g.cadastre)return;try{setMapError('');Object.values(g).forEach(x=>x.clearLayers());
      const anchor=implantationAnchor(m),baseLat=anchor.valid?anchor.lat:m.gpsLat,baseLng=anchor.valid?anchor.lng:m.gpsLng,lat=num(m.implantation?.centerLat||baseLat),lng=num(m.implantation?.centerLng||baseLng);
      // RC59 : un seul rendu des ouvrages est effectué ici après chaque rafraîchissement.
      // Aucun marqueur n'est créé au montage initial, ce qui supprime les doublons.
      const overviewIcon=(label,kind)=>L.divIcon({className:`secabOverviewMarker ${kind}`,html:`<div class="overviewDot"></div><div class="overviewLabel">${htmlEsc(label)}</div>`,iconSize:[210,34],iconAnchor:[8,8]});
      const explicitPostLat=num(m.postGpsLat),explicitPostLng=num(m.postGpsLng),postLat=Number.isFinite(explicitPostLat)?explicitPostLat:num(m.gpsLat),postLng=Number.isFinite(explicitPostLng)?explicitPostLng:num(m.gpsLng),neutralLat=num(m.neutralGpsLat),neutralLng=num(m.neutralGpsLng);
      if(Number.isFinite(postLat)&&Number.isFinite(postLng))L.marker([postLat,postLng],{pane:'markerPane',interactive:false,zIndexOffset:200,icon:overviewIcon('POSTE HTA/BT','post')}).addTo(g.landmarks);
      if(Number.isFinite(neutralLat)&&Number.isFinite(neutralLng))L.marker([neutralLat,neutralLng],{pane:'markerPane',interactive:false,zIndexOffset:220,icon:overviewIcon(m.neutralTargetLabel||'2ᵉ OUVRAGE NEUTRE','neutral')}).addTo(g.landmarks);
      if(Number.isFinite(postLat)&&Number.isFinite(postLng)&&Number.isFinite(neutralLat)&&Number.isFinite(neutralLng)&&distanceMeters(postLng,postLat,neutralLng,neutralLat)>.1)L.polyline([[postLat,postLng],[neutralLat,neutralLng]],{pane:'overlayPane',color:'#2563eb',weight:3,dashArray:'8 7',opacity:.8,interactive:false}).addTo(g.landmarks);
      {const markerLat=Number.isFinite(Number(baseLat))?Number(baseLat):Number(lat),markerLng=Number.isFinite(Number(baseLng))?Number(baseLng):Number(lng);if(Number.isFinite(markerLat)&&Number.isFinite(markerLng)){const anchorMovable=Boolean((anchorDraggable||(editable&&schemaOnly))&&m.implantation?.anchorLocked!==true);const gpsText=anchor.manuallyAdjusted?'Position corrigée manuellement':Number.isFinite(Number(anchor.accuracy))?`GPS · précision ${Math.round(Number(anchor.accuracy))} m`:'Position GPS';const transformerSvg='<svg viewBox="0 0 64 58" aria-hidden="true"><path d="M32 3 61 54H3Z" fill="#ffd400" stroke="#111827" stroke-width="4"/><path d="M34 12 24 32h9l-4 14 14-22h-9l5-12Z" fill="#111827"/></svg>';const marker=L.marker([markerLat,markerLng],{pane:'markerPane',draggable:anchorMovable,autoPan:false,riseOnHover:true,keyboard:false,title:anchorMovable?'Déplacer précisément le poste transformateur':'Poste transformateur verrouillé',zIndexOffset:300,icon:L.divIcon({className:`secabTransformerMarker ${anchorMovable?'movable':'locked'}`,html:`<div class="secabMarkerHitArea" aria-hidden="true"></div><div class="secabElectricalSymbol">${transformerSvg}</div><div class="secabMapMarkerLabel"><b>${anchor.type==='neutral'?'2ᵉ OUVRAGE':'POSTE TRANSFO'}</b><span>${gpsText}</span></div>`,iconSize:[230,72],iconAnchor:[26,26],popupAnchor:[0,-34]})}).addTo(g.landmarks);marker.bindPopup(`<div class="secabAnchorPopup"><b>${htmlEsc(anchor.label)}</b><span>${anchorMovable?'Glissez le symbole électrique pour placer exactement l’ouvrage. La position GPS d’origine reste conservée.':'Position verrouillée.'}</span></div>`);marker.bindTooltip(`${htmlEsc(anchor.label)} · ${htmlEsc(gpsText)}`,{direction:'top',offset:[0,-30]});if(anchorMovable){
        // RC55 : le glisser-déposer natif Leaflet est conservé comme voie principale.
        // Il fonctionne même si les événements pointer personnalisés sont filtrés par Electron.
        marker.on('dragstart',()=>{try{map.dragging.disable();marker.setZIndexOffset(1000)}catch{}});
        marker.on('dragend',e=>{try{map.dragging.enable();marker.setZIndexOffset(300)}catch{}const p=e.target.getLatLng();if(onMoveAnchor)onMoveAnchor(Number(p.lat.toFixed(7)),Number(p.lng.toFixed(7)));else onMoveCenter?.(Number(p.lat.toFixed(7)),Number(p.lng.toFixed(7)))});
      }}}

      if(showCadastre&&(m.cadastre?.features||[]).length){
        L.geoJSON(m.cadastre,{style:{color:'#a855f7',weight:2.2,fillColor:'#7c3aed',fillOpacity:.10},onEachFeature:(f,l)=>{
          const i=(m.cadastre?.features||[]).indexOf(f),info=parcelInfo(f,Math.max(0,i)),id=info.id;
          const stored=m.parcelStatus?.[id];
          const statut=typeof stored==='object'?(stored.status||stored.type||'Non renseigné'):(stored||'Non renseigné');
          const proprietaire=typeof stored==='object'?(stored.owner||stored.proprietaire||'Non renseigné'):(statut==='Privé'?'Propriétaire privé à identifier':statut==='Commune'?(info.commune||m.commune||'Commune'):(statut==='Département'?'Département de La Réunion':statut==='État'?'État / domaine public':statut==='EDF / Enedis'?'EDF / Enedis':'Non publié par le cadastre'));
          const rule=landRule(statut);
          l.bindTooltip(id,{sticky:true});
          l.bindPopup(`<div class="secabParcelPopup"><h3>Parcelle ${htmlEsc(id)}</h3><p><b>Commune</b><span>${htmlEsc(info.commune||m.commune||'—')}</span></p><p><b>Surface cadastrale</b><span>${htmlEsc(info.surface?`${info.surface} m²`:'Non publiée')}</span></p><p><b>Propriétaire / gestionnaire</b><span>${htmlEsc(proprietaire)}</span></p><p><b>Statut renseigné</b><span>${htmlEsc(statut)}</span></p><p><b>Convention</b><span class="${rule.need==='OUI'?'parcelConventionYes':rule.need==='NON*'?'parcelConventionNo':'parcelConventionCheck'}">${htmlEsc(rule.need)}</span></p><small>${htmlEsc(rule.label)}</small></div>`,{maxWidth:340});
          l.on('click',()=>onParcelSelect?.({id,info,stored:typeof stored==='object'?stored:{status:statut,owner:proprietaire},rule}));
        }}).addTo(g.cadastre);
        (m.cadastre.features||[]).forEach((f,i)=>{
          const info=parcelInfo(f,i),id=info.id,stored=m.parcelStatus?.[id],statut=typeof stored==='object'?(stored.status||'Non renseigné'):(stored||'Non renseigné'),rule=landRule(statut);
          let center=featureCentroid(f);
          // Le centre des limites Leaflet est plus stable visuellement pour les parcelles
          // longues ou concaves que la moyenne brute de tous les sommets.
          try{const probe=L.geoJSON(f);const b=probe.getBounds();if(b?.isValid?.()){const c=b.getCenter();center=[c.lng,c.lat]}}catch{}
          if(!center||!Number.isFinite(center[0])||!Number.isFinite(center[1]))return;
          const label=L.marker([center[1],center[0]],{interactive:true,riseOnHover:true,zIndexOffset:900,icon:L.divIcon({className:'secabParcelLabel clickable',iconSize:[58,30],iconAnchor:[29,15],html:`<button type="button" aria-label="Sélectionner la parcelle ${htmlEsc(id)}"><span>${htmlEsc(id)}</span></button>`})}).addTo(g.cadastre);
          label.on('click',e=>{L.DomEvent.stopPropagation(e);onParcelSelect?.({id,info,stored:typeof stored==='object'?stored:{status:statut},rule});try{label.openTooltip()}catch{}});
          label.bindTooltip(`Sélectionner la parcelle ${id}`,{direction:'top'});
        });
      }
      if(showArcgis&&(m.arcgisData?.features||[]).length)L.geoJSON({type:'FeatureCollection',features:m.arcgisData.features},{style:{color:'#7c3aed',weight:3,fillOpacity:.08},pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,color:'#7c3aed'}),onEachFeature:(f,l)=>l.bindPopup(htmlEsc(f.properties?.__secabLayer||'Réseau existant'))}).addTo(g.networks);
      if((m.contraintes?.features||[]).length)L.geoJSON(m.contraintes,{style:{color:'#dc2626',weight:2,dashArray:'6 5',fillOpacity:.08}}).addTo(g.networks);
      safeAnalysis.connector.slice(0,1).forEach(line=>{const pts=line.map(([lo,la])=>[la,lo]);if(pts.length<2)return;L.polyline(pts,{color:'#ffffff',weight:11,opacity:.96,interactive:false,lineCap:'round'}).addTo(g.implantation);const layer=L.polyline(pts,{color:'#ff9f0a',weight:6,opacity:1,interactive:false,lineCap:'round',dashArray:'18 9'}).addTo(g.implantation);const length=pts.slice(1).reduce((sum,p,i)=>sum+map.distance(L.latLng(pts[i]),L.latLng(p)),0);layer.bindTooltip(`Liaison ouvrage – prise de terre · ${length.toFixed(2)} m`,{permanent:true,direction:'center',className:'secabConnectorLength'});if(onMoveConnection){const cm=L.marker(pts[0],{draggable:true,autoPan:false,zIndexOffset:1600,icon:L.divIcon({className:'secabConnectionHandle',html:'<b>●</b><span>Raccordement</span>',iconSize:[120,34],iconAnchor:[10,10]})}).addTo(g.implantation);cm.bindTooltip('Glissez pour choisir librement le point de raccordement',{direction:'top'});cm.on('dragstart',()=>map.dragging.disable());cm.on('dragend',e=>{map.dragging.enable();const p=e.target.getLatLng();onMoveConnection(Number(p.lat.toFixed(7)),Number(p.lng.toFixed(7)))})}else L.circleMarker(pts[0],{radius:7,color:'#fff',weight:3,fillColor:'#ff9f0a',fillOpacity:1,interactive:false}).addTo(g.implantation);L.circleMarker(pts[pts.length-1],{radius:7,color:'#fff',weight:3,fillColor:'#e52b2b',fillOpacity:1,interactive:false}).addTo(g.implantation);});
      safeAnalysis.lines.forEach((line,idx)=>{const pts=line.map(([lo,la])=>[la,lo]);const layer=L.polyline(pts,{color:'#ef2f2f',weight:6,opacity:.98,interactive:false}).addTo(g.implantation);const length=pts.slice(1).reduce((sum,p,i)=>sum+map.distance(L.latLng(pts[i]),L.latLng(p)),0);layer.bindTooltip(`${length.toFixed(2)} m`,{permanent:true,direction:'center',className:'secabGroundLength'});});
      if(safeAnalysis.lines.length){const flat=safeAnalysis.lines.flat();const center=flat.reduce((a,c)=>[a[0]+c[0]/flat.length,a[1]+c[1]/flat.length],[0,0]);const labelPos=toLngLat(9,6,center[0],center[1]);const earthSvg='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 61 58H3Z" fill="#ffd400" stroke="#111827" stroke-width="4"/><path d="M32 18v15M20 33h24M24 40h16M28 47h8" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round"/></svg>';L.polyline([[center[1],center[0]],[labelPos[1],labelPos[0]]],{color:'#15803d',weight:2,dashArray:'5 5',opacity:.9,interactive:false}).addTo(g.implantation);L.marker([labelPos[1],labelPos[0]],{interactive:false,zIndexOffset:1450,icon:L.divIcon({className:'secabEarthSideMarker',html:`<div class="secabEarthSymbol">${earthSvg}</div><div class="secabMapMarkerLabel"><b>PRISE DE TERRE À CRÉER</b><span>Le tracé rouge représente l’ouvrage réel</span></div>`})}).addTo(g.implantation);if(editable){const moveHandle=L.marker([center[1],center[0]],{draggable:true,autoPan:false,riseOnHover:true,keyboard:false,zIndexOffset:1200,icon:L.divIcon({className:'secabGroundMoveHandle',html:'<b>✥</b><span>Déplacer précisément</span>'})}).addTo(g.implantation);let groundTip=null;moveHandle.on('dragstart',()=>{map.dragging.disable();moveHandle.setZIndexOffset(2500);groundTip=L.tooltip({permanent:true,direction:'top',offset:[0,-38],className:'secabPrecisionDragTip'}).setLatLng(moveHandle.getLatLng()).setContent('Déplacement du schéma…').addTo(map)});moveHandle.on('drag',e=>{const p=e.target.getLatLng();const d=map.distance(L.latLng(center[1],center[0]),p);groundTip?.setLatLng(p).setContent(`<b>Déplacement ${d.toFixed(2)} m</b><span>${p.lat.toFixed(7)} / ${p.lng.toFixed(7)}</span>`)});moveHandle.on('dragend',e=>{map.dragging.enable();moveHandle.setZIndexOffset(1200);if(groundTip){map.removeLayer(groundTip);groundTip=null}const p=e.target.getLatLng();onMoveCenter?.(Number(p.lat.toFixed(7)),Number(p.lng.toFixed(7)))})}}
      const remove=a=>{if(confirm('Supprimer cet objet ?'))setAnnotations((historyRef.current.current||[]).filter(x=>x.id!==a.id))};
      const select=(layer,a)=>{layer.on('click',e=>{L.DomEvent.stopPropagation(e);selectedRef.current=a.id;onSelectionChange?.(a.id);document.querySelectorAll('.secab-selected-object').forEach(x=>x.classList.remove('secab-selected-object'));layer.getElement?.()?.classList.add('secab-selected-object')});layer.on('contextmenu',()=>remove(a))};
      if(!schemaOnly)(annotations||[]).filter(a=>!(a.type==='symbol'&&String(a.symbol||'').toUpperCase()==='REGARD')).forEach(a=>{let layer=null,target=['piquet','symbol','cable','trench'].includes(a.type)?g.implantation:g.annotations;if(a.type==='text'&&Number.isFinite(Number(a.lat))){layer=L.marker([a.lat,a.lng],{draggable:true,icon:L.divIcon({className:'secabTextMarker',html:`<span>${htmlEsc(a.text||'Texte')}</span>`})}).addTo(target);layer.on('dragend',e=>{const p=e.target.getLatLng();setAnnotations((historyRef.current.current||[]).map(x=>x.id===a.id?{...x,lat:p.lat,lng:p.lng}:x))})}else if(a.type==='piquet'){layer=L.marker([a.lat,a.lng],{draggable:true,icon:L.divIcon({className:'secabPiquetMarker',html:`<b>⚑</b><span>${htmlEsc(a.label||'P')}</span>`})}).addTo(target);layer.on('dragend',e=>{const p=e.target.getLatLng();setAnnotations((historyRef.current.current||[]).map(x=>x.id===a.id?{...x,lat:p.lat,lng:p.lng}:x))})}else if(a.type==='symbol'){const icons={POSTE:'▣',SUPPORT:'│',EMERGENCE:'◆',TPC:'═',COFFRET:'▤',PIQUET:'⚑'};layer=L.marker([a.lat,a.lng],{draggable:true,icon:L.divIcon({className:'secabEdfSymbol',html:`<b>${icons[a.symbol]||'⚡'}</b><span>${htmlEsc(a.label||a.symbol)}</span>`})}).addTo(target);layer.on('dragend',e=>{const p=e.target.getLatLng();setAnnotations((historyRef.current.current||[]).map(x=>x.id===a.id?{...x,lat:p.lat,lng:p.lng}:x))})}else if(Array.isArray(a.points)&&a.points.length>1){if(a.type==='area'){layer=L.polygon(a.points,{color:'#0f766e',weight:3,fillOpacity:.18}).addTo(target);const area=Math.abs(a.points.reduce((sum,p,i)=>{const q=a.points[(i+1)%a.points.length];return sum+(p[1]*q[0]-q[1]*p[0])},0))*12321000000/2,per=a.points.reduce((sum,p,i)=>sum+map.distance(L.latLng(p),L.latLng(a.points[(i+1)%a.points.length])),0);layer.bindTooltip(`Surface ${area.toFixed(1)} m² · périmètre ${per.toFixed(1)} m`,{permanent:true,className:'secabMeasureTip'})}else if(a.type==='rectangle'){layer=L.rectangle(L.latLngBounds(a.points),{color:'#0f172a',weight:3,fillOpacity:.08}).addTo(target)}else if(a.type==='circle'){layer=L.circle(a.points[0],{radius:Number(a.radius||0),color:'#0f172a',weight:3,fillOpacity:.08}).addTo(target)}else{const isCable=a.type==='cable',isTrench=a.type==='trench';layer=L.polyline(a.points,{color:isCable?'#b45309':isTrench?'#7c2d12':'#0f172a',weight:isTrench?10:isCable?6:4,dashArray:a.type==='line'?'8 6':isTrench?'14 8':null}).addTo(target);const length=a.points.slice(1).reduce((sum,p,i)=>sum+map.distance(L.latLng(a.points[i]),L.latLng(p)),0);layer.bindTooltip(isCable?`Cuivre ${a.sectionMm2||25} mm² · ${length.toFixed(1)} m`:isTrench?`Tranchée ${a.widthM||.4} × ${a.depthM||.7} m · ${length.toFixed(1)} m`:`${length.toFixed(1)} m`,{permanent:['cable','trench'].includes(a.type),className:'secabMeasureTip'})}}
        if(editable&&Array.isArray(a.points)&&a.points.length>1){a.points.forEach((pt,vertexIndex)=>{const vh=L.circleMarker(pt,{radius:6,color:'#fff',weight:2,fillColor:'#2563eb',fillOpacity:1,pane:'markerPane'}).addTo(target);vh.bindTooltip(`Sommet ${vertexIndex+1} — glisser pour modifier`,{direction:'top'});vh.on('mousedown',ev=>{L.DomEvent.stopPropagation(ev);map.dragging.disable();const move=me=>vh.setLatLng(me.latlng);const up=ue=>{map.off('mousemove',move);map.off('mouseup',up);map.dragging.enable();const np=vh.getLatLng();setAnnotations((historyRef.current.current||[]).map(x=>x.id===a.id?{...x,points:x.points.map((q,j)=>j===vertexIndex?[np.lat,np.lng]:q)}:x))};map.on('mousemove',move);map.on('mouseup',up)});});const center=a.points.reduce((acc,p)=>[acc[0]+Number(p[0])/a.points.length,acc[1]+Number(p[1])/a.points.length],[0,0]);const mh=L.marker(center,{draggable:true,zIndexOffset:1200,icon:L.divIcon({className:'secabObjectMoveHandle',html:'<b>✥</b><span>Déplacer</span>'})}).addTo(target);mh.on('dragstart',()=>map.dragging.disable());mh.on('dragend',e=>{map.dragging.enable();const dest=e.target.getLatLng(),dLat=dest.lat-center[0],dLng=dest.lng-center[1];setAnnotations((historyRef.current.current||[]).map(x=>x.id===a.id?{...x,points:x.points.map(q=>[Number(q[0])+dLat,Number(q[1])+dLng])}:x))});}
        if(layer)select(layer,a)});
      setTimeout(()=>map.invalidateSize(true),60);setTimeout(()=>map.invalidateSize(true),350)
    }catch(e){console.error(e);setMapError(e?.message||'Erreur cartographique')}
  },[showCadastre,showArcgis,m.cadastre,m.contraintes,m.arcgisData,m.gpsLat,m.gpsLng,m.postGpsLat,m.postGpsLng,m.neutralGpsLat,m.neutralGpsLng,m.neutralTargetLabel,m.improvementTarget,m.solutionRetenue,m.solutionRetenueId,m.selectedSolutionId,m.diagnosticSolution,m.implantation?.selectedSolution,m.implantation?.solutionSnapshot?.id,m.implantation?.solutionSnapshot?.target,m.implantation?.orientation,m.implantation?.offsetX,m.implantation?.offsetY,m.implantation?.centerLat,m.implantation?.centerLng,m.implantation?.connectionMode,m.implantation?.connectionLat,m.implantation?.connectionLng,JSON.stringify(safeAnalysis.lines),JSON.stringify(safeAnalysis.connector),JSON.stringify(annotations)]);
  return <div className="liveMapShell">{mapError&&<div className="mapInlineError"><b>Carte temporairement indisponible</b><span>{mapError}</span></div>}<div className="liveMap" ref={el}/></div>;
}




function localPolylineLength(lines){return (lines||[]).reduce((sum,line)=>sum+(line||[]).slice(1).reduce((acc,p,i)=>acc+Math.hypot(Number(p[0])-Number(line[i][0]),Number(p[1])-Number(line[i][1])),0),0)}
function defaultSmartDesign(m,sol){
  const id=sol?.id||retainedSolutionId(m)||'piquet3', native=solutionShape(id,0,1,0,0), nativeLength=Math.max(.1,localPolylineLength(native));
  const inferredLength=Math.max(1,Number(sol?.length||nativeLength||10));
  return {lengthM:inferredLength,depthM:.8,piquetDepthM:2,piquets:id.includes('piquet')||id.includes('vertical')?3:id==='patte'?3:0,spacingM:3,conductorSectionMm2:25,regard:true,connection:'Cuivre nu raccordé à la borne principale de terre',profileNote:'Pose en fond de fouille, remblai compacté et grillage avertisseur selon prescription.',updatedAt:''};
}
function smartDesignFor(m,sol){return {...defaultSmartDesign(m,sol),...(m?.implantation?.smartDesign||{})}}
function technicalSchemaData(m,sol){
  const d=smartDesignFor(m,sol), imp=m?.implantation||{}, angle=Number(imp.orientation||0), scale=Math.max(.25,Math.min(3,Number(imp.scale||1))), offsetX=Number(imp.offsetX||0), offsetY=Number(imp.offsetY||0);
  let lines=solutionShape(sol?.id||retainedSolutionId(m),angle,scale,offsetX,offsetY).map(line=>line.map(([x,y])=>[imp.mirrorX?(2*offsetX-x):x,imp.mirrorY?(2*offsetY-y):y]));
  const anchor=implantationAnchor(m), connection=connectionAnchor(m);
  let connectionLocal=null;
  if(anchor.valid&&connection.valid){
    const lat0=anchor.lat*Math.PI/180, dx=(connection.lng-anchor.lng)*111320*Math.cos(lat0), dy=(connection.lat-anchor.lat)*111320;
    connectionLocal=[[dx,dy],[offsetX,offsetY]];
  }
  const pts=[...lines.flat(),...(connectionLocal||[])];const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  const minX=Math.min(...xs,-1),maxX=Math.max(...xs,1),minY=Math.min(...ys,-1),maxY=Math.max(...ys,1);
  const issues=[];
  if(Number(d.depthM)<.6)issues.push('Profondeur d’enfouissement inférieure à 0,60 m.');
  if(Number(d.piquets)>1&&Number(d.spacingM)<2)issues.push('Espacement entre piquets inférieur à 2 m.');
  if(localPolylineLength(lines)<=0)issues.push('Longueur de conducteur non valide.');
  if(!connection.valid)issues.push('Point de raccordement à l’ouvrage non renseigné.');
  return {d,lines,connectionLocal,connection,anchor,bounds:{minX,maxX,minY,maxY},actualLengthM:localPolylineLength(lines),issues,angle,scale,offsetX,offsetY};
}
function TechnicalSchema({m,sol,onChange,editable=true,compact=false}){
  if(!sol)return <div className="technicalSchemaEmpty">Aucun schéma technique à générer.</div>;
  const data=technicalSchemaData(m,sol),d=data.d,{minX,maxX,minY,maxY}=data.bounds;
  const w=Math.max(4,maxX-minX),h=Math.max(3,maxY-minY),pad=2.2,vb=`${minX-pad} ${minY-pad} ${w+pad*2} ${h+pad*2}`;
  const set=patch=>onChange?.({...d,...patch,actualLengthM:data.actualLengthM,updatedAt:new Date().toISOString()});
  const svgId=`technical-schema-${String(m.id||'report').replace(/[^a-z0-9]/gi,'')}`;
  const exportSvg=()=>{const el=document.getElementById(svgId);if(!el)return;download(`${safe(m.rapport||m.affaire||'SECAB')}_schema_execution.svg`,new XMLSerializer().serializeToString(el),'image/svg+xml;charset=utf-8')};
  const sx=minX, ex=maxX, dimY=maxY+1.15;
  return <div className={`technicalSchema ${compact?'compact':''}`}>
    <div className="technicalSchemaHead"><div><small>SCHÉMA VECTORIEL D’EXÉCUTION</small><h3>{sol.title}</h3><p>Vue en plan et profil générées depuis les paramètres réels de l’affaire.</p></div>{editable&&<button className="secondaryAction" onClick={exportSvg}>Exporter SVG</button>}</div>
    <div className="technicalSchemaViews">
      <figure className="technicalPlan"><svg id={svgId} viewBox={vb} role="img" aria-label={`Schéma en plan ${sol.title}`}>
        <defs><marker id="arrowDim" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z"/></marker><pattern id="metricGrid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1"/></pattern></defs>
        <rect x={minX-pad} y={minY-pad} width={w+pad*2} height={h+pad*2} className="schemaGrid"/>
        {data.connectionLocal&&<><line x1={data.connectionLocal[0][0]} y1={data.connectionLocal[0][1]} x2={data.connectionLocal[1][0]} y2={data.connectionLocal[1][1]} className="schemaConnection"/><circle cx={data.connectionLocal[0][0]} cy={data.connectionLocal[0][1]} r=".34" className="schemaOuvrage"/><circle cx={data.connectionLocal[1][0]} cy={data.connectionLocal[1][1]} r=".22" className="schemaRegard"/><text x={data.connectionLocal[0][0]} y={data.connectionLocal[0][1]-.5} textAnchor="middle" className="schemaLabel">{data.connection?.label||'OUVRAGE'}</text><text x={(data.connectionLocal[0][0]+data.connectionLocal[1][0])/2} y={(data.connectionLocal[0][1]+data.connectionLocal[1][1])/2-.28} textAnchor="middle" className="schemaDimensionText">Liaison {Math.hypot(data.connectionLocal[1][0]-data.connectionLocal[0][0],data.connectionLocal[1][1]-data.connectionLocal[0][1]).toFixed(1)} m</text></>}
        {data.lines.map((line,i)=><polyline key={i} points={line.map(p=>p.join(',')).join(' ')} className="schemaConductor"/>)}
        {Array.from({length:Math.max(0,Number(d.piquets||0))}).map((_,i)=>{const t=(i+1)/(Number(d.piquets)+1),x=minX+(maxX-minX)*t,y=minY+(maxY-minY)*(.5+.28*Math.sin(i*2.1));return <g key={i}><circle cx={x} cy={y} r=".18" className="schemaStake"/><line x1={x} y1={y-.35} x2={x} y2={y+.35} className="schemaStakeLine"/></g>})}
        {d.regard&&<g><rect x={minX-.15} y={(minY+maxY)/2-.28} width=".56" height=".56" rx=".08" className="schemaRegard"/><text x={minX+.55} y={(minY+maxY)/2+.1} className="schemaLabel">Regard</text></g>}
        <line x1={sx} y1={dimY} x2={ex} y2={dimY} className="schemaDimension" markerStart="url(#arrowDim)" markerEnd="url(#arrowDim)"/><text x={(sx+ex)/2} y={dimY-.18} textAnchor="middle" className="schemaDimensionText">{Number(d.lengthM).toFixed(1)} m de cuivre</text>
        <g transform={`translate(${maxX+.9} ${minY})`}><path d="M0 1 L0 -1 M0 -1 L-.25 -.45 M0 -1 L.25 -.45" className="schemaNorth"/><text x="0" y="-1.2" textAnchor="middle" className="schemaLabel">N</text></g>
      </svg><figcaption>Vue en plan cotée · Orientation réelle : {Number(data.angle||0).toFixed(1)}° · miroir H {m.implantation?.mirrorX?'oui':'non'} · miroir V {m.implantation?.mirrorY?'oui':'non'}</figcaption></figure>
      <figure className="technicalProfile"><svg viewBox="0 0 18 9" role="img" aria-label="Coupe de pose">
        <rect x="0" y="0" width="18" height="2.7" className="schemaSky"/><path d="M0 2.7 C4 2.5 7 2.9 11 2.7 S15 2.5 18 2.7 L18 9 L0 9 Z" className="schemaSoil"/><rect x="1" y={2.7+Number(d.depthM)-.18} width="16" height=".36" rx=".12" className="schemaSandBed"/><line x1="1" y1={2.7+Number(d.depthM)} x2="17" y2={2.7+Number(d.depthM)} className="schemaConductor"/><line x1="14" y1={2.7+Number(d.depthM)} x2="14" y2={Math.min(8.5,2.7+Number(d.depthM)+Number(d.piquetDepthM))} className="schemaStakeProfile"/><line x1="2" y1="2.7" x2="2" y2={2.7+Number(d.depthM)} className="schemaDimension" markerStart="url(#arrowDim)" markerEnd="url(#arrowDim)"/><line x1="1" y1={Math.max(3,2.7+Number(d.depthM)-.35)} x2="17" y2={Math.max(3,2.7+Number(d.depthM)-.35)} className="schemaWarningTape"/><text x="2.35" y={2.7+Number(d.depthM)/2} className="schemaDimensionText">{Number(d.depthM).toFixed(2)} m</text><text x="9" y="2.25" textAnchor="middle" className="schemaLabel">Terrain naturel</text><text x="9" y={2.35+Number(d.depthM)} textAnchor="middle" className="schemaDimensionText">Grillage avertisseur rouge</text><text x="9" y={2.95+Number(d.depthM)} textAnchor="middle" className="schemaDimensionText">Cuivre nu {Number(d.conductorSectionMm2)} mm² sur lit de sable</text><text x="14.35" y="7.6" className="schemaDimensionText">Piquet cuivre {Number(d.piquetDepthM).toFixed(1)} m</text>
      </svg><figcaption>Coupe de principe · profondeur et raccordement</figcaption></figure>
    </div>
    {editable&&<div className="technicalSchemaControls"><label>Cuivre total (m)<input type="number" min="1" step="1" value={d.lengthM} onChange={e=>set({lengthM:Math.max(1,Number(e.target.value||1))})}/></label><label>Profondeur (m)<input type="number" min=".3" step=".1" value={d.depthM} onChange={e=>set({depthM:Number(e.target.value||.8)})}/></label><label>Nombre de piquets<input type="number" min="0" step="1" value={d.piquets} onChange={e=>set({piquets:Math.max(0,Math.round(Number(e.target.value||0)))})}/></label><label>Profondeur piquet (m)<input type="number" min="1" step=".5" value={d.piquetDepthM} onChange={e=>set({piquetDepthM:Number(e.target.value||2)})}/></label><label>Espacement (m)<input type="number" min="1" step=".5" value={d.spacingM} onChange={e=>set({spacingM:Number(e.target.value||3)})}/></label><label>Section cuivre (mm²)<input type="number" min="16" step="1" value={d.conductorSectionMm2} onChange={e=>set({conductorSectionMm2:Number(e.target.value||25)})}/></label><label className="schemaCheck"><input type="checkbox" checked={Boolean(d.regard)} onChange={e=>set({regard:e.target.checked})}/> Regard de visite</label><label className="wide">Raccordement<input value={d.connection} onChange={e=>set({connection:e.target.value})}/></label><label className="wide">Note d’exécution<textarea rows="2" value={d.profileNote} onChange={e=>set({profileNote:e.target.value})}/></label></div>}
    <div className={`technicalSchemaValidation ${data.issues.length?'warning':'ok'}`}>{data.issues.length?<><b>⚠ Points à corriger avant validation</b>{data.issues.map(x=><span key={x}>{x}</span>)}</>:<><b>✓ Schéma techniquement cohérent</b><span>Longueur dessinée : {data.actualLengthM.toFixed(1)} m · {Number(d.piquets||0)} piquet(s) · profondeur {Number(d.depthM).toFixed(2)} m.</span></>}</div>
  </div>;
}

function Implantation({m,update,next,back}){
  const [mapReload,setMapReload]=useState(0);
  const [neutralGpsBusy,setNeutralGpsBusy]=useState(false);
  const [selectedParcel,setSelectedParcel]=useState(null);
  const c=compute(m), solutions=estimateSolutions(m), anchor=implantationAnchor(m);
  const recoveredSelection=retainedSolutionId(m)||m.implantation?.selectedSolution||m.implantation?.solutionSnapshot?.id||m.diagnostic?.solutionRetenue||'';
  const selected=recoveredSelection||(c.ok?'none':'');
  const noWork=selected==='none';
  const sol=retainedSolutionObject({...m,solutionRetenue:selected})||solutions.find(x=>x.id===selected)||ELECTRODES.find(x=>x.id===selected);
  const angle=Number(m.implantation?.orientation||0);
  const offsetX=Number(m.implantation?.offsetX||0), offsetY=Number(m.implantation?.offsetY||0);
  const mirrorX=Boolean(m.implantation?.mirrorX), mirrorY=Boolean(m.implantation?.mirrorY);
  const baseLat=anchor.valid?anchor.lat:num(m.gpsLat), baseLng=anchor.valid?anchor.lng:num(m.gpsLng);
  const centerLat=num(m.implantation?.centerLat||baseLat), centerLng=num(m.implantation?.centerLng||baseLng);

  useEffect(()=>{
    if(!selected)return;
    const imp=m.implantation||{};
    if(imp.selectedSolution!==selected||!Number.isFinite(num(imp.centerLat))||!Number.isFinite(num(imp.centerLng))){
      update(canonicalSolutionPatch(m,selected,{implantation:{orientation:Number(imp.orientation||0),offsetX:Number(imp.offsetX||0),offsetY:Number(imp.offsetY||0),mirrorX:Boolean(imp.mirrorX),mirrorY:Boolean(imp.mirrorY),placementConfirmed:Boolean(imp.placementConfirmed)}}))
    }
  },[selected,anchorKey(m)]);

  const effectiveAngle=((mirrorX?-angle:angle)+(mirrorY?180:0)+360)%360;
  const computedAnalysis=noWork?{lines:[],parcels:[],convention:'NON',ruleText:'Aucune intervention nouvelle.'}:sol?analyzeImplantation({...m,implantation:{...(m.implantation||{}),orientation:effectiveAngle}},sol,effectiveAngle):{lines:[],parcels:[],convention:'—',ruleText:'Aucune solution retenue.'};
  const savedGeometry=m.implantation?.geometrySnapshot;
  const analysis=(!noWork&&(!computedAnalysis.lines||!computedAnalysis.lines.length)&&Array.isArray(savedGeometry?.lines)&&savedGeometry.lines.length)?{...computedAnalysis,...savedGeometry,restored:true}:computedAnalysis;
  const patchImp=patch=>update({implantation:{...(m.implantation||{}),...patch,selectedSolution:selected}});
  const moveCenter=(lat,lng)=>{
    if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return;
    // RC62 : placement réellement libre. Aucun arrondi au mètre, aucune grille et
    // aucun accrochage aux routes, bâtiments, parcelles ou réseaux.
    const preciseLat=Number(lat), preciseLng=Number(lng);
    const rawDx=Number.isFinite(baseLng)?distanceMeters(baseLng,baseLat,preciseLng,baseLat)*(preciseLng>=baseLng?1:-1):0;
    const rawDy=Number.isFinite(baseLat)?distanceMeters(baseLng,baseLat,baseLng,preciseLat)*(preciseLat>=baseLat?1:-1):0;
    patchImp({centerLat:preciseLat.toFixed(8),centerLng:preciseLng.toFixed(8),offsetX:rawDx,offsetY:rawDy,placementConfirmed:false});
  };
  const moveAnchor=(lat,lng)=>{
    if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return;
    const preciseLat=String(Number(lat).toFixed(8)),preciseLng=String(Number(lng).toFixed(8));
    if(solutionTargetsNeutral(m)){
      // Le 2e ouvrage suit désormais exactement le même principe que le poste :
      // sa coordonnée affichée est réellement corrigée, tout en conservant le GPS d'origine.
      update({improvementTarget:'neutral',neutralGpsLat:preciseLat,neutralGpsLng:preciseLng,neutralGpsManual:true,implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:preciseLat,centerLng:preciseLng,offsetX:0,offsetY:0,placementConfirmed:false}});
      return;
    }
    update({gpsLat:preciseLat,gpsLng:preciseLng,gpsManuallyAdjusted:true,implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:preciseLat,centerLng:preciseLng,offsetX:0,offsetY:0,placementConfirmed:false}});
  };
  const moveConnection=(lat,lng)=>{if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return;patchImp({connectionMode:'manual',connectionLat:String(Number(lat).toFixed(7)),connectionLng:String(Number(lng).toFixed(7)),placementConfirmed:false})};
  const resetAnchorToGps=()=>{const gps=sourceGpsAnchor(m);if(!gps.valid)return alert('Aucune géolocalisation GPS source disponible.');const dx=Number(m.implantation?.offsetX||0),dy=Number(m.implantation?.offsetY||0),p=toLngLat(dx,dy,gps.lng,gps.lat);patchImp({manualAnchorLat:'',manualAnchorLng:'',centerLat:String(p[1]),centerLng:String(p[0]),placementConfirmed:false});};
  const recenter=()=>patchImp({centerLat:String(baseLat||''),centerLng:String(baseLng||''),offsetX:0,offsetY:0,placementConfirmed:false});
  const save=()=>{
    if(!anchor.valid)return alert('La position GPS de l’ouvrage doit être enregistrée avant de sauvegarder l’implantation.');
    if(!sol||noWork)return alert('Sélectionnez une solution dans Diagnostic & solutions.');
    if(!Number.isFinite(centerLat)||!Number.isFinite(centerLng))return alert('Déplacez le schéma sur une position valide de la carte.');
    update(canonicalSolutionPatch(m,selected,{improvementTarget:sol?.target||m.improvementTarget,implantation:{...(m.implantation||{}),centerLat:String(centerLat),centerLng:String(centerLng),selectedSolution:selected,solutionSnapshot:{...(m.implantation?.solutionSnapshot||{}),id:selected,title:sol.title||'',desc:sol.desc||'',target:sol.target||m.improvementTarget||'masses',length:sol.length||0,arms:sol.arms||0,svg:sol.svg||''},geometrySnapshot:{lines:analysis.lines||[],connector:analysis.connector||[],parcels:analysis.parcels||[],convention:analysis.convention||'—',ruleText:analysis.ruleText||'',savedAt:new Date().toISOString()},smartDesign:smartDesignFor(m,sol),placementConfirmed:true,savedAt:new Date().toISOString()}}));
    alert('Implantation enregistrée. Le rapport reprendra exactement cette position et cette orientation.');
  };
  const metres=(analysis.lines||[]).reduce((sum,line)=>sum+line.slice(1).reduce((a,p,i)=>a+distanceMeters(line[i][0],line[i][1],p[0],p[1]),0),0);
  const parcelRecord=selectedParcel?((m.parcelStatus||{})[selectedParcel.id]||{}):null;
  const saveParcel=(patch)=>{if(!selectedParcel)return;const current=typeof parcelRecord==='object'?parcelRecord:{status:String(parcelRecord||'Non renseigné')};update({parcelStatus:{...(m.parcelStatus||{}),[selectedParcel.id]:{...current,...patch,updatedAt:new Date().toISOString()}}});setSelectedParcel(x=>x?{...x,stored:{...current,...patch}}:x)};
  const selectedStatus=selectedParcel?(typeof parcelRecord==='object'?(parcelRecord.status||'Non renseigné'):(parcelRecord||'Non renseigné')):'Non renseigné';
  const selectedOwner=selectedParcel?(typeof parcelRecord==='object'?(parcelRecord.owner||parcelRecord.proprietaire||''):''):'';
  const selectedRule=landRule(selectedStatus);
  const captureNeutralHere=async()=>{setNeutralGpsBusy(true);try{const p=await getSecabPosition();const lat=Number(p.coords.latitude),lng=Number(p.coords.longitude);update({improvementTarget:'neutral',neutralGpsLat:lat.toFixed(7),neutralGpsLng:lng.toFixed(7),neutralGpsOriginalLat:lat.toFixed(7),neutralGpsOriginalLng:lng.toFixed(7),neutralGpsAccuracy:String(Math.round(p.coords.accuracy||0)),neutralGpsCapturedAt:new Date().toISOString(),neutralGpsManual:false,neutralMapFocusNonce:Date.now(),implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:lat.toFixed(7),centerLng:lng.toFixed(7),placementConfirmed:false}});setMapReload(x=>x+1)}catch(e){alert(`Géolocalisation du 2ᵉ ouvrage impossible : ${e.message}`)}finally{setNeutralGpsBusy(false)}};

  return <section className="implantationPhase2">
    <div className="card implantationHeaderCard"><div><small>POSITIONNEMENT DU SCHÉMA</small><h2>Implantation sur plan</h2><p>Positionnement libre : choisissez précisément l’emplacement et l’orientation de la prise de terre, puis enregistrez.</p><span className="freePlacementBadge">✥ Placement manuel libre</span></div><div className="implantationHeaderActions"><button className="secondaryAction" onClick={()=>setMapReload(x=>x+1)}>⟳ Réinitialiser la carte</button><button className="secondaryAction" onClick={recenter}>◎ Recentrer la terre sur l’ouvrage</button><button className="secondaryAction" onClick={resetAnchorToGps}>↺ Rétablir l’ouvrage au GPS</button><button onClick={save} disabled={noWork||!sol||!anchor.valid}>💾 Enregistrer</button></div></div>

    {solutionTargetsNeutral(m)&&<div className="card neutralDirectLocationCard"><div><small>TERRE DU NEUTRE</small><h3>Géolocaliser et affiner le 2ᵉ ouvrage</h3><p>Capturez sa position, puis glissez librement le repère ou cliquez sur la carte. Aucun accrochage aux routes, parcelles, réseaux ou grille n’est appliqué.</p></div><div className="neutralDirectFields"><Field label="Latitude du 2ᵉ ouvrage" value={m.neutralGpsLat} onChange={v=>update({improvementTarget:'neutral',neutralGpsLat:v,neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLat:v,placementConfirmed:false}})}/><Field label="Longitude du 2ᵉ ouvrage" value={m.neutralGpsLng} onChange={v=>update({improvementTarget:'neutral',neutralGpsLng:v,neutralGpsManual:true,implantation:{...(m.implantation||{}),centerLng:v,placementConfirmed:false}})}/><button type="button" onClick={captureNeutralHere} disabled={neutralGpsBusy}>📍 {neutralGpsBusy?'Acquisition…':'Géolocaliser le 2ᵉ ouvrage'}</button>{m.neutralGpsOriginalLat&&m.neutralGpsOriginalLng&&<button type="button" className="secondaryAction" onClick={()=>update({neutralGpsLat:m.neutralGpsOriginalLat,neutralGpsLng:m.neutralGpsOriginalLng,neutralGpsManual:false,neutralMapFocusNonce:Date.now(),implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:m.neutralGpsOriginalLat,centerLng:m.neutralGpsOriginalLng,offsetX:0,offsetY:0,placementConfirmed:false}})}>↺ Revenir au GPS d’origine</button>}</div>{m.neutralGpsLat&&m.neutralGpsLng&&<div className="neutralRefineMap"><div className="terrainMapHeader"><div><h4>Affinage manuel du 2ᵉ ouvrage</h4><p>Déplacement continu, pixel par pixel, sans recentrage automatique.</p></div><span className="freePlacementBadge">✥ Libre</span></div><LiveMap key={`neutral-refine-${m.neutralMapFocusNonce||m.neutralGpsCapturedAt||'map'}`} focusNonce={m.neutralMapFocusNonce||m.neutralGpsCapturedAt} preferredZoom={20} m={{...m,improvementTarget:'neutral',implantation:{...(m.implantation||{}),centerLat:m.neutralGpsLat,centerLng:m.neutralGpsLng,manualAnchorLat:'',manualAnchorLng:'',anchorLocked:false}}} analysis={{lines:[],parcels:[],connector:[]}} showCadastre={false} showArcgis={false} anchorDraggable={true} anchorSnap={false} clickToPlaceAnchor={true} onMoveAnchor={(lat,lng)=>update({improvementTarget:'neutral',neutralGpsLat:Number(lat).toFixed(8),neutralGpsLng:Number(lng).toFixed(8),neutralGpsManual:true,implantation:{...(m.implantation||{}),manualAnchorLat:'',manualAnchorLng:'',centerLat:Number(lat).toFixed(8),centerLng:Number(lng).toFixed(8),offsetX:0,offsetY:0,placementConfirmed:false}})}/><div className="terrainMapFooter"><span>⚡ 2ᵉ ouvrage librement déplaçable</span><span>{m.neutralGpsManual?'Position affinée manuellement':'Position GPS d’origine'}</span></div></div>}</div>}

    <div className="implantationReliabilityStrip">
      <span className={sol||noWork?'ok':'ko'}><b>{sol||noWork?'✓':'×'}</b> Solution synchronisée</span>
      <span className={anchor.valid?'ok':'ko'}><b>{anchor.valid?'✓':'×'}</b> GPS ouvrage</span>
      <span className={Number.isFinite(centerLat)&&Number.isFinite(centerLng)?'ok':'ko'}><b>{Number.isFinite(centerLat)&&Number.isFinite(centerLng)?'✓':'×'}</b> Position carte</span>
      <span className={m.implantation?.placementConfirmed?'ok':'pending'}><b>{m.implantation?.placementConfirmed?'✓':'○'}</b> Implantation enregistrée</span>
    </div>

    <div className="implantationWorkspace">
      <div className="card implantationMapCard">
        <div className="implantationMapToolbar">
          <div><b>{anchor.label}</b><span>{anchor.valid?`${fmt(anchor.lat,7)} / ${fmt(anchor.lng,7)}`:'GPS non renseigné'}</span></div>
          <div className="placementBadges"><span>Échelle réelle 1:1</span><span>{m.implantation?.placementConfirmed?'✓ Enregistré':'Position à confirmer'}</span></div>
        </div>
        <LiveMap key={`implantation-${anchorKey(m)}-${selected}-${mapReload}`} focusNonce={`${anchorKey(m)}-${mapReload}`} preferredZoom={19} m={{...m,implantation:{...(m.implantation||{}),centerLat:String(centerLat||''),centerLng:String(centerLng||'')}}} analysis={analysis} onMoveCenter={moveCenter} onMoveAnchor={moveAnchor} onMoveConnection={moveConnection} onParcelSelect={setSelectedParcel} showCadastre={true} showArcgis={false} editable={true} schemaOnly={true}/>
        {!anchor.valid&&<div className="implantationEmpty warningState"><b>Position GPS indisponible</b><span>Renseignez ou capturez la position de l’ouvrage avant de placer le schéma.</span><button onClick={back}>Retour au diagnostic</button></div>}{!sol&&!noWork&&anchor.valid&&<div className="implantationEmpty"><b>Solution non récupérée</b><span>La sélection n’a pas pu être relue. Retournez dans Diagnostic puis cliquez une fois sur la solution souhaitée.</span><button onClick={back}>Ouvrir Diagnostic & solutions</button></div>}
      </div>

      <aside className="implantationSidePanel">
        <div className="card"><h3>Solution retenue</h3><b className="solutionTitle">{noWork?'Aucune intervention':sol?.title||'Non définie'}</b><p>{sol?.desc||'Le schéma est verrouillé à l’échelle réelle.'}</p></div>
        {!noWork&&<div className="card placementControls"><h3>Position et orientation</h3><div className="anchorManualControl"><div><small>OUVRAGE DE RACCORDEMENT</small><b>{anchor.manuallyAdjusted?'Position corrigée manuellement':'Position GPS source'}</b><span>{Number.isFinite(anchor.lat)?`${anchor.lat.toFixed(7)} / ${anchor.lng.toFixed(7)}`:'Position indisponible'}</span></div><button className={m.implantation?.anchorLocked?'selected':''} onClick={()=>patchImp({anchorLocked:!m.implantation?.anchorLocked})}>{m.implantation?.anchorLocked?'🔒 Ouvrage verrouillé':'🔓 Ouvrage déplaçable'}</button></div><p className="anchorHelp">Glissez directement le repère POSTE / OUVRAGE sur la carte pour le positionner exactement. Cette correction ne modifie pas la géolocalisation GPS d’origine.</p>
          <div className="connectionControl"><small>POINT DE RACCORDEMENT DE LA PRISE DE TERRE</small><div className="connectionModeButtons"><button className={(m.implantation?.connectionMode||'auto')==='auto'?'selected':''} onClick={()=>patchImp({connectionMode:'auto',connectionLat:'',connectionLng:'',placementConfirmed:false})}>Automatique</button><button className={m.implantation?.connectionMode==='masses'?'selected':''} onClick={()=>patchImp({connectionMode:'masses',connectionLat:'',connectionLng:'',placementConfirmed:false})}>Poste</button><button className={m.implantation?.connectionMode==='neutral'?'selected':''} disabled={!Number.isFinite(num(m.neutralGpsLat))||!Number.isFinite(num(m.neutralGpsLng))} onClick={()=>patchImp({connectionMode:'neutral',connectionLat:'',connectionLng:'',placementConfirmed:false})}>2ᵉ ouvrage neutre</button><button className={m.implantation?.connectionMode==='manual'?'selected':''} onClick={()=>{const ca=connectionAnchor(m);patchImp({connectionMode:'manual',connectionLat:String(Number.isFinite(ca.lat)?ca.lat:baseLat),connectionLng:String(Number.isFinite(ca.lng)?ca.lng:baseLng),placementConfirmed:false})}}>Libre sur carte</button></div><p>{(m.implantation?.connectionMode||'auto')==='auto'?(solutionTargetsNeutral(m)?'Raccordement automatique au 2ᵉ ouvrage neutre.':'Raccordement automatique au poste de transformation.'):(m.implantation?.connectionMode==='manual'?'Glissez le repère orange « Raccordement » où vous le souhaitez sur la carte.':m.implantation?.connectionMode==='neutral'?'Raccordement forcé au 2ᵉ ouvrage neutre.':'Raccordement forcé au poste de transformation.')}</p></div>
          <label>Rotation <strong>{Number(angle).toFixed(1)}°</strong><input type="range" min="0" max="359.9" step="0.1" value={angle} onChange={e=>patchImp({orientation:Number(e.target.value),placementConfirmed:false})}/></label>
          <div className="precisionPositionGrid"><label>Est / Ouest (m)<input type="number" step="0.1" value={Number(offsetX).toFixed(2)} onChange={e=>{const x=Number(e.target.value||0),y=Number(offsetY||0),p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}/></label><label>Nord / Sud (m)<input type="number" step="0.1" value={Number(offsetY).toFixed(2)} onChange={e=>{const x=Number(offsetX||0),y=Number(e.target.value||0),p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}/></label></div>
          <div className="meterNudge"><button onClick={()=>{const x=Number(offsetX)-.1,y=Number(offsetY),p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}>← 0,1 m</button><button onClick={()=>{const x=Number(offsetX),y=Number(offsetY)+.1,p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}>↑ 0,1 m</button><button onClick={()=>{const x=Number(offsetX),y=Number(offsetY)-.1,p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}>↓ 0,1 m</button><button onClick={()=>{const x=Number(offsetX)+.1,y=Number(offsetY),p=toLngLat(x,y,baseLng,baseLat);patchImp({offsetX:x,offsetY:y,centerLng:String(p[0]),centerLat:String(p[1]),placementConfirmed:false})}}>0,1 m →</button></div>
          <div className="mirrorButtons"><button className={mirrorX?'selected':''} onClick={()=>patchImp({mirrorX:!mirrorX,placementConfirmed:false})}>↔ Miroir horizontal</button><button className={mirrorY?'selected':''} onClick={()=>patchImp({mirrorY:!mirrorY,placementConfirmed:false})}>↕ Miroir vertical</button></div>
          <div className="freePlacementNotice"><b>Positionnement totalement libre</b><span>Le glisser-déposer conserve la position exacte du curseur. Les boutons servent uniquement aux micro-ajustements de 0,1 m et n’imposent aucune grille.</span></div>
          <p className="hint">Cliquez aussi sur un numéro de parcelle pour afficher le gestionnaire connu et la nécessité d’une convention.</p>
        </div>}
        {!noWork&&sol&&<div className="card technicalSchemaCard"><TechnicalSchema m={m} sol={sol} onChange={smartDesign=>patchImp({smartDesign,placementConfirmed:false})}/></div>}
        <div className="card landManagementCard"><h3>Foncier & conventions</h3>{selectedParcel?<><div className="parcelSelectedHeader"><div><small>PARCELLE SÉLECTIONNÉE</small><b>{selectedParcel.id}</b></div><span>{selectedParcel.info?.surface?`${selectedParcel.info.surface} m²`:'Surface non publiée'}</span></div><label>Propriétaire / gestionnaire<input value={selectedOwner} placeholder="Commune, particulier, département…" onChange={e=>saveParcel({owner:e.target.value})}/></label><label>Statut foncier<select value={selectedStatus} onChange={e=>saveParcel({status:e.target.value})}><option>Non renseigné</option><option>Privé</option><option>Commune</option><option>Département</option><option>État</option><option>ONF</option><option>Domaine public routier</option><option>EDF / Enedis</option></select></label><div className={`conventionDecision ${selectedRule.need==='OUI'?'required':selectedRule.need==='NON*'?'notRequired':'check'}`}><small>CONVENTION / AUTORISATION</small><b>{selectedRule.need}</b><span>{selectedRule.label}</span></div><label>Référence / observation foncière<textarea rows="2" value={(typeof parcelRecord==='object'&&parcelRecord.note)||''} onChange={e=>saveParcel({note:e.target.value})} placeholder="Référence convention, contact propriétaire, permission de voirie…"/></label></>:<div className="parcelSelectHint"><b>Cliquez sur une parcelle de la carte</b><span>Le numéro, la surface, le propriétaire renseigné et la nécessité d’une convention apparaîtront ici.</span></div>}</div>
        <div className="card"><h3>Métrés instantanés</h3><div className="metricRows"><p><span>Cuivre / tranchée</span><b>{metres.toFixed(1)} m</b></p><p><span>Parcelles traversées</span><b>{analysis.parcels?.length||0}</b></p><p><span>Convention</span><b>{analysis.convention||'—'}</b></p></div></div>
        <div className="card"><h3>Variantes</h3><div className="variantList">{solutions.slice(0,3).map((x,i)=><button key={x.id} className={selected===x.id?'active':''} onClick={()=>update(canonicalSolutionPatch(m,x.id,{implantation:{placementConfirmed:false,savedAt:''}}))}><span>Variante {String.fromCharCode(65+i)}</span><b>{x.title}</b><small>{i===0?'Compromis recommandé':i===1?'Moins de travaux':'Efficacité maximale'}</small></button>)}</div></div>
      </aside>
    </div>

    <div className="workflowActions"><button className="secondaryAction" onClick={back}>← Retour Diagnostic</button><span className={m.implantation?.placementConfirmed?'readyText':'warningText'}>{m.implantation?.placementConfirmed?'✓ Implantation confirmée':'Positionner puis enregistrer le schéma'}</span><button disabled={!noWork&&(!sol||!m.implantation?.placementConfirmed)} onClick={next}>Continuer vers le contrôle final →</button></div>
  </section>
}

function Administration({records,setRecords,driveConfig,authSession,uiTheme,setUiTheme,onTrash}){
  const [governance,setGovernance]=useState(()=>loadGovernance());
  const readiness=productionReadiness({references:governance.references||DEFAULT_REFERENCES,hasDatabase:Boolean(window.secabDesktop?.databaseReady),hasAuth:Boolean(authSession?.user),hasSignedInstaller:Boolean(governance.signedInstaller),pdfValidated:Boolean(governance.pdfValidated),caseCount:Number(governance.validatedCaseCount||0)}); const catalogue=testCatalogue();
  const persistGovernance=next=>{setGovernance(next);saveGovernance(next)};
  const active=records.filter(r=>!r.deletedAt), trash=records.filter(r=>r.deletedAt&&!r.purgedAt), tests=active.filter(r=>r.isTest);
  const [users,setUsers]=useState([]);const [userForm,setUserForm]=useState({username:'',displayName:'',role:'technicien',password:''});const [userError,setUserError]=useState('');
  const refreshUsers=async()=>{if(authSession?.user?.role!=='administrateur')return;const r=await window.secabDesktop.listUsers(authSession.token);if(r?.ok)setUsers(r.users||[]);else setUserError(r?.error||'Lecture des comptes impossible')};
  useEffect(()=>{refreshUsers()},[authSession?.token]);
  const createAccount=async e=>{e.preventDefault();setUserError('');const r=await window.secabDesktop.createUser(authSession.token,userForm);if(!r?.ok){setUserError(r?.error||'Création impossible');return}setUserForm({username:'',displayName:'',role:'technicien',password:''});await refreshUsers()};
  const [selected,setSelected]=useState('');
  const target=records.find(r=>r.id===selected);
  const restoreRecord=async r=>{const now=new Date().toISOString();const restored={...r,deletedAt:'',deletedReason:'',deletedBy:'',deleteExpiresAt:'',updatedAt:now,audit:[...(r.audit||[]),auditEntry('Restauration depuis la corbeille','Affaire réintégrée dans les listes et le reporting selon son mode Test/Réelle')]};setRecords(rs=>rs.map(x=>x.id===r.id?restored:x));if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'restoreRecord',uuid:r.uuid||r.id,record:packageRecord(restored)})}catch(e){console.warn(e)}}};
  const trashRecord=async r=>{if(!r)return;const reason=prompt('Motif de mise en corbeille :','Suppression demandée')||'';if(!reason.trim())return;if(!confirm(`Placer ${r.codeGdo||r.numeroPoste||r.rapport||'cette affaire'} dans la corbeille ?`))return;const now=new Date().toISOString();const deleted={...r,deletedAt:now,deletedReason:reason,deletedBy:r.responsable||'Responsable bureau',deleteExpiresAt:new Date(Date.now()+30*86400000).toISOString(),updatedAt:now,audit:[...(r.audit||[]),auditEntry('Mise en corbeille',reason)]};setRecords(rs=>rs.map(x=>(x.id===r.id||(x.uuid&&x.uuid===r.uuid))?deleted:x));if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'trashRecord',uuid:r.uuid||r.id,record:packageRecord(deleted)})}catch(e){console.warn(e)}}};
  const hardDelete=async r=>{if(!confirm(`SUPPRESSION DÉFINITIVE de ${r.codeGdo||r.rapport||r.uuid} ?\nLes données locales et le package Drive seront supprimés.`))return;const now=new Date().toISOString();setRecords(rs=>rs.map(x=>x.id===r.id?{...x,deletedAt:now,deletedReason:'Suppression administrative',deletedBy:authSession?.user?.displayName||'Administration',purgedAt:now,updatedAt:now}:x));if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'deleteRecord',uuid:r.uuid||r.id})}catch(e){alert(`Suppression locale effectuée, mais nettoyage Drive à vérifier : ${e.message}`)}}};
  const deleteTests=()=>{if(!tests.length)return alert('Aucune affaire de test active.');if(!confirm(`Placer ${tests.length} affaire(s) de test dans la corbeille ?`))return;const now=new Date().toISOString(),expiry=new Date(Date.now()+30*86400000).toISOString();setRecords(rs=>rs.map(r=>r.isTest&&!r.deletedAt?{...r,deletedAt:now,deletedReason:'Nettoyage des essais',deletedBy:'Administration',deleteExpiresAt:expiry,updatedAt:now,audit:[...(r.audit||[]),auditEntry('Mise en corbeille groupée','Nettoyage des affaires de test')]}:r))};
  const emptyTrash=()=>{if(!trash.length)return alert('La corbeille est vide.');if(!confirm(`Supprimer définitivement ${trash.length} affaire(s) de la corbeille ?`))return;const now=new Date().toISOString();setRecords(rs=>rs.map(r=>r.deletedAt?{...r,purgedAt:now,updatedAt:now}:r));};
  const dbSize=new Blob([JSON.stringify(records)]).size;
  return <section className="adminModule"><div className="adminHero"><div><small>V52 DIAGNOSTIC MÉTIER</small><h2>Administration et maintenance de la base</h2><p>Les affaires placées dans la corbeille sont immédiatement exclues du reporting et de la carte client.</p></div><div className="adminHealth"><b>{active.length}</b><span>actives</span><b>{tests.length}</b><span>tests</span><b>{trash.length}</b><span>corbeille</span></div></div>
    <div className="card appearanceCard"><div className="panelTitle"><div><h3>Apparence du logiciel</h3><p>Les huit présentations reprennent fidèlement les maquettes HTML validées.</p></div><span>{UI_THEMES.find(t=>t.id===uiTheme)?.name}</span></div><div className="themeGallery">{UI_THEMES.map(t=><button key={t.id} type="button" className={`themePreview theme-${t.id} ${uiTheme===t.id?'selected':''}`} onClick={()=>setUiTheme(t.id)}><span className="themePreviewSidebar"></span><span className="themePreviewCanvas"><i></i><b></b><em></em></span><strong>{t.name}</strong><small>{t.subtitle}</small></button>)}</div></div>
    {authSession?.user?.role==='administrateur'&&<div className="card userAdminCard"><div className="panelTitle"><div><h3>Comptes nominatifs</h3><p>Les actions SQLite et les révisions sont attribuées à l’utilisateur connecté.</p></div><span>{users.filter(x=>x.active).length} compte(s) actif(s)</span></div>{userError&&<div className="authError">{userError}</div>}<form className="userCreateGrid" onSubmit={createAccount}><label>Identifiant<input value={userForm.username} onChange={e=>setUserForm({...userForm,username:e.target.value})} minLength="3" required/></label><label>Nom complet<input value={userForm.displayName} onChange={e=>setUserForm({...userForm,displayName:e.target.value})} minLength="2" required/></label><label>Rôle<select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="technicien">Technicien</option><option value="responsable">Responsable</option><option value="administrateur">Administrateur</option></select></label><label>Mot de passe provisoire<input type="password" value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} minLength="8" required/></label><button type="submit">Créer le compte</button></form><div className="userList">{users.map(u=><div key={u.id}><b>{u.displayName}</b><span>{u.username} · {u.role}</span><em>{u.active?'Actif':'Désactivé'}{u.lastLoginAt?` · dernière connexion ${new Date(u.lastLoginAt).toLocaleString('fr-FR')}`:''}</em></div>)}</div></div>}

    <div className="card nationalReadinessCard"><div className="panelTitle"><div><h3>Niveau de préparation nationale</h3><p>Contrôles essentiels sans ajouter de complexité au parcours terrain.</p></div><span>{PRODUCTION_CORE_VERSION} · {readiness.score}%</span></div><div className="nationalReadinessGrid">{readiness.checks.map(x=><div key={x.id} className={x.ok?'ok':'ko'}><b>{x.ok?'✓':'⚠'} {x.label}</b><span>{x.detail}</span></div>)}</div><p className="hint">Catalogue minimal prévu : {catalogue.total} familles de tests. Objectif avant diffusion nationale : au moins 50 cas métier réels validés et figés.</p></div><div className="card rcGovernanceCard"><div className="panelTitle"><div><h3>Gouvernance technique — Release Candidate</h3><p>Pondérations, rôles, référentiel documentaire et contrôles avant émission d’un rapport officiel.</p></div><span>Règles {governance.rulesVersion||'RC-2.0.0'}</span></div>
      <div className="rcGovernanceGrid"><section><h4>Pondérations du classement</h4>{Object.entries(DEFAULT_WEIGHTS).map(([key])=><label className="rcWeight" key={key}><span>{({technical:'Performance électrique',margin:'Marge sous le seuil',cost:'Coût',duration:'Durée',impact:'Impact terrain',maintainability:'Maintenabilité',evidence:'Qualité des preuves'})[key]}</span><input type="number" min="0" max="100" value={governance.weights?.[key]??DEFAULT_WEIGHTS[key]} onChange={e=>persistGovernance({...governance,weights:{...governance.weights,[key]:Number(e.target.value)}})}/><b>%</b></label>)}<small>Total : {Object.values(governance.weights||DEFAULT_WEIGHTS).reduce((a,b)=>a+Number(b||0),0)} % — le moteur normalise automatiquement.</small></section>
      <section><h4>Profil actif</h4><select value={governance.currentRole||'responsable'} onChange={e=>persistGovernance({...governance,currentRole:e.target.value})}>{Object.entries(DEFAULT_ROLES).map(([id,r])=><option key={id} value={id}>{r.label}</option>)}</select><div className="rcPermissions">{(DEFAULT_ROLES[governance.currentRole||'responsable']?.permissions||[]).map(x=><span key={x}>{x}</span>)}</div><p className="hint">Les fonctions sensibles pourront être bloquées selon ce profil lors du déploiement multi-utilisateur.</p></section>
      <section className="rcReferenceSection"><h4>Référentiel documentaire officiel</h4><p className="hint">Renseignez exactement l’indice, la date et le paragraphe du document réellement applicable. Le rapport officiel reste bloqué tant qu’une référence est incomplète.</p>{(governance.references||DEFAULT_REFERENCES).map((ref,i)=>{const check=validateReference(ref);const patch=(key,value)=>{const refs=[...(governance.references||DEFAULT_REFERENCES)];refs[i]={...refs[i],[key]:value};persistGovernance({...governance,references:refs})};return <div className={`rcReference referenceEditor ${check.ok?'ok':'ko'}`} key={ref.id||i}><div className="referenceEditorGrid"><label>Identifiant<input value={ref.id||''} onChange={e=>patch('id',e.target.value)}/></label><label>Titre exact<input value={ref.title||''} onChange={e=>patch('title',e.target.value)}/></label><label>Émetteur<input value={ref.issuer||''} onChange={e=>patch('issuer',e.target.value)}/></label><label>Indice<input value={ref.index||''} onChange={e=>patch('index',e.target.value)}/></label><label>Date d’application<input type="date" value={ref.effectiveDate||''} onChange={e=>patch('effectiveDate',e.target.value)}/></label><label>Paragraphe / page<input value={ref.location||''} onChange={e=>patch('location',e.target.value)}/></label><label className="wide">Domaine d’application<input value={ref.scope||''} onChange={e=>patch('scope',e.target.value)}/></label><label>Statut<select value={ref.status||'draft'} onChange={e=>patch('status',e.target.value)}><option value="draft">Brouillon</option><option value="active">En vigueur</option><option value="archived">Archivée</option></select></label></div><em>{check.ok?'✓ Référence exploitable':`⚠ À compléter : ${check.missing.join(', ')}`}</em></div>})}</section>
      <section><h4>Contrôles de maturité</h4><ul className="rcChecklist"><li>✓ Diagnostic déterministe et seuil 0,15 stabilisé</li><li>✓ Rapport avec/sans prix séparé</li><li>✓ Révisions figées et journal d’audit préparé</li><li>✓ Métré DAO consolidé depuis les annotations</li><li>⚠ Validation métier officielle toujours requise</li><li>⚠ Installeur Windows à tester sur poste vierge</li></ul><button onClick={()=>download(`SECAB_gouvernance_RC_${today()}.json`,JSON.stringify(governance,null,2),'application/json')}>Exporter la gouvernance</button></section></div>
    </div>
    <div className="adminGrid"><article className="card"><h3>Gestion ciblée</h3><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Sélectionner une affaire</option>{active.map(r=><option key={r.id} value={r.id}>{r.isTest?'[TEST] ':''}{r.codeGdo||r.numeroPoste||r.rapport} · {r.commune}</option>)}</select><div className="actions">{target&&!target.deletedAt&&<button className="danger" onClick={()=>onTrash?.(target,'Administratif')}>Mettre dans la corbeille</button>}</div></article>
    <article className="card"><h3>Nettoyage rapide</h3><p>Les données de test ne sont jamais comptées dans les statistiques.</p><div className="actions"><button onClick={deleteTests}>🧪 Supprimer les affaires de test</button><button className="danger" onClick={emptyTrash}>🗑 Vider la corbeille</button></div></article>
    <article className="card"><h3>Santé de la base</h3><div className="healthRows"><p><b>Taille des données indexées</b><span>{(dbSize/1024/1024).toFixed(2)} Mo</span></p><p><b>Synchronisations en attente/conflit</b><span>{active.filter(r=>['pending','conflict'].includes(r.syncState?.status)).length}</span></p><p><b>Dernière activité</b><span>{new Date(Math.max(...records.map(r=>new Date(r.updatedAt||0).getTime()),0)).toLocaleString('fr-FR')}</span></p></div></article></div>
    <div className="card"><div className="panelTitle"><div><h3>Corbeille</h3><p>Restaurez une affaire ou supprimez-la définitivement.</p></div></div>{trash.length?<div className="trashList">{trash.map(r=><div className="trashRow" key={r.id}><div><b>{r.codeGdo||r.numeroPoste||r.rapport||r.uuid}</b><span>{r.commune} · supprimée le {new Date(r.deletedAt).toLocaleString('fr-FR')}</span><small>{r.deletedReason||'Sans motif'}</small></div><button onClick={()=>restoreRecord(r)}>♻ Restaurer</button><button className="danger" onClick={()=>hardDelete(r)}>Supprimer définitivement</button></div>)}</div>:<p className="hint">La corbeille est vide.</p>}</div>
  </section>
}

function packageRecord(r){return {type:'SECAB_AFFAIRE_PACKAGE',version:'55.0.0',uuid:r.uuid||r.id,exportedAt:new Date().toISOString(),record:r};}
function Registry({records,allRecords,setRecords,active,exportTerrainDay,driveConfig,setDriveConfigState,pushDrive,simpleSyncSummary={},driveFolderStatus={},setDriveFolderStatus,initialFocus='all',setInitialFocus,setCurrent,setTab,onTrash}){
  const activeRecords=Array.isArray(records)?records.filter(Boolean):[];
  const safeAllRecords=Array.isArray(allRecords)?allRecords.filter(Boolean):activeRecords;
  const safeActive=active||activeRecords[0]||{};
  const [focus,setFocus]=useState(initialFocus||'all');
  useEffect(()=>{setFocus(initialFocus||'all')},[initialFocus]);
  const focusLabels={all:'Toutes les affaires',ok:'Affaires conformes',ko:'Affaires non conformes'};
  const filteredRecords=activeRecords.filter(r=>focus==='all'||(focus==='ok'&&compute(r).ok)||(focus==='ko'&&!compute(r).ok));
  const clearFocus=()=>{setFocus('all');setInitialFocus?.('all')};
  const openRecord=(r)=>{setCurrent?.(r.id);setTab?.('rapport')};
  const [unlockReason,setUnlockReason]=useState(''); const [unlockUuid,setUnlockUuid]=useState(safeActive?.uuid||safeActive?.id||'');
  function backup(){download(`SECAB_sauvegarde_complete_${today()}.secabbackup`,JSON.stringify({type:'SECAB_BACKUP',version:'42.0.0',exportedAt:new Date().toISOString(),records},null,2),'application/json')}
  async function restore(e){const f=e.target.files?.[0];if(!f)return;try{const d=await readJsonFile(f);if(d.type!=='SECAB_BACKUP')throw new Error('Type de sauvegarde incorrect');const imported=extractImportedRecords(d).map(normalizeRecord);if(confirm(`Restaurer ${imported.length} affaire(s) ? La sauvegarde actuelle sera remplacée.`)){setRecords(imported);alert('Sauvegarde restaurée et contrôlée.')}}catch(err){alert(`Sauvegarde incompatible : ${err.message}`)}finally{e.target.value=''}}
  function expOne(){download(`${safe(active.affaire||active.uuid)}.secabpkg`,JSON.stringify(packageRecord(safeActive),null,2),'application/json')}
  function expDay(){exportTerrainDay?.('manual')}
  async function moveToTrash(record){
        const reason=prompt(`Motif de suppression pour ${record.codeGdo||record.numeroPoste||record.rapport||'cette affaire'} :`,'Essai logiciel')||'';
    if(!reason)return;
    if(!confirm('Placer cette affaire dans la corbeille ? Elle sera exclue immédiatement du reporting.'))return;
    const now=new Date().toISOString(), expiry=new Date(Date.now()+30*86400000).toISOString();
    const deleted={...record,deletedAt:now,deletedReason:reason,deletedBy:record.responsable||'Responsable bureau',deleteExpiresAt:expiry,updatedAt:now,audit:[...(record.audit||[]),auditEntry('Mise en corbeille',reason)]};
    setRecords(rs=>rs.map(r=>r.id===record.id?deleted:r));
    const nextActive=activeRecords.find(r=>r.id!==record.id);if(nextActive)setCurrent?.(nextActive.id);setTab?.('registre');
    if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'trashRecord',uuid:record.uuid||record.id,record:packageRecord(deleted)})}catch(e){console.warn('Drive corbeille',e)}}
  }
  function requestUnlock(){if(!safeActive.validation?.locked){alert('Cette affaire n’est pas verrouillée.');return}const reason=unlockReason.trim()||prompt('Motif de la demande de réouverture :')||'';if(!reason)return;const request={type:'SECAB_UNLOCK_REQUEST',version:'42.0.0',uuid:safeActive.uuid||safeActive.id,affaire:active.affaire,requestedAt:new Date().toISOString(),technicien:active.technicien,reason};download(`${safe(active.affaire||active.uuid)}_demande_reouverture.secabunlockrequest`,JSON.stringify(request,null,2),'application/json');setRecords(rs=>rs.map(r=>r.id===active.id?{...r,validation:{...(r.validation||{}),unlockRequestedAt:request.requestedAt,unlockReason:reason},audit:[...(r.audit||[]),auditEntry('Demande de réouverture',reason)]}:r));setUnlockReason('')}
  async function authorizeUnlock(){if(!IS_DESKTOP){alert('Autorisation disponible uniquement dans le logiciel bureau.');return}const target=records.find(r=>(r.uuid||r.id)===unlockUuid);if(!target){alert('Sélectionnez une affaire à déverrouiller.');return}const token=uid();const auth={type:'SECAB_UNLOCK_AUTHORIZATION',version:'37.0.0',uuid:target.uuid||target.id,affaire:target.affaire,authorizedAt:new Date().toISOString(),responsable:target.responsable||'Responsable SECAB',token};setRecords(rs=>rs.map(r=>r.id===target.id?{...r,validation:{...(r.validation||{}),locked:false,managerAt:auth.authorizedAt,unlockToken:token,unlockRequestedAt:'',unlockReason:''},audit:[...(r.audit||[]),auditEntry('Réouverture autorisée',`Par ${auth.responsable}`)]}:r));if(driveConfigured(driveConfig)){try{await callDriveBridge(driveConfig,{action:'unlockAuthorize',authorization:auth})}catch(e){alert(`Autorisation locale créée, mais dépôt Drive impossible : ${e.message}`)}}download(`${safe(target.affaire||target.uuid)}_autorisation_reouverture.secabunlock`,JSON.stringify(auth,null,2),'application/json')}
  async function importUnlock(e){const f=e.target.files?.[0];if(!f)return;try{const d=await readJsonFile(f);if(d.type!=='SECAB_UNLOCK_AUTHORIZATION'||!d.uuid||!d.token||!d.authorizedAt)throw new Error('Autorisation incomplète');let found=false;setRecords(rs=>rs.map(r=>{if((r.uuid||r.id)!==d.uuid)return r;found=true;return {...r,validation:{...(r.validation||{}),locked:false,managerAt:d.authorizedAt,unlockToken:String(d.token).slice(0,200),unlockRequestedAt:'',unlockReason:''},audit:[...(r.audit||[]),auditEntry('Affaire déverrouillée sur le terminal',`Autorisation ${d.responsable||'responsable'}`)]}}));alert(found?'Affaire déverrouillée. Le technicien peut reprendre la saisie.':'Affaire correspondante introuvable sur ce terminal.')}catch(err){alert(`Autorisation de réouverture incompatible : ${err.message}`)}finally{e.target.value=''}}
  async function imp(e){const files=[...e.target.files];for(const f of files){try{const d=await readJsonFile(f);if(d.type==='SECAB_UNLOCK_REQUEST'){alert(`Demande de réouverture reçue pour ${d.affaire||d.uuid}\nMotif : ${d.reason||'Non renseigné'}`);continue}const incoming=extractImportedRecords(d).map(normalizeRecord);setRecords(old=>{const map=new Map(old.map(x=>[x.uuid||x.id,x]));incoming.forEach(x=>map.set(x.uuid||x.id,x));return [...map.values()]});alert(`${incoming.length} affaire(s) contrôlée(s) et importée(s).`)}catch(err){alert(`Fichier incompatible : ${f.name} — ${err.message}`)}}e.target.value=''}
  async function pullDrive(){try{const result=await callDriveBridge(driveConfig,{action:'pull'});const incoming=(result.records||[]).map(x=>normalizeRecord(x.record||x));let conflicts=0,created=0,updated=0;const pending=await getPendingSync();const pendingIds=new Set(pending.map(x=>x.uuid));setRecords(old=>{const map=new Map(old.map(x=>[x.uuid||x.id,x]));incoming.forEach(x=>{const key=x.uuid||x.id;const existing=map.get(key);if(!existing){map.set(key,{...x,syncState:{...(x.syncState||{}),status:'synced',lastPull:new Date().toISOString()}});created++;return}const remoteNewer=String(x.updatedAt||'')>String(existing.updatedAt||'');if(remoteNewer&&pendingIds.has(key)){conflicts++;map.set(key,{...existing,syncState:{...(existing.syncState||{}),status:'conflict',error:'Version Drive plus récente pendant des modifications locales'},audit:[...(existing.audit||[]),auditEntry('Conflit de synchronisation','La version locale a été conservée ; arbitrage bureau requis')],remoteConflict:x});return}if(remoteNewer){map.set(key,{...x,syncState:{...(x.syncState||{}),status:'synced',lastPull:new Date().toISOString()}});updated++}});return [...map.values()]});const next={...driveConfig,lastPull:new Date().toISOString(),status:`${created} nouvelle(s), ${updated} mise(s) à jour, ${conflicts} conflit(s)`};setDriveConfigState(next);saveDriveConfig(next);await writeSyncLog(conflicts?'warning':'success','Récupération Drive',next.status);alert(`Drive : ${created} nouvelle(s), ${updated} mise(s) à jour, ${conflicts} conflit(s). Aucun doublon créé.`)}catch(e){await writeSyncLog('error','Échec récupération Drive',e.message);alert(`Synchronisation impossible : ${e.message}`)}}
  async function pushAllDrive(){try{const result=await pushDrive(activeRecords,'bureau-manuel');alert(`Drive mis à jour : ${result.created||0} créée(s), ${result.updated||0} mise(s) à jour, ${result.unchanged||0} inchangée(s).`)}catch(e){alert(`Synchronisation impossible : ${e.message}`)}}
  function updateDriveConfig(p){const next={...driveConfig,...p};setDriveConfigState(next);saveDriveConfig(next)}
  function csv(){const cols=['uuid','rapport','affaire','codeGdo','commune','typeOuvrage','terreConfig','date','technicien','rm','rng','rni','rmn','rcDirect','resistivite','distance','diagnosticTerrain','solutionRetenue','observations','statut'];const rows=[cols.join(';'),...activeRecords.map(r=>cols.map(k=>`"${String(r[k]??'').replace(/"/g,'""')}"`).join(';'))];download(`SECAB_registre_${today()}.csv`,rows.join('\n'),'text/csv;charset=utf-8')}
  const [simpleSync,setSimpleSync]=React.useState({importFolder:'',processedFolder:'',lastScan:'',lastResult:''});
  React.useEffect(()=>{if(IS_DESKTOP&&window.secabDesktop?.getSimpleSyncConfig)window.secabDesktop.getSimpleSyncConfig().then(r=>r?.ok&&setSimpleSync(r.config||{}))},[]);
  async function chooseSimpleFolder(){const r=await window.secabDesktop?.chooseSimpleSyncFolder();if(r?.ok){setSimpleSync(r.config||{});alert('Dossier A_importer configuré. Le logiciel le surveillera automatiquement toutes les 10 secondes.')}}
  async function scanSimpleNow(){const r=await window.secabDesktop?.scanSimpleSyncFolder();if(!r?.ok)return alert(r?.error||'Dossier indisponible');const merged=mergeIncomingRecords(allRecords||records,r.records||[]);setRecords(merged.records);setSimpleSync(r.config||{});alert(`${merged.created} nouvelle(s), ${merged.updated} mise(s à jour), ${merged.ignored} déjà connue(s), ${merged.conflicts} conflit(s).`)}
  return <section className="card"><h2>Registre et synchronisation Google Drive</h2><div className="registryFocusBar"><div><b>Filtre actif : {focusLabels[focus]||focusLabels.all}</b><span>{filteredRecords.length} affaire(s) concernée(s)</span></div><div className="registryFocusActions"><button className={focus==='all'?'activeFilter':''} onClick={()=>{setFocus('all');setInitialFocus?.('all')}}>Toutes</button><button className={focus==='ok'?'activeFilter':''} onClick={()=>{setFocus('ok');setInitialFocus?.('ok')}}>Conformes</button><button className={focus==='ko'?'activeFilter':''} onClick={()=>{setFocus('ko');setInitialFocus?.('ko')}}>Non conformes</button>{focus!=='all'&&<button className="secondaryAction" onClick={clearFocus}>Effacer le filtre</button>}</div></div>
    {IS_DESKTOP&&<div className={`driveStatus ${simpleSync.importFolder?'driveOk':'driveKo'}`}><b>{simpleSync.importFolder?'✓ Dossier Google Drive local configuré':'⚠ Choisissez le dossier A_importer synchronisé par Google Drive'}</b><span>{simpleSync.importFolder||'Exemple : G:\Mon Drive\mesure & amélioration 26\Synchronisation\A_importer'}</span>{simpleSync.lastScan&&<small>Dernier contrôle : {new Date(simpleSync.lastScan).toLocaleString('fr-FR')} · {simpleSync.lastResult}</small>}<div className="actions"><button onClick={chooseSimpleFolder}>Choisir / changer A_importer</button><button onClick={scanSimpleNow} disabled={!simpleSync.importFolder}>Importer maintenant</button></div></div>}
    {IS_DESKTOP&&simpleSync.importFolder&&<div className="syncMonitorGrid"><div><b>Dernier contrôle</b><span>{simpleSyncSummary.lastScan?new Date(simpleSyncSummary.lastScan).toLocaleString('fr-FR'):'En attente'}</span></div><div><b>Dernier résultat</b><span>{simpleSyncSummary.lastResult||'Aucune nouveauté'}</span></div><div><b>Affaires reçues</b><span>{simpleSyncSummary.imported||0}</span></div><div><b>Conflits</b><span>{simpleSyncSummary.conflicts||0}</span></div><div><b>Erreurs</b><span>{simpleSyncSummary.errors||0}</span></div></div>}
    {!IS_DESKTOP&&<div className={`driveStatus ${driveFolderStatus.configured||localStorage.getItem(SAF_FOLDER_KEY)?'driveOk':'driveKo'}`}><b>{driveFolderStatus.configured||localStorage.getItem(SAF_FOLDER_KEY)?'✓ Dossier Google Drive autorisé':'⚠ Dossier Google Drive à sélectionner une seule fois'}</b><span>{driveFolderStatus.name?`Dossier : ${driveFolderStatus.name}`:'Choisissez le dossier partagé A_importer réservé au technicien.'}</span><div className="actions"><button onClick={async()=>{try{const r=await chooseSecabDriveFolder();setDriveFolderStatus?.({checked:true,configured:true,name:r.name||'Dossier Google Drive'});alert('Dossier mémorisé. Les prochaines affaires seront déposées automatiquement.')}catch(e){alert(e.message)}}}>Choisir / changer le dossier Drive</button><button className="secondaryAction" disabled={!(driveFolderStatus.configured||localStorage.getItem(SAF_FOLDER_KEY))} onClick={async()=>{try{await testSecabDriveFolder();alert('Test réussi : le dossier accepte les fichiers SECAB.')}catch(e){alert(e.message)}}}>Tester l’envoi</button></div></div>}
    <details className="driveSettings legacySettings"><summary>Options avancées anciennes (ne pas utiliser)</summary><div className="form"><Field label="URL Web App" value={driveConfig.webAppUrl} onChange={v=>updateDriveConfig({webAppUrl:v})}/><Field label="ID dossier" value={driveConfig.folderId} onChange={v=>updateDriveConfig({folderId:v})}/><Field label="Clé" value={driveConfig.secret} onChange={v=>updateDriveConfig({secret:v})}/></div></details>
    <div className="actions driveActions"><button onClick={expOne}>Exporter l’affaire complète</button><button onClick={expDay}>Exporter secours (.secabday)</button><label className="photoBtn">Importer transfert secours<input type="file" multiple accept=".secabpkg,.secabday,.json,application/json" onChange={imp}/></label><button onClick={csv}>Exporter CSV global</button><button onClick={backup}>Sauvegarde complète</button><label className="photoBtn secondary">Restaurer sauvegarde<input type="file" accept=".secabbackup,application/json" onChange={restore}/></label></div>
    <div className="unlockPanel"><h3>Gestion du verrouillage</h3><p><b>État :</b> {safeActive.validation?.locked?'🔒 Verrouillée terrain':'🔓 Modifiable'}</p>{!IS_DESKTOP&&safeActive.validation?.locked&&<><textarea value={unlockReason} onChange={e=>setUnlockReason(e.target.value)} placeholder="Motif de la demande de réouverture"/><button onClick={requestUnlock}>Demander l’autorisation au responsable</button><label className="photoBtn secondary">Importer l’autorisation du responsable<input type="file" accept=".secabunlock,application/json" onChange={importUnlock}/></label></>}{IS_DESKTOP&&<><label>Affaire à déverrouiller<select value={unlockUuid} onChange={e=>setUnlockUuid(e.target.value)}><option value="">Sélectionner une affaire</option>{activeRecords.map(r=><option key={r.id} value={r.uuid||r.id}>{r.rapport||r.uuid} · {r.codeGdo||r.affaire}</option>)}</select></label><button onClick={authorizeUnlock} disabled={!unlockUuid}>Déverrouiller uniquement cette affaire et générer l’autorisation</button></>}</div>
    <p className="hint">Le format .secabday est un fichier JSON métier lisible par Mesure & amélioration des terres de poste de transformation — Bureau. Il contient les affaires, les mesures, les commentaires et les photos originales.</p>{filteredRecords.length?filteredRecords.map(r=><div className="recordRow registryClickableRow" key={r.id} onDoubleClick={()=>openRecord(r)}><button className="recordOpenButton" onClick={()=>openRecord(r)}><b>{r.isTest?'🧪 TEST · ':''}{r.codeGdo||r.affaire||'Sans affaire'}</b><small>Ouvrir le rapport</small></button><span>{r.commune}</span><span>{r.rapport||r.uuid}</span><span>{r.date||'Date non renseignée'}</span><span>{compute(r).ok?'✅ Conforme':'⚠ Non conforme'}</span><span>{r.validation?.locked?'🔒 Verrouillée':r.statut||'Brouillon'}</span><span className={`syncPill ${r.syncState?.status||'local'}`}>{r.syncState?.status==='synced'?'☁ Synchronisée':r.syncState?.status==='pending'?'⏳ En attente':r.syncState?.status==='conflict'?'⚠ Conflit':'💾 Locale'}</span><span>Rév. {r.revisions?.length||0}</span><button className="danger compactDanger" onClick={e=>{e.stopPropagation();onTrash?.(r,'Registre')}}>🗑 Corbeille</button></div>):<div className="emptyRegistryFocus"><b>Aucune affaire dans ce filtre.</b><span>Le filtre {focusLabels[focus]?.toLowerCase()} ne contient actuellement aucune affaire.</span><button onClick={clearFocus}>Afficher toutes les affaires</button></div>}</section>
}

async function buildPortfolioPdf(m){
  const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold); const logoBytes=await fetch('./secab-logo.jpg').then(r=>r.arrayBuffer()); const logo=await pdf.embedJpg(logoBytes);
  const addPage=()=>{const p=pdf.addPage([595.28,841.89]);const {width,height}=p.getSize();p.drawImage(logo,{x:55,y:height/2-100,width:485,height:190,opacity:.15});return p};
  let page=addPage(), y=790; const text=(t,size=10,b=false)=>{if(y<70){page=addPage();y=790}page.drawText(String(t||'—'),{x:45,y,size,font:b?bold:font,color:rgb(.08,.12,.2)});y-=size+8};
  text('RAPPORT DE CONTRÔLE DES PRISES DE TERRE',17,true); text(`SECAB · ${officialReferenceGate().valid.map(referenceCitation).join(' · ')||'Référentiel officiel non validé'}`,11,true); y-=10; [['Affaire',m.affaire],['Code GDO',m.codeGdo],['Commune',m.commune],['Type d’ouvrage',m.typeOuvrage],['Configuration',m.terreConfig==='interconnectee'?'Interconnectée':'Séparée'],['Technicien',m.technicien],['Date intervention',m.date],['Rapport généré',new Date().toLocaleString('fr-FR')]].forEach(([a,b])=>text(`${a} : ${b}`)); const c=compute(m); y-=8;text('RÉSULTATS',13,true);text(`RM : ${m.rm||'—'} Ω`);if(m.terreConfig==='interconnectee')text(`RNg : ${m.rng||'—'} Ω`);else {text(`RNi : ${m.rni||'—'} Ω`);text(`RMN : ${m.rmn||'—'} Ω`);text(`Rc : ${fmt(c.rc,3)} Ω`);text(`c = Rc / RM : ${fmt(c.c,4)}`)}text(`Conclusion initiale : ${!c.valid?'MESURES INVALIDES':c.ok?'CONFORME':'NON CONFORME'}`,12,true);if(distanceAlert(m))text(distanceAlert(m),10,true);if(c.mode==='separee')text(couplingAdvice(m),9,false);y-=8;text('DIAGNOSTIC ET SOLUTION',13,true);text(m.diagnosticTerrain||c.diagnostic);const s=ELECTRODES.find(x=>x.id===m.solutionRetenue);const noWork=m.solutionRetenue==='none'&&canRetainNoWork(m);text(`Décision : ${noWork?'Aucune intervention — critères validés':(s?.title||'Solution à définir / décision incohérente')}`);text(`Matériel : ${noWork?'Aucun':(m.materielReprise||s?.material||'—')}`);
  const justification=solutionTechnicalJustification(m,s); const expertise=expertiseAssessment(m,s); y-=8; text('POURQUOI CETTE SOLUTION FONCTIONNE',13,true); text(justification.simple,9,false); text(`Référence technique : ${justification.reference}`,9,true); text(justification.validation,8,false); y-=8; text('MOTEUR D’EXPERTISE EXPLICABLE',13,true); text(`Indice global : ${expertise.overall}% — confiance ${expertise.level}`,10,true); text(expertise.reason,9,false); Object.entries(expertise.scores).forEach(([k,v])=>text(`${k} : ${v}%`,8,false)); expertise.limits.forEach(x=>text(`Limite : ${x}`,8,false)); text(`Empreinte du calcul : ${expertise.trace.fingerprint}`,7,false);
  if(s){try{
    page=addPage();
    page.drawText(`SOLUTION RETENUE - ${s.title}`,{x:45,y:790,size:14,font:bold,color:rgb(.08,.12,.2)});
    const refBytes=await fetch(`./b1323/${s.id}.png`).then(r=>r.arrayBuffer());
    const refImg=await pdf.embedPng(refBytes);
    const refScale=Math.min(430/refImg.width,620/refImg.height);
    page.drawImage(refImg,{x:(595-refImg.width*refScale)/2,y:120,width:refImg.width*refScale,height:refImg.height*refScale});
    page.drawText('Illustration technique interne — vérifier le référentiel validé du dossier.',{x:45,y:90,size:9,font});
  }catch{}}

  const final=computeFinal(m);
  page=addPage();
  page.drawText('CONTRÔLE FINAL ET COMPARAISON',{x:45,y:790,size:14,font:bold,color:rgb(.08,.12,.2)});
  const rows=[['RM',c.rm,final.rm],['RNi',c.rni,final.rni],['RMN',c.rmn,final.rmn],['Rc',c.rc,final.rc],['Coefficient',c.c,final.c]];
  let ry=750;for(const [label,a,b] of rows){if(!Number.isFinite(a)&&!Number.isFinite(b))continue;page.drawText(`${label} : avant ${fmt(a,label==='Coefficient'?4:2)} / après ${fmt(b,label==='Coefficient'?4:2)}`,{x:55,y:ry,size:11,font});ry-=24;}
  page.drawText(`Conclusion finale : ${final.ok?'CONFORME':'NON CONFORME'}`,{x:55,y:ry-10,size:13,font:bold,color:final.ok?rgb(.05,.55,.25):rgb(.75,.08,.12)});
  const retainedPdf=rankedApplicableSolutions(m).find(x=>x.id===m.solutionRetenue);
  if(retainedPdf){const pp=solutionComparison(m,retainedPdf),vv=vegetalEarthAdvice(m,retainedPdf);page.drawText(`Performance future : non prédictible · mesure finale : ${Number.isFinite(pp.finalValue)?fmt(pp.finalValue,2)+' Ohm':'non mesurée'}`,{x:55,y:ry-34,size:10,font});page.drawText(`Terre végétale : ${vv.label}${Number.isFinite(vv.volume)&&vv.volume>0?` · environ ${fmt(vv.volume,2)} m3`:''}`,{x:55,y:ry-52,size:10,font:bold});}
  const imp=reportImplantationData(m);
  if(imp.sol&&imp.analysis.lines?.length){
    page=addPage();page.drawText('IMPLANTATION — SOLUTION RETENUE',{x:45,y:790,size:14,font:bold,color:rgb(.08,.12,.2)});
    const [minX,minY,maxX,maxY]=imp.bounds;const sx=470/(maxX-minX||1),sy=570/(maxY-minY||1),sc=Math.min(sx,sy);const px=x=>65+(x-minX)*sc,py=y=>120+(y-minY)*sc;
    for(const f of m.cadastre?.features||[]){for(const ring of geometryRings(f.geometry)){for(let i=0;i<ring.length-1;i++)page.drawLine({start:{x:px(ring[i][0]),y:py(ring[i][1])},end:{x:px(ring[i+1][0]),y:py(ring[i+1][1])},thickness:.7,color:rgb(.35,.43,.35)})}}
    for(const line of imp.analysis.lines||[]){for(let i=0;i<line.length-1;i++)page.drawLine({start:{x:px(line[i][0]),y:py(line[i][1])},end:{x:px(line[i+1][0]),y:py(line[i+1][1])},thickness:4,color:rgb(.08,.65,.25)})}
    page.drawText(imp.sol.title,{x:45,y:90,size:10,font:bold});page.drawText(`Orientation ${Number(m.implantation?.orientation||0)}° · Échelle ${Number(m.implantation?.scale||1).toFixed(2)} ×`,{x:45,y:72,size:9,font});page.drawText(`Parcelles : ${(imp.analysis.parcels||[]).map(x=>x.id).join(', ')||'Aucune détectée'}`,{x:45,y:54,size:9,font});
  }
  const originals=allReportPhotos(m); for(const p of originals){ try{await pdf.attach(dataUrlBytes(p.data),p.name||'photo.jpg',{mimeType:p.type||'image/jpeg',description:p.label||p.caption||'Photo originale SECAB',creationDate:new Date(p.lastModified||Date.now())})}catch{} }
  for(const p of originals){try{page=addPage();const bytes=dataUrlBytes(p.data);const img=(p.type||'').includes('png')?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);const scale=Math.min(500/img.width,650/img.height,1);page.drawText(p.label||p.caption||p.name||'Photo',{x:45,y:790,size:14,font:bold});page.drawImage(img,{x:(595-img.width*scale)/2,y:100,width:img.width*scale,height:img.height*scale})}catch{}}
  const bytes=await pdf.save();if(IS_DESKTOP&&window.__SECAB_AUTH_SESSION__?.token){const archived=await window.secabDesktop.archiveReportArtifact({token:window.__SECAB_AUTH_SESSION__.token,uuid:m.uuid||m.id,reportRef:m.rapport||m.affaire,revision:Number(m.validation?.revision||m.revision||1),bytes:Array.from(bytes),metadata:{reportType:'client',withCosts:false,appVersion:APP_VERSION,referenceReady:officialReferenceGate().ready}});if(!archived?.ok)throw new Error(archived?.error||'Archivage du PDF maître impossible');}download(`${safe(m.rapport||m.affaire||m.uuid)}_Portfolio_SECAB.pdf`,bytes,'application/pdf');
}



function padBoundsMeters(bounds,padM=18){
  const [minX,minY,maxX,maxY]=bounds;
  const midLat=(minY+maxY)/2;
  const dLat=padM/EARTH_M*180/Math.PI;
  const dLng=padM/(EARTH_M*Math.max(.2,Math.cos(midLat*Math.PI/180)))*180/Math.PI;
  return [minX-dLng,minY-dLat,maxX+dLng,maxY+dLat];
}
function implantationViewBounds(m,analysis){
  const geometryCoords=(analysis?.lines||[]).flat().filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));
  if(Array.isArray(analysis?.target))geometryCoords.push(analysis.target);
  const anchor=implantationAnchor(m),centerLng=num(m.implantation?.centerLng||(anchor.valid?anchor.lng:m.gpsLng)),centerLat=num(m.implantation?.centerLat||(anchor.valid?anchor.lat:m.gpsLat));
  if(Number.isFinite(centerLng)&&Number.isFinite(centerLat))geometryCoords.push([centerLng,centerLat]);
  const raw=bbox(geometryCoords);
  const span=Math.max(distanceMeters(raw[0],(raw[1]+raw[3])/2,raw[2],(raw[1]+raw[3])/2),distanceMeters((raw[0]+raw[2])/2,raw[1],(raw[0]+raw[2])/2,raw[3]));
  return padBoundsMeters(raw,Math.max(8,Math.min(28,span*.28)));
}
function ignWmsMapUrl(bounds,width=900,height=520,layer='ORTHOIMAGERY.ORTHOPHOTOS'){
  const [minX,minY,maxX,maxY]=bounds;
  const q=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:layer,STYLES:'',CRS:'CRS:84',BBOX:[minX,minY,maxX,maxY].join(','),WIDTH:String(width),HEIGHT:String(height),FORMAT:'image/jpeg',TRANSPARENT:'false'});
  return `https://data.geopf.fr/wms-r?${q.toString()}`;
}

function reportImplantationData(m){
  const solutions=rankedApplicableSolutions(m), selected=retainedSolutionId(m),anchor=implantationAnchor(m);
  const sol=retainedSolutionObject({...m,solutionRetenue:selected})||solutions.find(x=>x.id===selected)||ELECTRODES.find(x=>x.id===selected);
  if(!sol||selected==='none')return {sol:null,analysis:{lines:[],parcels:[]},features:[],bounds:[55.44,-20.90,55.46,-20.88],ignUrl:'',anchor};
  // RC64 : le rapport ne recalcule et ne recentre jamais une implantation validée.
  // Il relit exactement les coordonnées et la géométrie sauvegardées à l'écran.
  const reportM=m;
  let analysis=analyzeImplantation(reportM,sol,Number(reportM.implantation?.orientation||0));
  const savedGeometry=reportM.implantation?.geometrySnapshot;
  if(reportM.implantation?.placementConfirmed&&Array.isArray(savedGeometry?.lines)&&savedGeometry.lines.length){
    analysis={...analysis,...savedGeometry,restored:true,fromSavedPlacement:true};
  }else if((!analysis.lines||!analysis.lines.length)&&Array.isArray(savedGeometry?.lines)&&savedGeometry.lines.length){
    analysis={...analysis,...savedGeometry,restored:true};
  }
  const drawn=Array.isArray(reportM.implantation?.annotations)?reportM.implantation.annotations:[];
  const drawnLines=drawn.filter(a=>['cable','trench','line','polyline'].includes(a.type)&&Array.isArray(a.points)&&a.points.length>1).map(a=>a.points.map(([lat,lng])=>[Number(lng),Number(lat)]));
  if(drawnLines.length&&!analysis.fromSavedPlacement)analysis={...analysis,lines:drawnLines,connector:[]};
  const bounds=implantationViewBounds(reportM,analysis);
  const features=focusedCadastreFeatures(reportM,analysis,90).filter(f=>{
    const c=featureCentroid(f);
    return c&&c[0]>=bounds[0]&&c[0]<=bounds[2]&&c[1]>=bounds[1]&&c[1]<=bounds[3];
  });
  return {sol,analysis,features,bounds,ignUrl:ignWmsMapUrl(bounds),anchor,reportM};
}
function ImplantationReportPreview({m,compact=false}){
  const {sol,analysis,features=[],bounds,ignUrl,anchor,reportM=m}=reportImplantationData(m);if(!sol)return <div className="reportMapEmpty">Aucune implantation nouvelle retenue.</div>;
  const rings=[];features.forEach((f,i)=>geometryRings(f.geometry).forEach((r,ri)=>rings.push({r,id:parcelLabel(f,i),labelPoint:ri===0?featureCentroid(f):null,hit:(analysis.parcels||[]).some(p=>p.id===parcelLabel(f,i))})));
  const [minX,minY,maxX,maxY]=bounds,w=900,h=520,pad=34,scale=Math.min((w-2*pad)/(maxX-minX||1),(h-2*pad)/(maxY-minY||1));
  const px=x=>pad+(x-minX)*scale,py=y=>h-pad-(y-minY)*scale;
  const centerLng=num(reportM.implantation?.centerLng||(anchor.valid?anchor.lng:reportM.gpsLng)),centerLat=num(reportM.implantation?.centerLat||(anchor.valid?anchor.lat:reportM.gpsLat));
  const spanMeters=distanceMeters(minX,(minY+maxY)/2,maxX,(minY+maxY)/2),barMeters=spanMeters>120?50:spanMeters>60?20:spanMeters>25?10:5,barPx=Math.max(40,barMeters/(spanMeters||1)*(w-2*pad));
  return <div className={`reportMapPreview ${compact?'compact':''}`}><svg viewBox="0 0 900 520" role="img" aria-label="Plan IGN zoomé d’implantation à l’échelle"><rect width="900" height="520" fill="#f5f8f2"/><image href={ignUrl} x="0" y="0" width="900" height="520" preserveAspectRatio="xMidYMid meet" opacity="1"/><rect width="900" height="520" fill="#ffffff" opacity=".08"/>{rings.map((x,i)=><g key={i}><path d={pathForRing(x.r,bounds,w,h,pad)} fill={x.hit?'#f6d887':'transparent'} fillOpacity={x.hit ? .32 : 0} stroke="#ffffff" strokeWidth="4"/>{x.labelPoint&&<text x={px(x.labelPoint[0])} y={py(x.labelPoint[1])} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700" fill="#173a28" stroke="#fff" strokeWidth="5" paintOrder="stroke">{x.id}</text>}</g>)}{[...(analysis.connector||[]),...(analysis.lines||[])].map((line,i)=>{const isConnector=i<(analysis.connector?.length||0),len=Math.round(line.reduce((a,p,j)=>j?a+distanceMeters(line[j-1][0],line[j-1][1],p[0],p[1]):a,0)*10)/10,mid=line[Math.floor(line.length/2)]||line[0];return <g key={i}><path d={linePath(line,bounds,w,h,pad)} fill="none" stroke="#ffffff" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/><path d={linePath(line,bounds,w,h,pad)} fill="none" stroke="#e11d2e" strokeWidth={isConnector?6:9} strokeDasharray={isConnector?'12 7':undefined} strokeLinecap="round" strokeLinejoin="round"/>{!isConnector&&mid&&<g><rect x={px(mid[0])-24} y={py(mid[1])-12} width="48" height="22" rx="5" fill="#fff" stroke="#e11d2e"/><text x={px(mid[0])} y={py(mid[1])+4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#b91c1c">{len} m</text></g>}</g>})}{analysis.target&&<g><circle cx={px(analysis.target[0])} cy={py(analysis.target[1])} r="11" fill="#fff" stroke="#e11d2e" strokeWidth="5"/><circle cx={px(analysis.target[0])} cy={py(analysis.target[1])} r="3" fill="#e11d2e"/></g>}{Number.isFinite(centerLng)&&Number.isFinite(centerLat)&&<circle cx={px(centerLng)} cy={py(centerLat)} r="8" fill="#ef4444" stroke="#fff" strokeWidth="3"/>}<g transform="translate(825,34)"><path d="M 0 24 L 12 0 L 24 24 L 12 18 Z" fill="#0f2744"/><text x="12" y="39" textAnchor="middle" fontSize="12" fontWeight="800" fill="#0f2744">N</text></g><g transform="translate(42,472)"><line x1="0" y1="0" x2={barPx} y2="0" stroke="#0f2744" strokeWidth="5"/><line x1="0" y1="-6" x2="0" y2="6" stroke="#0f2744" strokeWidth="2"/><line x1={barPx} y1="-6" x2={barPx} y2="6" stroke="#0f2744" strokeWidth="2"/><text x={barPx/2} y="20" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f2744">{barMeters} m</text></g><g transform="translate(280,472)"><rect width="340" height="30" rx="7" fill="#0b1f38" opacity=".9"/><text x="170" y="20" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">Schéma d’implantation positionné · {sol.short}</text></g></svg><div className="reportMapMeta"><b>Solution retenue : {sol.title}</b><span>Tracé rouge = schéma retenu et positionné sur la carte · Orientation {Number(m.implantation?.orientation||0)}° · facteur d’affichage {Number(m.implantation?.scale||1).toFixed(2)} ×</span><span>Décalage réel : Est/Ouest {Number(m.implantation?.offsetX||0).toFixed(1)} m · Nord/Sud {Number(m.implantation?.offsetY||0).toFixed(1)} m</span><span>Ouvrage de référence : {anchor.label} · {anchor.type==='neutral'?'amélioration de la terre du neutre':'amélioration de la terre des masses'} · GPS {anchor.valid?`${fmt(anchor.lat,7)} / ${fmt(anchor.lng,7)}`:'non renseigné'}</span><span>Raccordement : {analysis.connection?.label||connectionAnchor(reportM).label} · mode {reportM.implantation?.connectionMode||'automatique'}</span><span>Fond : photographie aérienne IGN · plan centré automatiquement sur le bon ouvrage</span><span>Parcelles traversées : {(analysis.parcels||[]).map(p=>`${p.id}${p.lengthM?` (${p.lengthM} m)`:''}`).join(', ')||'Aucune détectée'}</span></div></div>
}

function ReportMapViews({m}){const d=reportImplantationData(m);if(!d.sol)return null;const satellite=ignWmsMapUrl(d.bounds,3000,1800,'ORTHOIMAGERY.ORTHOPHOTOS');const plan=ignWmsMapUrl(d.bounds,3000,1800,'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2');return <div className="reportTripleViews"><figure><img src={satellite}/><figcaption>Vue satellite / Orthophoto IGN</figcaption></figure><figure><img src={plan}/><figcaption>Vue Plan IGN</figcaption></figure></div>}

function allReportPhotos(m){
  const out=[], seen=new Set();
  const keyOf=photo=>String(photo?.photoId||`${photo?.name||''}:${photo?.lastModified||''}:${photo?.originalSize||photo?.size||''}:${String(photo?.data||'').slice(0,96)}`);
  const add=(photo,caption,stage,source)=>{if(!photo?.data)return;const key=keyOf(photo);if(seen.has(key))return;seen.add(key);out.push({...photo,caption:photo.caption||photo.label||caption,stage,source});};
  Object.entries(m.measurePhotos||{}).forEach(([k,p])=>add(p,MEASURE_META[k]?.label||k,'Mesures initiales',`measure:${k}`));
  add(m.neutralTargetPhoto,'Photo du 2ᵉ ouvrage neutre','Nouvel emplacement','neutralTarget');
  (m.photos||[]).forEach((p,i)=>add(p,p.caption||`Photo complémentaire ${i+1}`,'Terrain / travaux',`terrain:${i}`));
  Object.entries(m.finalMeasurePhotos||{}).forEach(([k,p])=>add(p,`${MEASURE_META[k]?.label||k} — après travaux`,'Contrôle final',`final:${k}`));
  add(m.afterWorkPhoto,'Photo après travaux','Contrôle final','afterWork');
  add(m.reinstatementPhoto,'Photo de la réfection définitive','Réfection','reinstatement');
  return out;
}


function NationalReportSnapshot({m,c,final,sol}){
  const snap=executiveSnapshot(m,c,final); const expert=expertExplanation(m,c,sol);
  const governance=loadGovernance(); const activeRef=(governance.references||[]).find(r=>validateReference(r).ok);
  return <section className="nationalReportSnapshot">
    <div className="nationalBeforeAfter"><div className="before"><small>AVANT</small><b>{snap.initial==null?'—':fmt(snap.initial,3)}</b><span>Situation initiale</span></div><div className="flowArrow">→</div><div className={snap.status==='confirmed'?'after ok':'after'}><small>APRÈS MESURÉ</small><b>{snap.final==null?'—':fmt(snap.final,3)}</b><span>{snap.status==='confirmed'?'Résultat confirmé':'À contrôler'}</span></div><div className="target"><small>OBJECTIF</small><b>≤ {fmt(snap.target,3)}</b><span>{snap.nextAction}</span></div></div>
    <div className="nationalDualReading"><article><small>POUR LE CLIENT</small><h4>Pourquoi cette solution ?</h4><p>{plainLanguageExplanation(m,c)}</p></article><article><small>POUR LE PROFESSIONNEL</small><h4>Fondement et limites</h4><p>{expert.basis}</p><p>{expert.limits}</p></article></div>
    <div className="nationalReferenceLine"><b>Référence technique utilisée :</b> {activeRef?referenceCitation(activeRef):'Référence officielle à compléter et valider dans l’administration avant émission définitive.'}</div>
  </section>
}

function Report({m}){
  const printReport=()=>{try{assertClientRelease(m);setTimeout(()=>window.print(),80)}catch(e){alert(e.message)}};
  const c=compute(m), final=computeFinal(m), decision=reportDecisionState(m), retainedId=retainedSolutionId(m), sol=rankedApplicableSolutions(m).find(s=>s.id===retainedId), perf=sol?solutionComparison(m,sol):null, vegetal=sol?vegetalEarthAdvice(m,sol):null;
  const allPhotos=allReportPhotos(m), coverPhoto=allPhotos[0], annexPhotos=allPhotos;
  const targetPlan=couplingTargetPlan(m), traversed=(reportImplantationData(m).analysis?.parcels||[]);
  const evolution=(a,b)=>Number.isFinite(a)&&a!==0&&Number.isFinite(b)?`${fmt((b-a)/a*100,1)} %`:'—';
  const solutionTitle=retainedId==='none'?'Aucune intervention — installation existante conservée':(sol?.title||'Non renseignée');
  const justification=solutionTechnicalJustification(m,sol);
  const expertise=expertiseAssessment(m,sol);
  const pageCount=7+annexPhotos.length;
  const reportRef=m.rapport||m.affaire||'AFFAIRE';
  const PageHeader=({title,subtitle,page})=><header className="premiumReportHeader"><div className="premiumReportBrand"><img src="./secab-logo.jpg"/><div><b>SECAB</b><span>COUPLAGE EXPERT</span></div></div><div><h2>{title}</h2><p>{subtitle}</p></div><div className="premiumReportRef"><b>{reportRef}</b><span>{m.codeGdo||'—'}</span><small>{page}/{pageCount}</small></div></header>;
  const PageFooter=({page})=><footer className="premiumReportFooter"><span>SECAB · Rapport technique de contrôle des prises de terre</span><span>Généré le {new Date().toLocaleString('fr-FR')}</span><b>{page}/{pageCount}</b></footer>;
  return <section className="reportWorkspace premiumReportWorkspace">
    <div className="reportTopbar noPrint"><div><h2>Rapport final premium SECAB · RC61</h2><p>Le rapport client présente uniquement des mesures réelles, une décision tracée et des preuves contrôlées. Les coûts et estimations chantier restent internes.</p><b className={clientReleaseGate(m).ready?"clientReady":IS_DESKTOP?"clientDraft":"clientBlocked"}>{clientReleaseGate(m).ready?"✓ PRÊT POUR ÉMISSION CLIENT":IS_DESKTOP?`✎ BROUILLON BUREAU ÉDITABLE — ${clientReleaseGate(m).missing.length} information(s) manquante(s)`:`⚠ ÉMISSION BLOQUÉE — ${clientReleaseGate(m).missing.length} contrôle(s) restant(s)`}</b></div><div className="reportModeChoice"><button className="selected" onClick={()=>{}}>Rapport client</button></div><div className="actions"><button onClick={printReport}>PDF client</button><button onClick={()=>{try{assertClientRelease(m);buildPortfolioPdf(m)}catch(e){alert(e.message)}}}>Portfolio client</button><button onClick={()=>{try{assertClientRelease(m);buildWordReport(m)}catch(e){alert(e.message)}}}>Word client</button></div></div>
    <div className="reportPages premiumReportPages">
      <article className="a4ReportPage secabExecutiveCover">
        <header className="secabExecutiveHeader">
          <div className="secabExecutiveTitle"><span>RAPPORT FINAL</span><h1>Mesure et Amélioration des Prises de Terre</h1><p>Poste de Transformation HTA/BT</p></div>
          <span className="secabExecutiveVersion">V2.0 RC61</span>
        </header>
        <section className="secabExecutiveIdentity">
          <div><span className="secabIcon">▥</span><p><small>CLIENT</small><b>SECAB</b></p></div>
          <div><span className="secabIcon">⌖</span><p><small>SITE</small><b>{m.typeOuvrage||'Poste de Transformation HTA/BT'}</b><em>{m.commune||'—'}</em></p></div>
          <div><span className="secabIcon">▣</span><p><small>DATE D’INTERVENTION</small><b>{m.date||today()}</b></p></div>
          <div><span className="secabIcon">♙</span><p><small>TECHNICIEN</small><b>{m.technicien||'SECAB'}</b><em>Équipe technique</em></p></div>
        </section>
        <section className="secabExecutiveHero">
          {coverPhoto?.data?<img src={coverPhoto.data} alt="Poste de transformation"/>:<img src="./secab-report-hero.png" alt="Illustration premium d’un poste de transformation HTA/BT"/>}
          <div className="secabExecutiveHeroShade"></div>
          <div className="secabExecutiveHeroCopy"><h2>SÉCURISER<br/>AUJOURD’HUI,<br/><em>PROTÉGER DEMAIN.</em></h2><i></i><p>L’expertise <b>SECAB</b><br/>au service de la performance électrique.</p></div>
          <div className="secabExecutiveShield">⚡</div>
        </section>
        <section className="secabExecutiveSection">
          <h3>SYNTHÈSE DE L’INTERVENTION</h3>
          <div className="secabExecutiveKpis">
            <div><span className="kpiIcon blue">✓</span><strong>100 %</strong><b>Mesures réalisées</b><p>Conformément au protocole SECAB</p></div>
            <div><span className="kpiIcon green">◇</span><strong>{expertise.limits.length}</strong><b>Points sensibles identifiés</b><p>{expertise.limits.length?'Nécessitant une vigilance':'Aucun point critique bloquant'}</p></div>
            <div><span className="kpiIcon blue">↗</span><strong>{sol?1:0}</strong><b>Recommandation retenue</b><p>{sol?sol.short||sol.title:'Aucune intervention'}</p></div>
            <div><span className="kpiIcon gold">◎</span><strong>{final.ok?'CONFORME*':'À CORRIGER'}</strong><b>Exigences techniques</b><p>{final.ok?'Sous réserve de la complétude du dossier':'Action complémentaire requise'}</p></div>
          </div>
        </section>
        <section className="secabExecutiveObjective">
          <span>◎</span><div><h3>OBJECTIF DE L’INTERVENTION</h3><p>Vérifier l’état des prises de terre existantes, identifier les points sensibles et proposer les solutions adaptées afin de garantir la sécurité des personnes et des installations conformément aux prescriptions techniques en vigueur.</p></div><img src="./secab-logo.jpg" alt="SECAB"/>
        </section>
        <section className="secabExecutiveTechnical">
          <h3>RÉSUMÉ TECHNIQUE</h3>
          <div>
            <p><span className="ohm">Ω</span><small>Résistance de terre<br/>RM mesurée</small><strong>{Number.isFinite(final.rm)?`${fmt(final.rm,2)} Ω (finale)`:Number.isFinite(c.rm)?`${fmt(c.rm,2)} Ω (initiale)`:'À mesurer'}</strong></p>
            <p><span className="gauge green">◔</span><small>Résistance de terre<br/>RNi mesurée</small><strong>{Number.isFinite(final.rni)?`${fmt(final.rni,2)} Ω`:`${fmt(c.rni,2)} Ω (initiale)`}</strong></p>
            <p><span className="gauge gold">◔</span><small>Résistance de terre<br/>RMN mesurée</small><strong>{Number.isFinite(final.rmn)?`${fmt(final.rmn,2)} Ω`:'À mesurer'}</strong></p>
            <p><span className="wave">〰</span><small>Coefficient de couplage<br/>mesuré</small><strong>{Number.isFinite(final.c)?fmt(final.c,3):`${fmt(c.c,3)} (initial)`}</strong></p>
          </div>
          <small className="secabExecutiveFootnote">* Conformité déterminée à partir des valeurs saisies et des critères intégrés au logiciel. La validation finale reste conditionnée à la complétude des preuves et au visa du responsable.</small><div className={`secabConfidence ${dossierConfidence(m).level.toLowerCase()}`}><b>Indice de confiance du dossier : {dossierConfidence(m).score}% — {dossierConfidence(m).level}</b><span>{dossierConfidence(m).detail}</span></div>
        </section>
        <footer className="secabExecutiveFooter"><span>⚡</span><b>L’EXPERTISE ÉLECTRIQUE AU SERVICE DE <em>VOS INSTALLATIONS</em></b><strong>1/{pageCount}</strong></footer>
      </article>

      <article className="a4ReportPage premiumReportPage">
        <PageHeader title="Synthèse exécutive" subtitle="Lecture immédiate de l’affaire et du résultat" page={2}/>
        <section className="premiumSummaryGrid">
          <div className="premiumSummaryMain"><span className={`premiumDecisionBadge ${decision.conform?'ok':'ko'}`}>{decision.label}</span><h3>{solutionTitle}</h3><p>{decision.detail}</p></div>
          <div className="premiumKpi"><small>RM finale</small><strong>{fmt(final.rm,2)} Ω</strong><span>Initiale : {fmt(c.rm,2)} Ω</span></div>
          <div className="premiumKpi"><small>RNi finale</small><strong>{fmt(final.rni,2)} Ω</strong><span>Initiale : {fmt(c.rni,2)} Ω</span></div>
          <div className="premiumKpi"><small>RMN finale</small><strong>{fmt(final.rmn,2)} Ω</strong><span>Initiale : {fmt(c.rmn,2)} Ω</span></div>
          <div className={`premiumKpi accent ${final.ok?'ok':'ko'}`}><small>Couplage final</small><strong>{fmt(final.c,3)}</strong><span>Objectif ≤ 0,150</span></div>
        </section>
        <ReportSection n="1" title="IDENTIFICATION DE L’AFFAIRE"><div className="premiumInfoGrid">{[['Affaire',m.affaire],['Code GDO',m.codeGdo],['Commune',m.commune],['Type d’ouvrage',m.typeOuvrage],['Configuration',m.terreConfig==='interconnectee'?'Interconnectée':'Séparée'],['Opérateur',m.technicien||'—'],['GPS',`${m.gpsLat||'—'} / ${m.gpsLng||'—'}`],['Date',m.date||today()]].map(([a,b])=><div key={a}><small>{a}</small><b>{b||'—'}</b></div>)}</div></ReportSection>
        <ReportSection n="2" title="CONCLUSION TECHNIQUE"><div className={`premiumConclusion ${final.ok?'ok':'ko'}`}><b>{final.ok?'Objectif atteint':'Objectif non atteint'}</b><p>{final.ok?'Les mesures finales confirment la conformité de l’installation. Le dossier peut être clôturé sous réserve de la complétude documentaire.':'Les résultats nécessitent une reprise ou une validation technique complémentaire avant clôture.'}</p></div></ReportSection><NationalReportSnapshot m={m} c={c} final={final} sol={sol}/><ReportQualitySummary m={m}/>
        <PageFooter page={2}/>
      </article>

      <article className="a4ReportPage premiumReportPage">
        <PageHeader title="Mesures et diagnostic" subtitle="Comparaison avant / après intervention" page={3}/>
        <div className="premiumMeasureHero"><div><small>COEFFICIENT DE COUPLAGE</small><strong>{fmt(c.c,3)} <span>→</span> {fmt(final.c,3)}</strong><p>Évolution : {evolution(c.c,final.c)}</p></div><div className={`premiumGauge ${final.ok?'ok':'ko'}`}><span style={{width:`${Math.min(100,Math.max(4,(Number(final.c)||0)/.3*100))}%`}}></span></div><small>Zone conforme : 0 à 0,150</small></div>
        <table className="a4Table premiumMeasureTable"><thead><tr><th>Paramètre</th><th>Avant travaux</th><th>Après travaux</th><th>Évolution</th><th>État</th></tr></thead><tbody>{[['RM (Ω)',c.rm,final.rm],['RNi (Ω)',c.rni,final.rni],['RMN (Ω)',c.rmn,final.rmn],['Résistivité (Ω.m)',num(m.resistivite),final.resistivite],['Coeff. de couplage',c.c,final.c]].map(([label,a,b])=><tr key={label}><td>{label}</td><td>{fmt(a,label.includes('Coeff')?3:2)}</td><td>{fmt(b,label.includes('Coeff')?3:2)}</td><td>{evolution(a,b)}</td><td><span className={`tableStatus ${Number.isFinite(b)?(b<=a?'ok':'neutral'):'neutral'}`}>{!Number.isFinite(b)?'Non mesurée':b<=a?'Amélioration mesurée':'Valeur augmentée'}</span></td></tr>)}</tbody></table>
        <ReportSection n="3" title="OBJECTIF DE CORRECTION">{targetPlan?<div className="premiumTargetGrid"><div><small>Rc initial</small><b>{fmt(c.rc,3)} Ω</b></div><div><small>Rc maximal visé</small><b>{fmt(targetPlan.rcMax,3)} Ω</b></div><div><small>Réduction minimale</small><b>{fmt(targetPlan.rcReduction,3)} Ω</b></div><div className="wide"><small>Priorité technique</small><b>{targetPlan.priority}</b></div></div>:<p>Aucun calcul correctif requis.</p>}</ReportSection>
        <ReportSection n="4" title="OBSERVATIONS"><div className="premiumNotes">{m.observations||m.reprise||'Aucune observation complémentaire renseignée.'}</div></ReportSection>
        <PageFooter page={3}/>
      </article>

      <article className="a4ReportPage premiumReportPage premiumMapPage">
        <PageHeader title="Implantation sur plan" subtitle="Position, orientation et emprise de la solution retenue" page={4}/>
        <div className="premiumMapFrame"><ImplantationReportPreview m={m} compact/></div>
        <ReportMapViews m={m}/>
        <div className="premiumMapFacts"><div><small>Solution</small><b>{solutionTitle}</b></div><div><small>Orientation</small><b>{Number(m.implantation?.orientation||0)}°</b></div><div><small>Positionnement</small><b>Libre, enregistré sur plan</b></div><div><small>Cuivre</small><b>{Number(m.implantation?.smartDesign?.actualLengthM||m.implantation?.smartDesign?.lengthM||0).toFixed(1)} m</b></div><div><small>Piquets</small><b>{Number(m.implantation?.smartDesign?.piquets||0)}</b></div><div><small>Parcelles</small><b>{traversed.map(x=>x.id).join(', ')||'Aucune'}</b></div></div>
        <div className="premiumMapLegend"><span><i className="redLine"></i> Schéma retenu</span><span><i className="gpsDot"></i> Point GPS</span><span><i className="parcelBox"></i> Parcelle traversée</span></div>
        <PageFooter page={4}/>
      </article>

      <article className="a4ReportPage premiumReportPage technicalReportPage">
        <PageHeader title="Schéma technique d’exécution" subtitle="Plan coté, coupe de pose et paramètres réellement retenus" page={5}/>
        {sol?<TechnicalSchema m={m} sol={sol} editable={false} compact/>:<div className="premiumNoWork">Aucun schéma d’exécution : aucune intervention nouvelle.</div>}
        {sol&&<div className="technicalReportSpecs"><div><small>Raccordement</small><b>{smartDesignFor(m,sol).connection}</b></div><div><small>Note d’exécution</small><b>{smartDesignFor(m,sol).profileNote}</b></div><div><small>Décalage depuis l’ouvrage</small><b>ΔX {Math.round(Number(m.implantation?.offsetX||0))} m · ΔY {Math.round(Number(m.implantation?.offsetY||0))} m</b></div><div><small>Validation implantation</small><b>{m.implantation?.placementConfirmed?'Enregistrée':'À confirmer'}</b></div></div>}
        <PageFooter page={5}/>
      </article>

      <article className="a4ReportPage premiumReportPage">
        <PageHeader title="Solution et validation" subtitle="Prescriptions, résultat et visa final" page={6}/>
        <div className="premiumSolutionLayout">{sol?<><div className="premiumDiagram"><ReferenceDiagram solutionId={sol.id} title={sol.title} m={m}/></div><div className="premiumSolutionText"><span className="premiumSolutionTag">SOLUTION RETENUE</span><h3>{sol.title}</h3><div className="premiumSpecList"><p><small>Matériau</small><b>{sol.material}</b></p><p><small>Emprise</small><b>{sol.footprint}</b></p><p><small>Raccordement</small><b>{technicalReferences(m,sol)[0]?.title||'Référentiel à valider'}</b></p><p><small>Terre végétale</small><b>{vegetal?.label||'À déterminer'}</b></p></div><p className="premiumWorkText"><b>Travaux prévus :</b> {m.reprise||sol.steps.join(' · ')}</p></div></>:<div className="premiumNoWork">Aucune nouvelle prise de terre à réaliser.</div>}</div>
        <section className="premiumJustification">
          <div className="premiumJustificationTitle"><span>POURQUOI CETTE SOLUTION FONCTIONNE</span><h3>Lecture client et justification professionnelle</h3></div>
          <div className="premiumJustificationGrid"><div><small>EXPLICATION SIMPLE — 2 PHRASES</small><p>{justification.simple}</p></div><div><small>JUSTIFICATION TECHNIQUE</small><p>{justification.professional}</p></div></div>
          <div className="premiumReferenceBox"><b>Texte technique utilisé</b><p>{justification.reference}</p><span>{justification.validation}</span></div>
        </section>
        <section className="expertNarrativeBlock">
          {(()=>{const n=expertRiskNarrative(m);return <><div><small>POURQUOI INTERVENIR ?</small><p>{n.need}</p></div><div><small>RISQUE EN L’ABSENCE D’ACTION</small><p>{n.risk}</p></div><div><small>BÉNÉFICE TECHNIQUE ATTENDU</small><p>{n.benefit}</p></div></>})()}
        </section>
        <section className="beforeAfterVisual">
          <div className={`beforeAfterCard ${c.ok?'ok':'ko'}`}><small>AVANT TRAVAUX</small><strong>{Number.isFinite(c.c)?fmt(c.c,3):fmt(c.rm,2)+' Ω'}</strong><span>{c.ok?'Critère satisfait':'Correction nécessaire'}</span></div>
          <div className="beforeAfterArrow"><b>→</b><span>{sol?.title||'Contrôle'}</span></div>
          <div className="beforeAfterCard pending"><small>OBJECTIF APRÈS TRAVAUX</small><strong>À MESURER</strong><span>Aucune valeur simulée n’est présentée comme un résultat</span></div>
          <div className={`beforeAfterCard ${final.ok?'ok':'pending'}`}><small>APRÈS MESURÉ</small><strong>{Number.isFinite(final.c)?fmt(final.c,3):'À mesurer'}</strong><span>{Number.isFinite(final.c)?(final.ok?'Conformité confirmée':'Action complémentaire'):'Validation terrain requise'}</span></div>
        </section>
        <section className="expertiseDecisionBlock">
          <div className="expertiseHeader"><div><span>MOTEUR D’EXPERTISE EXPLICABLE</span><h3>Analyse multicritère de faisabilité de la solution retenue</h3></div><strong>{expertise.overall}%<small>niveau de dossier {expertise.level.toLowerCase()}</small></strong></div>
          <p className="expertiseReason">{expertise.reason}</p>
          <div className="expertiseScores">{[['Fiabilité technique',expertise.scores.technical],['Facilité d’exécution',expertise.scores.execution],['Temps de chantier',expertise.scores.time],['Coût estimatif',expertise.scores.cost],['Impact terrain',expertise.scores.impact],['Qualité des preuves',expertise.scores.evidence],['Robustesse terrain',expertise.scores.robustness],['Maintenabilité',expertise.scores.maintainability]].map(([label,value])=><div key={label}><span>{label}</span><b>{value}%</b><i><em style={{width:`${value}%`}}></em></i></div>)}</div>
          {expertise.rejected.length>0&&<div className="expertiseAlternatives"><small>SOLUTIONS NON RETENUES</small>{expertise.rejected.map((x,i)=><p key={i}><b>{x.title}</b><span>{x.reason}</span></p>)}</div>}
          {expertise.limits.length>0&&<div className="expertiseLimits"><b>Limites et vérifications nécessaires</b>{expertise.limits.map((x,i)=><p key={i}>• {x}</p>)}</div>}
        </section>
        {sol&&<div className="premiumSimulation"><div><small>Valeur initiale mesurée</small><strong>{fmt(perf?.initialValue,2)} Ω</strong></div><div><small>Travaux retenus</small><strong>{sol.short||sol.title}</strong></div><div><small>Valeur finale mesurée</small><strong>{Number.isFinite(perf?.finalValue)&&perf.finalValue>0?`${fmt(perf.finalValue,2)} Ω`:'Non mesurée'}</strong></div><div><small>Coefficient final</small><strong>{Number.isFinite(final.c)?fmt(final.c,4):'À mesurer'}</strong></div></div>}
        <div className={`premiumFinalDecision ${decision.conform?'ok':'ko'}`}><div><small>DÉCISION FINALE</small><strong>{decision.label}</strong></div><p>{decision.detail}</p></div>
        <section className="reportTraceability"><h3>Traçabilité du calcul</h3><div>{Object.entries(expertise.trace).map(([k,v])=><p key={k}><small>{k}</small><b>{v}</b></p>)}</div></section>
        <section className="reportGlossaryBlock"><h3>Glossaire — comprendre les valeurs du rapport</h3><div>{reportGlossary().map(([term,definition])=><p key={term}><b>{term}</b><span>{definition}</span></p>)}</div></section>
        <section className="referenceRegister"><h3>Références techniques utilisées</h3>{technicalReferences(m,sol).map((r,i)=><div key={i}><b>{r.title}</b><span>{r.version}</span><p>{r.scope} · {r.location}</p><small>{r.status}</small></div>)}</section>
        <section className="auditTimeline"><h3>Historique et traçabilité des actions</h3>{auditTimeline(m).map((x,i)=><p key={i}><time>{x.date?new Date(x.date).toLocaleString('fr-FR'):'—'}</time><b>{x.actor}</b><span>{x.action}</span></p>)}</section>
        <div className="premiumSignatures"><div><b>Opérateur SECAB</b><span>{m.technicien||'SECAB Terrain'}</span><small>Date : {m.date||today()}</small><em>Signature</em></div><div><b>Visa responsable</b><span>Nom : ____________________</span><small>Date : ____________________</small><em>Signature</em></div></div>
        <PageFooter page={6}/>
      </article>

      <article className="a4ReportPage premiumReportPage premiumVisualSummaryPage">
        <PageHeader title="Dossier photographique" subtitle="Contrôle visuel de l’ouvrage, de l’implantation et des preuves terrain" page={7}/>
        <section className="reportVisualSchemaBlock">
          <div className="reportVisualSchemaTitle"><span>SCHÉMA TECHNIQUE</span><h3>{solutionTitle}</h3></div>
          
        </section>
        <section className="reportPhotoContactSheet"><div className="reportContactHeader"><div><span>PHOTOGRAPHIES DU DOSSIER</span><h3>{allPhotos.length} image{allPhotos.length>1?'s':''} disponible{allPhotos.length>1?'s':''}</h3></div><b>{allPhotos.length?`${allPhotos.length} preuve(s) intégrée(s)`:'Photos à compléter'}</b></div><div className="reportContactGrid">{Array.from({length:6},(_,i)=>{const p=allPhotos[i];return p?<figure key={i}><img src={p.thumbnail||p.data}/><figcaption><b>REP-PH-{String(i+1).padStart(2,'0')}</b><span>{p.caption||p.name||`Photo ${i+1}`}</span></figcaption></figure>:<div className="reportPhotoPlaceholder" key={i}><span>📷</span><b>Emplacement photo</b><small>{i===0?'Mesure initiale':i===1?'Ouvrage / environnement':i===2?'Implantation':i===3?'Travaux réalisés':i===4?'Mesure finale':'Réfection définitive'}</small></div>})}</div></section>
        <PageFooter page={7}/>
      </article>

      {annexPhotos.map((p,i)=><article className="a4ReportPage premiumReportPage premiumPhotoPage" key={`${p.name||'photo'}-${i}`}><PageHeader title="Annexe photographique" subtitle={`${p.stage||'Affaire'} · REP-PH-${String(i+1).padStart(2,'0')}`} page={i+8}/><div className="premiumPhotoTitle"><span>REP-PH-{String(i+1).padStart(2,'0')}</span><h3>{p.caption||p.name||`Photo ${i+1}`}</h3></div><div className="premiumPhotoFrame"><img src={p.data}/></div><div className="premiumPhotoMeta"><div><small>Étape</small><b>{p.stage||'—'}</b></div><div><small>Date</small><b>{p.lastModified?new Date(p.lastModified).toLocaleString('fr-FR'):'—'}</b></div><div><small>Coordonnées affaire</small><b>{m.gpsLat||'—'} / {m.gpsLng||'—'}</b></div><div><small>Référence</small><b>{reportRef}</b></div></div><PageFooter page={i+8}/></article>)}
    </div>
  </section>
}


function ReportQualitySummary({m}){const q=qualityAssessment(m);return <ReportSection n="3" title="CONTRÔLE QUALITÉ DU DOSSIER"><div className="reportQuality"><div className={`reportQualityScore ${q.level}`}><strong>{q.score}%</strong><span>complétude</span></div><div className="reportQualityChecks">{q.checks.map(x=><span key={x.id} className={x.ok?'ok':'ko'}>{x.ok?'✓':'×'} {x.label}</span>)}</div></div>{q.anomalies.length>0&&<div className="reportQualityAlerts">{q.anomalies.map((a,i)=><p key={i}>⚠ {a}</p>)}</div>}</ReportSection>}

function ReportSection({n,title,children}){return <section className="a4Section"><h3><span>{n}.</span> {title}</h3>{children}</section>}

createRoot(document.getElementById('root')).render(<ErrorBoundary name="application"><App/></ErrorBoundary>);
