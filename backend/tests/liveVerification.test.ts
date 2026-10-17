import { describe, it, expect } from 'vitest';
import { GitHubService } from '../src/services/githubService.js';
import { ParserService } from '../src/services/parserService.js';
import { IndexingService } from '../src/services/indexingService.js';
import { shouldIncludeFile, detectLanguage, redactSecrets } from '../src/services/fileFilterService.js';
import { SourceFile } from '@codebase-explainer/shared';

describe('Phase 11: Real Public GitHub Repository Ingestion Verification', () => {
  const github = new GitHubService();
  const parser = new ParserService();
  const indexer = new IndexingService(100, 20);

  it('connects to real GitHub API, fetches metadata and tree for expressjs/cookie-parser', async () => {
    const { owner, repo } = github.parseRepoUrl('https://github.com/expressjs/cookie-parser');
    expect(owner).toBe('expressjs');
    expect(repo).toBe('cookie-parser');

    // 1. Live Metadata Fetch
    const metadata = await github.fetchMetadata(owner, repo);
    expect(metadata.owner).toBe('expressjs');
    expect(metadata.name).toBe('cookie-parser');
    expect(metadata.stars).toBeGreaterThan(50);
    expect(metadata.defaultBranch).toBeDefined();

    // 2. Live Tree Fetch
    const tree = await github.fetchTree(owner, repo, metadata.defaultBranch);
    expect(tree.tree.length).toBeGreaterThan(3);

    const filePaths = tree.tree.map((t) => t.path);
    expect(filePaths).toContain('package.json');
    expect(filePaths).toContain('index.js');

    // 3. Filter Files
    const candidateFiles = tree.tree.filter((node) => {
      if (node.type !== 'blob') return false;
      return shouldIncludeFile(node.path, node.size || 0, 300000).shouldInclude;
    });
    expect(candidateFiles.length).toBeGreaterThan(0);

    // 4. Download Real Source Files
    const downloadedFiles: SourceFile[] = [];
    const filesToFetch = candidateFiles.slice(0, 5); // fetch top files

    for (const f of filesToFetch) {
      const raw = await github.fetchRawFile(owner, repo, metadata.defaultBranch, f.path);
      const { content } = redactSecrets(raw);
      downloadedFiles.push({
        path: f.path,
        content,
        size: Buffer.byteLength(content),
        language: detectLanguage(f.path),
        lineCount: content.split('\n').length,
      });
    }

    expect(downloadedFiles.length).toBe(filesToFetch.length);
    const indexJs = downloadedFiles.find((f) => f.path === 'index.js');
    expect(indexJs).toBeDefined();
    expect(indexJs!.content).toContain('cookieParser');

    // 5. Parse Project Manifest
    const manifest = parser.parseProject(downloadedFiles, filePaths);
    expect(manifest.stack.some((s) => s.name === 'Node.js')).toBe(true);
    expect(manifest.entryPoints.some((ep) => ep.path === 'index.js')).toBe(true);

    // 6. Index Real Code and Search with Citations
    const { totalChunks } = indexer.indexFiles(downloadedFiles);
    expect(totalChunks).toBeGreaterThan(0);

    const citations = indexer.search('cookieParser secret signedCookies');
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0].filePath).toBe('index.js');
    expect(citations[0].snippet).toContain('cookieParser');
    expect(citations[0].startLine).toBeGreaterThanOrEqual(1);
    expect(citations[0].endLine).toBeGreaterThanOrEqual(citations[0].startLine);
  }, 25000); // 25s timeout for network fetch
});
