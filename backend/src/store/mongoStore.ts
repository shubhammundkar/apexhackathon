import dns from 'dns';
import { MongoClient, Db } from 'mongodb';
import {
  RepositoryStore,
  StoredRepositoryRecord,
  StoredFileRecord,
  StoredJobRecord,
  StoredUserRecord,
  StoredQARecord,
  StoredUserRepoRecord,
  GraphNodeRecord,
  GraphEdgeRecord,
  SymbolRecord,
  ExplanationRecord,
  VerifierResultRecord,
} from './repositoryStore.js';

// Ensure SRV records resolve cleanly on Windows environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore fallback
}

export class MongoRepositoryStore implements RepositoryStore {
  private client: MongoClient;
  private dbName: string;
  private dbInstance: Db | null = null;
  private connectingPromise: Promise<Db> | null = null;

  constructor(uri: string, dbName = 'codebase_explainer') {
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    this.dbName = dbName;
  }

  private async getDb(): Promise<Db> {
    if (this.dbInstance) {
      return this.dbInstance;
    }

    if (!this.connectingPromise) {
      this.connectingPromise = (async () => {
        await this.client.connect();
        const db = this.client.db(this.dbName);
        this.dbInstance = db;

        // Ensure key indexes exist
        await Promise.all([
          db.collection('repositories').createIndex({ repoId: 1, lastAccessedAt: -1 }),
          db.collection('repositories').createIndex({ repoId: 1, commitSha: 1 }, { unique: true }),
          db.collection('files').createIndex({ repoId: 1, commitSha: 1, path: 1 }, { unique: true }),
          db.collection('jobs').createIndex({ jobId: 1 }, { unique: true }),
          db.collection('users').createIndex({ username: 1 }, { unique: true }),
          db.collection('users').createIndex({ email: 1 }, { unique: true }),
          db.collection('qa_history').createIndex({ repoId: 1, createdAt: 1 }),
          db.collection('qa_history').createIndex({ userId: 1, createdAt: -1 }),
          db.collection('qa_history').createIndex({ sessionId: 1, createdAt: -1 }),
          db.collection('user_repositories').createIndex({ userId: 1, lastAccessedAt: -1 }),
          db.collection('user_repositories').createIndex({ sessionId: 1, lastAccessedAt: -1 }),
          db.collection('graph_nodes').createIndex({ repoId: 1, commitSha: 1, id: 1 }, { unique: true }),
          db.collection('graph_edges').createIndex({ repoId: 1, commitSha: 1, id: 1 }, { unique: true }),
          db.collection('symbols').createIndex({ repoId: 1, commitSha: 1, filePath: 1 }),
          db.collection('explanations').createIndex({ fileSha256: 1, promptVersion: 1 }, { unique: true }),
          db.collection('verifier_results').createIndex({ repoId: 1, commitSha: 1, id: 1 }, { unique: true }),
        ]);

        return db;
      })();
    }

    return this.connectingPromise;
  }

  private makeRepoKey(repoId: string, commitSha: string): string {
    return `${repoId.toLowerCase()}@${commitSha}`;
  }

  public async saveRepository(repo: StoredRepositoryRecord, files: StoredFileRecord[]): Promise<void> {
    const db = await this.getDb();
    const repoId = repo.repoId.toLowerCase();
    const key = this.makeRepoKey(repoId, repo.commitSha);

    await db.collection('repositories').updateOne(
      { _id: key as any },
      {
        $set: {
          _id: key,
          repoId,
          commitSha: repo.commitSha,
          metadata: repo.metadata,
          analysis: repo.analysis,
          fileTree: repo.fileTree,
          fileAnalysisMap: repo.fileAnalysisMap,
          ingestedAt: repo.ingestedAt,
          lastAccessedAt: repo.lastAccessedAt,
        },
      },
      { upsert: true }
    );

    // Replace files
    await db.collection('files').deleteMany({ repoId, commitSha: repo.commitSha });

    if (files.length > 0) {
      const docs = files.map((f) => ({
        _id: `${key}@${f.path}`,
        repoId,
        commitSha: repo.commitSha,
        path: f.path,
        language: f.language,
        size: f.size,
        lineCount: f.lineCount,
        sha256: f.sha256,
        content: f.content,
      }));
      await db.collection('files').insertMany(docs as any);
    }
  }

  public async getRepository(repoId: string, commitSha?: string): Promise<StoredRepositoryRecord | null> {
    const db = await this.getDb();
    const normalizedRepoId = repoId.toLowerCase();

    let doc: any;
    if (commitSha) {
      const key = this.makeRepoKey(normalizedRepoId, commitSha);
      doc = await db.collection('repositories').findOne({ _id: key as any });
    } else {
      doc = await db
        .collection('repositories')
        .find({ repoId: normalizedRepoId })
        .sort({ lastAccessedAt: -1 })
        .limit(1)
        .next();
    }

    if (!doc) return null;

    // Touch last accessed
    await this.touchRepository(doc.repoId, doc.commitSha);

    return {
      repoId: doc.repoId,
      commitSha: doc.commitSha,
      metadata: doc.metadata,
      analysis: doc.analysis,
      fileTree: doc.fileTree,
      fileAnalysisMap: doc.fileAnalysisMap,
      ingestedAt: doc.ingestedAt,
      lastAccessedAt: doc.lastAccessedAt,
    };
  }

  public async touchRepository(repoId: string, commitSha: string): Promise<void> {
    const db = await this.getDb();
    const key = this.makeRepoKey(repoId, commitSha);
    await db.collection('repositories').updateOne(
      { _id: key as any },
      { $set: { lastAccessedAt: new Date().toISOString() } }
    );
  }

  public async getFiles(repoId: string, commitSha: string): Promise<StoredFileRecord[]> {
    const db = await this.getDb();
    const docs = await db
      .collection('files')
      .find({ repoId: repoId.toLowerCase(), commitSha })
      .toArray();

    return docs.map((d: any) => ({
      repoId: d.repoId,
      commitSha: d.commitSha,
      path: d.path,
      language: d.language,
      size: d.size,
      lineCount: d.lineCount,
      sha256: d.sha256,
      content: d.content,
    }));
  }

  public async getFile(repoId: string, commitSha: string, path: string): Promise<StoredFileRecord | null> {
    const db = await this.getDb();
    const key = `${this.makeRepoKey(repoId, commitSha)}@${path}`;
    const doc: any = await db.collection('files').findOne({ _id: key as any });
    if (!doc) return null;

    return {
      repoId: doc.repoId,
      commitSha: doc.commitSha,
      path: doc.path,
      language: doc.language,
      size: doc.size,
      lineCount: doc.lineCount,
      sha256: doc.sha256,
      content: doc.content,
    };
  }

  public async listRepositories(): Promise<Array<{ id: string; commitSha: string; name: string; stars: number; ingestedAt: string; lastAccessedAt: string }>> {
    const db = await this.getDb();
    const docs = await db
      .collection('repositories')
      .find({})
      .sort({ lastAccessedAt: -1 })
      .toArray();

    return docs.map((d: any) => ({
      id: d.repoId,
      commitSha: d.commitSha,
      name: d.metadata?.fullName || d.metadata?.name || d.repoId,
      stars: d.metadata?.stars || 0,
      ingestedAt: d.ingestedAt,
      lastAccessedAt: d.lastAccessedAt,
    }));
  }

  public async deleteRepository(repoId: string, commitSha: string): Promise<void> {
    const db = await this.getDb();
    const normalized = repoId.toLowerCase();
    const key = this.makeRepoKey(normalized, commitSha);

    await Promise.all([
      db.collection('repositories').deleteOne({ _id: key as any }),
      db.collection('files').deleteMany({ repoId: normalized, commitSha }),
      db.collection('graph_nodes').deleteMany({ repoId: normalized, commitSha }),
      db.collection('graph_edges').deleteMany({ repoId: normalized, commitSha }),
      db.collection('symbols').deleteMany({ repoId: normalized, commitSha }),
      db.collection('verifier_results').deleteMany({ repoId: normalized, commitSha }),
    ]);
  }

  public async pruneOldRepositories(maxRepositories: number): Promise<number> {
    if (maxRepositories <= 0) return 0;
    const db = await this.getDb();
    const count = await db.collection('repositories').countDocuments({});
    if (count <= maxRepositories) return 0;

    const excess = count - maxRepositories;
    const oldestDocs = await db
      .collection('repositories')
      .find({})
      .sort({ lastAccessedAt: 1 })
      .limit(excess)
      .toArray();

    for (const d of oldestDocs) {
      await this.deleteRepository(d.repoId, d.commitSha);
    }

    return oldestDocs.length;
  }

  // Jobs
  public async saveJob(job: StoredJobRecord): Promise<void> {
    const db = await this.getDb();
    await db.collection('jobs').updateOne(
      { _id: job.jobId as any },
      {
        $set: {
          _id: job.jobId,
          jobId: job.jobId,
          repoId: job.repoId.toLowerCase(),
          url: job.url,
          status: job.status,
          progress: job.progress,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      },
      { upsert: true }
    );
  }

  public async getJob(jobId: string): Promise<StoredJobRecord | null> {
    const db = await this.getDb();
    const doc: any = await db.collection('jobs').findOne({ _id: jobId as any });
    if (!doc) return null;

    return {
      jobId: doc.jobId,
      repoId: doc.repoId,
      url: doc.url,
      status: doc.status,
      progress: doc.progress,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  public async updateJob(jobId: string, updates: Partial<StoredJobRecord>): Promise<void> {
    const db = await this.getDb();
    await db.collection('jobs').updateOne(
      { _id: jobId as any },
      {
        $set: {
          ...updates,
          updatedAt: updates.updatedAt || new Date().toISOString(),
        },
      }
    );
  }

  // Future schema tables
  public async saveGraphNodes(nodes: GraphNodeRecord[]): Promise<void> {
    const db = await this.getDb();
    for (const n of nodes) {
      const key = `${this.makeRepoKey(n.repoId, n.commitSha)}@${n.id}`;
      await db.collection('graph_nodes').updateOne(
        { _id: key as any },
        { $set: { ...n, _id: key, repoId: n.repoId.toLowerCase() } },
        { upsert: true }
      );
    }
  }

  public async getGraphNodes(repoId: string, commitSha: string): Promise<GraphNodeRecord[]> {
    const db = await this.getDb();
    const docs = await db.collection('graph_nodes').find({ repoId: repoId.toLowerCase(), commitSha }).toArray();
    return docs.map((d: any) => ({
      id: d.id,
      repoId: d.repoId,
      commitSha: d.commitSha,
      label: d.label,
      kind: d.kind,
      filePath: d.filePath,
      metadata: d.metadata,
    }));
  }

  public async saveGraphEdges(edges: GraphEdgeRecord[]): Promise<void> {
    const db = await this.getDb();
    for (const e of edges) {
      const key = `${this.makeRepoKey(e.repoId, e.commitSha)}@${e.id}`;
      await db.collection('graph_edges').updateOne(
        { _id: key as any },
        { $set: { ...e, _id: key, repoId: e.repoId.toLowerCase() } },
        { upsert: true }
      );
    }
  }

  public async getGraphEdges(repoId: string, commitSha: string): Promise<GraphEdgeRecord[]> {
    const db = await this.getDb();
    const docs = await db.collection('graph_edges').find({ repoId: repoId.toLowerCase(), commitSha }).toArray();
    return docs.map((d: any) => ({
      id: d.id,
      repoId: d.repoId,
      commitSha: d.commitSha,
      sourceId: d.sourceId,
      targetId: d.targetId,
      kind: d.kind,
      confidence: d.confidence,
      evidence: d.evidence,
    }));
  }

  public async saveSymbols(symbols: SymbolRecord[]): Promise<void> {
    const db = await this.getDb();
    for (const s of symbols) {
      const key = `${this.makeRepoKey(s.repoId, s.commitSha)}@${s.id}`;
      await db.collection('symbols').updateOne(
        { _id: key as any },
        { $set: { ...s, _id: key, repoId: s.repoId.toLowerCase() } },
        { upsert: true }
      );
    }
  }

  public async getSymbols(repoId: string, commitSha: string, filePath?: string): Promise<SymbolRecord[]> {
    const db = await this.getDb();
    const query: any = { repoId: repoId.toLowerCase(), commitSha };
    if (filePath) query.filePath = filePath;
    const docs = await db.collection('symbols').find(query).toArray();
    return docs.map((d: any) => ({
      id: d.id,
      repoId: d.repoId,
      commitSha: d.commitSha,
      filePath: d.filePath,
      name: d.name,
      kind: d.kind,
      startLine: d.startLine,
      endLine: d.endLine,
      metadata: d.metadata,
    }));
  }

  public async saveExplanation(explanation: ExplanationRecord): Promise<void> {
    const db = await this.getDb();
    const key = `${explanation.fileSha256}@${explanation.promptVersion}`;
    await db.collection('explanations').updateOne(
      { _id: key as any },
      { $set: { ...explanation, _id: key } },
      { upsert: true }
    );
  }

  public async getExplanation(fileSha256: string, promptVersion: string): Promise<ExplanationRecord | null> {
    const db = await this.getDb();
    const key = `${fileSha256}@${promptVersion}`;
    const doc: any = await db.collection('explanations').findOne({ _id: key as any });
    if (!doc) return null;
    return {
      fileSha256: doc.fileSha256,
      promptVersion: doc.promptVersion,
      explanation: doc.explanation,
      createdAt: doc.createdAt,
    };
  }

  public async saveVerifierResult(result: VerifierResultRecord): Promise<void> {
    const db = await this.getDb();
    const key = `${this.makeRepoKey(result.repoId, result.commitSha)}@${result.id}`;
    await db.collection('verifier_results').updateOne(
      { _id: key as any },
      { $set: { ...result, _id: key, repoId: result.repoId.toLowerCase() } },
      { upsert: true }
    );
  }

  public async getVerifierResults(repoId: string, commitSha: string): Promise<VerifierResultRecord[]> {
    const db = await this.getDb();
    const docs = await db
      .collection('verifier_results')
      .find({ repoId: repoId.toLowerCase(), commitSha })
      .toArray();

    return docs.map((d: any) => ({
      id: d.id,
      repoId: d.repoId,
      commitSha: d.commitSha,
      checkName: d.checkName,
      status: d.status,
      evidence: d.evidence,
      createdAt: d.createdAt,
    }));
  }

  // ==========================================
  // User Accounts
  // ==========================================

  public async saveUser(user: StoredUserRecord): Promise<void> {
    const db = await this.getDb();
    await db.collection('users').updateOne(
      { _id: user.id as any },
      { $set: { ...user, _id: user.id } },
      { upsert: true }
    );
  }

  public async getUserById(id: string): Promise<StoredUserRecord | null> {
    const db = await this.getDb();
    const doc: any = await db.collection('users').findOne({ _id: id as any });
    if (!doc) return null;
    return {
      id: doc._id || doc.id,
      username: doc.username,
      email: doc.email,
      passwordHash: doc.passwordHash,
      createdAt: doc.createdAt,
      lastLoginAt: doc.lastLoginAt,
    };
  }

  public async getUserByUsernameOrEmail(identifier: string): Promise<StoredUserRecord | null> {
    const db = await this.getDb();
    const clean = identifier.trim().toLowerCase();
    const doc: any = await db.collection('users').findOne({
      $or: [
        { username: { $regex: new RegExp(`^${clean}$`, 'i') } },
        { email: clean },
      ],
    });
    if (!doc) return null;
    return {
      id: doc._id || doc.id,
      username: doc.username,
      email: doc.email,
      passwordHash: doc.passwordHash,
      createdAt: doc.createdAt,
      lastLoginAt: doc.lastLoginAt,
    };
  }

  // ==========================================
  // QA Chat History
  // ==========================================

  public async saveQAHistory(record: StoredQARecord): Promise<void> {
    const db = await this.getDb();
    await db.collection('qa_history').updateOne(
      { _id: record.id as any },
      { $set: { ...record, _id: record.id, repoId: record.repoId.toLowerCase() } },
      { upsert: true }
    );
  }

  public async getQAHistory(
    repoId: string,
    filter?: { userId?: string; sessionId?: string }
  ): Promise<StoredQARecord[]> {
    const db = await this.getDb();
    const query: any = { repoId: repoId.toLowerCase() };

    if (filter?.userId) {
      // If logged in, return records belonging to this user or their anonymous session
      if (filter.sessionId) {
        query.$or = [{ userId: filter.userId }, { sessionId: filter.sessionId }];
      } else {
        query.userId = filter.userId;
      }
    } else if (filter?.sessionId) {
      query.sessionId = filter.sessionId;
    }

    const docs = await db
      .collection('qa_history')
      .find(query)
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    return docs.map((d: any) => ({
      id: d._id || d.id,
      repoId: d.repoId,
      commitSha: d.commitSha,
      userId: d.userId,
      sessionId: d.sessionId,
      question: d.question,
      answer: d.answer,
      citations: d.citations,
      modelUsed: d.modelUsed,
      createdAt: d.createdAt,
    }));
  }

  // ==========================================
  // User Analyzed Repositories
  // ==========================================

  public async trackUserRepo(record: StoredUserRepoRecord): Promise<void> {
    const db = await this.getDb();
    const key = record.id || `${record.userId || record.sessionId}@${record.repoId.toLowerCase()}`;
    await db.collection('user_repositories').updateOne(
      { _id: key as any },
      {
        $set: {
          _id: key,
          userId: record.userId,
          sessionId: record.sessionId,
          repoId: record.repoId.toLowerCase(),
          name: record.name,
          stars: record.stars,
          lastAccessedAt: record.lastAccessedAt,
        },
      },
      { upsert: true }
    );
  }

  public async getUserRepos(filter: { userId?: string; sessionId?: string }): Promise<StoredUserRepoRecord[]> {
    const db = await this.getDb();
    const query: any = {};
    if (filter.userId && filter.sessionId) {
      query.$or = [{ userId: filter.userId }, { sessionId: filter.sessionId }];
    } else if (filter.userId) {
      query.userId = filter.userId;
    } else if (filter.sessionId) {
      query.sessionId = filter.sessionId;
    } else {
      return [];
    }

    const docs = await db
      .collection('user_repositories')
      .find(query)
      .sort({ lastAccessedAt: -1 })
      .limit(20)
      .toArray();

    return docs.map((d: any) => ({
      id: d._id || d.id,
      userId: d.userId,
      sessionId: d.sessionId,
      repoId: d.repoId,
      name: d.name,
      stars: d.stars,
      lastAccessedAt: d.lastAccessedAt,
    }));
  }

  public async close(): Promise<void> {
    await this.client.close();
    this.dbInstance = null;
    this.connectingPromise = null;
  }
}
