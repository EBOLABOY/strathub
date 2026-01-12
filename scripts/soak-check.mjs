import { prisma } from '@crypto-strategy-hub/database';

function minutes(ms) {
  return ms * 60 * 1000;
}

function formatAgeMs(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

const now = Date.now();
const stuckThresholdMs = minutes(10);
const stuckBefore = new Date(now - stuckThresholdMs);

const botsByStatus = await prisma.bot.groupBy({
  by: ['status'],
  _count: { _all: true },
  orderBy: { status: 'asc' },
});

const stuckStopping = await prisma.bot.findMany({
  where: {
    status: 'STOPPING',
    updatedAt: { lt: stuckBefore },
  },
  select: {
    id: true,
    symbol: true,
    updatedAt: true,
    lastError: true,
  },
  orderBy: { updatedAt: 'asc' },
  take: 50,
});

const errorBots = await prisma.bot.findMany({
  where: { status: 'ERROR' },
  select: { id: true, symbol: true, lastError: true, updatedAt: true },
  orderBy: { updatedAt: 'desc' },
  take: 50,
});

const stuckOutboxOrders = await prisma.order.findMany({
  where: {
    submittedAt: null,
    exchangeOrderId: null,
    createdAt: { lt: stuckBefore },
  },
  select: {
    id: true,
    botId: true,
    clientOrderId: true,
    intentSeq: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'asc' },
  take: 50,
});

const summary = {
  now: new Date(now).toISOString(),
  stuckThresholdMinutes: stuckThresholdMs / minutes(1),
  botsByStatus,
  counts: {
    stoppingStuck: stuckStopping.length,
    errorBots: errorBots.length,
    outboxOrdersStuck: stuckOutboxOrders.length,
  },
  stoppingStuck: stuckStopping.map((b) => ({
    ...b,
    age: formatAgeMs(now - b.updatedAt.getTime()),
  })),
  errorBots: errorBots.map((b) => ({
    ...b,
    age: formatAgeMs(now - b.updatedAt.getTime()),
  })),
  outboxOrdersStuck: stuckOutboxOrders.map((o) => ({
    ...o,
    age: formatAgeMs(now - o.createdAt.getTime()),
  })),
};

console.log(JSON.stringify(summary, null, 2));

await prisma.$disconnect();
