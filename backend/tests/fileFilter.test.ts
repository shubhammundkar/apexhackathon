import { describe, it, expect } from 'vitest';
import { shouldIncludeFile, detectLanguage, isSafePath, isSecretFile, redactSecrets } from '../src/services/fileFilterService.js';
import { GitHubService } from '../src/services/githubService.js';

describe('FileFilterService & GitHub URL Parsing', () => {
  const github = new GitHubService();

  describe('GitHub URL Parsing', () => {
    it('parses valid repository URLs', () => {
      const res = github.parseRepoUrl('https://github.com/facebook/react');
      expect(res.owner).toBe('facebook');
      expect(res.repo).toBe('react');
    });

    it('strips .git extension if present', () => {
      const res = github.parseRepoUrl('https://github.com/pallets/flask.git');
      expect(res.owner).toBe('pallets');
      expect(res.repo).toBe('flask');
    });

    it('rejects unsupported domains to prevent SSRF', () => {
      expect(() => github.parseRepoUrl('https://evil-phishing.com/owner/repo')).toThrow(/Unsupported host/);
      expect(() => github.parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(/Unsupported host/);
    });

    it('rejects malformed URLs without repo or owner', () => {
      expect(() => github.parseRepoUrl('https://github.com/onlyowner')).toThrow(/Invalid GitHub URL/);
    });
  });

  describe('File Filtering & Path Traversal Prevention', () => {
    it('rejects path traversal attempts', () => {
      expect(isSafePath('../secret.txt')).toBe(false);
      expect(isSafePath('../../etc/passwd')).toBe(false);
      expect(isSafePath('src/../../etc/passwd')).toBe(false);
      expect(isSafePath('/absolute/path')).toBe(false);
      expect(isSafePath('src/components/App.tsx')).toBe(true);
    });

    it('excludes ignored directories like node_modules, .git, dist', () => {
      expect(shouldIncludeFile('node_modules/express/index.js', 100, 300000).shouldInclude).toBe(false);
      expect(shouldIncludeFile('.git/config', 100, 300000).shouldInclude).toBe(false);
      expect(shouldIncludeFile('dist/bundle.js', 100, 300000).shouldInclude).toBe(false);
      expect(shouldIncludeFile('venv/lib/python.py', 100, 300000).shouldInclude).toBe(false);
    });

    it('excludes binary files', () => {
      expect(shouldIncludeFile('assets/logo.png', 1000, 300000).shouldInclude).toBe(false);
      expect(shouldIncludeFile('build/binary.exe', 50000, 300000).shouldInclude).toBe(false);
      expect(shouldIncludeFile('fonts/font.woff2', 20000, 300000).shouldInclude).toBe(false);
    });

    it('excludes sensitive secret files', () => {
      expect(isSecretFile('.env')).toBe(true);
      expect(isSecretFile('.env.production')).toBe(true);
      expect(isSecretFile('server.key')).toBe(true);
      expect(isSecretFile('id_rsa')).toBe(true);
      expect(isSecretFile('.env.example')).toBe(false); // example files allowed
    });

    it('enforces file size limits', () => {
      const res = shouldIncludeFile('src/huge.ts', 500000, 300000);
      expect(res.shouldInclude).toBe(false);
      expect(res.reason).toContain('exceeds limit');
    });

    it('accepts legitimate source files', () => {
      expect(shouldIncludeFile('src/index.ts', 2500, 300000).shouldInclude).toBe(true);
      expect(shouldIncludeFile('app/main.py', 1500, 300000).shouldInclude).toBe(true);
      expect(shouldIncludeFile('README.md', 1200, 300000).shouldInclude).toBe(true);
      expect(shouldIncludeFile('package.json', 800, 300000).shouldInclude).toBe(true);
    });
  });

  describe('Language Detection', () => {
    it('detects languages from extensions and special filenames', () => {
      expect(detectLanguage('src/app.tsx')).toBe('TypeScript (React)');
      expect(detectLanguage('server/main.go')).toBe('Go');
      expect(detectLanguage('script.py')).toBe('Python');
      expect(detectLanguage('Dockerfile')).toBe('Dockerfile');
      expect(detectLanguage('Makefile')).toBe('Makefile');
    });
  });

  describe('Secret Redaction', () => {
    it('redacts detected API keys and secrets from source text', () => {
      const sample = 'const key = "AIzaSyD-1234567890abcdefghijklmnopqr";\nconst normal = "hello";';
      const result = redactSecrets(sample);
      expect(result.hasRedactions).toBe(true);
      expect(result.content).toContain('[REDACTED_SECRET]');
      expect(result.content).not.toContain('AIzaSyD-1234567890abcdefghijklmnopqr');
    });
  });
});
