import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseDir = path.resolve(__dirname, '..', '..', 'database');
const prismaDir = path.resolve(databaseDir, 'prisma');
const dbFile = path.join(prismaDir, 'test-worker.db');
const dbUrl = 'file:./test-worker.db';

process.env.DATABASE_URL = dbUrl;
(globalThis as any).__prisma = undefined;

try {
  if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile);
  }
} catch {
  // ignore
}

// Prisma's SQLite `file:./x.db` path is resolved relative to the schema directory (`packages/database/prisma`),
// so we must ensure the file exists there first on Windows.
try {
  fs.mkdirSync(prismaDir, { recursive: true });
  fs.closeSync(fs.openSync(dbFile, 'w'));
} catch {
  // ignore
}

execSync('npx prisma db push --skip-generate', {
  cwd: databaseDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: dbUrl,
  },
});
