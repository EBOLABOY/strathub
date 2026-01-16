/**
 * Express Server Entry Point
 */

import express from 'express';
import { botsRouter } from './routes/bots.js';
import { authRouter } from './routes/auth.js';
import { accountsRouter } from './routes/accounts.js';
import { killSwitchRouter } from './routes/kill-switch.js';
import { metricsRouter } from './routes/metrics.js';
import { sseRouter } from './routes/sse.js';
import { configRouter } from './routes/config.js';
import { templatesRouter } from './routes/templates.js';
import { marketRouter } from './routes/market.js';
import { dashboardRouter } from './routes/dashboard.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { initAlertService } from '@crypto-strategy-hub/observability';

const app = express();
const PORT = process.env['PORT'] ?? 3000;

// 初始化告警服务
initAlertService({
    telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'],
    telegramChatId: process.env['TELEGRAM_CHAT_ID'],
    webhookUrl: process.env['ALERT_WEBHOOK_URL'],
    pushPlusToken: process.env['PUSHPLUS_TOKEN'],
    throttleWindowMs: parseInt(process.env['ALERT_THROTTLE_MS'] ?? '60000', 10),
    enabled: process.env['ALERTS_ENABLED'] !== 'false',
});

// Middleware
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/bots', botsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/kill-switch', killSwitchRouter);
app.use('/api/sse', sseRouter);
app.use('/api/config', configRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/market', marketRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/metrics', metricsRouter);

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
