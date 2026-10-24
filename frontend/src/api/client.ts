import {
  FullRepositoryAnalysis,
  RepositoryFileNode,
  JobStatusResponse,
  QAResponse,
  SourceFile,
  FileAnalysis,
  AuthResponse,
  UserSummary,
  QAHistoryItem,
  RecentRepositoryItem,
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

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    let sessionId = localStorage.getItem('anonymous_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substring(2, 12);
      localStorage.setItem('anonymous_session_id', sessionId);
    }
    headers['x-session-id'] = sessionId;
  } catch {
    // Fallback if localStorage unavailable
  }
  return headers;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const authHeaders = getAuthHeaders();
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 500 && !data.message) {
        throw new ApiError(
          'Backend server is not reachable on port 3001. Please run "npm run dev:backend" or "npm run dev".',
          500,
          'BACKEND_OFFLINE'
        );
      }
      throw new ApiError(
        data.message || `HTTP ${response.status}: An unexpected error occurred`,
        response.status,
        data.error,
        data.details
      );
    }

    return data as T;
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      'Cannot connect to backend server. Make sure the backend is running on port 3001 (run "npm run dev:backend" or "npm run dev").',
      503,
      'NETWORK_ERROR'
    );
  }
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
    request<{
      repositoryId: string;
      tree: RepositoryFileNode[];
      totalFiles: number;
      files?: { path: string; name: string; language: string; size: number; lineCount: number; responsibility: string }[];
    }>(`/repositories/${owner}/${repo}/files`),

  getFileContent: (owner: string, repo: string, filePath: string) =>
    request<SourceFile & { analysis?: FileAnalysis }>(
      `/repositories/${owner}/${repo}/files/content?path=${encodeURIComponent(filePath)}`
    ),

  getAnalysis: (owner: string, repo: string) =>
    request<FullRepositoryAnalysis>(`/repositories/${owner}/${repo}/analysis`),

  askQuestion: (
    owner: string,
    repo: string,
    params: { question: string; filePath?: string; apiKey?: string; model?: string }
  ) =>
    request<QAResponse>(`/repositories/${owner}/${repo}/questions`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  askQuestionStream: async (
    owner: string,
    repo: string,
    params: { question: string; filePath?: string; apiKey?: string; model?: string },
    callbacks: {
      onCitations?: (citations: any[]) => void;
      onChunk?: (text: string) => void;
    }
  ): Promise<QAResponse> => {
    const authHeaders = getAuthHeaders();
    const res = await fetch(`/api/repositories/${owner}/${repo}/questions/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new ApiError(errorJson.message || 'Streaming failed', res.status, errorJson.error);
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('Response stream not readable');

    let fullAnswer = '';
    let citations: any[] = [];
    let modelUsed = 'gemini-3.5-flash';
    let retrieval: any = undefined;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const eventMatch = line.match(/^event:\s*(.+)$/m);
        const dataMatch = line.match(/^data:\s*(.+)$/m);

        const event = eventMatch ? eventMatch[1].trim() : 'message';
        const rawData = dataMatch ? dataMatch[1].trim() : '';

        try {
          const data = rawData ? JSON.parse(rawData) : null;
          if (event === 'citations' && data) {
            citations = data;
            callbacks.onCitations?.(data);
          } else if (event === 'chunk' && data?.text) {
            fullAnswer += data.text;
            callbacks.onChunk?.(data.text);
          } else if (event === 'done' && data) {
            modelUsed = data.modelUsed || modelUsed;
            retrieval = data.retrieval;
          } else if (event === 'error' && data) {
            throw new Error(data.message || 'Stream error');
          }
        } catch (e: any) {
          if (event === 'error') throw e;
        }
      }
    }

    return {
      question: params.question,
      answer: fullAnswer,
      citations,
      modelUsed,
      answeredAt: new Date().toISOString(),
      retrieval,
    };
  },

  // Auth methods
  register: (params: { username: string; email: string; password: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  login: (params: { identifier: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getMe: () => request<{ user: UserSummary }>('/auth/me'),

  // Recent Repositories and Q&A history
  getRecentRepositories: () =>
    request<{ repositories: Array<RecentRepositoryItem & { isUserRepo?: boolean }> }>('/repositories'),

  getQAHistory: (owner: string, repo: string) =>
    request<{ repositoryId: string; history: QAHistoryItem[] }>(
      `/repositories/${owner}/${repo}/questions/history`
    ),
};
