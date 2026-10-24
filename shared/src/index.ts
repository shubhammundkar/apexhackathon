import { z } from 'zod';

// ==========================================
// 1. REPOSITORY URL VALIDATION & SCHEMAS
// ==========================================

export const GITHUB_URL_REGEX = /^https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;

export const GitHubUrlSchema = z.string()
  .trim()
  .min(1, 'Repository URL is required')
  .refine((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
        return false;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts.length >= 2;
    } catch {
      return false;
    }
  }, {
    message: 'Must be a valid GitHub repository URL (e.g. https://github.com/owner/repository)',
  });

export const AnalyzeRepoRequestSchema = z.object({
  url: GitHubUrlSchema,
  apiKey: z.string().optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
});

export type AnalyzeRepoRequest = z.infer<typeof AnalyzeRepoRequestSchema>;

export const AskQuestionRequestSchema = z.object({
  question: z.string().trim().min(2, 'Question must be at least 2 characters').max(2000, 'Question too long'),
  filePath: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export type AskQuestionRequest = z.infer<typeof AskQuestionRequestSchema>;

// ==========================================
// 2. REPOSITORY METADATA & INGESTION TYPES
// ==========================================

export type IngestionStage =
  | 'idle'
  | 'validating'
  | 'fetching_metadata'
  | 'fetching_tree'
  | 'filtering'
  | 'downloading_files'
  | 'indexing'
  | 'analyzing'
  | 'completed'
  | 'failed';

export interface IngestionProgress {
  stage: IngestionStage;
  message: string;
  percent: number;
  filesProcessed?: number;
  totalFiles?: number;
  currentFile?: string;
  warnings?: string[];
  error?: string;
}

export interface RepositoryMetadata {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  primaryLanguage: string | null;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  sizeKb: number;
}

export interface RepositoryFileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  language?: string;
  responsibility?: string;
  lineCount?: number;
  children?: RepositoryFileNode[];
}

export interface SourceFile {
  path: string;
  content: string;
  size: number;
  language: string;
  lineCount: number;
  isTruncated?: boolean;
}

export type ChunkKind =
  | 'module'
  | 'class_header'
  | 'function'
  | 'method'
  | 'group'
  | 'part'
  | 'doc'
  | 'config'
  | 'window';

export type CitationRole = 'hit' | 'parent' | 'context';

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  symbols?: string[];
  kind?: ChunkKind;
  symbolName?: string;
  className?: string;
  parentChunkId?: string;
  parentSymbol?: string;
  partIndex?: number;
  partCount?: number;
  isExported?: boolean;
  isTest?: boolean;
  searchText?: string;
  chunkerVersion?: string;
  oversized?: boolean;
  memberNames?: string[];
  role?: CitationRole;
  score?: number;
}

export interface SearchCitation {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  relevanceScore?: number;
  kind?: ChunkKind;
  symbolName?: string;
  className?: string;
  role?: CitationRole;
  score?: number;
  parentChunkId?: string;
}

// ==========================================
// 3. ANALYSIS DOMAIN MODELS
// ==========================================

export interface TechStackItem {
  name: string;
  category: 'language' | 'framework' | 'library' | 'database' | 'tool' | 'runtime' | 'dev';
  version?: string;
  confidence: 'detected' | 'inferred';
  evidencePath?: string;
}

export interface RepositoryOverview {
  projectName: string;
  tagline: string;
  problemSolved: string;
  detailedSummary: string;
  detectedStack: TechStackItem[];
  entryPoints: {
    path: string;
    description: string;
    type: 'frontend' | 'backend' | 'cli' | 'library' | 'worker';
  }[];
  quickStartGuide: {
    prerequisites: string[];
    installCommands: string[];
    runCommands: string[];
    envVariablesRequired: string[];
  };
  missingOrAmbiguousInfo?: string[];
}

export interface ArchitectureLayer {
  name: string;
  type: 'frontend' | 'backend' | 'database' | 'api' | 'auth' | 'external_service' | 'worker' | 'shared';
  description: string;
  files: string[];
  dependencies: string[];
}

export interface ArchitectureAnalysis {
  pattern: string; // e.g. "MVC", "Microservices", "Monolith with Modular Services", "SPA + REST API"
  description: string;
  layers: ArchitectureLayer[];
  mermaidDiagram: string;
  dataFlowDescription: string;
}

export interface FileAnalysis {
  path: string;
  responsibility: string;
  language: string;
  lineCount: number;
  importance: 'critical' | 'high' | 'medium' | 'low';
  exports: string[];
  imports: string[];
  keyFunctions: {
    name: string;
    line: number;
    description: string;
  }[];
  connectedFiles: string[];
  summary: string;
}

export interface ExecutionFlowStep {
  step: number;
  layer: string;
  file: string;
  functionOrRoute: string;
  action: string;
  isConfirmed: boolean;
  notes?: string;
}

export interface ExecutionFlow {
  name: string;
  trigger: string;
  description: string;
  steps: ExecutionFlowStep[];
}

export interface CodeFinding {
  id: string;
  category: 'bug' | 'security' | 'code_smell' | 'architecture' | 'missing_test' | 'maintainability';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  codeSnippet?: string;
  isConfirmed: boolean;
  impact: string;
  remediation: string;
}

export interface FullRepositoryAnalysis {
  repositoryId: string;
  analyzedAt: string;
  modelUsed: string;
  overview: RepositoryOverview;
  architecture: ArchitectureAnalysis;
  importantFiles: FileAnalysis[];
  executionFlows: ExecutionFlow[];
  findings: CodeFinding[];
  dependenciesSummary: {
    runtimeDependencies: TechStackItem[];
    devDependencies: TechStackItem[];
    packageManager?: string;
    hasLockfile: boolean;
  };
  stats: {
    totalFiles: number;
    indexedFiles: number;
    totalLines: number;
    languages: Record<string, number>;
    eligibleFiles?: number;
    skippedByGroup?: Record<string, number>;
  };
}

export type QuestionKind = 'NARROW' | 'NORMAL' | 'BROAD';

export interface RetrievalStats {
  questionKind: QuestionKind;
  poolSize: number;
  candidatesConsidered: number;
  hitsUsed: number;
  blocksReturned: number;
  droppedByCutoff: number;
  droppedByFileCap: number;
  droppedByBudget: number;
  tokensUsed: number;
  totalMatches: number;
}

export interface QAResponse {
  question: string;
  answer: string;
  citations: SearchCitation[];
  modelUsed: string;
  answeredAt: string;
  isRelevant?: boolean;
  retrieval?: RetrievalStats;
}

export interface JobStatusResponse {
  jobId: string;
  repositoryId?: string;
  status: IngestionStage;
  progress: IngestionProgress;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// 7. USER AUTHENTICATION & HISTORY
// ==========================================

export const RegisterRequestSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(30, 'Username cannot exceed 30 characters'),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100, 'Password cannot exceed 100 characters'),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  identifier: z.string().trim().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export interface UserSummary {
  id: string;
  username: string;
  email: string;
  createdAt?: string;
}

export interface AuthResponse {
  user: UserSummary;
  token: string;
}

export interface QAHistoryItem {
  id: string;
  repoId: string;
  commitSha?: string;
  userId?: string;
  sessionId?: string;
  question: string;
  answer: string;
  citations: SearchCitation[];
  modelUsed?: string;
  createdAt: string;
}

export interface RecentRepositoryItem {
  id: string;
  name: string;
  stars: number;
  lastAccessedAt: string;
  ingestedAt?: string;
}

