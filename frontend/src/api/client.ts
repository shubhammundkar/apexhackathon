import {
  FullRepositoryAnalysis,
  RepositoryFileNode,
  JobStatusResponse,
  QAResponse,
  SourceFile,
  FileAnalysis,
} from '@codebase-explainer/shared';

const API_BASE = '/api';

export class ApiError extends Error {
  public code?: string;
  public status: number;
  public details?: any;

  constructor(message: string, status: number, code?: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      data.message || `HTTP ${response.status}: An unexpected error occurred`,
      response.status,
      data.error,
      data.details
    );
  }

  return data as T;
}

export const apiClient = {
  getHealth: () => request<{ status: string; config: any }>('/health'),

  startAnalysis: (params: { url: string; apiKey?: string; branch?: string; model?: string }) =>
    request<{ message: string; jobId: string; repositoryId: string }>('/repositories/analyze', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getJobStatus: (jobId: string) => request<JobStatusResponse>(`/jobs/${jobId}`),

  cancelJob: (jobId: string) =>
    request<{ message: string }>(`/jobs/${jobId}/cancel`, {
      method: 'POST',
    }),

  getRepository: (owner: string, repo: string) =>
    request<{ id: string; metadata: any; ingestedAt: string; fileCount: number; languages: Record<string, number> }>(
      `/repositories/${owner}/${repo}`
    ),

  getFileTree: (owner: string, repo: string) =>
    request<{ repositoryId: string; tree: RepositoryFileNode[]; totalFiles: number }>(
      `/repositories/${owner}/${repo}/files`
    ),

  getFileContent: (owner: string, repo: string, filePath: string) =>
    request<SourceFile & { analysis?: FileAnalysis }>(
      `/repositories/${owner}/${repo}/files/content?path=${encodeURIComponent(filePath)}`
    ),

  getAnalysis: (owner: string, repo: string) =>
    request<FullRepositoryAnalysis>(`/repositories/${owner}/${repo}/analysis`),

  askQuestion: (
    owner: string,
    repo: string,
    params: { question: string; filePath?: string; apiKey?: string }
  ) =>
    request<QAResponse>(`/repositories/${owner}/${repo}/questions`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};
