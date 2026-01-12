/**
 * Crypto Module Unit Tests
 * 
 * Tests for AES-256-GCM encryption of credentials
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

describe('Crypto Module', () => {
    const originalEnv = process.env['CREDENTIALS_ENCRYPTION_KEY'];

    // Generate a valid 32-byte key for tests
    const testKey = randomBytes(32).toString('base64');

    beforeEach(() => {
        process.env['CREDENTIALS_ENCRYPTION_KEY'] = testKey;
    });

    afterEach(() => {
        if (originalEnv) {
            process.env['CREDENTIALS_ENCRYPTION_KEY'] = originalEnv;
        } else {
            delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
        }
    });

    describe('encryptCredentials / decryptCredentials', () => {
        it('should roundtrip encrypt and decrypt successfully', async () => {
            // Dynamic import to get fresh module with env set
            const { encryptCredentials, decryptCredentials } = await import('../src/utils/crypto.js');

            const plaintext = JSON.stringify({ apiKey: 'test-key', secret: 'test-secret' });

            const encrypted = encryptCredentials(plaintext);
            const decrypted = decryptCredentials(encrypted);

            expect(decrypted).toBe(plaintext);
        });

        it('should produce ciphertext that is not JSON parseable', async () => {
            const { encryptCredentials } = await import('../src/utils/crypto.js');

            const plaintext = JSON.stringify({ apiKey: 'test-key', secret: 'test-secret' });
            const encrypted = encryptCredentials(plaintext);

            // Encrypted format should NOT be valid JSON
            expect(() => JSON.parse(encrypted)).toThrow();

            // Should be in format iv:authTag:ciphertext
            const parts = encrypted.split(':');
            expect(parts.length).toBe(3);
        });

        it('should produce different ciphertext for same plaintext (random IV)', async () => {
            const { encryptCredentials } = await import('../src/utils/crypto.js');

            const plaintext = JSON.stringify({ apiKey: 'test-key', secret: 'test-secret' });

            const encrypted1 = encryptCredentials(plaintext);
            const encrypted2 = encryptCredentials(plaintext);

            expect(encrypted1).not.toBe(encrypted2);
        });
    });

    describe('error handling', () => {
        it('should throw when encryption key is missing', async () => {
            delete process.env['CREDENTIALS_ENCRYPTION_KEY'];

            // Re-import to get fresh module
            const cryptoModule = await import('../src/utils/crypto.js');

            const plaintext = JSON.stringify({ apiKey: 'test', secret: 'test' });

            expect(() => cryptoModule.encryptCredentials(plaintext)).toThrow('CREDENTIALS_ENCRYPTION_KEY is not set');
        });

        it('should throw when decrypting with wrong key', async () => {
            const { encryptCredentials } = await import('../src/utils/crypto.js');

            const plaintext = JSON.stringify({ apiKey: 'test', secret: 'test' });
            const encrypted = encryptCredentials(plaintext);

            // Change to a different key
            process.env['CREDENTIALS_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

            // Re-import to get module with new key
            const { decryptCredentials } = await import('../src/utils/crypto.js');

            expect(() => decryptCredentials(encrypted)).toThrow();
        });

        it('should throw for invalid ciphertext format', async () => {
            const { decryptCredentials } = await import('../src/utils/crypto.js');

            expect(() => decryptCredentials('not-valid-format')).toThrow('Invalid ciphertext format');
            expect(() => decryptCredentials('only:two:parts:extra')).toThrow(); // 4 parts
        });
    });

    describe('isEncryptionEnabled', () => {
        it('should return true when key is set', async () => {
            const { isEncryptionEnabled } = await import('../src/utils/crypto.js');
            expect(isEncryptionEnabled()).toBe(true);
        });

        it('should return false when key is not set', async () => {
            delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
            const { isEncryptionEnabled } = await import('../src/utils/crypto.js');
            expect(isEncryptionEnabled()).toBe(false);
        });
    });

    describe('isEncryptedFormat', () => {
        it('should return true for encrypted format', async () => {
            const { encryptCredentials, isEncryptedFormat } = await import('../src/utils/crypto.js');

            const encrypted = encryptCredentials('{"test": "data"}');
            expect(isEncryptedFormat(encrypted)).toBe(true);
        });

        it('should return false for plaintext JSON', async () => {
            const { isEncryptedFormat } = await import('../src/utils/crypto.js');

            expect(isEncryptedFormat('{"apiKey": "test", "secret": "test"}')).toBe(false);
        });
    });
});
