import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from workspace root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config(); // fallback to local

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  GITHUB_TOKEN: z.string().optional().default(''),
  MAX_REPO_FILES: z.coerce.number().default(500),
  MAX_FILE_SIZE_BYTES: z.coerce.number().default(300000), // ~300KB
  MAX_TOTAL_REPO_BYTES: z.coerce.number().default(25000000), // ~25MB
  CHUNK_SIZE_LINES: z.coerce.number().default(120),
  CHUNK_OVERLAP_LINES: z.coerce.number().default(20),
});

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
    maxRepoFiles: config.MAX_REPO_FILES,
    maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
  };
}
