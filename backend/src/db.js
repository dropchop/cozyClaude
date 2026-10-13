import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = () => process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pgdata');

// Open lazily, on first use, never at import: merely importing a module that
// depends on db.js (a "pure" unit test, say) must not open or create the live
// data directory.
let _db = null;
export function getDb() {
  if (!_db) {
    // PGlite won't create missing parent directories — ensure the path exists first.
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    // Embedded PostgreSQL (PGlite) — persists to disk, single in-process connection.
    _db = new PGlite(DATA_DIR());
  }
  return _db;
}

export async function initDb() {
  const db = getDb();
  await db.waitReady;
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.exec(schema);
}

// Thin helper: run a parameterized query and return the rows array.
export async function query(sql, params = []) {
  const result = await getDb().query(sql, params);
  return result.rows;
}

// Run a query expecting at most one row; returns the row or null.
export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
