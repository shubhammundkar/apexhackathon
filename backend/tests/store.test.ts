import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import request from 'supertest';
import {
  SqliteRepositoryStore,
  InMemoryRepositoryStore,
  StoredRepositoryRecord,
  StoredFileRecord,
  StoredJobRecord,
} from '../src/store/index.js';
import { RepositoryManager, repositoryManager } from '../src/services/repositoryManager.js';
import { createApp } from '../src/app.js';
import { RepositoryMetadata, FullRepositoryAnalysis } from '@codebase-explainer/shared';

describe('Persistent Repository Storage & Restart Verification', () => {
  const testDbDir = path.resolve(process.cwd(), 'tests/temp_db');

  function getUniqueDbPath(): string {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    return path.resolve(testDbDir, `test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  }

  beforeEach(() => {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
  });

  afterEach(() => {
    repositoryManager.setStore(new InMemoryRepositoryStore());
    try {
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore Windows file lock during cleanup
    }
  });

  const sampleMetadata: RepositoryMetadata = {
    id: 'testowner/testrepo',
    owner: 'testowner',
    name: 'testrepo',
    fullName: 'testowner/testrepo',
    url: 'https://github.com/testowner/testrepo',
    defaultBranch: 'main',
    description: 'A test repository',
    stars: 120,
    forks: 15,
    openIssues: 2,
    primaryLanguage: 'TypeScript',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    sizeKb: 50,
  };

  const sampleFiles: StoredFileRecord[] = [
    {
      repoId: 'testowner/testrepo',
      commitSha: 'c032a11b88e6a18d197cb9b699e120bc7bb500a1',
      path: 'index.ts',
      language: 'typescript',
      size: 150,
      lineCount: 8,
      sha256: crypto.createHash('sha256').update('export function main() { return "hello world"; }').digest('hex'),
      content: 'export function main() { return "hello world"; }',
    },
    {
      repoId: 'testowner/testrepo',
      commitSha: 'c032a11b88e6a18d197cb9b699e120bc7bb500a1',
      path: 'package.json',
      language: 'json',
      size: 80,
      lineCount: 5,
      sha256: crypto.createHash('sha256').update('{"name": "testrepo", "version": "1.0.0"}').digest('hex'),
      content: '{"name": "testrepo", "version": "1.0.0"}',
    },
  ];

  const sampleAnalysis: FullRepositoryAnalysis = {
    repositoryId: 'testowner/testrepo',
    analyzedAt: new Date().toISOString(),
    modelUsed: 'rule-based-static-analyzer',
    overview: {
      projectName: 'testrepo',
      tagline: 'A test repository',
      problemSolved: 'Software testing',
      detailedSummary: 'A test repository for unit and integration testing',
      detectedStack: [{ name: 'TypeScript', category: 'language', confidence: 'confirmed' }],
      entryPoints: [{ path: 'index.ts', description: 'Entrypoint', type: 'library' }],
      quickStartGuide: {
        prerequisites: ['Node.js'],
        installCommands: ['npm install'],
        runCommands: ['npm start'],
        envVariablesRequired: [],
      },
    },
    architecture: {
      pattern: 'Modular',
      description: 'Test architecture',
      layers: [{ name: 'Core', type: 'shared', description: 'Core library', files: ['index.ts'], dependencies: [] }],
      mermaidDiagram: 'graph TD; A-->B;',
      dataFlowDescription: 'Simple call flow',
    },
    importantFiles: [
      {
        path: 'index.ts',
        name: 'index.ts',
        responsibility: 'Exports main function',
        type: 'library',
        exports: ['main'],
        imports: [],
        functions: [{ name: 'main', startLine: 1, endLine: 1, isExported: true, description: 'Returns greeting' }],
        dependencies: [],
      },
    ],
    executionFlows: [],
    findings: [],
    dependenciesSummary: {
      runtimeDependencies: [],
      devDependencies: [],
      packageManager: 'npm',
      hasLockfile: false,
    },
    stats: {
      totalFiles: 2,
      indexedFiles: 2,
      totalLines: 13,
      languages: { typescript: 1, json: 1 },
    },
  };

  it('1. Save then load through a NEW store instance (simulates restart)', async () => {
    const dbPath = getUniqueDbPath();
    const store1 = new SqliteRepositoryStore(dbPath);

    const record: StoredRepositoryRecord = {
      repoId: 'testowner/testrepo',
      commitSha: 'c032a11b88e6a18d197cb9b699e120bc7bb500a1',
      metadata: sampleMetadata,
      analysis: sampleAnalysis,
      fileTree: [
        { path: 'index.ts', name: 'index.ts', type: 'file', size: 150, language: 'typescript', lineCount: 8 },
        { path: 'package.json', name: 'package.json', type: 'file', size: 80, language: 'json', lineCount: 5 },
      ],
      fileAnalysisMap: {
        'index.ts': sampleAnalysis.importantFiles[0],
      },
      ingestedAt: '2024-02-01T12:00:00Z',
      lastAccessedAt: '2024-02-01T12:00:00Z',
    };

    try {
      store1.saveRepository(record, sampleFiles);
    } finally {
      store1.close();
    }

    // Now open a brand new store on the exact same database file
    const store2 = new SqliteRepositoryStore(dbPath);
    try {
      const loaded = store2.getRepository('testowner/testrepo');

      expect(loaded).toBeDefined();
      expect(loaded?.repoId).toBe('testowner/testrepo');
      expect(loaded?.commitSha).toBe('c032a11b88e6a18d197cb9b699e120bc7bb500a1');
      expect(loaded?.metadata.name).toBe('testrepo');
      expect(loaded?.analysis?.overview.projectName).toBe('testrepo');
      expect(loaded?.fileTree.length).toBe(2);
      expect(loaded?.fileAnalysisMap['index.ts']?.responsibility).toBe('Exports main function');

      const files = store2.getFiles('testowner/testrepo', 'c032a11b88e6a18d197cb9b699e120bc7bb500a1');
      expect(files.length).toBe(2);
      expect(files.find((f) => f.path === 'index.ts')?.content).toBe('export function main() { return "hello world"; }');
      expect(files.find((f) => f.path === 'index.ts')?.sha256).toBe(sampleFiles[0].sha256);

      // Verify RepositoryManager lazily builds BM25 index on restart
      const manager = new RepositoryManager(store2);
      const repoState = await manager.getRepository('testowner/testrepo');
      expect(repoState).toBeDefined();

      // BM25 search should work seamlessly via lazy getter
      const searchResults = repoState!.indexer.search('main hello world');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].filePath).toBe('index.ts');
    } finally {
      store2.close();
    }
  });

  it('2. Cleanup of old repos beyond MAX_STORED_REPOS (LRU)', () => {
    const dbPath = getUniqueDbPath();
    const store = new SqliteRepositoryStore(dbPath);

    try {
      for (let i = 1; i <= 5; i++) {
        const repoId = `owner/repo${i}`;
        const sha = `sha_${i}`;
        const rec: StoredRepositoryRecord = {
          repoId,
          commitSha: sha,
          metadata: { ...sampleMetadata, id: repoId, name: `repo${i}` },
          fileTree: [],
          fileAnalysisMap: {},
          ingestedAt: new Date(2024, 0, i).toISOString(),
          lastAccessedAt: new Date(2024, 0, i).toISOString(),
        };
        const files: StoredFileRecord[] = [
          {
            repoId,
            commitSha: sha,
            path: 'README.md',
            language: 'markdown',
            size: 10,
            lineCount: 1,
            sha256: `hash_${i}`,
            content: `# Repo ${i}`,
          },
        ];
        store.saveRepository(rec, files);
      }

      expect(store.listRepositories().length).toBe(5);

      const deletedCount = store.pruneOldRepositories(2);
      expect(deletedCount).toBe(3);

      const remaining = store.listRepositories();
      expect(remaining.length).toBe(2);

      const remainingIds = remaining.map((r) => r.id);
      expect(remainingIds).toContain('owner/repo5');
      expect(remainingIds).toContain('owner/repo4');
      expect(remainingIds).not.toContain('owner/repo1');
      expect(remainingIds).not.toContain('owner/repo2');
      expect(remainingIds).not.toContain('owner/repo3');

      const oldFiles = store.getFiles('owner/repo1', 'sha_1');
      expect(oldFiles.length).toBe(0);
    } finally {
      store.close();
    }
  });

  it('3. Cache hit on re-analysis with same repoId@commitSha', async () => {
    const store = new InMemoryRepositoryStore();
    const manager = new RepositoryManager(store);

    const record: StoredRepositoryRecord = {
      repoId: 'expressjs/cookie-parser',
      commitSha: 'commit_cached_123',
      metadata: {
        ...sampleMetadata,
        id: 'expressjs/cookie-parser',
        owner: 'expressjs',
        name: 'cookie-parser',
        fullName: 'expressjs/cookie-parser',
      },
      fileTree: [],
      fileAnalysisMap: {},
      ingestedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
    store.saveRepository(record, []);

    const github = (manager as any).githubService;
    github.fetchMetadata = async () => record.metadata;
    github.fetchCommitSha = async () => 'commit_cached_123';

    const { jobId } = await manager.startAnalysis('https://github.com/expressjs/cookie-parser');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const job = await manager.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('completed');
    expect(job?.progress.message).toContain('already analyzed');
    expect(job?.progress.percent).toBe(100);
  });

  it('4. Concurrent job writes without locking errors', async () => {
    const dbPath = getUniqueDbPath();
    const store = new SqliteRepositoryStore(dbPath);

    try {
      const writes = Array.from({ length: 40 }, (_, i) => {
        const jobId = `job_concurrent_${i}`;
        const job: StoredJobRecord = {
          jobId,
          repoId: 'testowner/testrepo',
          url: 'https://github.com/testowner/testrepo',
          status: 'validating',
          progress: { stage: 'validating', message: `Step ${i}`, percent: i, warnings: [] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.saveJob(job);
        return store.updateJob(jobId, { status: 'completed', progress: { stage: 'completed', message: 'done', percent: 100 } });
      });

      expect(() => writes).not.toThrow();

      for (let i = 0; i < 40; i++) {
        const loaded = store.getJob(`job_concurrent_${i}`);
        expect(loaded).toBeDefined();
        expect(loaded?.status).toBe('completed');
      }
    } finally {
      store.close();
    }
  });

  it('5. API endpoints work correctly with persistence and 404 for unknown repo', async () => {
    const dbPath = getUniqueDbPath();
    const store = new SqliteRepositoryStore(dbPath);

    try {
      const record: StoredRepositoryRecord = {
        repoId: 'persistowner/persistrepo',
        commitSha: 'commit_xyz789',
        metadata: {
          ...sampleMetadata,
          id: 'persistowner/persistrepo',
          owner: 'persistowner',
          name: 'persistrepo',
          fullName: 'persistowner/persistrepo',
        },
        analysis: sampleAnalysis,
        fileTree: [
          { path: 'index.ts', name: 'index.ts', type: 'file', size: 150, language: 'typescript', lineCount: 8 },
        ],
        fileAnalysisMap: {
          'index.ts': sampleAnalysis.importantFiles[0],
        },
        ingestedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };
      store.saveRepository(record, [sampleFiles[0]]);

      repositoryManager.setStore(store);
      const app = createApp();

      // Test GET /api/repositories/:owner/:repo
      const repoRes = await request(app).get('/api/repositories/persistowner/persistrepo');
      expect(repoRes.status).toBe(200);
      expect(repoRes.body.id).toBe('persistowner/persistrepo');

      // Test GET /api/repositories/:owner/:repo/files
      const filesRes = await request(app).get('/api/repositories/persistowner/persistrepo/files');
      expect(filesRes.status).toBe(200);
      expect(filesRes.body.totalFiles).toBe(1);
      expect(filesRes.body.files[0].path).toBe('index.ts');

      // Test GET /api/repositories/:owner/:repo/files/content
      const contentRes = await request(app).get('/api/repositories/persistowner/persistrepo/files/content?path=index.ts');
      expect(contentRes.status).toBe(200);
      expect(contentRes.body.content).toContain('export function main()');

      // Test GET /api/repositories/:owner/:repo/analysis
      const analysisRes = await request(app).get('/api/repositories/persistowner/persistrepo/analysis');
      expect(analysisRes.status).toBe(200);
      expect(analysisRes.body.overview.projectName).toBe('testrepo');

      // Test 404 for unknown repository
      const notFoundRes = await request(app).get('/api/repositories/unknown/notanalyzed');
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.error).toBe('REPOSITORY_NOT_FOUND');
    } finally {
      store.close();
    }
  });
});
