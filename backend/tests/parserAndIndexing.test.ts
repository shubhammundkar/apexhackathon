import { describe, it, expect } from 'vitest';
import { ParserService } from '../src/services/parserService.js';
import { IndexingService } from '../src/services/indexingService.js';
import { SourceFile } from '@codebase-explainer/shared';

describe('ParserService and IndexingService', () => {
  const parser = new ParserService();

  const mockFiles: SourceFile[] = [
    {
      path: 'package.json',
      language: 'JSON',
      size: 400,
      lineCount: 18,
      content: JSON.stringify({
        name: 'sample-app',
        scripts: {
          start: 'node src/index.js',
          test: 'vitest',
        },
        dependencies: {
          express: '^4.19.0',
          react: '^18.3.0',
        },
        devDependencies: {
          typescript: '^5.5.0',
          vitest: '^2.1.0',
        },
      }),
    },
    {
      path: 'src/index.ts',
      language: 'TypeScript',
      size: 600,
      lineCount: 25,
      content: `
import express from 'express';
import { handleAuth } from './auth';

export const app = express();

export function startServer(port: number) {
  app.listen(port, () => console.log('Listening on', port));
}
`,
    },
    {
      path: 'src/auth.ts',
      language: 'TypeScript',
      size: 350,
      lineCount: 15,
      content: `
export function handleAuth(token: string) {
  if (!token) throw new Error('Unauthorized');
  return { userId: '123' };
}
`,
    },
  ];

  it('detects frameworks, dependencies, and entrypoints accurately', () => {
    const manifest = parser.parseProject(mockFiles, mockFiles.map((f) => f.path));

    const stackNames = manifest.stack.map((s) => s.name);
    expect(stackNames).toContain('Express.js');
    expect(stackNames).toContain('React');
    expect(stackNames).toContain('TypeScript');
    expect(stackNames).toContain('Vitest');

    expect(manifest.entryPoints.some((ep) => ep.path === 'src/index.ts')).toBe(true);
    expect(manifest.scripts['start']).toBe('node src/index.js');
  });

  it('analyzes individual file exports, imports, and functions', () => {
    const fileAnalysis = parser.analyzeFileContent(mockFiles[1]); // src/index.ts
    expect(fileAnalysis.path).toBe('src/index.ts');
    expect(fileAnalysis.imports).toContain('express');
    expect(fileAnalysis.imports).toContain('./auth');
    expect(fileAnalysis.exports).toContain('app');
    expect(fileAnalysis.exports).toContain('startServer');
    expect(fileAnalysis.keyFunctions.some((k) => k.name === 'startServer')).toBe(true);
  });

  it('chunks and indexes source files with BM25 keyword search', () => {
    const indexer = new IndexingService(10, 2);
    const { totalChunks } = indexer.indexFiles(mockFiles);
    expect(totalChunks).toBeGreaterThanOrEqual(3);

    // Search for authentication logic
    const results = indexer.search('handleAuth authentication token');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].filePath).toBe('src/auth.ts');
    expect(results[0].snippet).toContain('handleAuth');
    expect(results[0].startLine).toBeGreaterThanOrEqual(1);
  });
});
