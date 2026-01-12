
import dotenv from 'dotenv';
import { BinanceExecutor } from '../src/binance-executor.js';
import { ORDER_PREFIX } from '@crypto-strategy-hub/shared';

dotenv.config();

async function main() {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_SECRET;

    if (!apiKey || !secret) {
        console.error('Missing BINANCE_API_KEY or BINANCE_SECRET env vars');
        process.exit(1);
    }

    console.log('Initializing BinanceExecutor (Testnet)...');
    const executor = new BinanceExecutor({
        apiKey,
        secret,
        isTestnet: true,
    });

    const symbol = 'BNB/USDT';
    const price = '500'; // Low price to avoid fill? Or reasonable price? Testnet price might vary.
    // fetchTicker first?
    // executor doesn't have fetchTicker exposed directly as public method (it's TradingExecutor interface).
    // But we can cast or just blindly place unlikely order.
    // Testnet BNB usually around normal price. 

    // Generate unique clientOrderId suffix
    const suffix = Date.now().toString();
    const clientOrderId = `${ORDER_PREFIX}-man-${suffix}`;

    console.log(`\n1. Creating Limit Buy Order: ${clientOrderId} at ${price}`);
    try {
        const order = await executor.createOrder({
            symbol,
            type: 'limit',
            side: 'buy',
            price,
            amount: '0.1',
            clientOrderId
        });
        console.log('Order created:', order);
    } catch (e) {
        console.error('Create order failed:', e);
        return;
    }

    console.log(`\n2. Submitting REPEAT Duplicate Order: ${clientOrderId}`);
    try {
        const order = await executor.createOrder({
            symbol,
            type: 'limit',
            side: 'buy',
            price,
            amount: '0.1',
            clientOrderId
        });
        console.log('Duplicate order submission result (Idempotency Success):', order);
    } catch (e: any) {
        console.error('Duplicate submission failed (Expected Success):', e.message);
    }

    console.log(`\n3. Fetching Open Orders...`);
    const openOrders = await executor.fetchOpenOrders(symbol);
    console.log(`Found ${openOrders.length} open orders.`);
    const found = openOrders.find(o => o.clientOrderId === clientOrderId);
    if (found) {
        console.log('Verified order exists in open orders:', found);

        console.log(`\n4. Cancelling Order: ${found.id}`);
        await executor.cancelOrder(found.id, symbol);
        console.log('Order cancelled.');
    } else {
        console.error('Order not found in open orders list!');
    }

    console.log('\nDone.');
}

main().catch(console.error);
