// Import this FIRST in every test that touches the database. It points PGlite at
// a fresh scratch directory (unless the caller set PGLITE_DIR), so no test can
// ever open the owner's live backend/data/pgdata.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.PGLITE_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-test-pg-'));
  process.env.PGLITE_DIR = dir;
  // Remove only a directory created here (~27 MB each); never a caller-supplied one.
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
}
