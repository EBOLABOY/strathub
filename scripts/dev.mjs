import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npmCmd = 'npm';
const useShell = process.platform === 'win32';

function spawnNpm(args, options = {}) {
  return spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: useShell,
    ...options,
  });
}

async function runNpm(args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawnNpm(args, options);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(undefined);
      reject(new Error(`Command failed: npm ${args.join(' ')} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    });
  });
}

function readEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};

  const content = fs.readFileSync(envPath, 'utf8');
  const out = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key) continue;

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

const envLocal = readEnvLocal();

// Shared defaults for local dev (safe mode)
const databaseUrl = process.env.DATABASE_URL ?? envLocal.DATABASE_URL;
const apiPort = process.env.API_PORT ?? envLocal.API_PORT ?? '3001';
const webPort = process.env.WEB_PORT ?? envLocal.WEB_PORT ?? '3000';
const jwtSecret = process.env.JWT_SECRET ?? envLocal.JWT_SECRET ?? 'dev-secret-change-me';

console.log('[dev] Bootstrapping local DB schema...');

const baseEnv = {
  ...process.env,
  ...envLocal,
};

await runNpm(['-w', 'packages/database', 'run', 'db:push'], {
  env: {
    ...baseEnv,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  },
});

console.log(`[dev] Starting API on :${apiPort}, Web on :${webPort}`);
if (databaseUrl) {
  console.log(`[dev] DATABASE_URL=${databaseUrl}`);
} else {
  console.log('[dev] DATABASE_URL not set (Prisma will load packages/database/.env)');
}

const children = [];

function startChild(label, args, extraEnv) {
  const child = spawnNpm(args, {
    env: {
      ...baseEnv,
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      ...extraEnv,
    },
  });
  child.on('exit', (code, signal) => {
    console.error(`[dev] ${label} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill('SIGINT');
    } catch {
      // ignore
    }
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startChild('api', ['-w', 'packages/api', 'run', 'dev'], {
  PORT: apiPort,
  JWT_SECRET: jwtSecret,
});

startChild('worker', ['-w', 'packages/worker', 'run', 'dev'], {
  WORKER_ENABLED: process.env.WORKER_ENABLED ?? envLocal.WORKER_ENABLED ?? 'true',
  WORKER_ENABLE_TRADING: process.env.WORKER_ENABLE_TRADING ?? envLocal.WORKER_ENABLE_TRADING ?? 'true',
  WORKER_ENABLE_STOPPING: process.env.WORKER_ENABLE_STOPPING ?? envLocal.WORKER_ENABLE_STOPPING ?? 'true',
  WORKER_USE_REAL_EXCHANGE: process.env.WORKER_USE_REAL_EXCHANGE ?? envLocal.WORKER_USE_REAL_EXCHANGE ?? 'false',
  EXCHANGE_PROVIDER: process.env.EXCHANGE_PROVIDER ?? envLocal.EXCHANGE_PROVIDER ?? 'mock',
  ALLOW_MAINNET_TRADING: process.env.ALLOW_MAINNET_TRADING ?? envLocal.ALLOW_MAINNET_TRADING ?? 'false',
});

startChild('web', ['-w', 'packages/web', 'run', 'dev'], {
  PORT: webPort,
  API_URL: process.env.API_URL ?? envLocal.API_URL ?? `http://localhost:${apiPort}`,
});
