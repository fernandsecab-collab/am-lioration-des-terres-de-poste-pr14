const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');

const authSessions = new Map();
function createSession(user){ const token=crypto.randomBytes(32).toString('hex'); authSessions.set(token,{user,createdAt:Date.now(),lastSeen:Date.now()}); return token; }
function sessionUser(token){ const session=authSessions.get(String(token||'')); if(!session)return null; if(Date.now()-session.lastSeen>12*60*60*1000){authSessions.delete(token);return null} session.lastSeen=Date.now(); return session.user; }


function secabRoot(){ const p=path.join(app.getPath('userData'),'SECAB-Couplage-Expert'); if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true}); return p; }
function appendLog(file,payload){ try{const dir=path.join(secabRoot(),'logs');ensureDir(dir);fs.appendFileSync(path.join(dir,file),JSON.stringify(payload)+'\n','utf8')}catch{} }
function pruneBackups(dir,keep=30){try{fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>({x,t:fs.statSync(path.join(dir,x)).mtimeMs})).sort((a,b)=>b.t-a.t).slice(keep).forEach(o=>fs.rmSync(path.join(dir,o.x),{force:true}))}catch{}}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: 'Mesure & amélioration des terres de poste de transformation',
    autoHideMenuBar: true,
    backgroundColor: '#071326',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.webContents.on('render-process-gone',(_e,details)=>appendLog('crashes.jsonl',{at:new Date().toISOString(),type:'render-process-gone',details}));
  win.webContents.on('unresponsive',()=>appendLog('crashes.jsonl',{at:new Date().toISOString(),type:'unresponsive'}));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if(/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate',(event,url)=>{
    const current=win.webContents.getURL();
    if(url!==current) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}




ipcMain.handle('desktop-geolocation', async () => {
  const ps = String.raw`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
function Await-WinRT($Operation, $ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if(-not $task.Wait(10000)){ throw 'Délai de localisation Windows dépassé.' }
  return $task.Result
}
$geo = New-Object Windows.Devices.Geolocation.Geolocator
$geo.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::High
$geo.MovementThreshold = 1
$position = Await-WinRT ($geo.GetGeopositionAsync()) ([Windows.Devices.Geolocation.Geoposition])
$coordinate = $position.Coordinate
[pscustomobject]@{
  latitude = $coordinate.Point.Position.Latitude
  longitude = $coordinate.Point.Position.Longitude
  altitude = $coordinate.Point.Position.Altitude
  accuracy = $coordinate.Accuracy
  source = 'Localisation Windows'
} | ConvertTo-Json -Compress`;
  return await new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
      if(error){
        resolve({ok:false,error:String(stderr||error.message||'Localisation Windows indisponible').trim()});
        return;
      }
      try{ resolve({ok:true,data:JSON.parse(String(stdout).trim())}); }
      catch(e){ resolve({ok:false,error:`Réponse de localisation Windows invalide : ${e.message}`}); }
    });
  });
});

ipcMain.handle('fetch-cartography', async (_event, payload) => {
  try {
    const geom = payload?.geom;
    if (!geom) throw new Error('Géométrie GPS manquante');
    const g=encodeURIComponent(JSON.stringify(geom));
    const endpoints={cadastre:`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${g}&source_ign=PCI&_limit=300`,documents:`https://apicarto.ign.fr/api/gpu/document?geom=${g}`,zones:`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${g}`,prescriptionsSurf:`https://apicarto.ign.fr/api/gpu/prescription-surf?geom=${g}`,prescriptionsLin:`https://apicarto.ign.fr/api/gpu/prescription-lin?geom=${g}`};
    const data={};
    for(const [key,url] of Object.entries(endpoints)){
      try{const response=await fetch(url,{headers:{accept:'application/json','user-agent':'SECAB-Couplage-Expert/33.0'}});data[key]=response.ok?await response.json():{type:'FeatureCollection',features:[],error:`HTTP ${response.status}`};}
      catch(e){data[key]={type:'FeatureCollection',features:[],error:e.message};}
    }
    return {ok:true,data};
  } catch (error) { return { ok: false, error: error?.message || String(error) }; }
});


ipcMain.handle('fetch-arcgis', async (_event, payload) => {
  try{
    const lng=Number(payload?.lng),lat=Number(payload?.lat),radiusM=Math.max(25,Math.min(1000,Number(payload?.radiusM||100)));
    const itemId=String(payload?.itemId||'897f5f20fed7477b881653ac31b98520');
    const portal=String(payload?.portal||'https://edfseicorseore.maps.arcgis.com').replace(/\/$/,'');
    if(!Number.isFinite(lng)||!Number.isFinite(lat))throw new Error('Coordonnées ArcGIS manquantes');
    const get=async url=>{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'SECAB-Couplage-Expert/46.0'}});if(!r.ok)throw new Error(`ArcGIS HTTP ${r.status}`);const j=await r.json();if(j?.error)throw new Error(j.error.message||'Erreur ArcGIS');return j};
    const info=await get(`${portal}/sharing/rest/content/items/${encodeURIComponent(itemId)}?f=json`);
    const webmap=await get(`${portal}/sharing/rest/content/items/${encodeURIComponent(itemId)}/data?f=json`);
    const flatten=(layers=[],parent='')=>layers.flatMap(l=>{const title=[parent,l.title||l.name||'Couche ArcGIS'].filter(Boolean).join(' / ');return [...(l.url?[{title,url:l.url,visibility:l.visibility!==false}]:[]),...(Array.isArray(l.layers)?flatten(l.layers,title):[])]});
    const refs=flatten(webmap.operationalLayers||[]).filter(x=>x.visibility!==false),features=[],layers=[];
    const walkPoint=g=>{if(!g)return null;if(g.type==='Point')return g.coordinates;const pts=[];const walk=c=>{if(!Array.isArray(c))return;if(c.length>=2&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))pts.push([Number(c[0]),Number(c[1])]);else c.forEach(walk)};walk(g.coordinates);return pts.length?[pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length]:null};
    const dist=f=>{const p=walkPoint(f.geometry);if(!p)return Infinity;const p1=lat*Math.PI/180,p2=p[1]*Math.PI/180,dP=(p[1]-lat)*Math.PI/180,dL=(p[0]-lng)*Math.PI/180,q=Math.sin(dP/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dL/2)**2;return 2*6371000*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))};
    for(const ref of refs.slice(0,30)){
      try{
        let targets=[];const clean=String(ref.url).replace(/\/$/,'');
        if(/\/(FeatureServer|MapServer)\/\d+$/i.test(clean))targets=[{title:ref.title,url:clean}];
        else{const meta=await get(`${clean}?f=json`);targets=(meta.layers||[]).slice(0,50).map(x=>({title:`${ref.title} / ${x.name||x.id}`,url:`${clean}/${x.id}`}))}
        for(const t of targets){
          try{const q=new URLSearchParams({f:'geojson',where:'1=1',geometry:`${lng},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(radiusM),units:'esriSRUnit_Meter',outFields:'*',returnGeometry:'true',outSR:'4326',resultRecordCount:'100'});const fc=await get(`${t.url}/query?${q.toString()}`);const fs=(fc.features||[]).map(f=>({...f,properties:{...(f.properties||{}),__secabLayer:t.title,__secabLayerUrl:t.url}}));if(fs.length){layers.push({title:t.title,url:t.url,count:fs.length});features.push(...fs)}}catch(e){layers.push({title:t.title,url:t.url,count:0,error:e.message})}
        }
      }catch(e){layers.push({title:ref.title,url:ref.url,count:0,error:e.message})}
    }
    features.forEach(f=>f.properties={...(f.properties||{}),__secabDistanceM:Math.round(dist(f)*10)/10});features.sort((a,b)=>(a.properties.__secabDistanceM??Infinity)-(b.properties.__secabDistanceM??Infinity));
    const likely=features.filter(f=>/poste|hta|bt|transform|ouvrage/i.test(`${f.properties.__secabLayer||''} ${Object.values(f.properties||{}).join(' ')}`));
    return {ok:true,data:{item:{id:itemId,title:info.title||'Carte EDF SEI',owner:info.owner||'',modified:info.modified||null},layers,features,nearest:likely[0]||features[0]||null,loadedAt:new Date().toISOString(),radiusM}};
  }catch(e){return {ok:false,error:e.message}}
});

ipcMain.handle('save-json', async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: 'Exporter les données SECAB',
    defaultPath: `secab-couplage-export-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('save-csv', async (_event, csv) => {
  const result = await dialog.showSaveDialog({
    title: 'Exporter le registre CSV',
    defaultPath: `registre-secab-${new Date().toISOString().slice(0,10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  fs.writeFileSync(result.filePath, csv, 'utf8');
  return { ok: true, filePath: result.filePath };
});


function ensureDir(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
function dataUrlToBuffer(data){ const m=String(data||'').match(/^data:([^;]+);base64,(.*)$/); return m?Buffer.from(m[2],'base64'):Buffer.from(String(data||'')); }
function safeName(s){ return String(s||'fichier').replace(/[\\/:*?"<>|]+/g,'-'); }
function collectPhotos(record){ const out=[]; const add=(k,v)=>{if(v&&v.data)out.push({key:k,name:v.name||`${k}.jpg`,data:v.data})}; Object.entries(record.measurePhotos||{}).forEach(([k,v])=>add(`mesure-${k}`,v)); Object.entries(record.finalMeasurePhotos||{}).forEach(([k,v])=>add(`final-${k}`,v)); (record.photos||[]).forEach((v,i)=>add(`generale-${i+1}`,v)); add('apres-travaux',record.afterWorkPhoto); add('refection-terminee',record.reinstatementPhoto); return out; }
ipcMain.handle('archive-record', async (_event, record) => {
  try{
    const uuid=record.uuid||record.id; if(!uuid)throw new Error('UUID manquant');
    const root=path.join(app.getPath('userData'),'SECAB-Couplage-Expert','affaires',safeName(uuid)); const photosDir=path.join(root,'photos'); ensureDir(photosDir);
    const clean={...record,measurePhotos:{},finalMeasurePhotos:{},photos:[],afterWorkPhoto:null,reinstatementPhoto:null};
    fs.writeFileSync(path.join(root,'affaire.json'),JSON.stringify(clean,null,2),'utf8');
    const backupDir=path.join(root,'backups');ensureDir(backupDir);fs.writeFileSync(path.join(backupDir,`backup-${Date.now()}.json`),JSON.stringify(clean),'utf8');
    for(const ph of collectPhotos(record)){const ext=path.extname(ph.name)||'.jpg';fs.writeFileSync(path.join(photosDir,`${safeName(ph.key)}${ext}`),dataUrlToBuffer(ph.data));}
    return {ok:true,path:root};
  }catch(e){return {ok:false,error:e.message}}
});
ipcMain.handle('load-archive-index',async()=>{try{const root=path.join(app.getPath('userData'),'SECAB-Couplage-Expert','affaires');ensureDir(root);return {ok:true,folders:fs.readdirSync(root)}}catch(e){return {ok:false,error:e.message}}});


ipcMain.handle('report-renderer-error',async(_event,payload)=>{appendLog('renderer-errors.jsonl',payload);return {ok:true}});
ipcMain.handle('create-auto-backup',async(_event,payload)=>{try{const dir=path.join(secabRoot(),'backups');ensureDir(dir);const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=path.join(dir,`backup-${stamp}.json`);fs.writeFileSync(file,JSON.stringify(payload,null,2),'utf8');pruneBackups(dir,30);return {ok:true,filePath:file}}catch(e){return {ok:false,error:e.message}}});
ipcMain.handle('list-auto-backups',async()=>{try{const dir=path.join(secabRoot(),'backups');ensureDir(dir);const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>{const p=path.join(dir,x),st=fs.statSync(p);return {name:x,path:p,size:st.size,modifiedAt:st.mtime.toISOString()}}).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));return {ok:true,files}}catch(e){return {ok:false,error:e.message}}});
ipcMain.handle('read-auto-backup',async(_event,filePath)=>{try{const dir=path.resolve(path.join(secabRoot(),'backups')),p=path.resolve(filePath);if(!p.startsWith(dir))throw new Error('Chemin de sauvegarde non autorisé');return {ok:true,payload:JSON.parse(fs.readFileSync(p,'utf8'))}}catch(e){return {ok:false,error:e.message}}});
ipcMain.handle('open-data-folder',async()=>{const p=secabRoot();await shell.openPath(p);return {ok:true,path:p}});
ipcMain.handle('app-health',async()=>{try{const root=secabRoot(),aff=path.join(root,'affaires'),back=path.join(root,'backups'),logs=path.join(root,'logs');[aff,back,logs].forEach(ensureDir);return {ok:true,version:app.getVersion(),paths:{root,affaires:aff,backups:back,logs},counts:{affaires:fs.readdirSync(aff).length,backups:fs.readdirSync(back).length,logs:fs.readdirSync(logs).length},freeSpaceNote:'Surveillance disque gérée par Windows'}}catch(e){return {ok:false,error:e.message}}});



const SYNC_CONFIG_FILE = () => path.join(secabRoot(), 'simple-drive-sync.json');
function readSimpleSyncConfig(){
  try{return JSON.parse(fs.readFileSync(SYNC_CONFIG_FILE(),'utf8'))}catch{return {importFolder:'',processedFolder:'',lastScan:'',lastResult:''}}
}
function writeSimpleSyncConfig(config){ensureDir(secabRoot());fs.writeFileSync(SYNC_CONFIG_FILE(),JSON.stringify(config,null,2),'utf8');return config}
function deriveProcessedFolder(importFolder){return path.join(path.dirname(importFolder),'Traites')}
function parseSecabTransfer(filePath){
  const raw=fs.readFileSync(filePath,'utf8');
  const data=JSON.parse(raw);
  let records=[];
  if(data?.type==='SECAB_AFFAIRE_PACKAGE' && data.record) records=[data.record];
  else if((data?.type==='SECAB_TERRAIN_SYNC'||data?.type==='SECAB_DAY') && Array.isArray(data.records)) records=data.records.map(x=>x?.record||x).filter(Boolean);
  else if(data?.record) records=[data.record];
  else if(data?.uuid||data?.id) records=[data];
  if(!records.length) throw new Error('Aucune affaire SECAB reconnue dans le package');
  return records;
}
ipcMain.handle('choose-simple-sync-folder', async()=>{
  const result=await dialog.showOpenDialog({title:'Choisir le dossier Google Drive A_importer',properties:['openDirectory','createDirectory']});
  if(result.canceled||!result.filePaths?.[0])return {ok:false};
  const importFolder=result.filePaths[0],processedFolder=deriveProcessedFolder(importFolder);ensureDir(importFolder);ensureDir(processedFolder);
  const config=writeSimpleSyncConfig({...readSimpleSyncConfig(),importFolder,processedFolder,configuredAt:new Date().toISOString()});
  return {ok:true,config};
});
ipcMain.handle('get-simple-sync-config',async()=>({ok:true,config:readSimpleSyncConfig()}));
ipcMain.handle('scan-simple-sync-folder',async()=>{
  try{
    const config=readSimpleSyncConfig();
    if(!config.importFolder||!fs.existsSync(config.importFolder))return {ok:false,error:'Dossier A_importer non configuré ou indisponible',config};
    const processedFolder=config.processedFolder||deriveProcessedFolder(config.importFolder);ensureDir(processedFolder);
    const now=Date.now(),files=fs.readdirSync(config.importFolder).filter(n=>/\.(secabpkg|secabday|json)$/i.test(n));
    const records=[],processed=[],errors=[];
    for(const name of files){
      const source=path.join(config.importFolder,name);
      try{
        const st=fs.statSync(source);if(now-st.mtimeMs<1500)continue;
        records.push(...parseSecabTransfer(source));
        let dest=path.join(processedFolder,name);if(fs.existsSync(dest)){const ext=path.extname(name),base=path.basename(name,ext);dest=path.join(processedFolder,`${base}-${Date.now()}${ext}`)}
        fs.renameSync(source,dest);processed.push(name);
      }catch(e){errors.push({file:name,error:e.message})}
    }
    const next=writeSimpleSyncConfig({...config,processedFolder,lastScan:new Date().toISOString(),lastResult:`${records.length} affaire(s), ${processed.length} fichier(s), ${errors.length} erreur(s)`});
    if(records.length||errors.length)appendLog('simple-sync.jsonl',{at:next.lastScan,records:records.length,processed,errors});
    return {ok:true,records,processed,errors,config:next};
  }catch(e){return {ok:false,error:e.message}}
});



// RC5 — stockage SQLite professionnel : WAL, migrations, transactions, révisions et audit SHA-256.
const { SecabSqliteStore } = require('./sqlite-store.cjs');
let sqliteStore = null;
function getSqliteStore(){
  if(sqliteStore) return sqliteStore;
  sqliteStore = new SecabSqliteStore({
    databasePath: path.join(secabRoot(),'database','secab-couplage-expert.sqlite'),
    legacyStorePath: path.join(secabRoot(),'transactional-store'),
    backupPath: path.join(secabRoot(),'backups','sqlite'),
    logger: (type,payload)=>appendLog('sqlite.jsonl',{at:new Date().toISOString(),type,...payload})
  }).open();
  return sqliteStore;
}
function sqliteReply(fn){
  try{return fn(getSqliteStore())}
  catch(e){appendLog('sqlite-errors.jsonl',{at:new Date().toISOString(),message:e.message,stack:e.stack});return {ok:false,error:e.message,storageMode:'sqlite-wal-sha256'}}
}
ipcMain.handle('auth-auto-session',async()=>{try{const result=getSqliteStore().getOrCreateLocalOperator();const token=createSession(result.user);return {...result,token,automatic:true}}catch(e){return {ok:false,error:e.message}}});
ipcMain.handle('auth-status',async()=>sqliteReply(store=>store.authStatus()));
ipcMain.handle('auth-bootstrap',async(_event,payload)=>sqliteReply(store=>store.bootstrapAdmin(payload)));
ipcMain.handle('auth-login',async(_event,payload)=>{try{const result=getSqliteStore().authenticate(payload);const token=createSession(result.user);return {...result,token}}catch(e){return {ok:false,error:e.message}}});
ipcMain.handle('auth-logout',async(_event,token)=>{authSessions.delete(String(token||''));return {ok:true}});
ipcMain.handle('auth-list-users',async(_event,token)=>{const user=sessionUser(token);if(!user||user.role!=='administrateur')return {ok:false,error:'Accès administrateur requis'};return sqliteReply(store=>store.listUsers())});
ipcMain.handle('auth-create-user',async(_event,{token,payload})=>{const user=sessionUser(token);if(!user||user.role!=='administrateur')return {ok:false,error:'Accès administrateur requis'};return sqliteReply(store=>store.createUser(payload))});
ipcMain.handle('sqlite-save-record',async(_event,payload)=>{const user=sessionUser(payload?.token);if(!user)return {ok:false,error:'Session expirée'};return sqliteReply(store=>store.saveRecord({...payload,actor:user.displayName}))});
ipcMain.handle('sqlite-load-record',async(_event,uuid)=>sqliteReply(store=>store.loadRecord(uuid)));
ipcMain.handle('sqlite-list-records',async(_event,options)=>sqliteReply(store=>store.listRecords(options)));
ipcMain.handle('sqlite-verify-record',async(_event,uuid)=>sqliteReply(store=>store.verifyRecord(String(uuid||''))));
ipcMain.handle('sqlite-verify-all',async()=>sqliteReply(store=>store.verifyAll()));
ipcMain.handle('sqlite-health',async()=>sqliteReply(store=>store.health()));
ipcMain.handle('sqlite-pending-sync',async(_event,limit)=>sqliteReply(store=>store.getPendingSync(limit)));
ipcMain.handle('sqlite-complete-sync',async(_event,{token,uuids})=>{if(!sessionUser(token))return {ok:false,error:'Session expirée'};return sqliteReply(store=>store.completeSync(uuids))});
ipcMain.handle('sqlite-fail-sync',async(_event,{token,uuids,error})=>{if(!sessionUser(token))return {ok:false,error:'Session expirée'};return sqliteReply(store=>store.failSync(uuids,error))});
ipcMain.handle('archive-report-artifact',async(_event,{token,uuid,reportRef,revision,bytes,metadata})=>{
  const user=sessionUser(token);if(!user)return {ok:false,error:'Session expirée'};
  try{const root=path.join(secabRoot(),'rapports',safeName(uuid||'sans-uuid'));ensureDir(root);const stamp=new Date().toISOString().replace(/[:.]/g,'-');const name=`${safeName(reportRef||'rapport')}-R${Number(revision||1)}-${stamp}.pdf`;const filePath=path.join(root,name);const buffer=Buffer.from(bytes);fs.writeFileSync(filePath,buffer);const hash=crypto.createHash('sha256').update(buffer).digest('hex');fs.writeFileSync(`${filePath}.sha256`,`${hash}  ${name}
`,'utf8');fs.writeFileSync(`${filePath}.json`,JSON.stringify({uuid,reportRef,revision,sha256:hash,createdAt:new Date().toISOString(),actor:user.displayName,metadata},null,2),'utf8');return {ok:true,filePath,sha256:hash}}catch(e){return {ok:false,error:e.message}}
});
ipcMain.handle('sqlite-backup',async(_event,label)=>{
  try{return await getSqliteStore().backup(label||'manuel')}
  catch(e){appendLog('sqlite-errors.jsonl',{at:new Date().toISOString(),message:e.message,stack:e.stack});return {ok:false,error:e.message}}
});
// Alias de compatibilité RC4 : l'interface existante utilise désormais SQLite sans rupture.
ipcMain.handle('transactional-save-record',async(_event,payload)=>sqliteReply(store=>store.saveRecord(payload)));
ipcMain.handle('transactional-load-record',async(_event,uuid)=>sqliteReply(store=>store.loadRecord(uuid)));
ipcMain.handle('transactional-list-records',async(_event,options)=>sqliteReply(store=>store.listRecords(options)));
ipcMain.handle('transactional-verify-all',async()=>sqliteReply(store=>store.verifyAll()));
process.on('uncaughtException',e=>appendLog('main-errors.jsonl',{at:new Date().toISOString(),type:'uncaughtException',message:e.message,stack:e.stack}));
process.on('unhandledRejection',e=>appendLog('main-errors.jsonl',{at:new Date().toISOString(),type:'unhandledRejection',message:String(e?.message||e),stack:e?.stack||''}));

app.whenReady().then(() => {
  try{getSqliteStore();}catch(e){appendLog('sqlite-errors.jsonl',{at:new Date().toISOString(),message:e.message,stack:e.stack});}
  session.defaultSession.setPermissionRequestHandler((_webContents,permission,callback)=>callback(permission==='geolocation'));
  session.defaultSession.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,
    'Content-Security-Policy':["default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://apicarto.ign.fr https://*.arcgis.com https://*.arcgisonline.com; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
    'X-Content-Type-Options':['nosniff'],'Referrer-Policy':['no-referrer']
  }}));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit',()=>{try{sqliteStore?.close()}catch{}});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
