import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pgdata');

// PGlite won't create missing parent directories — ensure the path exists first.
fs.mkdirSync(DATA_DIR, { recursive: true });

// Embedded PostgreSQL (PGlite) — persists to disk, single in-process connection.
export const db = new PGlite(DATA_DIR);

export async function initDb() {
  await db.waitReady;
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.exec(schema);
}

// Thin helper: run a parameterized query and return the rows array.
export async function query(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

// Run a query expecting at most one row; returns the row or null.
export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
