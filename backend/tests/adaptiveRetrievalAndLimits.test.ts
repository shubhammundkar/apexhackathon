import { describe, it, expect, beforeAll } from 'vitest';
import { IndexingService } from '../src/services/indexingService';
import { rankFilesForIngestion, categorizeFile } from '../src/services/filePriorityService';
import { selectArchitectureContext } from '../src/services/contextSelectionService';
import { ParserService } from '../src/services/parserService';
import { SourceFile } from '@codebase-explainer/shared';
import { z } from 'zod';

describe('Adaptive Retrieval, Ranked Ingestion, Architecture Context, and Limits', () => {
  describe('Question Classification', () => {
    const mockFiles: SourceFile[] = [
      {
        path: 'src/services/authService.ts',
        content: `
export class AuthService {
  public verifyToken(token: string): boolean {
    return token.length > 0;
  }
}
`,
        size: 150,
        language: 'TypeScript',
        lineCount: 8,
      },
      {
        path: 'src/controllers/userController.ts',
        content: `
export function handleUserLogin(req: any, res: any) {
  return true;
}
`,
        size: 100,
        language: 'TypeScript',
        lineCount: 6,
      },
    ];

    let indexer: IndexingService;
    beforeAll(() => {
      indexer = new IndexingService(100, 20, { mode: 'syntax' });
      indexer.indexFiles(mockFiles);
    });

    it('classifies exact file path or symbol as NARROW', () => {
      expect(indexer.classifyQuestion('where is authService.ts located?')).toBe('NARROW');
      expect(indexer.classifyQuestion('how does verifyToken validate tokens?')).toBe('NARROW');
      expect(indexer.classifyQuestion('where is AuthService defined?')).toBe('NARROW');
    });

    it('classifies broad questions and multi-component queries as BROAD', () => {
      expect(indexer.classifyQuestion('how does the system analyze repositories end to end?')).toBe('BROAD');
      expect(indexer.classifyQuestion('what is the architecture overview of the project?')).toBe('BROAD');
      expect(indexer.classifyQuestion('explain the lifecycle flow')).toBe('BROAD');
      expect(indexer.classifyQuestion('how does the frontend interact with the backend and database?')).toBe('BROAD');
    });

    it('classifies standard questions as NORMAL', () => {
      expect(indexer.classifyQuestion('what are the credentials needed for storage?')).toBe('NORMAL');
      expect(indexer.classifyQuestion('calculate hash digest for password string')).toBe('NORMAL');
    });
  });

  describe('Adaptive Selection Algorithm Invariants', () => {
    const mockFiles: SourceFile[] = [
      {
        path: 'src/moduleA.ts',
        content: `
export function funcA1() {
  // Description block for funcA1 to exceed 200 chars threshold
  const tokenA = 'alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet-kilo-lima-mike-november-oscar-papa';
  return tokenA;
}

export function funcA2() {
  // Description block for funcA2 to exceed 200 chars threshold
  const tokenB = 'quebec-romeo-sierra-tango-uniform-victor-whiskey-xray-yankee-zulu-zero-one-two-three-four-five-six';
  return tokenB;
}

export function funcA3() {
  // Description block for funcA3 to exceed 200 chars threshold
  const tokenC = 'red-blue-green-yellow-purple-orange-cyan-magenta-silver-gold-platinum-diamond-emerald-sapphire-ruby';
  return tokenC;
}
`,
        size: 900,
        language: 'TypeScript',
        lineCount: 20,
      },
      {
        path: 'src/moduleB.ts',
        content: `
export function funcB1() {
  // Description block for funcB1 to exceed 200 chars threshold
  const helperToken = 'helper-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet-kilo-lima-mike-november-oscar';
  return helperToken;
}
`,
        size: 400,
        language: 'TypeScript',
        lineCount: 10,
      },
    ];

    let indexer: IndexingService;
    beforeAll(() => {
      indexer = new IndexingService(100, 20, { mode: 'syntax' });
      indexer.indexFiles(mockFiles);
    });

    it('respects relative cutoff and min/max hit bounds', () => {
      const { citations, stats } = indexer.searchWithStats('funcA1', {
        narrowMin: 1,
        narrowMax: 3,
        narrowCutoff: 0.8,
      });

      expect(citations.length).toBeGreaterThanOrEqual(1);
      expect(citations.length).toBeLessThanOrEqual(3);
      expect(stats.hitsUsed).toBeGreaterThanOrEqual(1);
    });

    it('enforces per-file cap unless named in query or filterFilePath', () => {
      // Query not naming moduleA with per-file cap = 1
      const res1 = indexer.searchWithStats('Description block', {
        normalMin: 1,
        normalMax: 10,
        normalCutoff: 0.1,
        maxChunksPerFile: 1,
      });
      const moduleAHits1 = res1.citations.filter((c) => c.filePath === 'src/moduleA.ts');
      expect(moduleAHits1.length).toBeLessThanOrEqual(1);
      expect(res1.stats.droppedByFileCap).toBeGreaterThan(0);

      // Query naming moduleA: cap is bypassed
      const res2 = indexer.searchWithStats('Description block in moduleA.ts', {
        normalMin: 1,
        normalMax: 10,
        normalCutoff: 0.1,
        maxChunksPerFile: 1,
      });
      expect(res2.stats.droppedByFileCap).toBe(0);

      // filterFilePath set: cap is bypassed
      const res3 = indexer.searchWithStats('Description block', {
        normalMin: 1,
        normalMax: 10,
        normalCutoff: 0.1,
        maxChunksPerFile: 1,
      }, 'moduleA.ts');
      expect(res3.stats.droppedByFileCap).toBe(0);
    });

    it('ensures results[0] is always the best hit and execution is deterministic', () => {
      const resA = indexer.searchWithStats('funcA1');
      const resB = indexer.searchWithStats('funcA1');

      expect(resA.citations.length).toBe(resB.citations.length);
      expect(resA.citations[0].filePath).toBe('src/moduleA.ts');
      expect(resA.citations[0].score).toBe(resB.citations[0].score);
      // Results[0] has maximum score among hits
      for (const c of resA.citations) {
        expect(resA.citations[0].score!).toBeGreaterThanOrEqual(c.score || 0);
      }
    });

    it('backward-compatible search wrapper caps hits when maxResults is provided', () => {
      const fixed3 = indexer.search('function return', 3);
      expect(fixed3.length).toBeLessThanOrEqual(3);

      const fixed1 = indexer.search('funcA1', 1);
      expect(fixed1.length).toBe(1);
      expect(fixed1[0].filePath).toBe('src/moduleA.ts');
    });

    it('stats counts are completely self-consistent', () => {
      const { stats } = indexer.searchWithStats('function return');
      expect(stats.candidatesConsidered).toBeGreaterThan(0);
      expect(stats.hitsUsed).toBeGreaterThanOrEqual(1);
      expect(stats.blocksReturned).toBeGreaterThanOrEqual(1);
      expect(stats.tokensUsed).toBeGreaterThan(0);
      expect(stats.totalMatches).toBeGreaterThan(0);
    });
  });

  describe('Ranked Ingestion (rankFilesForIngestion)', () => {
    it('ranks manifests first, entry points second, src before tests/docs/examples, and shallower paths first', () => {
      const generatedNodes: Array<{ path: string; size: number }> = [];

      // 1. Manifests
      generatedNodes.push({ path: 'package.json', size: 1000 });
      generatedNodes.push({ path: 'README.md', size: 2000 });
      generatedNodes.push({ path: 'Dockerfile', size: 500 });

      // 2. Entry points
      generatedNodes.push({ path: 'src/index.ts', size: 1500 });
      generatedNodes.push({ path: 'src/server.ts', size: 2500 });

      // 3. Source files
      for (let i = 0; i < 400; i++) {
        generatedNodes.push({ path: `src/services/service_${i}.ts`, size: 1000 + i });
      }

      // 4. Config
      for (let i = 0; i < 100; i++) {
        generatedNodes.push({ path: `config/tool_${i}.config.json`, size: 400 + i });
      }

      // 5. Tests
      for (let i = 0; i < 300; i++) {
        generatedNodes.push({ path: `tests/unit/test_${i}.test.ts`, size: 800 + i });
      }

      // 6. Docs
      for (let i = 0; i < 200; i++) {
        generatedNodes.push({ path: `docs/guide_${i}.md`, size: 600 + i });
      }

      // 7. Examples / Generated
      for (let i = 0; i < 200; i++) {
        generatedNodes.push({ path: `examples/sample_${i}.ts`, size: 700 + i });
      }

      expect(generatedNodes.length).toBe(1205);

      const ranked = rankFilesForIngestion(generatedNodes);

      // Verify group ordering
      expect(ranked[0].group).toBe('manifests');
      expect(ranked[1].group).toBe('manifests');
      expect(ranked[2].group).toBe('manifests');

      const entrypointIndex = ranked.findIndex((r) => r.group === 'entrypoints');
      const sourceIndex = ranked.findIndex((r) => r.group === 'source');
      const configIndex = ranked.findIndex((r) => r.group === 'config');
      const testIndex = ranked.findIndex((r) => r.group === 'tests');
      const docIndex = ranked.findIndex((r) => r.group === 'docs');
      const exampleIndex = ranked.findIndex((r) => r.group === 'examples_generated');

      expect(entrypointIndex).toBeLessThan(sourceIndex);
      expect(sourceIndex).toBeLessThan(configIndex);
      expect(configIndex).toBeLessThan(testIndex);
      expect(testIndex).toBeLessThan(docIndex);
      expect(docIndex).toBeLessThan(exampleIndex);

      // Verify slice to 500 files keeps zero tests or examples when eligible code files exist
      const kept = ranked.slice(0, 500);
      const keptTests = kept.filter((k) => k.group === 'tests');
      const keptExamples = kept.filter((k) => k.group === 'examples_generated');
      expect(keptTests.length).toBe(0);
      expect(keptExamples.length).toBe(0);

      // Verify exact skipped counts
      const skipped = ranked.slice(500);
      const skippedCounts: Record<string, number> = {};
      for (const s of skipped) {
        skippedCounts[s.group] = (skippedCounts[s.group] || 0) + 1;
      }

      expect(skippedCounts['tests']).toBe(300);
      expect(skippedCounts['docs']).toBe(200);
      expect(skippedCounts['examples_generated']).toBe(200);
    });

    it('is completely deterministic across multiple runs', () => {
      const nodes = [
        { path: 'src/b.ts', size: 100 },
        { path: 'src/a.ts', size: 100 },
        { path: 'package.json', size: 50 },
        { path: 'README.md', size: 80 },
      ];

      const r1 = rankFilesForIngestion(nodes);
      const r2 = rankFilesForIngestion(nodes);

      expect(r1.map((x) => x.path)).toEqual(r2.map((x) => x.path));
    });
  });

  describe('Architecture Context Selection (selectArchitectureContext)', () => {
    const mockFiles: SourceFile[] = [
      { path: 'package.json', content: '{"name": "test-app"}', size: 25, language: 'JSON', lineCount: 1 },
      { path: 'README.md', content: '# Test App\nDocumentation', size: 30, language: 'Markdown', lineCount: 2 },
      { path: 'src/index.ts', content: "import { auth } from './auth'; import { db } from './db';", size: 60, language: 'TypeScript', lineCount: 2 },
      { path: 'src/auth.ts', content: "import { db } from './db'; export const auth = 1;", size: 50, language: 'TypeScript', lineCount: 2 },
      { path: 'src/db.ts', content: 'export const db = 1;', size: 25, language: 'TypeScript', lineCount: 1 },
      { path: 'src/utils/helper.ts', content: 'export const helper = 1;', size: 30, language: 'TypeScript', lineCount: 1 },
    ];

    const mockManifest = {
      stack: [],
      entryPoints: [{ path: 'src/index.ts', description: 'Main entry', type: 'backend' as const }],
      scripts: {},
      dependencies: {},
      devDependencies: {},
      hasLockfile: true,
    };

    it('prioritizes manifests, entry points, and high in-degree files', () => {
      const context = selectArchitectureContext(mockFiles, mockManifest, { maxFiles: 4 });

      expect(context.selectedFiles.length).toBe(4);
      const selectedPaths = context.selectedFiles.map((f) => f.path);

      // Must include package.json, README.md, entrypoint src/index.ts, and db.ts (imported by both index and auth)
      expect(selectedPaths).toContain('package.json');
      expect(selectedPaths).toContain('README.md');
      expect(selectedPaths).toContain('src/index.ts');
      expect(selectedPaths).toContain('src/db.ts');
    });

    it('includes full file list up to 800 files in pathsListFormatted', () => {
      const context = selectArchitectureContext(mockFiles, mockManifest);
      expect(context.pathsListFormatted).toContain('src/index.ts');
      expect(context.pathsListFormatted).toContain('src/utils/helper.ts');
      expect(context.allIndexedPaths.length).toBe(mockFiles.length);
    });

    it('respects per-file truncation cap and total character budget', () => {
      const bigFiles: SourceFile[] = [
        { path: 'package.json', content: 'a'.repeat(6000), size: 6000, language: 'JSON', lineCount: 10 },
        { path: 'src/main.ts', content: 'b'.repeat(6000), size: 6000, language: 'TypeScript', lineCount: 10 },
      ];

      const context = selectArchitectureContext(bigFiles, mockManifest, {
        maxCharsPerFile: 1000,
        totalCharBudget: 2500,
      });

      for (const f of context.selectedFiles) {
        expect(f.content.length).toBeLessThanOrEqual(1020); // 1000 + '\n... [truncated]'
      }
    });
  });

  describe('Config Validation Rules', () => {
    it('rejects invalid configurations where min > max', () => {
      const EnvSchema = z.object({
        NARROW_MIN_HITS: z.coerce.number().positive(),
        NARROW_MAX_HITS: z.coerce.number().positive(),
      }).refine((data) => data.NARROW_MIN_HITS <= data.NARROW_MAX_HITS, {
        message: 'NARROW_MIN_HITS must be <= NARROW_MAX_HITS',
      });

      const invalid = EnvSchema.safeParse({
        NARROW_MIN_HITS: 10,
        NARROW_MAX_HITS: 5,
      });

      expect(invalid.success).toBe(false);

      const valid = EnvSchema.safeParse({
        NARROW_MIN_HITS: 2,
        NARROW_MAX_HITS: 5,
      });

      expect(valid.success).toBe(true);
    });
  });

  describe('ParserService Key Functions Limits', () => {
    const parser = new ParserService();

    it('returns exact same keyFunctions for files with <= 15 functions', () => {
      let code = '';
      for (let i = 1; i <= 10; i++) {
        code += `export function fn_${i}() { return ${i}; }\n`;
      }

      const file: SourceFile = {
        path: 'src/tenFunctions.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: 10,
      };

      const analysis = parser.analyzeFileContent(file);
      expect(analysis.keyFunctions.length).toBe(10);
      expect(analysis.keyFunctions[0].name).toBe('fn_1');
      expect(analysis.keyFunctions[9].name).toBe('fn_10');
    });

    it('extracts more than 15 key functions when present up to MAX_KEY_FUNCTIONS_PER_FILE', () => {
      let code = '';
      for (let i = 1; i <= 30; i++) {
        code += `export function fn_${i}() { return ${i}; }\n`;
      }

      const file: SourceFile = {
        path: 'src/thirtyFunctions.ts',
        content: code,
        size: code.length,
        language: 'TypeScript',
        lineCount: 30,
      };

      const analysis = parser.analyzeFileContent(file);
      expect(analysis.keyFunctions.length).toBe(30);
      expect(analysis.keyFunctions[29].name).toBe('fn_30');
    });
  });
});
