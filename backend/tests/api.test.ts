import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Backend API Endpoints', () => {
  const app = createApp();

  describe('GET /api/health', () => {
    it('returns status 200 with server status and safe config summary', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.config).toBeDefined();
      expect(res.body.config.port).toBeDefined();
      // Ensure no raw secrets are leaked in response
      expect(res.body.config.geminiApiKey).toBeUndefined();
      expect(res.body.config.githubToken).toBeUndefined();
    });
  });

  describe('POST /api/repositories/analyze Validation', () => {
    it('rejects missing or empty repository URL with 400', async () => {
      const res = await request(app).post('/api/repositories/analyze').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects non-GitHub URLs with 400', async () => {
      const res = await request(app)
        .post('/api/repositories/analyze')
        .send({ url: 'https://gitlab.com/owner/repo' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Must be a valid GitHub repository URL');
    });

    it('rejects malformed URLs with 400', async () => {
      const res = await request(app)
        .post('/api/repositories/analyze')
        .send({ url: 'not-even-a-url' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/jobs/:jobId', () => {
    it('returns 404 for unknown job ID', async () => {
      const res = await request(app).get('/api/jobs/job_nonexistent_123');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('JOB_NOT_FOUND');
    });
  });

  describe('GET /api/repositories/:owner/:repo', () => {
    it('returns 404 for un-analyzed repository', async () => {
      const res = await request(app).get('/api/repositories/nobody/nothing');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('REPOSITORY_NOT_FOUND');
    });
  });
});
