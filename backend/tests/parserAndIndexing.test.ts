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

  it('detects nested multi-language stack (Python, FastAPI, SQLite, JS, HTML, CSS) and nested entrypoints without fabricating data', () => {
    const multiLangFiles: SourceFile[] = [
      {
        path: 'backend/main.py',
        language: 'Python',
        size: 500,
        lineCount: 20,
        content: `
from fastapi import FastAPI
import uvicorn
from .database import init_db

app = FastAPI(title="Mandi Saathi")

@app.on_event("startup")
def startup():
    init_db()

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000)
`,
      },
      {
        path: 'backend/database.py',
        language: 'Python',
        size: 400,
        lineCount: 15,
        content: `
import sqlite3

def init_db():
    conn = sqlite3.connect("mandisaathi.db")
    return conn
`,
      },
      {
        path: 'frontend/index.html',
        language: 'HTML',
        size: 600,
        lineCount: 25,
        content: `
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>Mandi Saathi Dashboard</h1>
  <script src="js/app.js"></script>
</body>
</html>
`,
      },
      {
        path: 'frontend/css/style.css',
        language: 'CSS',
        size: 300,
        lineCount: 12,
        content: `
body { margin: 0; background-color: #f0f0f0; }
`,
      },
      {
        path: 'frontend/js/app.js',
        language: 'JavaScript',
        size: 450,
        lineCount: 18,
        content: `
fetch('/api/crops').then(res => res.json()).then(console.log);
`,
      },
    ];

    const manifest = parser.parseProject(multiLangFiles, multiLangFiles.map((f) => f.path));
    const stackNames = manifest.stack.map((s) => s.name);

    // Languages detected from real files
    expect(stackNames).toContain('Python');
    expect(stackNames).toContain('JavaScript');
    expect(stackNames).toContain('HTML5');
    expect(stackNames).toContain('CSS3');

    // Frameworks and databases detected from code imports/calls
    expect(stackNames).toContain('FastAPI');
    expect(stackNames).toContain('SQLite');
    expect(stackNames).toContain('Uvicorn');

    // Verify grounded evidence paths
    const pythonEntry = manifest.stack.find((s) => s.name === 'Python');
    expect(pythonEntry?.evidencePath).toBe('backend/main.py');

    const htmlEntry = manifest.stack.find((s) => s.name === 'HTML5');
    expect(htmlEntry?.evidencePath).toBe('frontend/index.html');

    // Verify nested entrypoints
    const entryPaths = manifest.entryPoints.map((ep) => ep.path);
    expect(entryPaths).toContain('backend/main.py');
    expect(entryPaths).toContain('frontend/index.html');

    const backendEp = manifest.entryPoints.find((ep) => ep.path === 'backend/main.py');
    expect(backendEp?.type).toBe('backend');

    const frontendEp = manifest.entryPoints.find((ep) => ep.path === 'frontend/index.html');
    expect(frontendEp?.type).toBe('frontend');
  });
});
