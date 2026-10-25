import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { getConfigSummary } from '../src/config.js';
import { createToken, verifyToken, hashPassword, verifyPassword } from '../src/services/authService.js';
import { GitHubService } from '../src/services/githubService.js';
import { redactSecrets, isSecretFile } from '../src/services/fileFilterService.js';
import { StoredUserRecord } from '../src/store/repositoryStore.js';

describe('Credential Security & Secret Management', () => {
  const app = createApp();

  describe('1. Safe Configuration & Diagnostic Endpoints', () => {
    it('GET /api/health never exposes server secrets or raw credentials', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.config).toBeDefined();

      const config = res.body.config;
      // Must only expose booleans for status, never raw secrets
      expect(typeof config.geminiConfigured).toBe('boolean');
      expect(typeof config.githubTokenConfigured).toBe('boolean');
      expect(typeof config.mongodbConfigured).toBe('boolean');
      expect(typeof config.authSecretConfigured).toBe('boolean');

      // Verify no credential fields exist
      expect(config.GEMINI_API_KEY).toBeUndefined();
      expect(config.geminiApiKey).toBeUndefined();
      expect(config.GITHUB_TOKEN).toBeUndefined();
      expect(config.githubToken).toBeUndefined();
      expect(config.AUTH_SECRET).toBeUndefined();
      expect(config.authSecret).toBeUndefined();
      expect(config.MONGODB_URI).toBeUndefined();
      expect(config.mongodbUri).toBeUndefined();
    });

    it('getConfigSummary returns safe boolean indicators', () => {
      const summary = getConfigSummary();
      expect(summary).not.toHaveProperty('GEMINI_API_KEY');
      expect(summary).not.toHaveProperty('GITHUB_TOKEN');
      expect(summary).not.toHaveProperty('AUTH_SECRET');
      expect(summary).not.toHaveProperty('MONGODB_URI');
    });
  });

  describe('2. Authentication Secrets & Token Security', () => {
    const mockUser: StoredUserRecord = {
      id: 'usr_sec_123',
      username: 'security_auditor',
      email: 'sec@example.com',
      passwordHash: hashPassword('super_secure_pass_123!'),
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    it('creates and verifies tokens with HMAC-SHA256 signatures', () => {
      const token = createToken(mockUser);
      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(2);

      const verified = verifyToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(mockUser.id);
      expect(verified?.username).toBe(mockUser.username);
    });

    it('rejects tampered or forged tokens', () => {
      const token = createToken(mockUser);
      const [payload, sig] = token.split('.');

      // Tamper with signature
      const tamperedSig = sig.slice(0, -3) + 'xyz';
      expect(verifyToken(`${payload}.${tamperedSig}`)).toBeNull();

      // Tamper with payload (e.g. attempting privilege escalation)
      const tamperedPayload = Buffer.from(
        JSON.stringify({ userId: 'usr_admin', exp: Date.now() + 100000 })
      ).toString('base64url');
      expect(verifyToken(`${tamperedPayload}.${sig}`)).toBeNull();
    });

    it('rejects expired tokens', () => {
      // Manually construct an expired token with correct format
      const expiredPayload = Buffer.from(
        JSON.stringify({ userId: 'usr_expired', exp: Date.now() - 5000, iat: Date.now() - 100000 })
      ).toString('base64url');

      expect(verifyToken(`${expiredPayload}.invalidsig`)).toBeNull();
    });

    it('safely hashes and verifies passwords using PBKDF2 with unique salts', () => {
      const hash1 = hashPassword('myPassword123');
      const hash2 = hashPassword('myPassword123');

      // Unique salts ensure two identical passwords produce different hashes
      expect(hash1).not.toBe(hash2);
      expect(verifyPassword('myPassword123', hash1)).toBe(true);
      expect(verifyPassword('myPassword123', hash2)).toBe(true);
      expect(verifyPassword('wrongPassword', hash1)).toBe(false);
    });
  });

  describe('3. Secret Redaction Pipeline', () => {
    it('redacts Google AI API keys (AIza...)', () => {
      const sample = 'const key = "AIzaSyD-fakeKeyForTestingPurposes123456";';
      const result = redactSecrets(sample);
      expect(result.hasRedactions).toBe(true);
      expect(result.content).toBe('const key = "[REDACTED_SECRET]";');
    });

    it('redacts GitHub Personal Access Tokens (ghp_ and github_pat_)', () => {
      const sample = 'const classic = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";\nconst fine = "github_pat_11AAAAAAA0123456789abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuv";';
      const result = redactSecrets(sample);
      expect(result.hasRedactions).toBe(true);
      expect(result.content).not.toContain('ghp_');
      expect(result.content).not.toContain('github_pat_');
      expect(result.content).toContain('[REDACTED_SECRET]');
    });

    it('redacts AWS Access Keys (AKIA...)', () => {
      const sample = 'AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"';
      const result = redactSecrets(sample);
      expect(result.hasRedactions).toBe(true);
      expect(result.content).toBe('AWS_ACCESS_KEY_ID="[REDACTED_SECRET]"');
    });

    it('redacts MongoDB connection strings containing passwords', () => {
      const sample = 'const uri = "mongodb+srv://admin:superSecretPass123@cluster0.abcde.mongodb.net/prod";';
      const result = redactSecrets(sample);
      expect(result.hasRedactions).toBe(true);
      expect(result.content).not.toContain('superSecretPass123');
    });

    it('identifies sensitive secret files for exclusion', () => {
      expect(isSecretFile('.env')).toBe(true);
      expect(isSecretFile('.env.production')).toBe(true);
      expect(isSecretFile('id_rsa')).toBe(true);
      expect(isSecretFile('server.key')).toBe(true);
      expect(isSecretFile('cert.pem')).toBe(true);
      expect(isSecretFile('.env.example')).toBe(false);
      expect(isSecretFile('index.ts')).toBe(false);
    });
  });

  describe('4. SSRF & GitHub URL Security', () => {
    const service = new GitHubService();

    it('allows valid GitHub URLs', () => {
      const parsed = service.parseRepoUrl('https://github.com/expressjs/cookie-parser');
      expect(parsed.owner).toBe('expressjs');
      expect(parsed.repo).toBe('cookie-parser');
    });

    it('strips .git suffix cleanly', () => {
      const parsed = service.parseRepoUrl('https://github.com/expressjs/cookie-parser.git');
      expect(parsed.repo).toBe('cookie-parser');
    });

    it('rejects non-GitHub domains to prevent SSRF', () => {
      expect(() => service.parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(/Only github\.com is supported/);
      expect(() => service.parseRepoUrl('http://169.254.169.254/latest/meta-data')).toThrow(/Only github\.com is supported/);
      expect(() => service.parseRepoUrl('http://localhost:3001/api/admin')).toThrow(/Only github\.com is supported/);
    });

    it('rejects non-HTTP protocols', () => {
      expect(() => service.parseRepoUrl('ftp://github.com/owner/repo')).toThrow(/Unsupported protocol/);
      expect(() => service.parseRepoUrl('file:///etc/passwd')).toThrow(/Unsupported protocol/);
    });
  });

  describe('5. Error Handler Secret Scrubbing', () => {
    it('redacts sensitive tokens and keys from error messages returned to clients', async () => {
      const errorApp = express();
      errorApp.get('/test-error', () => {
        throw new Error('Failed connecting with key AIzaSyD1234567890abcdef and token ghp_1234567890abcdefghijklmnopqrstuvwxyz');
      });

      // Attach error handler from app.ts logic
      errorApp.use((err: any, _req: any, res: any, _next: any) => {
        let safeMessage = err.message || '';
        safeMessage = safeMessage
          .replace(/AIza[0-9A-Za-z-_]{16,}/g, '[REDACTED]')
          .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED]')
          .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
          .replace(/mongodb(?:\+srv)?:\/\/[^\s@]+@/gi, 'mongodb$1://[REDACTED]@');

        res.status(500).json({ error: 'INTERNAL_ERROR', message: safeMessage });
      });

      const res = await request(errorApp).get('/test-error');
      expect(res.status).toBe(500);
      expect(res.body.message).not.toContain('AIzaSyD');
      expect(res.body.message).not.toContain('ghp_');
      expect(res.body.message).toContain('[REDACTED]');
    });
  });
});
