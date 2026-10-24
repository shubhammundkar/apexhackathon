import {
  RepositoryMetadata,
  FullRepositoryAnalysis,
  RepositoryFileNode,
  FileAnalysis,
  IngestionStage,
  IngestionProgress,
} from '@codebase-explainer/shared';

export interface StoredRepositoryRecord {
  repoId: string; // e.g. "owner/repo"
  commitSha: string; // e.g. 40-char SHA or ref
  metadata: RepositoryMetadata;
  analysis?: FullRepositoryAnalysis;
  fileTree: RepositoryFileNode[];
  fileAnalysisMap: Record<string, FileAnalysis>;
  ingestedAt: string;
  lastAccessedAt: string;
}

export interface StoredFileRecord {
  repoId: string;
  commitSha: string;
  path: string;
  language: string;
  size: number;
  lineCount: number;
  sha256: string;
  content: string;
}

export interface StoredJobRecord {
  jobId: string;
  repoId: string;
  url: string;
  status: IngestionStage;
  progress: IngestionProgress;
  createdAt: string;
  updatedAt: string;
}

export interface GraphNodeRecord {
  id: string;
  repoId: string;
  commitSha: string;
  label: string;
  kind: string;
  filePath?: string;
  metadata?: Record<string, any>;
}

export interface GraphEdgeRecord {
  id: string;
  repoId: string;
  commitSha: string;
  sourceId: string;
  targetId: string;
  kind: string;
  confidence?: 'confirmed' | 'inferred' | 'unknown';
  evidence?: {
    filePath: string;
    startLine: number;
    endLine: number;
    kind: string;
  };
}

export interface SymbolRecord {
  id: string;
  repoId: string;
  commitSha: string;
  filePath: string;
  name: string;
  kind: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, any>;
}

export interface ExplanationRecord {
  fileSha256: string;
  promptVersion: string;
  explanation: string;
  createdAt: string;
}

export interface VerifierResultRecord {
  id: string;
  repoId: string;
  commitSha: string;
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
  evidence?: Record<string, any>;
  createdAt: string;
}

export interface StoredUserRecord {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface StoredQARecord {
  id: string;
  repoId: string;
  commitSha?: string;
  userId?: string;
  sessionId?: string;
  question: string;
  answer: string;
  citations?: any[];
  modelUsed?: string;
  createdAt: string;
}

export interface StoredUserRepoRecord {
  id: string; // unique key e.g. `${userId || sessionId}@${repoId}`
  userId?: string;
  sessionId?: string;
  repoId: string;
  name: string;
  stars: number;
  lastAccessedAt: string;
}

export interface RepositoryStore {
  // Repository
  saveRepository(repo: StoredRepositoryRecord, files: StoredFileRecord[]): Promise<void> | void;
  getRepository(repoId: string, commitSha?: string): Promise<StoredRepositoryRecord | null> | StoredRepositoryRecord | null;
  getFiles(repoId: string, commitSha: string): Promise<StoredFileRecord[]> | StoredFileRecord[];
  getFile(repoId: string, commitSha: string, path: string): Promise<StoredFileRecord | null> | StoredFileRecord | null;
  listRepositories(): Promise<Array<{ id: string; commitSha: string; name: string; stars: number; ingestedAt: string; lastAccessedAt: string }>> | Array<{ id: string; commitSha: string; name: string; stars: number; ingestedAt: string; lastAccessedAt: string }>;
  deleteRepository(repoId: string, commitSha: string): Promise<void> | void;
  pruneOldRepositories(maxRepositories: number): Promise<number> | number;
  touchRepository(repoId: string, commitSha: string): Promise<void> | void;

  // Jobs
  saveJob(job: StoredJobRecord): Promise<void> | void;
  getJob(jobId: string): Promise<StoredJobRecord | null> | StoredJobRecord | null;
  updateJob(jobId: string, updates: Partial<StoredJobRecord>): Promise<void> | void;

  // User Accounts
  saveUser(user: StoredUserRecord): Promise<void> | void;
  getUserById(id: string): Promise<StoredUserRecord | null> | StoredUserRecord | null;
  getUserByUsernameOrEmail(identifier: string): Promise<StoredUserRecord | null> | StoredUserRecord | null;

  // QA Chat History
  saveQAHistory(record: StoredQARecord): Promise<void> | void;
  getQAHistory(repoId: string, filter?: { userId?: string; sessionId?: string }): Promise<StoredQARecord[]> | StoredQARecord[];

  // User Analyzed Repositories
  trackUserRepo(record: StoredUserRepoRecord): Promise<void> | void;
  getUserRepos(filter: { userId?: string; sessionId?: string }): Promise<StoredUserRepoRecord[]> | StoredUserRepoRecord[];

  // Future schema tables
  saveGraphNodes(nodes: GraphNodeRecord[]): Promise<void> | void;
  getGraphNodes(repoId: string, commitSha: string): Promise<GraphNodeRecord[]> | GraphNodeRecord[];
  saveGraphEdges(edges: GraphEdgeRecord[]): Promise<void> | void;
  getGraphEdges(repoId: string, commitSha: string): Promise<GraphEdgeRecord[]> | GraphEdgeRecord[];
  saveSymbols(symbols: SymbolRecord[]): Promise<void> | void;
  getSymbols(repoId: string, commitSha: string, filePath?: string): Promise<SymbolRecord[]> | SymbolRecord[];
  saveExplanation(explanation: ExplanationRecord): Promise<void> | void;
  getExplanation(fileSha256: string, promptVersion: string): Promise<ExplanationRecord | null> | ExplanationRecord | null;
  saveVerifierResult(result: VerifierResultRecord): Promise<void> | void;
  getVerifierResults(repoId: string, commitSha: string): Promise<VerifierResultRecord[]> | VerifierResultRecord[];

  close(): Promise<void> | void;
}

