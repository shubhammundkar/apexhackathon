import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// Built-in node:sqlite in Node.js >= 22
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeSqlite: any = typeof require !== 'undefined' ? require('node:sqlite') : null;
const NodeDatabaseSync = nodeSqlite ? nodeSqlite.DatabaseSync : null;

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

interface Migration {
  version: number;
  up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      // 1. Repositories table
      db.exec(`
        CREATE TABLE IF NOT EXISTS repositories (
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          metadata TEXT NOT NULL,
          analysis TEXT,
          file_tree TEXT NOT NULL,
          file_analysis_map TEXT NOT NULL,
          ingested_at TEXT NOT NULL,
          last_accessed_at TEXT NOT NULL,
          PRIMARY KEY (repo_id, commit_sha)
        );
      `);

      // 2. Files table
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          path TEXT NOT NULL,
          language TEXT NOT NULL,
          size INTEGER NOT NULL,
          line_count INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          content TEXT NOT NULL,
          PRIMARY KEY (repo_id, commit_sha, path),
          FOREIGN KEY (repo_id, commit_sha) REFERENCES repositories(repo_id, commit_sha) ON DELETE CASCADE
        );
      `);

      // 3. Jobs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT NOT NULL,
          progress TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 4. Graph Nodes table
      db.exec(`
        CREATE TABLE IF NOT EXISTS graph_nodes (
          id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL,
          file_path TEXT,
          metadata TEXT,
          PRIMARY KEY (repo_id, commit_sha, id),
          FOREIGN KEY (repo_id, commit_sha) REFERENCES repositories(repo_id, commit_sha) ON DELETE CASCADE
        );
      `);

      // 5. Graph Edges table
      db.exec(`
        CREATE TABLE IF NOT EXISTS graph_edges (
          id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          confidence TEXT,
          evidence TEXT,
          PRIMARY KEY (repo_id, commit_sha, id),
          FOREIGN KEY (repo_id, commit_sha) REFERENCES repositories(repo_id, commit_sha) ON DELETE CASCADE
        );
      `);

      // 6. Symbols table
      db.exec(`
        CREATE TABLE IF NOT EXISTS symbols (
          id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          file_path TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          start_line INTEGER,
          end_line INTEGER,
          metadata TEXT,
          PRIMARY KEY (repo_id, commit_sha, id),
          FOREIGN KEY (repo_id, commit_sha) REFERENCES repositories(repo_id, commit_sha) ON DELETE CASCADE
        );
      `);

      // 7. Explanations table
      db.exec(`
        CREATE TABLE IF NOT EXISTS explanations (
          file_sha256 TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          explanation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (file_sha256, prompt_version)
        );
      `);

      // 8. Verifier Results table
      db.exec(`
        CREATE TABLE IF NOT EXISTS verifier_results (
          id TEXT NOT NULL,
          repo_id TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          check_name TEXT NOT NULL,
          status TEXT NOT NULL,
          evidence TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (repo_id, commit_sha, id),
          FOREIGN KEY (repo_id, commit_sha) REFERENCES repositories(repo_id, commit_sha) ON DELETE CASCADE
        );
      `);

      // Indexes for fast querying
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_repos_repo_id ON repositories(repo_id);
        CREATE INDEX IF NOT EXISTS idx_repos_last_accessed ON repositories(last_accessed_at);
        CREATE INDEX IF NOT EXISTS idx_files_repo_sha ON files(repo_id, commit_sha);
        CREATE INDEX IF NOT EXISTS idx_symbols_repo_sha ON symbols(repo_id, commit_sha);
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_repo_sha ON graph_nodes(repo_id, commit_sha);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_repo_sha ON graph_edges(repo_id, commit_sha);
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );
        CREATE TABLE IF NOT EXISTS qa_history (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          commit_sha TEXT,
          user_id TEXT,
          session_id TEXT,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          citations TEXT,
          model_used TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_repositories (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          session_id TEXT,
          repo_id TEXT NOT NULL,
          name TEXT NOT NULL,
          stars INTEGER NOT NULL,
          last_accessed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qa_repo_created ON qa_history(repo_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_qa_user ON qa_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_history(session_id);
        CREATE INDEX IF NOT EXISTS idx_user_repos_user ON user_repositories(user_id, last_accessed_at);
        CREATE INDEX IF NOT EXISTS idx_user_repos_session ON user_repositories(session_id, last_accessed_at);
      `);
    },
  },
];

export class SqliteRepositoryStore implements RepositoryStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new NodeDatabaseSync(dbPath) as DatabaseSync;

    // Performance and safety pragmas
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }

    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const currentVersionRow = this.db
      .prepare('SELECT MAX(version) as max_version FROM schema_version')
      .get() as { max_version: number | null } | undefined;

    const currentVersion = currentVersionRow?.max_version || 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        migration.up(this.db);
        this.db
          .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      }
    }
  }

  public saveRepository(repo: StoredRepositoryRecord, files: StoredFileRecord[]): void {
    const insertRepo = this.db.prepare(`
      INSERT OR REPLACE INTO repositories (
        repo_id, commit_sha, metadata, analysis, file_tree, file_analysis_map, ingested_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRepo.run(
      repo.repoId,
      repo.commitSha,
      JSON.stringify(repo.metadata),
      repo.analysis ? JSON.stringify(repo.analysis) : null,
      JSON.stringify(repo.fileTree),
      JSON.stringify(repo.fileAnalysisMap),
      repo.ingestedAt,
      repo.lastAccessedAt
    );

    // Save files
    this.db
      .prepare('DELETE FROM files WHERE repo_id = ? AND commit_sha = ?')
      .run(repo.repoId, repo.commitSha);

    const insertFile = this.db.prepare(`
      INSERT INTO files (repo_id, commit_sha, path, language, size, line_count, sha256, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const f of files) {
      insertFile.run(
        repo.repoId,
        repo.commitSha,
        f.path,
        f.language,
        f.size,
        f.lineCount,
        f.sha256,
        f.content
      );
    }
  }

  public getRepository(repoId: string, commitSha?: string): StoredRepositoryRecord | null {
    const normalizedRepoId = repoId.toLowerCase();
    let row: any;

    if (commitSha) {
      row = this.db
        .prepare('SELECT * FROM repositories WHERE repo_id = ? AND commit_sha = ?')
        .get(normalizedRepoId, commitSha);
    } else {
      row = this.db
        .prepare('SELECT * FROM repositories WHERE repo_id = ? ORDER BY last_accessed_at DESC LIMIT 1')
        .get(normalizedRepoId);
    }

    if (!row) return null;

    this.touchRepository(row.repo_id, row.commit_sha);

    return {
      repoId: row.repo_id,
      commitSha: row.commit_sha,
      metadata: JSON.parse(row.metadata),
      analysis: row.analysis ? JSON.parse(row.analysis) : undefined,
      fileTree: JSON.parse(row.file_tree),
      fileAnalysisMap: JSON.parse(row.file_analysis_map),
      ingestedAt: row.ingested_at,
      lastAccessedAt: row.last_accessed_at,
    };
  }

  public touchRepository(repoId: string, commitSha: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE repositories SET last_accessed_at = ? WHERE repo_id = ? AND commit_sha = ?')
      .run(now, repoId.toLowerCase(), commitSha);
  }

  public getFiles(repoId: string, commitSha: string): StoredFileRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM files WHERE repo_id = ? AND commit_sha = ?')
      .all(repoId.toLowerCase(), commitSha) as any[];

    return rows.map((r) => ({
      repoId: r.repo_id,
      commitSha: r.commit_sha,
      path: r.path,
      language: r.language,
      size: Number(r.size),
      lineCount: Number(r.line_count),
      sha256: r.sha256,
      content: r.content,
    }));
  }

  public getFile(repoId: string, commitSha: string, path: string): StoredFileRecord | null {
    const row: any = this.db
      .prepare('SELECT * FROM files WHERE repo_id = ? AND commit_sha = ? AND path = ?')
      .get(repoId.toLowerCase(), commitSha, path);

    if (!row) return null;

    return {
      repoId: row.repo_id,
      commitSha: row.commit_sha,
      path: row.path,
      language: row.language,
      size: Number(row.size),
      lineCount: Number(row.line_count),
      sha256: row.sha256,
      content: row.content,
    };
  }

  public listRepositories(): Array<{ id: string; commitSha: string; name: string; stars: number; ingestedAt: string; lastAccessedAt: string }> {
    const rows = this.db
      .prepare('SELECT repo_id, commit_sha, metadata, ingested_at, last_accessed_at FROM repositories ORDER BY last_accessed_at DESC')
      .all() as any[];

    return rows.map((r) => {
      const meta = JSON.parse(r.metadata);
      return {
        id: r.repo_id,
        commitSha: r.commit_sha,
        name: meta.fullName || meta.name || r.repo_id,
        stars: meta.stars || 0,
        ingestedAt: r.ingested_at,
        lastAccessedAt: r.last_accessed_at,
      };
    });
  }

  public deleteRepository(repoId: string, commitSha: string): void {
    this.db
      .prepare('DELETE FROM files WHERE repo_id = ? AND commit_sha = ?')
      .run(repoId.toLowerCase(), commitSha);
    this.db
      .prepare('DELETE FROM repositories WHERE repo_id = ? AND commit_sha = ?')
      .run(repoId.toLowerCase(), commitSha);
  }

  public pruneOldRepositories(maxRepositories: number): number {
    if (maxRepositories <= 0) return 0;

    const countRow: any = this.db
      .prepare('SELECT COUNT(*) as count FROM repositories')
      .get();
    const count = Number(countRow?.count || 0);

    if (count <= maxRepositories) return 0;

    const excess = count - maxRepositories;
    const oldestRows = this.db
      .prepare('SELECT repo_id, commit_sha FROM repositories ORDER BY last_accessed_at ASC LIMIT ?')
      .all(excess) as any[];

    for (const r of oldestRows) {
      this.deleteRepository(r.repo_id, r.commit_sha);
    }

    return oldestRows.length;
  }

  // Jobs
  public saveJob(job: StoredJobRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO jobs (job_id, repo_id, url, status, progress, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        job.jobId,
        job.repoId,
        job.url,
        job.status,
        JSON.stringify(job.progress),
        job.createdAt,
        job.updatedAt
      );
  }

  public getJob(jobId: string): StoredJobRecord | null {
    const row: any = this.db
      .prepare('SELECT * FROM jobs WHERE job_id = ?')
      .get(jobId);

    if (!row) return null;

    return {
      jobId: row.job_id,
      repoId: row.repo_id,
      url: row.url,
      status: row.status,
      progress: JSON.parse(row.progress),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public updateJob(jobId: string, updates: Partial<StoredJobRecord>): void {
    const current = this.getJob(jobId);
    if (!current) return;

    const updated: StoredJobRecord = {
      ...current,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    };

    this.saveJob(updated);
  }

  // Future schema tables
  public saveGraphNodes(nodes: GraphNodeRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO graph_nodes (id, repo_id, commit_sha, label, kind, file_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of nodes) {
      stmt.run(
        node.id,
        node.repoId.toLowerCase(),
        node.commitSha,
        node.label,
        node.kind,
        node.filePath || null,
        node.metadata ? JSON.stringify(node.metadata) : null
      );
    }
  }

  public getGraphNodes(repoId: string, commitSha: string): GraphNodeRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM graph_nodes WHERE repo_id = ? AND commit_sha = ?')
      .all(repoId.toLowerCase(), commitSha) as any[];

    return rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      commitSha: r.commit_sha,
      label: r.label,
      kind: r.kind,
      filePath: r.file_path || undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  public saveGraphEdges(edges: GraphEdgeRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO graph_edges (id, repo_id, commit_sha, source_id, target_id, kind, confidence, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of edges) {
      stmt.run(
        edge.id,
        edge.repoId.toLowerCase(),
        edge.commitSha,
        edge.sourceId,
        edge.targetId,
        edge.kind,
        edge.confidence || null,
        edge.evidence ? JSON.stringify(edge.evidence) : null
      );
    }
  }

  public getGraphEdges(repoId: string, commitSha: string): GraphEdgeRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM graph_edges WHERE repo_id = ? AND commit_sha = ?')
      .all(repoId.toLowerCase(), commitSha) as any[];

    return rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      commitSha: r.commit_sha,
      sourceId: r.source_id,
      targetId: r.target_id,
      kind: r.kind,
      confidence: r.confidence || undefined,
      evidence: r.evidence ? JSON.parse(r.evidence) : undefined,
    }));
  }

  public saveSymbols(symbols: SymbolRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (id, repo_id, commit_sha, file_path, name, kind, start_line, end_line, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const sym of symbols) {
      stmt.run(
        sym.id,
        sym.repoId.toLowerCase(),
        sym.commitSha,
        sym.filePath,
        sym.name,
        sym.kind,
        sym.startLine || null,
        sym.endLine || null,
        sym.metadata ? JSON.stringify(sym.metadata) : null
      );
    }
  }

  public getSymbols(repoId: string, commitSha: string, filePath?: string): SymbolRecord[] {
    let rows: any[];
    if (filePath) {
      rows = this.db
        .prepare('SELECT * FROM symbols WHERE repo_id = ? AND commit_sha = ? AND file_path = ?')
        .all(repoId.toLowerCase(), commitSha, filePath) as any[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM symbols WHERE repo_id = ? AND commit_sha = ?')
        .all(repoId.toLowerCase(), commitSha) as any[];
    }

    return rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      commitSha: r.commit_sha,
      filePath: r.file_path,
      name: r.name,
      kind: r.kind,
      startLine: r.start_line != null ? Number(r.start_line) : undefined,
      endLine: r.end_line != null ? Number(r.end_line) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  public saveExplanation(explanation: ExplanationRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO explanations (file_sha256, prompt_version, explanation, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        explanation.fileSha256,
        explanation.promptVersion,
        explanation.explanation,
        explanation.createdAt
      );
  }

  public getExplanation(fileSha256: string, promptVersion: string): ExplanationRecord | null {
    const row: any = this.db
      .prepare('SELECT * FROM explanations WHERE file_sha256 = ? AND prompt_version = ?')
      .get(fileSha256, promptVersion);

    if (!row) return null;

    return {
      fileSha256: row.file_sha256,
      promptVersion: row.prompt_version,
      explanation: row.explanation,
      createdAt: row.created_at,
    };
  }

  public saveVerifierResult(result: VerifierResultRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO verifier_results (id, repo_id, commit_sha, check_name, status, evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        result.id,
        result.repoId.toLowerCase(),
        result.commitSha,
        result.checkName,
        result.status,
        result.evidence ? JSON.stringify(result.evidence) : null,
        result.createdAt
      );
  }

  public getVerifierResults(repoId: string, commitSha: string): VerifierResultRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM verifier_results WHERE repo_id = ? AND commit_sha = ?')
      .all(repoId.toLowerCase(), commitSha) as any[];

    return rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      commitSha: r.commit_sha,
      checkName: r.check_name,
      status: r.status,
      evidence: r.evidence ? JSON.parse(r.evidence) : undefined,
      createdAt: r.created_at,
    }));
  }

  // ==========================================
  // User Accounts
  // ==========================================

  public saveUser(user: StoredUserRecord): void {
    this.db
      .prepare(`
        INSERT INTO users (id, username, email, password_hash, created_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          email = excluded.email,
          password_hash = excluded.password_hash,
          last_login_at = excluded.last_login_at
      `)
      .run(
        user.id,
        user.username,
        user.email,
        user.passwordHash,
        user.createdAt,
        user.lastLoginAt || null
      );
  }

  public getUserById(id: string): StoredUserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || undefined,
    };
  }

  public getUserByUsernameOrEmail(identifier: string): StoredUserRecord | null {
    const clean = identifier.trim().toLowerCase();
    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?')
      .get(clean, clean) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || undefined,
    };
  }

  // ==========================================
  // QA Chat History
  // ==========================================

  public saveQAHistory(record: StoredQARecord): void {
    this.db
      .prepare(`
        INSERT INTO qa_history (id, repo_id, commit_sha, user_id, session_id, question, answer, citations, model_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          answer = excluded.answer,
          citations = excluded.citations
      `)
      .run(
        record.id,
        record.repoId.toLowerCase(),
        record.commitSha || null,
        record.userId || null,
        record.sessionId || null,
        record.question,
        record.answer,
        record.citations ? JSON.stringify(record.citations) : null,
        record.modelUsed || null,
        record.createdAt
      );
  }

  public getQAHistory(
    repoId: string,
    filter?: { userId?: string; sessionId?: string }
  ): StoredQARecord[] {
    let query = 'SELECT * FROM qa_history WHERE repo_id = ?';
    const params: any[] = [repoId.toLowerCase()];

    if (filter?.userId) {
      if (filter.sessionId) {
        query += ' AND (user_id = ? OR session_id = ?)';
        params.push(filter.userId, filter.sessionId);
      } else {
        query += ' AND user_id = ?';
        params.push(filter.userId);
      }
    } else if (filter?.sessionId) {
      query += ' AND session_id = ?';
      params.push(filter.sessionId);
    }

    query += ' ORDER BY created_at ASC LIMIT 100';
    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      repoId: r.repo_id,
      commitSha: r.commit_sha || undefined,
      userId: r.user_id || undefined,
      sessionId: r.session_id || undefined,
      question: r.question,
      answer: r.answer,
      citations: r.citations ? JSON.parse(r.citations) : undefined,
      modelUsed: r.model_used || undefined,
      createdAt: r.created_at,
    }));
  }

  // ==========================================
  // User Analyzed Repositories
  // ==========================================

  public trackUserRepo(record: StoredUserRepoRecord): void {
    const key = record.id || `${record.userId || record.sessionId}@${record.repoId.toLowerCase()}`;
    this.db
      .prepare(`
        INSERT INTO user_repositories (id, user_id, session_id, repo_id, name, stars, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stars = excluded.stars,
          last_accessed_at = excluded.last_accessed_at
      `)
      .run(
        key,
        record.userId || null,
        record.sessionId || null,
        record.repoId.toLowerCase(),
        record.name,
        record.stars,
        record.lastAccessedAt
      );
  }

  public getUserRepos(filter: { userId?: string; sessionId?: string }): StoredUserRepoRecord[] {
    let query = 'SELECT * FROM user_repositories WHERE ';
    const params: any[] = [];

    if (filter.userId && filter.sessionId) {
      query += '(user_id = ? OR session_id = ?)';
      params.push(filter.userId, filter.sessionId);
    } else if (filter.userId) {
      query += 'user_id = ?';
      params.push(filter.userId);
    } else if (filter.sessionId) {
      query += 'session_id = ?';
      params.push(filter.sessionId);
    } else {
      return [];
    }

    query += ' ORDER BY last_accessed_at DESC LIMIT 20';
    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id || undefined,
      sessionId: r.session_id || undefined,
      repoId: r.repo_id,
      name: r.name,
      stars: r.stars,
      lastAccessedAt: r.last_accessed_at,
    }));
  }

  public close(): void {
    this.db.close();
  }
}
