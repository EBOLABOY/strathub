/**
 * Worker 入口 - C1 接线版
 * 
 * 使用真实 deps（从 api 包复用）
 */

import { startLoop, type WorkerConfig } from './worker.js';
import { createWorkerDeps } from './deps.js';

// ============================================================================
// Config
// ============================================================================

function loadConfig(): WorkerConfig {
    return {
        intervalMs: parseInt(process.env['WORKER_INTERVAL_MS'] ?? '10000', 10),
        maxBotsPerTick: parseInt(process.env['WORKER_MAX_BOTS'] ?? '100', 10),
        providerCacheMaxSize: parseInt(process.env['WORKER_CACHE_MAX'] ?? '100', 10),
    };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    const enabled = process.env['WORKER_ENABLED'] === 'true';

    if (!enabled) {
        console.log('[Worker] WORKER_ENABLED is not true, exiting');
        process.exit(0);
    }

    console.log('[Worker] Starting...');

    // 使用真实 deps
    const deps = await createWorkerDeps();

    const config = loadConfig();
    await startLoop(deps, config);
}

main().catch((error) => {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
});
