/**
 * Credentials Encryption Module
 * 
 * AES-256-GCM encryption for exchange account credentials.
 * Format: iv:authTag:ciphertext (all base64)
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment
 * @returns Buffer containing 32-byte key
 * @throws Error if key is missing or invalid
 */
function getEncryptionKey(): Buffer {
    const keyBase64 = process.env['CREDENTIALS_ENCRYPTION_KEY'];
    if (!keyBase64) {
        throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set');
    }

    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) {
        throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
    }

    return key;
}

/**
 * Check if encryption is available
 */
export function isEncryptionEnabled(): boolean {
    try {
        getEncryptionKey();
        return true;
    } catch {
        return false;
    }
}

/**
 * Encrypt credentials using AES-256-GCM
 * 
 * @param plaintext JSON string containing credentials
 * @returns Encrypted string in format "iv:authTag:ciphertext" (all base64)
 */
export function encryptCredentials(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt credentials using AES-256-GCM
 * 
 * @param ciphertext Encrypted string in format "iv:authTag:ciphertext"
 * @returns Decrypted plaintext JSON string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptCredentials(ciphertext: string): string {
    const key = getEncryptionKey();

    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format: expected iv:authTag:ciphertext');
    }

    const [ivBase64, authTagBase64, encryptedBase64] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');

    if (iv.length !== IV_LENGTH) {
        throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Check if a string looks like encrypted credentials (vs plaintext JSON)
 */
export function isEncryptedFormat(value: string): boolean {
    // Encrypted format: iv:authTag:ciphertext (3 base64 parts)
    const parts = value.split(':');
    if (parts.length !== 3) {
        return false;
    }

    // Try to parse as JSON - if it works, it's probably plaintext
    try {
        JSON.parse(value);
        return false; // Valid JSON = plaintext
    } catch {
        return true; // Not JSON = likely encrypted
    }
}
