import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const trades = await prisma.trade.findMany({
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
            tradeId: true,
            price: true,
            amount: true,
            orderId: true,
            clientOrderId: true,
            timestamp: true,
        }
    });

    // Also check orders for these trades if clientOrderId is available
    const clientOrderIds = trades.map(t => t.clientOrderId).filter(Boolean) as string[];
    const orders = await prisma.order.findMany({
        where: { clientOrderId: { in: clientOrderIds } },
        select: {
            id: true,
            clientOrderId: true,
            exchangeOrderId: true,
            side: true,
            status: true,
            createdAt: true,
            intentSeq: true
        }
    });

    console.log('--- TRADES ---');
    console.log(JSON.stringify(trades, null, 2));
    console.log('--- RELATED ORDERS ---');
    console.log(JSON.stringify(orders, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
