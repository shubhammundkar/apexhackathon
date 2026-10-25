import crypto from 'crypto';
import { StoredUserRecord } from '../store/repositoryStore.js';
import { config } from '../config.js';

// High-entropy ephemeral secret generated in-memory once per process in non-production environments
// This avoids having any hardcoded secret string in source code while remaining zero-config in development/tests.
const ephemeralDevSecret = crypto.randomBytes(32).toString('hex');

export function getAuthSecret(): string {
  const configured = config.AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  if (config.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be configured with at least 16 characters in production environments.');
  }
  return ephemeralDevSecret;
}

export interface TokenPayload {
  userId: string;
  username: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Hashes a plain-text password using crypto PBKDF2 with a unique salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plain-text password against a stored salt:hash string
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Creates an HMAC-SHA256 signed stateless auth token valid for 30 days
 */
export function createToken(user: StoredUserRecord): string {
  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    email: user.email,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies and decodes an auth token. Returns null if invalid or expired.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadBase64, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', getAuthSecret())
      .update(payloadBase64)
      .digest('base64url');

    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }

    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload: TokenPayload = JSON.parse(payloadJson);

    if (Date.now() > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}
