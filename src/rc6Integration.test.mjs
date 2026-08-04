import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('./main.jsx',import.meta.url),'utf8');
const preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
for(const token of ['listSqliteRecords','saveSqliteRecord','DesktopAuthGate','officialReferenceGate','archiveReportArtifact','getPendingSqliteSync','completeSqliteSync']) assert.ok(ui.includes(token),`Intégration UI absente: ${token}`);
for(const token of ['authStatus','bootstrapAdmin','login','archiveReportArtifact','getPendingSqliteSync']) assert.ok(preload.includes(token),`Pont Electron absent: ${token}`);
for(const token of ['auth-bootstrap','auth-login','sqlite-pending-sync','archive-report-artifact']) assert.ok(main.includes(token),`IPC absent: ${token}`);
console.log('RC6 integration contract: OK');
