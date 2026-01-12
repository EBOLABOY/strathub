/**
 * Database Types Export
 * 
 * 重新导出 Prisma 生成的类型，方便其他包使用
 */

export type {
    User,
    ExchangeAccount,
    Bot,
    Order,
    Trade,
    BotSnapshot,
    BotLog,
    ConfigItem,
    ConfigHistory,
    ConfigTemplate,
} from '@prisma/client';

// Re-export Prisma namespace for advanced usage
export { Prisma } from '@prisma/client';
