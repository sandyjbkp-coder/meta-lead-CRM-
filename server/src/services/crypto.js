// AES-256-GCM encryption/decryption for credentials at rest
// Uses MASTER_KEY from env (base64:// prefixed or raw base64)
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { getMasterKey } from '../config/env.js';

let masterKey = null;

function getKey() {
  if (!masterKey) {
    masterKey = getMasterKey();
    // AES-256-GCM requires exactly 32 bytes
    if (masterKey.length !== 32) {
      masterKey = createHmac('sha256', 'meta-crm-key-derivation-v1').update(masterKey).digest();
    }
  }
  return masterKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: iv.authTag.ciphertext (all base64url-encoded)
 */
export function encryptToken(plain) {
  if (!plain) return '';
  const iv = randomBytes(12); // 96-bit IV standard for GCM
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(Buffer.from('meta-crm-aad', 'utf8'));
  let encrypted = cipher.update(plain, 'utf8', 'base64url');
  encrypted += cipher.final('base64url');
  const authTag = cipher.getAuthTag().toString('base64url');
  return `${iv.toString('base64url')}.${authTag}.${encrypted}`;
}

/**
 * Decrypt a token produced by encryptToken.
 * Accepts format: iv.authTag.ciphertext (all base64url)
 */
export function decryptToken(encryptedToken) {
  if (!encryptedToken) return '';
  const parts = encryptedToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format: expected iv.authTag.ciphertext');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAAD(Buffer.from('meta-crm-aad', 'utf8'));
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(dataB64, 'base64url', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Mask a secret for safe display in API responses.
 * Shows first 4 and last 2 characters, rest as ***.
 */
export function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-2);
}

// Re-export bcrypt for users routes
import bcrypt from 'bcryptjs';
export { bcrypt };
