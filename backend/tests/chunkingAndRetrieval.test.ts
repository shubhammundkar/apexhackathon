import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IndexingService } from '../src/services/indexingService';
import { chunkFile, chunkByLineWindow } from '../src/services/chunkingService';
import { extractSymbols } from '../src/services/symbolService';
import { formatEvidence } from '../src/services/geminiService';
import { SourceFile, SearchCitation } from '@codebase-explainer/shared';

describe('Syntax-Aware Chunking, BM25, and Small-to-Big Retrieval Tests', () => {
  const indexer = new IndexingService(100, 20);

  // ==========================================
  // 1. TOKENIZER TESTS
  // ==========================================
  describe('Identifier-Split Tokenizer', () => {
    it('correctly splits camelCase, PascalCase, acronyms, snake_case, kebab-case, dots, slashes, digits and keeps whole identifiers', () => {
      const tokens1 = indexer.tokenize('verifyToken');
      expect(tokens1).toContain('verify');
      expect(tokens1).toContain('token');
      expect(tokens1).toContain('verifytoken');

      const tokens2 = indexer.tokenize('HTTPServer');
      expect(tokens2).toContain('http');
      expect(tokens2).toContain('server');
      expect(tokens2).toContain('httpserver');

      const tokens3 = indexer.tokenize('snake_case_name');
      expect(tokens3).toContain('snake');
      expect(tokens3).toContain('case');
      expect(tokens3).toContain('name');
      expect(tokens3).toContain('snakecasename');

      const tokens4 = indexer.tokenize('kebab-name');
      expect(tokens4).toContain('kebab');
      expect(tokens4).toContain('name');
      expect(tokens4).toContain('kebabname');

      const tokens5 = indexer.tokenize('req.cookies');
      expect(tokens5).toContain('req');
      expect(tokens5).toContain('cookies');
      expect(tokens5).toContain('reqcookies');

      const tokens6 = indexer.tokenize('src/routes/auth.ts');
      expect(tokens6).toContain('src');
      expect(tokens6).toContain('routes');
      expect(tokens6).toContain('auth');
      expect(tokens6).toContain('ts');
      expect(tokens6).toContain('srcroutesauthts');

      const tokens7 = indexer.tokenize('user123Id');
      expect(tokens7).toContain('user');
      expect(tokens7).toContain('123');
      expect(tokens7).toContain('id');
      expect(tokens7).toContain('user123id');
    });

    it('matches "cookies" query against "req.cookies" code token', () => {
      const idx = new IndexingService(100, 20);
      idx.indexFiles([
        {
          path: 'src/handler.ts',
          content: 'export function getSession(req: any) {\n  return req.cookies;\n}\n',
          size: 60,
          language: 'TypeScript',
          lineCount: 3,
        },
      ]);

      const results = idx.search('cookies');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain('req.cookies');
    });
  });

  // ==========================================
  // 2. CHUNKING INVARIANTS ON REPO FILES
  // ==========================================
  describe('Chunking Invariants on Local Files', () => {
    it('satisfies no overlap, exact content, line coverage, cap and determinism across codebase', () => {
      const testFiles = [
        'backend/src/services/indexingService.ts',
        'backend/src/services/chunkingService.ts',
        'backend/src/services/symbolService.ts',
        'backend/src/services/geminiService.ts',
        'backend/src/services/repositoryManager.ts',
        'backend/src/services/fileFilterService.ts',
        'shared/src/index.ts',
      ];

      for (const relPath of testFiles) {
        const fullPath = path.resolve(__dirname, '../..', relPath);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        const file: SourceFile = {
          path: relPath,
          content,
          size: Buffer.byteLength(content),
          language: 'TypeScript',
          lineCount: content.split('\n').length,
        };

        const chunks1 = chunkFile(file);
        const chunks2 = chunkFile(file);

        // 1. Determinism
        expect(chunks1.length).toBe(chunks2.length);
        for (let i = 0; i < chunks1.length; i++) {
          expect(chunks1[i].id).toBe(chunks2[i].id);
          expect(chunks1[i].content).toBe(chunks2[i].content);
        }

        const lines = content.split('\n');

        for (let i = 0; i < chunks1.length; i++) {
          const c = chunks1[i];

          // 2. No empty chunks
          expect(c.startLine).toBeLessThanOrEqual(c.endLine);
          expect(c.content.length).toBeGreaterThan(0);

          // 3. Exact file lines match
          const expectedContent = lines.slice(c.startLine - 1, c.endLine).join('\n');
          expect(c.content).toBe(expectedContent);

          // 4. No overlap with adjacent chunks
          if (i < chunks1.length - 1) {
            expect(c.endLine).toBeLessThan(chunks1[i + 1].startLine);
          }

          // 5. Cap compliance (unless marked oversized)
          if (c.content.length > 1500) {
            expect(c.oversized).toBe(true);
          }
        }

        // 6. Non-blank line coverage
        for (let l = 1; l <= lines.length; l++) {
          if (lines[l - 1].trim().length > 0) {
            const covered = chunks1.some((c) => c.startLine <= l && c.endLine >= l);
            expect(covered).toBe(true);
          }
        }
      }
    });
  });

  // ==========================================
  // 3. SYNTAX-AWARE PATTERNS & SYMBOLS
  // ==========================================
  describe('Syntax Chunk Features', () => {
    it('includes leading comments and decorators without blank line gap', () => {
      const code = `
// First unrelated comment

/**
 * Detailed documentation for calculateTotal
 */
@logged
export function calculateTotal(a: number, b: number) {
  return a + b;
}
`;
      const file: SourceFile = {
        path: 'src/math.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: code.split('\n').length,
      };

      const syms = extractSymbols(file);
      expect(syms).toBeDefined();
      const fnSym = syms?.symbols.find((s) => s.name === 'calculateTotal');
      expect(fnSym).toBeDefined();

      const chunks = chunkFile(file);
      const fnChunk = chunks.find((c) => c.symbolName === 'calculateTotal');
      expect(fnChunk).toBeDefined();
      expect(fnChunk?.content).toContain('Detailed documentation for calculateTotal');
      expect(fnChunk?.content).toContain('@logged');
      expect(fnChunk?.content).not.toContain('First unrelated comment');
    });

    it('extracts class_header and links method chunks to parentChunkId', () => {
      const code = `
export class OrderService {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  public async getOrder(id: string) {
    return this.db.find(id);
  }
}
`;
      const file: SourceFile = {
        path: 'src/order.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: code.split('\n').length,
      };

      const chunks = chunkFile(file);
      const headerChunk = chunks.find((c) => c.kind === 'class_header');
      const methodChunks = chunks.filter((c) => c.kind === 'method');

      expect(headerChunk).toBeDefined();
      expect(headerChunk?.className).toBe('OrderService');
      expect(methodChunks.length).toBe(2);

      for (const m of methodChunks) {
        expect(m.className).toBe('OrderService');
        expect(m.parentChunkId).toBe(headerChunk?.id);
      }
    });

    it('splits oversized functions at statement boundaries into part chunks', () => {
      const stmts = Array.from({ length: 40 }, (_, i) => `  const step${i} = ${i} * 100 + 42;`).join('\n');
      const code = `export function longPipeline() {\n${stmts}\n  return true;\n}`;

      const file: SourceFile = {
        path: 'src/pipeline.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: code.split('\n').length,
      };

      const chunks = chunkFile(file, { maxChunkChars: 500 });
      const parts = chunks.filter((c) => c.kind === 'part');
      expect(parts.length).toBeGreaterThan(1);

      for (const p of parts) {
        expect(p.parentSymbol).toBe('longPipeline');
        expect(p.partIndex).toBeDefined();
        expect(p.partCount).toBe(parts.length);
      }
    });

    it('merges adjacent tiny sibling functions into a group chunk', () => {
      const code = `
export function add(a: number, b: number) { return a + b; }
export function sub(a: number, b: number) { return a - b; }
export function mul(a: number, b: number) { return a * b; }
`;
      const file: SourceFile = {
        path: 'src/tiny.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: code.split('\n').length,
      };

      const chunks = chunkFile(file);
      const groupChunk = chunks.find((c) => c.kind === 'group');
      expect(groupChunk).toBeDefined();
      expect(groupChunk?.memberNames).toEqual(['add', 'sub', 'mul']);
    });

    it('falls back to window chunking gracefully on syntax errors without throwing', () => {
      const badCode = `export function broken( { if while = === return ???`;
      const file: SourceFile = {
        path: 'src/broken.ts',
        content: badCode,
        size: badCode.length,
        language: 'TypeScript',
        lineCount: 1,
      };

      let chunks: any[] = [];
      expect(() => {
        chunks = chunkFile(file);
      }).not.toThrow();
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('falls back to window chunking on Python file when grammar is unavailable', () => {
      const pyCode = `def hello():\n    print("Hello world")\n`;
      const file: SourceFile = {
        path: 'script.py',
        content: pyCode,
        size: pyCode.length,
        language: 'Python',
        lineCount: 2,
      };

      const chunks = chunkFile(file);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].filePath).toBe('script.py');
    });
  });

  // ==========================================
  // 4. BM25 SCORING PREFERENCES
  // ==========================================
  describe('BM25 Field and Length Normalization', () => {
    it('prefers a short exact function over a long file that merely mentions the word', () => {
      const shortFn = `export function parseJwtToken(token: string) {\n  return token.split('.')[1];\n}\n`;
      const longNoise = Array.from({ length: 100 }, (_, i) => `// background noise line ${i}`).join('\n') +
        '\nconst someVar = "token";\n' +
        Array.from({ length: 100 }, (_, i) => `// more background noise line ${i}`).join('\n');

      const files: SourceFile[] = [
        {
          path: 'src/jwt.ts',
          content: shortFn,
          size: shortFn.length,
          language: 'TypeScript',
          lineCount: 3,
        },
        {
          path: 'src/noise.ts',
          content: longNoise,
          size: longNoise.length,
          language: 'TypeScript',
          lineCount: 202,
        },
      ];

      const idx = new IndexingService(100, 20);
      idx.indexFiles(files);

      const results = idx.search('parseJwtToken');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filePath).toBe('src/jwt.ts');
      expect(results[0].snippet).toContain('parseJwtToken');
    });
  });

  // ==========================================
  // 5. SMALL-TO-BIG RETRIEVAL
  // ==========================================
  describe('Small-to-Big Retrieval & Evidence Formatting', () => {
    it('returns parent class header alongside method hit', () => {
      const code = `
export class AuthService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  public validateSessionToken(token: string) {
    return token === this.secret;
  }
}
`;
      const file: SourceFile = {
        path: 'src/authService.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: code.split('\n').length,
      };

      const idx = new IndexingService(100, 20);
      idx.indexFiles([file]);

      const results = idx.search('validateSessionToken');
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Best hit is the method
      expect(results[0].role).toBe('hit');
      expect(results[0].symbolName).toBe('validateSessionToken');

      // Parent class header is included
      const parentResult = results.find((r) => r.role === 'parent');
      expect(parentResult).toBeDefined();
      expect(parentResult?.kind).toBe('class_header');
      expect(parentResult?.snippet).toContain('export class AuthService');
    });

    it('formats evidence with original file line number prefix on every code line', () => {
      const citations: SearchCitation[] = [
        {
          filePath: 'src/demo.ts',
          startLine: 10,
          endLine: 12,
          snippet: 'function demo() {\n  return 42;\n}',
          kind: 'function',
          symbolName: 'demo',
        },
      ];

      const formatted = formatEvidence(citations);
      expect(formatted).toContain('[EVIDENCE #1] src/demo.ts (lines 10-12) function demo');
      expect(formatted).toContain('10 | function demo() {');
      expect(formatted).toContain('11 |   return 42;');
      expect(formatted).toContain('12 | }');
    });
  });
});
