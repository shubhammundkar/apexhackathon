import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from workspace root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config(); // fallback to local

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z
    .preprocess((val) => (typeof val === 'string' ? val.toLowerCase().trim() : val), z.enum(['development', 'production', 'test']))
    .default('development'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  GITHUB_TOKEN: z.string().optional().default(''),
  MAX_REPO_FILES: z.coerce.number().default(500),
  MAX_FILE_SIZE_BYTES: z.coerce.number().default(300000), // ~300KB
  MAX_TOTAL_REPO_BYTES: z.coerce.number().default(25000000), // ~25MB
  CHUNK_SIZE_LINES: z.coerce.number().default(120),
  CHUNK_OVERLAP_LINES: z.coerce.number().default(20),
  CHUNKING_MODE: z.enum(['line', 'syntax']).default('syntax'),
  MAX_CHUNK_CHARS: z.coerce.number().default(1500),
  SYMBOL_BOOST: z.coerce.number().default(3),
  PATH_BOOST: z.coerce.number().default(2),
  BM25_K1: z.coerce.number().default(1.2),
  BM25_B: z.coerce.number().default(0.75),
  CONTEXT_TOKEN_BUDGET: z.coerce.number().default(6000),
  MAX_EXTRA_BLOCKS: z.coerce.number().default(4),
  MAX_STORED_REPOS: z.coerce.number().default(20),
  DB_PATH: z.string().optional(),
  MONGODB_URI: z.string().optional().default(''),
  AUTH_SECRET: z.string().optional().default(''),

  // Adaptive Q&A Retrieval
  RETRIEVAL_POOL: z.coerce.number().positive().default(40),
  EVIDENCE_TOKEN_BUDGET: z.coerce.number().positive().default(6000),
  NARROW_MIN_HITS: z.coerce.number().positive().default(2),
  NARROW_MAX_HITS: z.coerce.number().positive().default(5),
  NARROW_CUTOFF: z.coerce.number().min(0).max(1).default(0.6),
  NORMAL_MIN_HITS: z.coerce.number().positive().default(3),
  NORMAL_MAX_HITS: z.coerce.number().positive().default(8),
  NORMAL_CUTOFF: z.coerce.number().min(0).max(1).default(0.5),
  BROAD_MIN_HITS: z.coerce.number().positive().default(4),
  BROAD_MAX_HITS: z.coerce.number().positive().default(12),
  BROAD_CUTOFF: z.coerce.number().min(0).max(1).default(0.35),
  MAX_CHUNKS_PER_FILE: z.coerce.number().positive().default(3),
  MAX_CHUNKS_PER_FILE_BROAD: z.coerce.number().positive().default(4),

  // Architecture Context Selection
  ARCH_CONTEXT_MAX_FILES: z.coerce.number().positive().default(25),
  ARCH_CONTEXT_CHAR_BUDGET: z.coerce.number().positive().default(60000),

  // Key Functions Limits
  MAX_KEY_FUNCTIONS_PER_FILE: z.coerce.number().positive().default(40),
  AI_MAX_FUNCTIONS_PER_FILE: z.coerce.number().positive().default(20),
}).refine(
  (data) => data.NARROW_MIN_HITS <= data.NARROW_MAX_HITS,
  { message: 'NARROW_MIN_HITS must be <= NARROW_MAX_HITS', path: ['NARROW_MIN_HITS'] }
).refine(
  (data) => data.NORMAL_MIN_HITS <= data.NORMAL_MAX_HITS,
  { message: 'NORMAL_MIN_HITS must be <= NORMAL_MAX_HITS', path: ['NORMAL_MIN_HITS'] }
).refine(
  (data) => data.BROAD_MIN_HITS <= data.BROAD_MAX_HITS,
  { message: 'BROAD_MIN_HITS must be <= BROAD_MAX_HITS', path: ['BROAD_MIN_HITS'] }
);

export const CHUNKER_VERSION = '2.0.0';

export type AppConfig = z.infer<typeof EnvSchema>;

function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    throw new Error('Environment configuration validation failed');
  }
  return parsed.data;
}

export const config = loadConfig();

// Safe diagnostic summary (never logs keys)
export function getConfigSummary() {
  return {
    port: config.PORT,
    host: config.HOST,
    nodeEnv: config.NODE_ENV,
    geminiConfigured: Boolean(config.GEMINI_API_KEY && config.GEMINI_API_KEY.length > 5),
    geminiModel: config.GEMINI_MODEL,
    githubTokenConfigured: Boolean(config.GITHUB_TOKEN && config.GITHUB_TOKEN.length > 5),
    mongodbConfigured: Boolean(config.MONGODB_URI && config.MONGODB_URI.length > 5),
    authSecretConfigured: Boolean(config.AUTH_SECRET && config.AUTH_SECRET.length >= 16),
    maxRepoFiles: config.MAX_REPO_FILES,
    maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
    maxStoredRepos: config.MAX_STORED_REPOS,
  };
}

export function getDatabasePath(): string {
  if (config.DB_PATH && config.DB_PATH.trim().length > 0) {
    return path.resolve(config.DB_PATH);
  }
  const isBackendDir = path.basename(process.cwd()) === 'backend';
  return isBackendDir
    ? path.resolve(process.cwd(), 'data/app.db')
    : path.resolve(process.cwd(), 'backend/data/app.db');
}
