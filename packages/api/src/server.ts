/**
 * Express Server Entry Point
 */

import express from 'express';
import { botsRouter } from './routes/bots.js';
import { authRouter } from './routes/auth.js';
import { accountsRouter } from './routes/accounts.js';
import { killSwitchRouter } from './routes/kill-switch.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';

const app = express();
const PORT = process.env['PORT'] ?? 3000;

// Middleware
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/bots', botsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/kill-switch', killSwitchRouter);

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
});

export { app };
