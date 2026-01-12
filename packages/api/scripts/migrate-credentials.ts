#!/usr/bin/env npx tsx
/**
 * Migrate Credentials Script
 * 
 * Migrates existing plaintext JSON credentials to encrypted format.
 * 
 * Usage:
 *   CREDENTIALS_ENCRYPTION_KEY=<base64-key> npx tsx scripts/migrate-credentials.ts
 * 
 * Requirements:
 *   - CREDENTIALS_ENCRYPTION_KEY must be set (32 bytes base64)
 *   - DATABASE_URL must be set
 */

import { prisma } from '@crypto-strategy-hub/database';
import { encryptCredentials, isEncryptionEnabled, isEncryptedFormat } from '../src/utils/crypto.js';

async function main() {
    console.log('=== Credentials Migration Script ===\n');

    // Check encryption key
    if (!isEncryptionEnabled()) {
        console.error('ERROR: CREDENTIALS_ENCRYPTION_KEY is not set.');
        console.error('Please set a 32-byte base64-encoded key.');
        process.exit(1);
    }

    console.log('✓ Encryption key is available\n');

    // Find all exchange accounts
    const accounts = await prisma.exchangeAccount.findMany({
        select: {
            id: true,
            name: true,
            exchange: true,
            encryptedCredentials: true,
        },
    });

    console.log(`Found ${accounts.length} account(s) to process.\n`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const account of accounts) {
        const { id, name, exchange, encryptedCredentials } = account;
        const label = `[${exchange}] ${name} (${id})`;

        try {
            // Check if already encrypted
            if (isEncryptedFormat(encryptedCredentials)) {
                console.log(`⏭  ${label}: Already encrypted, skipping.`);
                skippedCount++;
                continue;
            }

            // Validate plaintext JSON
            try {
                JSON.parse(encryptedCredentials);
            } catch {
                console.log(`⚠  ${label}: Invalid JSON, skipping.`);
                skippedCount++;
                continue;
            }

            // Encrypt and update
            const encrypted = encryptCredentials(encryptedCredentials);

            await prisma.exchangeAccount.update({
                where: { id },
                data: { encryptedCredentials: encrypted },
            });

            console.log(`✓  ${label}: Migrated successfully.`);
            migratedCount++;
        } catch (error) {
            console.error(`✗  ${label}: Error - ${error}`);
            errorCount++;
        }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`  Migrated: ${migratedCount}`);
    console.log(`  Skipped:  ${skippedCount}`);
    console.log(`  Errors:   ${errorCount}`);
    console.log('');

    if (errorCount > 0) {
        console.log('⚠  Some accounts failed to migrate. Please investigate.');
        process.exit(1);
    }

    console.log('✓ Migration complete.');
}

main()
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    })
    .finally(() => {
        prisma.$disconnect();
    });
