import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        fileParallelism: false, // 避免 DB 并发冲突
        sequence: {
            concurrent: false,
        },
    },
});
