import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npmCmd = 'npm';
const isWindows = process.platform === 'win32';
const useShell = isWindows;

function mergeNodeOptions(existing, extra) {
  const current = (existing ?? '').trim();
  if (!current) return extra;
  if (current.includes(extra)) return current;
  return `${current} ${extra}`;
}

function spawnNpm(args, options = {}) {
  return spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: useShell,
    ...options,
  });
}

function spawnCmd(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });
}

function runCmd(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCmd(command, args, options);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve(undefined);
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    });
  });
}

function runNpm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args, options);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve(undefined);
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
const exchangeProvider = process.env.EXCHANGE_PROVIDER ?? envLocal.EXCHANGE_PROVIDER ?? 'sim';

console.log('[dev] Building local workspace packages...');

// Build shared libs that are imported by api/worker via "dist" exports.
// Keep this list short to avoid dev startup turning into a full production build.
await runNpm(['-w', 'packages/shared', 'run', 'build']);
await runNpm(['-w', 'packages/security', 'run', 'build']);
await runNpm(['-w', 'packages/database', 'run', 'build']);
await runNpm(['-w', 'packages/exchange-simulator', 'run', 'build']);
await runNpm(['-w', 'packages/market-data', 'run', 'build']);
await runNpm(['-w', 'packages/exchange', 'run', 'build']);

console.log('[dev] Bootstrapping local DB schema...');

const traceDeprecations = (process.env.TRACE_DEPRECATIONS ?? envLocal.TRACE_DEPRECATIONS ?? '').trim().toLowerCase();
const enableTraceDeprecations = traceDeprecations === '1' || traceDeprecations === 'true' || traceDeprecations === 'yes';
const nodeOptionExtra = enableTraceDeprecations ? '--trace-deprecation' : '--disable-warning=DEP0060';
const userNodeOptions = envLocal.NODE_OPTIONS ?? process.env.NODE_OPTIONS;

const baseEnv = {
  ...process.env,
  ...envLocal,
  NODE_OPTIONS: mergeNodeOptions(userNodeOptions, nodeOptionExtra),
};

await runCmd('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  cwd: path.join(process.cwd(), 'packages', 'database'),
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
      if (isWindows && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        continue;
      }

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
  EXCHANGE_PROVIDER: exchangeProvider,
});

startChild('worker', ['-w', 'packages/worker', 'run', 'dev'], {
  WORKER_ENABLED: process.env.WORKER_ENABLED ?? envLocal.WORKER_ENABLED ?? 'true',
  WORKER_ENABLE_TRADING: process.env.WORKER_ENABLE_TRADING ?? envLocal.WORKER_ENABLE_TRADING ?? 'true',
  WORKER_ENABLE_STOPPING: process.env.WORKER_ENABLE_STOPPING ?? envLocal.WORKER_ENABLE_STOPPING ?? 'true',
  WORKER_USE_REAL_EXCHANGE: process.env.WORKER_USE_REAL_EXCHANGE ?? envLocal.WORKER_USE_REAL_EXCHANGE ?? 'false',
  EXCHANGE_PROVIDER: exchangeProvider,
  ALLOW_MAINNET_TRADING: process.env.ALLOW_MAINNET_TRADING ?? envLocal.ALLOW_MAINNET_TRADING ?? 'false',
});

startChild('web', ['-w', 'packages/web', 'run', 'dev'], {
  PORT: webPort,
  API_URL: process.env.API_URL ?? envLocal.API_URL ?? `http://localhost:${apiPort}`,
});
