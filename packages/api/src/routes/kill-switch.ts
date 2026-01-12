/**
 * Kill Switch Routes - ACC-RISK-001
 * 
 * API：
 * - POST /kill-switch/enable
 * - POST /kill-switch/disable
 * - GET /kill-switch
 */

import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import {
    getKillSwitchState,
    enableKillSwitch,
    disableKillSwitch,
} from '../services/kill-switch.js';

export const killSwitchRouter = Router();

// 所有路由都需要认证
killSwitchRouter.use(authGuard);

const enableSchema = z.object({
    reason: z.string().optional(),
});

// GET /kill-switch - 获取状态
killSwitchRouter.get('/', async (req, res, next) => {
    try {
        const userId = requireUserId(req);
        const state = await getKillSwitchState(userId);
        res.json(state);
    } catch (error) {
        next(error);
    }
});

// POST /kill-switch/enable - 启用（幂等）
killSwitchRouter.post('/enable', async (req, res, next) => {
    try {
        const userId = requireUserId(req);
        const { reason } = enableSchema.parse(req.body);

        const result = await enableKillSwitch(userId, reason ?? 'MANUAL');
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// POST /kill-switch/disable - 禁用（幂等）
killSwitchRouter.post('/disable', async (req, res, next) => {
    try {
        const userId = requireUserId(req);
        const state = await disableKillSwitch(userId);
        res.json(state);
    } catch (error) {
        next(error);
    }
});
