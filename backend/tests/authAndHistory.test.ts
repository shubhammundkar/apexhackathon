import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { apiRouter } from '../src/routes/api.js';
import { repositoryManager } from '../src/services/repositoryManager.js';
import { InMemoryRepositoryStore } from '../src/store/memoryStore.js';
import { StoredRepositoryRecord, StoredFileRecord } from '../src/store/repositoryStore.js';

describe('Auth & Q&A Chat History in Store', () => {
  let app: express.Application;
  let testStore: InMemoryRepositoryStore;

  const mockRepoRecord: StoredRepositoryRecord = {
    repoId: 'testowner/testrepo',
    commitSha: 'commit1234567890abcdef',
    metadata: {
      id: 'testowner/testrepo',
      owner: 'testowner',
      name: 'testrepo',
      fullName: 'testowner/testrepo',
      url: 'https://github.com/testowner/testrepo',
      defaultBranch: 'main',
      description: 'Test repository for auth & history',
      stars: 42,
      forks: 5,
      openIssues: 1,
      primaryLanguage: 'TypeScript',
      license: 'MIT',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      sizeKb: 100,
    },
    fileTree: [
      {
        path: 'src/index.ts',
        name: 'index.ts',
        type: 'file',
        size: 50,
      },
    ],
    fileAnalysisMap: {},
    ingestedAt: '2024-01-01T00:00:00Z',
    lastAccessedAt: '2024-01-01T00:00:00Z',
  };

  const mockFiles: StoredFileRecord[] = [
    {
      repoId: 'testowner/testrepo',
      commitSha: 'commit1234567890abcdef',
      path: 'src/index.ts',
      language: 'typescript',
      size: 50,
      lineCount: 3,
      sha256: 'abc123sha',
      content: 'export function hello() { return "world"; }',
    },
  ];

  beforeEach(async () => {
    testStore = new InMemoryRepositoryStore();
    repositoryManager.setStore(testStore);
    await testStore.saveRepository(mockRepoRecord, mockFiles);

    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
  });

  afterEach(async () => {
    await testStore.close();
  });

  it('allows optional user registration and returns token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'coder123',
        email: 'coder@example.com',
        password: 'password123',
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe('coder123');
    expect(res.body.user.email).toBe('coder@example.com');
  });

  it('allows user login with valid credentials and fails on wrong password', async () => {
    // 1. Register
    await request(app)
      .post('/api/auth/register')
      .send({
        username: 'alice',
        email: 'alice@example.com',
        password: 'securepassword',
      });

    // 2. Login successfully
    const successRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'alice',
        password: 'securepassword',
      });

    expect(successRes.status).toBe(200);
    expect(successRes.body.token).toBeDefined();
    expect(successRes.body.user.username).toBe('alice');

    // 3. Login with wrong password
    const failRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'alice',
        password: 'wrongpassword',
      });

    expect(failRes.status).toBe(401);
    expect(failRes.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('validates current user via /api/auth/me with bearer token', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'bob123',
        email: 'bob@example.com',
        password: 'mypassword',
      });

    const token = regRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.username).toBe('bob123');
  });

  it('saves Q&A chat history and retrieves it for returning users', async () => {
    // Register user
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'carol',
        email: 'carol@example.com',
        password: 'carolpassword',
      });

    const token = regRes.body.token;
    const userId = regRes.body.user.id;

    // Save Q&A history directly into store
    await testStore.saveQAHistory({
      id: 'qa_test_1',
      repoId: 'testowner/testrepo',
      commitSha: 'commit1234567890abcdef',
      userId,
      question: 'How is the hello function exported?',
      answer: 'The hello function is exported in src/index.ts',
      citations: [{ filePath: 'src/index.ts', startLine: 1, endLine: 1, snippet: 'export function hello()' }],
      createdAt: new Date().toISOString(),
    });

    // Retrieve history
    const historyRes = await request(app)
      .get('/api/repositories/testowner/testrepo/questions/history')
      .set('Authorization', `Bearer ${token}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.history.length).toBe(1);
    expect(historyRes.body.history[0].question).toBe('How is the hello function exported?');
    expect(historyRes.body.history[0].answer).toContain('src/index.ts');
  });

  it('shows previously analyzed repositories in /api/repositories', async () => {
    // Track repo for anonymous or logged-in user
    await testStore.trackUserRepo({
      id: 'sess_1@testowner/testrepo',
      sessionId: 'sess_1',
      repoId: 'testowner/testrepo',
      name: 'testrepo',
      stars: 42,
      lastAccessedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/repositories')
      .set('x-session-id', 'sess_1');

    expect(res.status).toBe(200);
    expect(res.body.repositories.length).toBeGreaterThanOrEqual(1);
    expect(res.body.repositories[0].id).toBe('testowner/testrepo');
  });
});
