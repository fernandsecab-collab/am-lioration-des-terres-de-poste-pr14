'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stableJson, sha256, SCHEMA_VERSION } = require('./sqlite-store.cjs');

assert.strictEqual(SCHEMA_VERSION, 3);
assert.strictEqual(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.strictEqual(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }));
assert.strictEqual(sha256('SECAB').length, 64);
const source = fs.readFileSync(path.join(__dirname, 'sqlite-store.cjs'), 'utf8');
for (const token of ['journal_mode = WAL','synchronous = FULL','BEGIN IMMEDIATE','CREATE TABLE IF NOT EXISTS affairs','CREATE TABLE IF NOT EXISTS revisions','CREATE TABLE IF NOT EXISTS audit_log','CREATE TABLE IF NOT EXISTS attachments','CREATE TABLE IF NOT EXISTS sync_outbox','user_version = 3','CREATE TABLE IF NOT EXISTS users','crypto.scryptSync']) {
  assert.ok(source.includes(token), `Schéma SQLite incomplet : ${token}`);
}
console.log('sqlite-store: OK');
