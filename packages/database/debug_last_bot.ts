
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const bot = await prisma.bot.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
            orders: {
                orderBy: { createdAt: 'desc' },
                take: 5
            }
        }
    });

    if (!bot) {
        console.log('No bot found');
        return;
    }

    console.log(`Bot ID: ${bot.id}`);
    console.log(`Status: ${bot.status}`);
    console.log('--- Config ---');
    try {
        const config = JSON.parse(bot.configJson);
        console.log("Grid Type:", config.trigger?.gridType);
        console.log("Amount Mode:", config.sizing?.amountMode);
        console.log("Symmetric OrderQty:", config.sizing?.symmetric?.orderQuantity);
        console.log("Asymmetric OrderQty:", config.sizing?.asymmetric);
        console.log("Base Price:", config.trigger?.basePrice);
        console.log("Rise/Fall:", config.trigger?.riseSell, config.trigger?.fallBuy);
    } catch (e) {
        console.log('Invalid Config JSON', bot.configJson);
    }

    bot.orders.forEach(o => {
        console.log(`[${o.status}] ${o.side} ${o.type} Price:${o.price} Amount:${o.amount}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
