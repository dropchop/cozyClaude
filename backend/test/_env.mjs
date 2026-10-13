// Import this FIRST in every test that touches the database. It points PGlite at
// a fresh scratch directory (unless the caller set PGLITE_DIR), so no test can
// ever open the owner's live backend/data/pgdata.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.PGLITE_DIR) {
  process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-test-pg-'));
}
