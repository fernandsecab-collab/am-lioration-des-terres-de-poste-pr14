'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 3;

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  if (Buffer.isBuffer(value)) return crypto.createHash('sha256').update(value).digest('hex');
  const input = typeof value === 'string' ? value : stableJson(value);
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}


function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function sanitizeRecord(record) {
  const output = clone(record || {});
  delete output.revisions;
  delete output.audit;
  delete output.integrityHash;
  return output;
}

function loadDriver() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    const wrapped = new Error(
      "Le pilote SQLite natif 'better-sqlite3' est absent. Exécutez 'npm install', puis 'npm run rebuild:native'."
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

class SecabSqliteStore {
  constructor({ databasePath, legacyStorePath, backupPath, logger = () => {} }) {
    if (!databasePath) throw new Error('Chemin de base SQLite manquant');
    this.databasePath = databasePath;
    this.legacyStorePath = legacyStorePath;
    this.backupPath = backupPath || path.join(path.dirname(databasePath), 'sqlite-backups');
    this.logger = logger;
    this.db = null;
  }

  open() {
    if (this.db) return this;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    fs.mkdirSync(this.backupPath, { recursive: true });
    const Database = loadDriver();
    this.db = new Database(this.databasePath, { timeout: 10_000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 10000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('wal_autocheckpoint = 1000');
    this.migrateSchema();
    this.importLegacyJsonOnce();
    return this;
  }

  close() {
    if (!this.db) return;
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    this.db.close();
    this.db = null;
  }

  migrateSchema() {
    const currentVersion = Number(this.db.pragma('user_version', { simple: true }) || 0);
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(`Base SQLite trop récente (${currentVersion}) pour cette application (${SCHEMA_VERSION})`);
    }
    if (currentVersion === 0) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS app_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS affairs (
          uuid TEXT PRIMARY KEY,
          record_json TEXT NOT NULL,
          record_hash TEXT NOT NULL,
          revision_count INTEGER NOT NULL DEFAULT 0 CHECK(revision_count >= 0),
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS revisions (
          uuid TEXT NOT NULL,
          revision_no INTEGER NOT NULL CHECK(revision_no > 0),
          snapshot_json TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          immutable INTEGER NOT NULL DEFAULT 1 CHECK(immutable = 1),
          PRIMARY KEY(uuid, revision_no),
          FOREIGN KEY(uuid) REFERENCES affairs(uuid) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL,
          sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          revision_no INTEGER NOT NULL,
          snapshot_hash TEXT NOT NULL,
          previous_hash TEXT NOT NULL,
          entry_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          UNIQUE(uuid, sequence_no),
          FOREIGN KEY(uuid) REFERENCES affairs(uuid) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL,
          category TEXT NOT NULL,
          original_name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
          sha256 TEXT NOT NULL,
          gps_json TEXT,
          captured_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(uuid, sha256, category),
          FOREIGN KEY(uuid) REFERENCES affairs(uuid) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL,
          revision_no INTEGER NOT NULL,
          operation TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT,
          FOREIGN KEY(uuid) REFERENCES affairs(uuid) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_affairs_updated_at ON affairs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_affairs_status ON affairs(status);
        CREATE INDEX IF NOT EXISTS idx_revisions_created_at ON revisions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_uuid_sequence ON audit_log(uuid, sequence_no);
        CREATE INDEX IF NOT EXISTS idx_attachments_uuid ON attachments(uuid);
        CREATE INDEX IF NOT EXISTS idx_sync_pending ON sync_outbox(completed_at, next_attempt_at);
        PRAGMA user_version = 1;
        COMMIT;
      `);
      this.setMetadata('schema.createdAt', new Date().toISOString());
      this.setMetadata('schema.version', '1');
    }
    if (currentVersion < 2) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('technicien','responsable','administrateur')),
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_users_active ON users(active, role);
        PRAGMA user_version = 2;
        COMMIT;
      `);
      this.setMetadata('schema.version', '2');
      this.setMetadata('auth.enabledAt', new Date().toISOString());
    }
    if (currentVersion < 3) {
      const columns = this.db.prepare("PRAGMA table_info(sync_outbox)").all().map(x=>x.name);
      if (!columns.includes('last_error')) this.db.exec('ALTER TABLE sync_outbox ADD COLUMN last_error TEXT');
      this.db.pragma('user_version = 3');
      this.setMetadata('schema.version', '3');
    }
  }

  passwordDigest(password, salt) {
    return crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  }

  authStatus() {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE active=1').get().n || 0);
    return { ok: true, initialized: count > 0, userCount: count };
  }

  createUser({ username, displayName, role='technicien', password }) {
    const login = String(username || '').trim();
    const name = String(displayName || '').trim();
    if (login.length < 3) throw new Error('Identifiant trop court');
    if (name.length < 2) throw new Error('Nom utilisateur manquant');
    if (!['technicien','responsable','administrateur'].includes(role)) throw new Error('Rôle invalide');
    if (String(password || '').length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = this.passwordDigest(password, salt);
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO users(username, display_name, role, password_salt, password_hash, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)`).run(login, name, role, salt, hash, now, now);
    return { ok: true, user: { id: Number(result.lastInsertRowid), username: login, displayName: name, role } };
  }

  bootstrapAdmin(payload) {
    if (this.authStatus().initialized) throw new Error('Un compte existe déjà');
    return this.createUser({ ...payload, role: 'administrateur' });
  }

  getOrCreateLocalOperator() {
    let row = this.db.prepare(`SELECT * FROM users WHERE active=1 ORDER BY
      CASE role WHEN 'administrateur' THEN 0 WHEN 'responsable' THEN 1 ELSE 2 END,
      id ASC LIMIT 1`).get();
    if (!row) {
      const password = crypto.randomBytes(48).toString('hex');
      this.createUser({
        username: 'poste-local',
        displayName: 'Utilisateur local SECAB',
        role: 'administrateur',
        password
      });
      row = this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get('poste-local');
    }
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?').run(now, now, row.id);
    return { ok: true, user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role } };
  }

  authenticate({ username, password }) {
    const login = String(username || '').trim();
    const row = this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(login);
    const now = new Date();
    if (!row || !row.active) throw new Error('Identifiant ou mot de passe incorrect');
    if (row.locked_until && new Date(row.locked_until) > now) throw new Error('Compte temporairement verrouillé');
    const expected = Buffer.from(row.password_hash, 'hex');
    const actual = Buffer.from(this.passwordDigest(password, row.password_salt), 'hex');
    const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!valid) {
      const failures = Number(row.failed_attempts || 0) + 1;
      const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      this.db.prepare('UPDATE users SET failed_attempts=?, locked_until=?, updated_at=? WHERE id=?')
        .run(failures, lockedUntil, now.toISOString(), row.id);
      throw new Error(lockedUntil ? 'Compte verrouillé 15 minutes après 5 échecs' : 'Identifiant ou mot de passe incorrect');
    }
    this.db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=?, updated_at=? WHERE id=?')
      .run(now.toISOString(), now.toISOString(), row.id);
    return { ok: true, user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role } };
  }

  listUsers() {
    return { ok: true, users: this.db.prepare(`SELECT id, username, display_name AS displayName, role, active,
      created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY display_name`).all().map(x=>({...x,active:Boolean(x.active)})) };
  }

  setMetadata(key, value) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_metadata(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(String(key), String(value), now);
  }

  getMetadata(key) {
    return this.db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(String(key))?.value ?? null;
  }

  saveRecord(payload) {
    const record = sanitizeRecord(payload?.record || payload);
    const uuid = String(record?.uuid || record?.id || '').trim();
    if (!uuid) throw new Error('UUID affaire manquant');
    record.uuid = uuid;
    const actor = String(payload?.actor || 'Utilisateur local').trim() || 'Utilisateur local';
    const reason = String(payload?.reason || 'Enregistrement').trim() || 'Enregistrement';
    const now = new Date().toISOString();
    const snapshotJson = stableJson(record);
    const snapshotHash = sha256(snapshotJson);
    const status = String(record?.workflowStatus || record?.status || 'draft');

    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM affairs WHERE uuid = ?').get(uuid);
      if (existing) this.assertRecordIntegrity(uuid, existing);

      let revisionNo = Number(existing?.revision_count || 0);
      const lastRevision = revisionNo
        ? this.db.prepare('SELECT snapshot_hash FROM revisions WHERE uuid = ? AND revision_no = ?').get(uuid, revisionNo)
        : null;
      const changed = !lastRevision || lastRevision.snapshot_hash !== snapshotHash;

      if (!existing) {
        this.db.prepare(`INSERT INTO affairs(uuid, record_json, record_hash, revision_count, status, created_at, updated_at)
          VALUES(?, ?, ?, 0, ?, ?, ?)`)
          .run(uuid, snapshotJson, snapshotHash, status, now, now);
      }

      if (changed) {
        revisionNo += 1;
        this.db.prepare(`INSERT INTO revisions(uuid, revision_no, snapshot_json, snapshot_hash, actor, reason, created_at, immutable)
          VALUES(?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(uuid, revisionNo, snapshotJson, snapshotHash, actor, reason, now);
      }

      this.db.prepare(`UPDATE affairs SET record_json=?, record_hash=?, revision_count=?, status=?, updated_at=?, deleted_at=NULL WHERE uuid=?`)
        .run(snapshotJson, snapshotHash, revisionNo, status, now, uuid);

      if (changed || !existing) {
        const previous = this.db.prepare('SELECT entry_hash FROM audit_log WHERE uuid=? ORDER BY sequence_no DESC LIMIT 1').get(uuid);
        const sequenceNo = Number(this.db.prepare('SELECT COALESCE(MAX(sequence_no),0)+1 AS n FROM audit_log WHERE uuid=?').get(uuid).n);
        const auditEntry = {
          uuid,
          sequenceNo,
          action: existing ? 'UPDATE' : 'CREATE',
          actor,
          reason,
          revisionNo,
          snapshotHash,
          previousHash: previous?.entry_hash || 'GENESIS',
          createdAt: now
        };
        const entryHash = sha256(auditEntry);
        this.db.prepare(`INSERT INTO audit_log(uuid, sequence_no, action, actor, reason, revision_no, snapshot_hash, previous_hash, entry_hash, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid, sequenceNo, auditEntry.action, actor, reason, revisionNo, snapshotHash, auditEntry.previousHash, entryHash, now);
        this.db.prepare(`INSERT INTO sync_outbox(uuid, revision_no, operation, payload_json, created_at)
          VALUES(?, ?, 'UPSERT', ?, ?)`)
          .run(uuid, revisionNo, snapshotJson, now);
      }

      return { uuid, revision: revisionNo, changed, recordHash: snapshotHash, updatedAt: now };
    });

    const result = transaction.immediate();
    return { ok: true, ...result, storageMode: 'sqlite-wal-sha256', databasePath: this.databasePath };
  }

  loadRecord(uuid) {
    const id = String(uuid || '').trim();
    const row = this.db.prepare('SELECT * FROM affairs WHERE uuid=? AND deleted_at IS NULL').get(id);
    if (!row) return { ok: false, error: 'Affaire introuvable' };
    const integrity = this.verifyRecord(id);
    return {
      ok: true,
      envelope: {
        schemaVersion: SCHEMA_VERSION,
        uuid: id,
        updatedAt: row.updated_at,
        record: JSON.parse(row.record_json),
        revisions: this.getRevisions(id),
        audit: this.getAudit(id),
        integrityOk: integrity.ok,
        integrityErrors: integrity.errors,
        integrityHash: row.record_hash
      },
      storageMode: 'sqlite-wal-sha256'
    };
  }

  listRecords({ includeDeleted = false, limit = 5000 } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    const rows = this.db.prepare(`SELECT uuid, record_json, record_hash, revision_count, status, created_at, updated_at, deleted_at
      FROM affairs ${where} ORDER BY updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(Number(limit) || 5000, 20_000)));
    return {
      ok: true,
      rows: rows.map((row) => ({
        uuid: row.uuid,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        revisionCount: row.revision_count,
        status: row.status,
        deletedAt: row.deleted_at,
        integrityOk: sha256(row.record_json) === row.record_hash,
        record: JSON.parse(row.record_json)
      })),
      storageMode: 'sqlite-wal-sha256'
    };
  }

  getRevisions(uuid) {
    return this.db.prepare(`SELECT revision_no AS number, created_at AS createdAt, actor, reason, snapshot_json, snapshot_hash AS snapshotHash, immutable
      FROM revisions WHERE uuid=? ORDER BY revision_no`).all(uuid).map((row) => ({
        number: row.number,
        createdAt: row.createdAt,
        actor: row.actor,
        reason: row.reason,
        snapshot: JSON.parse(row.snapshot_json),
        snapshotHash: row.snapshotHash,
        immutable: Boolean(row.immutable)
      }));
  }

  getAudit(uuid) {
    return this.db.prepare(`SELECT sequence_no AS sequenceNo, action, actor, reason, revision_no AS revision,
      snapshot_hash AS snapshotHash, previous_hash AS previousHash, entry_hash AS hash, created_at AS at
      FROM audit_log WHERE uuid=? ORDER BY sequence_no`).all(uuid);
  }

  assertRecordIntegrity(uuid, row = null) {
    const result = this.verifyRecord(uuid, row);
    if (!result.ok) throw new Error(`Intégrité SQLite invalide pour ${uuid} : ${result.errors.join('; ')}`);
  }

  verifyRecord(uuid, suppliedRow = null) {
    const row = suppliedRow || this.db.prepare('SELECT * FROM affairs WHERE uuid=?').get(uuid);
    if (!row) return { uuid, ok: false, errors: ['Affaire absente'] };
    const errors = [];
    if (sha256(row.record_json) !== row.record_hash) errors.push('Empreinte du dossier courant invalide');
    const revisions = this.db.prepare('SELECT * FROM revisions WHERE uuid=? ORDER BY revision_no').all(uuid);
    if (revisions.length !== Number(row.revision_count)) errors.push('Nombre de révisions incohérent');
    revisions.forEach((revision, index) => {
      if (revision.revision_no !== index + 1) errors.push(`Séquence de révision invalide à R${revision.revision_no}`);
      if (sha256(revision.snapshot_json) !== revision.snapshot_hash) errors.push(`Empreinte invalide à R${revision.revision_no}`);
      if (Number(revision.immutable) !== 1) errors.push(`Révision R${revision.revision_no} non immuable`);
    });
    const audit = this.db.prepare('SELECT * FROM audit_log WHERE uuid=? ORDER BY sequence_no').all(uuid);
    let previousHash = 'GENESIS';
    audit.forEach((entry, index) => {
      const model = {
        uuid,
        sequenceNo: entry.sequence_no,
        action: entry.action,
        actor: entry.actor,
        reason: entry.reason,
        revisionNo: entry.revision_no,
        snapshotHash: entry.snapshot_hash,
        previousHash: entry.previous_hash,
        createdAt: entry.created_at
      };
      if (entry.sequence_no !== index + 1) errors.push(`Séquence d'audit invalide à ${entry.sequence_no}`);
      if (entry.previous_hash !== previousHash) errors.push(`Chaînage d'audit invalide à ${entry.sequence_no}`);
      if (sha256(model) !== entry.entry_hash) errors.push(`Empreinte d'audit invalide à ${entry.sequence_no}`);
      previousHash = entry.entry_hash;
    });
    return { uuid, ok: errors.length === 0, errors, revisionCount: revisions.length, auditCount: audit.length };
  }

  verifyAll() {
    const uuids = this.db.prepare('SELECT uuid FROM affairs ORDER BY uuid').all().map((row) => row.uuid);
    const checks = uuids.map((uuid) => this.verifyRecord(uuid));
    return { ok: true, total: checks.length, valid: checks.filter((x) => x.ok).length, invalid: checks.filter((x) => !x.ok), checks };
  }

  integrityCheck() {
    const rows = this.db.pragma('integrity_check');
    const messages = rows.map((row) => Object.values(row)[0]);
    return { ok: messages.length === 1 && messages[0] === 'ok', messages };
  }

  async backup(label = 'auto') {
    const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'auto';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.backupPath, `secab-${safeLabel}-${stamp}.sqlite`);
    await this.db.backup(destination);
    const hash = sha256(fs.readFileSync(destination));
    fs.writeFileSync(`${destination}.sha256`, `${hash}  ${path.basename(destination)}\n`, 'utf8');
    this.pruneBackups(30);
    return { ok: true, filePath: destination, sha256: hash };
  }

  pruneBackups(keep = 30) {
    const files = fs.readdirSync(this.backupPath)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => ({ name, path: path.join(this.backupPath, name), time: fs.statSync(path.join(this.backupPath, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    files.slice(keep).forEach((file) => {
      fs.rmSync(file.path, { force: true });
      fs.rmSync(`${file.path}.sha256`, { force: true });
    });
  }

  importLegacyJsonOnce() {
    if (this.getMetadata('legacy.rc4.importedAt')) return;
    let imported = 0;
    let failed = 0;
    if (this.legacyStorePath && fs.existsSync(this.legacyStorePath)) {
      const files = fs.readdirSync(this.legacyStorePath).filter((name) => name.endsWith('.json'));
      for (const name of files) {
        try {
          const envelope = JSON.parse(fs.readFileSync(path.join(this.legacyStorePath, name), 'utf8'));
          if (!envelope?.record) continue;
          this.saveRecord({ record: envelope.record, actor: 'Migration automatique RC4', reason: 'Migration JSON vers SQLite' });
          imported += 1;
        } catch (error) {
          failed += 1;
          this.logger('sqlite-migration-error', { file: name, error: error.message });
        }
      }
    }
    this.setMetadata('legacy.rc4.importedAt', new Date().toISOString());
    this.setMetadata('legacy.rc4.importedCount', String(imported));
    this.setMetadata('legacy.rc4.failedCount', String(failed));
  }

  getPendingSync(limit = 250) {
    const rows = this.db.prepare(`SELECT id, uuid, revision_no AS revision, operation, payload_json, attempts,
      next_attempt_at AS nextAttemptAt, created_at AS createdAt, last_error AS lastError
      FROM sync_outbox WHERE completed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY created_at LIMIT ?`).all(new Date().toISOString(), Math.max(1, Math.min(Number(limit)||250, 2000)));
    return { ok:true, rows:rows.map(row=>({...row,payload:JSON.parse(row.payload_json)})) };
  }

  completeSync(uuids) {
    const ids=[...new Set((uuids||[]).map(String).filter(Boolean))];
    if(!ids.length)return {ok:true,completed:0};
    const now=new Date().toISOString();
    const stmt=this.db.prepare('UPDATE sync_outbox SET completed_at=?, last_error=NULL WHERE uuid=? AND completed_at IS NULL');
    const tx=this.db.transaction(()=>ids.reduce((n,id)=>n+stmt.run(now,id).changes,0));
    return {ok:true,completed:tx.immediate()};
  }

  failSync(uuids, errorMessage='Échec de synchronisation') {
    const ids=[...new Set((uuids||[]).map(String).filter(Boolean))];
    if(!ids.length)return {ok:true,updated:0};
    const stmt=this.db.prepare(`UPDATE sync_outbox SET attempts=attempts+1,
      next_attempt_at=datetime('now', '+' || MIN(60, (attempts+1)*(attempts+1)) || ' minutes'), last_error=?
      WHERE uuid=? AND completed_at IS NULL`);
    const tx=this.db.transaction(()=>ids.reduce((n,id)=>n+stmt.run(String(errorMessage).slice(0,1000),id).changes,0));
    return {ok:true,updated:tx.immediate()};
  }

  health() {
    const counts = {
      affairs: this.db.prepare('SELECT COUNT(*) AS n FROM affairs WHERE deleted_at IS NULL').get().n,
      revisions: this.db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,
      auditEntries: this.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
      attachments: this.db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,
      syncPending: this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE completed_at IS NULL').get().n
    };
    return {
      ok: true,
      storageMode: 'sqlite-wal-sha256',
      databasePath: this.databasePath,
      schemaVersion: Number(this.db.pragma('user_version', { simple: true })),
      journalMode: this.db.pragma('journal_mode', { simple: true }),
      integrity: this.integrityCheck(),
      counts
    };
  }
}

module.exports = { SecabSqliteStore, stableJson, sha256, SCHEMA_VERSION };
