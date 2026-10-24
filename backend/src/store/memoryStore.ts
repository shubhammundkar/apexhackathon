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

export class InMemoryRepositoryStore implements RepositoryStore {
  private repositories: Map<string, StoredRepositoryRecord> = new Map();
  private files: Map<string, StoredFileRecord> = new Map();
  private jobs: Map<string, StoredJobRecord> = new Map();
  private users: Map<string, StoredUserRecord> = new Map();
  private qaHistory: StoredQARecord[] = [];
  private userRepos: Map<string, StoredUserRepoRecord> = new Map();
  private graphNodes: Map<string, GraphNodeRecord> = new Map();
  private graphEdges: Map<string, GraphEdgeRecord> = new Map();
  private symbols: Map<string, SymbolRecord> = new Map();
  private explanations: Map<string, ExplanationRecord> = new Map();
  private verifierResults: Map<string, VerifierResultRecord> = new Map();

  private makeRepoKey(repoId: string, commitSha: string): string {
    return `${repoId.toLowerCase()}@${commitSha}`;
  }

  public saveRepository(repo: StoredRepositoryRecord, files: StoredFileRecord[]): void {
    const key = this.makeRepoKey(repo.repoId, repo.commitSha);
    this.repositories.set(key, { ...repo, repoId: repo.repoId.toLowerCase() });

    const prefix = `${key}@`;
    for (const fKey of Array.from(this.files.keys())) {
      if (fKey.startsWith(prefix)) {
        this.files.delete(fKey);
      }
    }

    for (const f of files) {
      this.files.set(`${prefix}${f.path}`, { ...f, repoId: repo.repoId.toLowerCase() });
    }
  }

  public getRepository(repoId: string, commitSha?: string): StoredRepositoryRecord | null {
    const normalizedRepoId = repoId.toLowerCase();

    if (commitSha) {
      const key = this.makeRepoKey(normalizedRepoId, commitSha);
      const repo = this.repositories.get(key);
      if (repo) {
        this.touchRepository(normalizedRepoId, commitSha);
        return { ...repo };
      }
      return null;
    }

    let latest: StoredRepositoryRecord | null = null;
    for (const r of this.repositories.values()) {
      if (r.repoId.toLowerCase() === normalizedRepoId) {
        if (!latest || new Date(r.lastAccessedAt).getTime() > new Date(latest.lastAccessedAt).getTime()) {
          latest = r;
        }
      }
    }

    if (latest) {
      this.touchRepository(latest.repoId, latest.commitSha);
      return { ...latest };
    }

    return null;
  }

  public touchRepository(repoId: string, commitSha: string): void {
    const key = this.makeRepoKey(repoId, commitSha);
    const existing = this.repositories.get(key);
    if (existing) {
      existing.lastAccessedAt = new Date().toISOString();
    }
  }

  public getFiles(repoId: string, commitSha: string): StoredFileRecord[] {
    const prefix = `${this.makeRepoKey(repoId, commitSha)}@`;
    const result: StoredFileRecord[] = [];
    for (const [key, val] of this.files.entries()) {
      if (key.startsWith(prefix)) {
        result.push({ ...val });
      }
    }
    return result;
  }

  public getFile(repoId: string, commitSha: string, path: string): StoredFileRecord | null {
    const key = `${this.makeRepoKey(repoId, commitSha)}@${path}`;
    const file = this.files.get(key);
    return file ? { ...file } : null;
  }

  public listRepositories(): Array<{ id: string; commitSha: string; name: string; stars: number; ingestedAt: string; lastAccessedAt: string }> {
    return Array.from(this.repositories.values())
      .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
      .map((r) => ({
        id: r.repoId,
        commitSha: r.commitSha,
        name: r.metadata.fullName || r.metadata.name || r.repoId,
        stars: r.metadata.stars || 0,
        ingestedAt: r.ingestedAt,
        lastAccessedAt: r.lastAccessedAt,
      }));
  }

  public deleteRepository(repoId: string, commitSha: string): void {
    const key = this.makeRepoKey(repoId, commitSha);
    this.repositories.delete(key);

    const prefix = `${key}@`;
    for (const fKey of Array.from(this.files.keys())) {
      if (fKey.startsWith(prefix)) this.files.delete(fKey);
    }
    for (const nKey of Array.from(this.graphNodes.keys())) {
      if (nKey.startsWith(prefix)) this.graphNodes.delete(nKey);
    }
    for (const eKey of Array.from(this.graphEdges.keys())) {
      if (eKey.startsWith(prefix)) this.graphEdges.delete(eKey);
    }
    for (const sKey of Array.from(this.symbols.keys())) {
      if (sKey.startsWith(prefix)) this.symbols.delete(sKey);
    }
    for (const vKey of Array.from(this.verifierResults.keys())) {
      if (vKey.startsWith(prefix)) this.verifierResults.delete(vKey);
    }
  }

  public pruneOldRepositories(maxRepositories: number): number {
    if (maxRepositories <= 0) return 0;
    if (this.repositories.size <= maxRepositories) return 0;

    const excess = this.repositories.size - maxRepositories;
    const sorted = Array.from(this.repositories.values()).sort(
      (a, b) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime()
    );

    const toDelete = sorted.slice(0, excess);
    for (const item of toDelete) {
      this.deleteRepository(item.repoId, item.commitSha);
    }
    return toDelete.length;
  }

  // Jobs
  public saveJob(job: StoredJobRecord): void {
    this.jobs.set(job.jobId, { ...job });
  }

  public getJob(jobId: string): StoredJobRecord | null {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : null;
  }

  public updateJob(jobId: string, updates: Partial<StoredJobRecord>): void {
    const current = this.jobs.get(jobId);
    if (!current) return;
    this.jobs.set(jobId, {
      ...current,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    });
  }

  // Future schema tables
  public saveGraphNodes(nodes: GraphNodeRecord[]): void {
    for (const n of nodes) {
      const key = `${this.makeRepoKey(n.repoId, n.commitSha)}@${n.id}`;
      this.graphNodes.set(key, { ...n });
    }
  }

  public getGraphNodes(repoId: string, commitSha: string): GraphNodeRecord[] {
    const prefix = `${this.makeRepoKey(repoId, commitSha)}@`;
    const result: GraphNodeRecord[] = [];
    for (const [key, val] of this.graphNodes.entries()) {
      if (key.startsWith(prefix)) result.push({ ...val });
    }
    return result;
  }

  public saveGraphEdges(edges: GraphEdgeRecord[]): void {
    for (const e of edges) {
      const key = `${this.makeRepoKey(e.repoId, e.commitSha)}@${e.id}`;
      this.graphEdges.set(key, { ...e });
    }
  }

  public getGraphEdges(repoId: string, commitSha: string): GraphEdgeRecord[] {
    const prefix = `${this.makeRepoKey(repoId, commitSha)}@`;
    const result: GraphEdgeRecord[] = [];
    for (const [key, val] of this.graphEdges.entries()) {
      if (key.startsWith(prefix)) result.push({ ...val });
    }
    return result;
  }

  public saveSymbols(symbols: SymbolRecord[]): void {
    for (const s of symbols) {
      const key = `${this.makeRepoKey(s.repoId, s.commitSha)}@${s.id}`;
      this.symbols.set(key, { ...s });
    }
  }

  public getSymbols(repoId: string, commitSha: string, filePath?: string): SymbolRecord[] {
    const prefix = `${this.makeRepoKey(repoId, commitSha)}@`;
    const result: SymbolRecord[] = [];
    for (const [key, val] of this.symbols.entries()) {
      if (key.startsWith(prefix)) {
        if (!filePath || val.filePath === filePath) {
          result.push({ ...val });
        }
      }
    }
    return result;
  }

  public saveExplanation(explanation: ExplanationRecord): void {
    const key = `${explanation.fileSha256}@${explanation.promptVersion}`;
    this.explanations.set(key, { ...explanation });
  }

  public getExplanation(fileSha256: string, promptVersion: string): ExplanationRecord | null {
    const key = `${fileSha256}@${promptVersion}`;
    const e = this.explanations.get(key);
    return e ? { ...e } : null;
  }

  public saveVerifierResult(result: VerifierResultRecord): void {
    const key = `${this.makeRepoKey(result.repoId, result.commitSha)}@${result.id}`;
    this.verifierResults.set(key, { ...result });
  }

  public getVerifierResults(repoId: string, commitSha: string): VerifierResultRecord[] {
    const prefix = `${this.makeRepoKey(repoId, commitSha)}@`;
    const result: VerifierResultRecord[] = [];
    for (const [key, val] of this.verifierResults.entries()) {
      if (key.startsWith(prefix)) result.push({ ...val });
    }
    return result;
  }

  // ==========================================
  // User Accounts
  // ==========================================

  public saveUser(user: StoredUserRecord): void {
    this.users.set(user.id, { ...user });
  }

  public getUserById(id: string): StoredUserRecord | null {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  public getUserByUsernameOrEmail(identifier: string): StoredUserRecord | null {
    const clean = identifier.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === clean || u.email.toLowerCase() === clean) {
        return { ...u };
      }
    }
    return null;
  }

  // ==========================================
  // QA Chat History
  // ==========================================

  public saveQAHistory(record: StoredQARecord): void {
    const normalized: StoredQARecord = {
      ...record,
      repoId: record.repoId.toLowerCase(),
    };
    this.qaHistory.push(normalized);
  }

  public getQAHistory(
    repoId: string,
    filter?: { userId?: string; sessionId?: string }
  ): StoredQARecord[] {
    const normalizedRepoId = repoId.toLowerCase();
    return this.qaHistory
      .filter((q) => {
        if (q.repoId !== normalizedRepoId) return false;
        if (filter?.userId) {
          if (filter.sessionId) {
            return q.userId === filter.userId || q.sessionId === filter.sessionId;
          }
          return q.userId === filter.userId;
        }
        if (filter?.sessionId) {
          return q.sessionId === filter.sessionId;
        }
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ==========================================
  // User Analyzed Repositories
  // ==========================================

  public trackUserRepo(record: StoredUserRepoRecord): void {
    const key = record.id || `${record.userId || record.sessionId}@${record.repoId.toLowerCase()}`;
    this.userRepos.set(key, { ...record, repoId: record.repoId.toLowerCase() });
  }

  public getUserRepos(filter: { userId?: string; sessionId?: string }): StoredUserRepoRecord[] {
    const list: StoredUserRepoRecord[] = [];
    for (const r of this.userRepos.values()) {
      if (filter.userId && filter.sessionId) {
        if (r.userId === filter.userId || r.sessionId === filter.sessionId) list.push({ ...r });
      } else if (filter.userId && r.userId === filter.userId) {
        list.push({ ...r });
      } else if (filter.sessionId && r.sessionId === filter.sessionId) {
        list.push({ ...r });
      }
    }
    return list.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());
  }

  public close(): void {
    this.repositories.clear();
    this.files.clear();
    this.jobs.clear();
    this.users.clear();
    this.qaHistory = [];
    this.userRepos.clear();
    this.graphNodes.clear();
    this.graphEdges.clear();
    this.symbols.clear();
    this.explanations.clear();
    this.verifierResults.clear();
  }
}
