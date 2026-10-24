import { RepositoryMetadata } from '@codebase-explainer/shared';

export interface GitHubRepoId {
  owner: string;
  repo: string;
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export class GitHubService {
  private token?: string;

  constructor(token?: string) {
    this.token = token && token.trim().length > 0 ? token.trim() : undefined;
  }

  public parseRepoUrl(url: string): GitHubRepoId {
    try {
      const parsed = new URL(url.trim());
      if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
        throw new Error(`Unsupported host: ${parsed.hostname}. Only github.com is supported.`);
      }

      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 2) {
        throw new Error('Invalid GitHub URL path. Expected format: https://github.com/owner/repository');
      }

      const owner = segments[0];
      let repo = segments[1];

      // Remove .git suffix if present
      if (repo.endsWith('.git')) {
        repo = repo.slice(0, -4);
      }

      // Basic alphanumeric and hyphen validation
      if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
        throw new Error('Invalid characters in GitHub repository owner or name.');
      }

      return { owner, repo };
    } catch (err: any) {
      throw new Error(err.message || 'Malformed repository URL');
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Codebase-Explainer-AI/1.0',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  public async fetchMetadata(owner: string, repo: string): Promise<RepositoryMetadata> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await fetch(apiUrl, { headers: this.getHeaders() });

    if (response.status === 404) {
      throw new Error(`Repository "${owner}/${repo}" was not found or is private.`);
    }

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
      const rateLimitReset = response.headers.get('x-ratelimit-reset');
      if (rateLimitRemaining === '0') {
        const resetDate = rateLimitReset ? new Date(parseInt(rateLimitReset, 10) * 1000).toLocaleTimeString() : 'later';
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}. Provide a GITHUB_TOKEN in .env for higher limits.`);
      }
      throw new Error('Access forbidden by GitHub API (HTTP 403).');
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API returned error ${response.status}: ${body}`);
    }

    const data: any = await response.json();

    return {
      id: `${owner}/${repo}`,
      owner: data.owner?.login || owner,
      name: data.name || repo,
      fullName: data.full_name || `${owner}/${repo}`,
      url: data.html_url || `https://github.com/${owner}/${repo}`,
      defaultBranch: data.default_branch || 'main',
      description: data.description || null,
      stars: data.stargazers_count || 0,
      forks: data.forks_count || 0,
      openIssues: data.open_issues_count || 0,
      primaryLanguage: data.language || null,
      license: data.license?.spdx_id || data.license?.name || null,
      createdAt: data.created_at || new Date().toISOString(),
      updatedAt: data.updated_at || new Date().toISOString(),
      sizeKb: data.size || 0,
    };
  }

  public async fetchCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
      const response = await fetch(apiUrl, { headers: this.getHeaders() });
      if (response.ok) {
        const data: any = await response.json();
        if (data && typeof data.sha === 'string') {
          return data.sha;
        }
      }
    } catch {
      // Fallback
    }
    return branch;
  }

  public async fetchTree(owner: string, repo: string, branch: string): Promise<GitHubTreeResponse> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(apiUrl, { headers: this.getHeaders() });

    if (!response.ok) {
      throw new Error(`Failed to fetch file tree for ${owner}/${repo}@${branch} (HTTP ${response.status})`);
    }

    const data: any = await response.json();
    return {
      sha: data.sha,
      url: data.url,
      tree: data.tree || [],
      truncated: Boolean(data.truncated),
    };
  }

  public async fetchRawFile(owner: string, repo: string, branch: string, filePath: string): Promise<string> {
    // Try raw.githubusercontent.com first with fallback to api.github.com
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    const rawHeaders: Record<string, string> = {
      'User-Agent': 'Codebase-Explainer-AI/1.0',
    };
    if (this.token) {
      rawHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(rawUrl, { headers: rawHeaders });
    if (response.ok) {
      return await response.text();
    }

    // Fallback: GitHub Contents API
    const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
    const apiRes = await fetch(contentUrl, { headers: this.getHeaders() });
    if (!apiRes.ok) {
      throw new Error(`Failed to retrieve file ${filePath} (HTTP ${apiRes.status})`);
    }

    const contentData: any = await apiRes.json();
    if (contentData.content && contentData.encoding === 'base64') {
      return Buffer.from(contentData.content, 'base64').toString('utf-8');
    }

    throw new Error(`Unrecognized content encoding for file: ${filePath}`);
  }
}
