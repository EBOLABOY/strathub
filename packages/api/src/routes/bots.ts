/**
 * Bot Routes Factory - 支持 provider 注入
 * 
 * 使用 router factory 模式实现依赖注入，
 * 使 MarketDataProvider 可以在测试中替换
 */

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma, Prisma } from '@crypto-strategy-hub/database';
import {
    BotStatus,
    type GridConfig,
    getReferencePrice,
    normalizeSupportedExchangeId,
} from '@crypto-strategy-hub/shared';
import { createApiError } from '../middleware/error-handler.js';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import {
    validateStateTransition,
    canModifyConfig,
    parseTriggerConfig,
    resolveRunningOrWaiting,
    type StateTransitionEvent,
} from '../services/state-machine.js';
import {
    validateBotConfig,
    validateAndBlockOnError,
    type MarketDataProvider,
    type PreviewMarketInfo,
    type PreviewTickerInfo,
    type PreviewBalanceInfo,
} from '../services/preview-validation.js';
import {
    checkAndTriggerAutoClose,
    getReferencePriceForFreeze,
} from '../services/auto-close.js';
import {
    type MarketDataProviderFactory,
    getProviderFactory,
    mockProviderFactory,
} from '@crypto-strategy-hub/market-data';

// ============================================================================
// Types
// ============================================================================

export interface BotsRouterDeps {
    /**
     * 注入 ProviderFactory（必须显式注入，无默认值）
     * - 测试：传入 mockProviderFactory
     * - 生产：传入 getProviderFactory()
     */
    providerFactory?: MarketDataProviderFactory;
}

// ============================================================================
// Schemas
// ============================================================================

const createBotSchema = z.object({
    exchangeAccountId: z.string().uuid(),
    symbol: z.string().min(1),
    configJson: z.string(),
});

const updateConfigSchema = z.object({
    configJson: z.string(),
});

const previewSchema = z.object({
    configOverride: z.record(z.unknown()).optional(),
});

const botIdParamSchema = z.object({
    botId: z.string().uuid(),
});

const tradesQuerySchema = z.object({
    limit: z.preprocess(
        (value) => (Array.isArray(value) ? value[0] : value),
        z.coerce.number().int().min(1).max(100).optional().default(50)
    ),
});

// ============================================================================
// Router Factory
// ============================================================================

export function createBotsRouter(deps: BotsRouterDeps = {}): Router {
    const router = Router();
    // 使用注入的 factory，默认走 env 配置
    const providerFactory = deps.providerFactory ?? getProviderFactory();

    /**
     * 根据 Bot 的 exchangeAccountId 创建 Provider
     */
    async function getProviderForBot(botId: string, userId: string): Promise<MarketDataProvider> {
        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
            include: { exchangeAccount: true },
        });

        if (!bot) {
            throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
        }

        return providerFactory.createProvider({
            id: bot.exchangeAccount.id,
            exchange: bot.exchangeAccount.exchange,
            // V2: 解密密钥
            // apiKey: decrypt(bot.exchangeAccount.encryptedCredentials).apiKey,
            // secret: decrypt(bot.exchangeAccount.encryptedCredentials).secret,
        });
    }

    // 所有 bot 路由都需要认证
    router.use(authGuard);

    // POST /api/bots - 创建 Bot
    router.post('/', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { exchangeAccountId, symbol, configJson } = createBotSchema.parse(req.body);

            // Security: Validate exchangeAccountId belongs to current user
            const exchangeAccount = await prisma.exchangeAccount.findFirst({
                where: { id: exchangeAccountId, userId },
            });
            if (!exchangeAccount) {
                throw createApiError(
                    'Exchange account not found',
                    404,
                    'EXCHANGE_ACCOUNT_NOT_FOUND'
                );
            }

            if (!normalizeSupportedExchangeId(exchangeAccount.exchange)) {
                throw createApiError(
                    `Exchange not supported: ${exchangeAccount.exchange}`,
                    400,
                    'EXCHANGE_NOT_SUPPORTED'
                );
            }

            const bot = await prisma.bot.create({
                data: {
                    userId,
                    exchangeAccountId,
                    symbol,
                    configJson,
                    status: BotStatus.DRAFT,
                },
            });

            res.status(201).json(bot);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                next(
                    createApiError(
                        'Bot already exists for this exchange account and symbol',
                        409,
                        'BOT_ALREADY_EXISTS'
                    )
                );
                return;
            }
            next(error);
        }
    });

    // GET /api/bots - 列表
    router.get('/', async (req, res, next) => {
        try {
            const userId = requireUserId(req);

            const bots = await prisma.bot.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
            });

            res.json(bots);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/bots/:botId - 详情
    router.get('/:botId', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            res.json(bot);
        } catch (error) {
            next(error);
        }
    });

    // DELETE /api/bots/:botId - 删除（只允许 DRAFT/STOPPED/ERROR）
    router.delete('/:botId', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
                select: { id: true, status: true },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            const status = bot.status as BotStatus;
            const canDelete =
                status === BotStatus.DRAFT ||
                status === BotStatus.STOPPED ||
                status === BotStatus.ERROR;

            if (!canDelete) {
                throw createApiError(
                    `Cannot delete bot in ${bot.status} state`,
                    409,
                    'INVALID_STATE_FOR_DELETE'
                );
            }

            await prisma.bot.delete({ where: { id: botId } });
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    // PUT /api/bots/:botId/config - 更新配置
    router.put('/:botId/config', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);
            const { configJson } = updateConfigSchema.parse(req.body);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            if (!canModifyConfig(bot.status as BotStatus)) {
                throw createApiError(
                    `Cannot modify config in ${bot.status} state`,
                    409,
                    'INVALID_STATE_FOR_CONFIG_UPDATE'
                );
            }

            const updated = await prisma.bot.update({
                where: { id: botId },
                data: {
                    configJson,
                    configRevision: bot.configRevision + 1,
                },
            });

            res.json(updated);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/preview - 预览（无副作用，支持 configOverride）
    router.post('/:botId/preview', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);
            const { configOverride } = previewSchema.parse(req.body);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            // 使用注入的 provider（按 bot 的 exchangeAccountId 创建）
            const provider = await getProviderForBot(botId, userId);
            const result = await validateBotConfig({
                symbol: bot.symbol,
                configJson: bot.configJson,
                configOverride: configOverride as Partial<GridConfig> | undefined,
                marketDataProvider: provider,
            });

            res.json(result.preview);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/start - 启动
    router.post('/:botId/start', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const provider = await getProviderForBot(botId, userId);
            const result = await transitionBotState(botId, userId, 'START', provider);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/pause - 暂停
    router.post('/:botId/pause', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const provider = await getProviderForBot(botId, userId);
            const result = await transitionBotState(botId, userId, 'PAUSE', provider);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/resume - 恢复
    router.post('/:botId/resume', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const provider = await getProviderForBot(botId, userId);
            const result = await transitionBotState(botId, userId, 'RESUME', provider);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/stop - 停止
    router.post('/:botId/stop', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const provider = await getProviderForBot(botId, userId);
            const result = await transitionBotState(botId, userId, 'STOP', provider);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/bots/:botId/runtime - 运行状态
    router.get('/:botId/runtime', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            const snapshot = await prisma.botSnapshot.findFirst({
                where: { botId },
                orderBy: { createdAt: 'desc' },
            });

            res.json({
                status: bot.status,
                statusVersion: bot.statusVersion,
                runId: bot.runId,
                lastError: bot.lastError,
                snapshot: snapshot ? JSON.parse(snapshot.stateJson) : null,
            });
        } catch (error) {
            next(error);
        }
    });

    // GET /api/bots/:botId/trades - 交易历史
    router.get('/:botId/trades', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);
            const { limit } = tradesQuerySchema.parse(req.query);

            const bot = await prisma.bot.findFirst({
                where: { id: botId, userId },
            });

            if (!bot) {
                throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
            }

            const trades = await prisma.trade.findMany({
                where: { botId },
                orderBy: { timestamp: 'desc' },
                take: limit,
            });

            res.json(trades);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/bots/:botId/risk-check - AutoClose 检查（ACC-RISK-002）
    router.post('/:botId/risk-check', async (req, res, next) => {
        try {
            const userId = requireUserId(req);
            const { botId } = botIdParamSchema.parse(req.params);

            const provider = await getProviderForBot(botId, userId);
            const result = await checkAndTriggerAutoClose(botId, userId, provider);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

// ============================================================================
// Helper: 状态转移
// ============================================================================

async function transitionBotState(
    botId: string,
    userId: string,
    event: StateTransitionEvent,
    provider: MarketDataProvider
) {
    // ========================================================================
    // 1. 预检查（事务外）
    // ========================================================================

    // 获取 bot 基本信息（事务外）
    const bot = await prisma.bot.findFirst({
        where: { id: botId, userId },
    });

    if (!bot) {
        throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
    }

    const currentStatus = bot.status as BotStatus;
    const transition = validateStateTransition(currentStatus, event);

    // START/RESUME：先检查 Kill Switch（即使幂等也要阻断）
    if (event === 'START' || event === 'RESUME') {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { killSwitchEnabled: true },
        });

        if (user?.killSwitchEnabled) {
            throw createApiError(
                'Kill switch is enabled, cannot start or resume bot',
                423,
                'KILL_SWITCH_LOCKED'
            );
        }
    }

    // 幂等检查（Kill Switch 检查后）
    if (transition.idempotent) {
        return bot; // 已在目标状态，不 bump statusVersion
    }

    if (!transition.valid) {
        throw createApiError(
            `Cannot ${event} from ${currentStatus}`,
            409,
            'INVALID_STATE_TRANSITION'
        );
    }

    // START 或 RESUME 的预检查（I/O 在事务外，Kill Switch 已在前面检查）
    let referencePrice: string | null = null;
    if (event === 'START' || event === 'RESUME') {
        // 校验配置（I/O 在事务外）
        const validation = await validateBotConfig({
            symbol: bot.symbol,
            configJson: bot.configJson,
            marketDataProvider: provider,
        });

        if (validation.hasErrors) {
            const errors = validation.preview.issues
                .filter(i => i.severity === 'ERROR')
                .map(i => `${i.code}: ${i.message}`)
                .join('; ');

            throw createApiError(
                `Config validation failed: ${errors}`,
                422,
                'CONFIG_VALIDATION_ERROR'
            );
        }

        // 获取参考价格用于冻结（basePrice 已在 preview 中计算）
        referencePrice = validation.preview.basePrice;
    }

    // ========================================================================
    // 2. CAS 写入（事务内，只做数据库操作）
    // ========================================================================

    const result = await prisma.$transaction(async (tx) => {
        // 重新读取 bot 获取最新 statusVersion（防止并发）
        const currentBot = await tx.bot.findFirst({
            where: { id: botId, userId },
        });

        if (!currentBot || currentBot.statusVersion !== bot.statusVersion) {
            // 乐观锁失败 = 其他请求已处理
            throw createApiError(
                'Bot state changed, please retry',
                409,
                'CONCURRENT_MODIFICATION'
            );
        }

        // 数据驱动：如果需要检查配置来决定目标状态
        let newStatus = transition.targetStatus;
        if (transition.needsConfigCheck) {
            const triggerConfig = parseTriggerConfig(bot.configJson);
            newStatus = resolveRunningOrWaiting(triggerConfig);
        }

        const runId = event === 'START' || event === 'RESUME' ? uuidv4() : bot.runId;

        // 构建更新数据
        interface BotUpdateData {
            status: string;
            statusVersion: number;
            runId: string | null;
            startedAt?: Date | null;
            autoCloseReferencePrice?: string | null;
            autoCloseTriggeredAt?: null;
            autoCloseReason?: null;
        }

        const updateData: BotUpdateData = {
            status: newStatus ?? transition.targetStatus!,
            statusVersion: bot.statusVersion + 1,
            runId: event === 'STOP' ? null : runId,
        };

        // START/RESUME: set startedAt baseline for expiryDays
        if (event === 'START' || event === 'RESUME') {
            updateData.startedAt = new Date();
        }

        // START/RESUME: 冻结 referencePrice + 清空触发状态（新 run）
        if ((event === 'START' || event === 'RESUME') && referencePrice) {
            updateData.autoCloseReferencePrice = referencePrice;
            updateData.autoCloseTriggeredAt = null;
            updateData.autoCloseReason = null;
        }

        const updated = await tx.bot.update({
            where: {
                id: botId,
                statusVersion: bot.statusVersion,
            },
            data: updateData,
        });

        return updated;
    });

    return result;
}

// ============================================================================
// 向后兼容：导出默认 router
// ============================================================================

export const botsRouter = createBotsRouter();
