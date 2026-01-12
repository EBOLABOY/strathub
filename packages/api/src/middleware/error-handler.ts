/**
 * Error Handler Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface ApiError extends Error {
    statusCode?: number;
    code?: string;
}

export function errorHandler(
    err: ApiError,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    console.error(`[Error] ${err.message}`, err.stack);

    // Zod validation error
    if (err instanceof ZodError) {
        res.status(422).json({
            error: 'Validation Error',
            code: 'VALIDATION_ERROR',
            issues: err.errors,
        });
        return;
    }

    // Custom API error
    const statusCode = err.statusCode ?? 500;
    const code = err.code ?? 'INTERNAL_ERROR';

    res.status(statusCode).json({
        error: err.message,
        code,
    });
}

/**
 * 创建 API 错误
 */
export function createApiError(message: string, statusCode: number, code: string): ApiError {
    const error = new Error(message) as ApiError;
    error.statusCode = statusCode;
    error.code = code;
    return error;
}
