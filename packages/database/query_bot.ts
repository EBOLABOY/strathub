import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const bot = await prisma.bot.findMany({
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
            orders: {
                take: 5,
                orderBy: { createdAt: 'desc' }
            }
        }
    });

    console.log('--- BOT STATUS ---');
    console.log(JSON.stringify(bot, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
