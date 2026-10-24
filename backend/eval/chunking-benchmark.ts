import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { SourceFile } from '@codebase-explainer/shared';
import { IndexingService } from '../src/services/indexingService';
import { extractSymbols, ExtractedSymbol } from '../src/services/symbolService';
import { detectLanguage } from '../src/services/fileFilterService';

interface GoldenItem {
  id: number;
  question: string;
  expectedFile: string;
  expectedSymbol: string;
  reviewed: boolean;
  note?: string;
}

interface BenchmarkResult {
  mode: string;
  totalFiles: number;
  totalChunks: number;
  indexingTimeMs: number;
  fileHit1: number;
  fileHit3: number;
  fileHit5: number;
  symbolHit5: number;
  wholeSymbolRate: number;
  avgResults: number;
  avgChars: number;
  avgLines: number;
  perQuestion: Array<{
    id: number;
    question: string;
    expectedFile: string;
    expectedSymbol: string;
    fileHit1: boolean;
    fileHit3: boolean;
    fileHit5: boolean;
    symbolHit5: boolean;
    wholeSymbol: boolean;
    resultsCount: number;
    totalChars: number;
    totalLines: number;
  }>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function loadCorpus(rootDir: string): SourceFile[] {
  const dirsToScan = ['backend/src', 'shared/src', 'frontend/src'];
  const corpus: SourceFile[] = [];

  function scan(dirPath: string) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
          scan(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css'].includes(ext) && !entry.name.endsWith('.d.ts')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          corpus.push({
            path: relPath,
            content,
            size: Buffer.byteLength(content, 'utf8'),
            language: detectLanguage(relPath),
            lineCount: content.split('\n').length,
          });
        }
      }
    }
  }

  for (const d of dirsToScan) {
    scan(path.join(rootDir, d));
  }

  return corpus;
}

function runBenchmarkForMode(
  mode: 'line' | 'syntax',
  corpus: SourceFile[],
  golden: GoldenItem[],
  symbolMap: Map<string, Map<string, ExtractedSymbol>>
): BenchmarkResult {
  const indexer = new IndexingService(100, 20, { mode });
  const t0 = performance.now();
  const { totalChunks } = indexer.indexFiles(corpus);
  const indexingTimeMs = Math.round((performance.now() - t0) * 100) / 100;

  let totalHit1 = 0;
  let totalHit3 = 0;
  let totalHit5 = 0;
  let totalSymbolHit5 = 0;
  let totalWholeSymbol = 0;
  let sumResults = 0;
  let sumChars = 0;
  let sumLines = 0;

  const perQuestion: BenchmarkResult['perQuestion'] = [];

  for (const item of golden) {
    const results = indexer.search(item.question, 6);
    const expectedFileNorm = normalizePath(item.expectedFile);
    const top1 = results.slice(0, 1);
    const top3 = results.slice(0, 3);
    const top5 = results.slice(0, 5);

    const fileHit1 = top1.some((r) => normalizePath(r.filePath).includes(expectedFileNorm) || expectedFileNorm.includes(normalizePath(r.filePath)));
    const fileHit3 = top3.some((r) => normalizePath(r.filePath).includes(expectedFileNorm) || expectedFileNorm.includes(normalizePath(r.filePath)));
    const fileHit5 = top5.some((r) => normalizePath(r.filePath).includes(expectedFileNorm) || expectedFileNorm.includes(normalizePath(r.filePath)));

    // Symbol overlap check
    const fileSymbols = symbolMap.get(expectedFileNorm);
    const targetSymbol = fileSymbols?.get(item.expectedSymbol);

    let symbolHit5 = false;
    let wholeSymbol = false;

    if (targetSymbol) {
      const symLen = targetSymbol.endLine - targetSymbol.startLine + 1;

      for (const r of top5) {
        const rPathNorm = normalizePath(r.filePath);
        if (rPathNorm.includes(expectedFileNorm) || expectedFileNorm.includes(rPathNorm)) {
          const overlapStart = Math.max(r.startLine, targetSymbol.startLine);
          const overlapEnd = Math.min(r.endLine, targetSymbol.endLine);
          const overlap = Math.max(0, overlapEnd - overlapStart + 1);

          if (overlap / symLen >= 0.5) {
            symbolHit5 = true;
          }
        }
      }

      for (const r of results) {
        const rPathNorm = normalizePath(r.filePath);
        if (rPathNorm.includes(expectedFileNorm) || expectedFileNorm.includes(rPathNorm)) {
          if (r.startLine <= targetSymbol.startLine && r.endLine >= targetSymbol.endLine) {
            wholeSymbol = true;
          }
        }
      }
    }

    if (fileHit1) totalHit1++;
    if (fileHit3) totalHit3++;
    if (fileHit5) totalHit5++;
    if (symbolHit5) totalSymbolHit5++;
    if (wholeSymbol) totalWholeSymbol++;

    const qChars = results.reduce((acc, r) => acc + (r.snippet ? r.snippet.length : 0), 0);
    const qLines = results.reduce((acc, r) => acc + (r.endLine - r.startLine + 1), 0);

    sumResults += results.length;
    sumChars += qChars;
    sumLines += qLines;

    perQuestion.push({
      id: item.id,
      question: item.question,
      expectedFile: item.expectedFile,
      expectedSymbol: item.expectedSymbol,
      fileHit1,
      fileHit3,
      fileHit5,
      symbolHit5,
      wholeSymbol,
      resultsCount: results.length,
      totalChars: qChars,
      totalLines: qLines,
    });
  }

  const n = golden.length;
  return {
    mode,
    totalFiles: corpus.length,
    totalChunks,
    indexingTimeMs,
    fileHit1: Math.round((totalHit1 / n) * 1000) / 10,
    fileHit3: Math.round((totalHit3 / n) * 1000) / 10,
    fileHit5: Math.round((totalHit5 / n) * 1000) / 10,
    symbolHit5: Math.round((totalSymbolHit5 / n) * 1000) / 10,
    wholeSymbolRate: Math.round((totalWholeSymbol / n) * 1000) / 10,
    avgResults: Math.round((sumResults / n) * 10) / 10,
    avgChars: Math.round(sumChars / n),
    avgLines: Math.round(sumLines / n),
    perQuestion,
  };
}

async function main() {
  const rootDir = path.resolve(__dirname, '../..');
  const args = process.argv.slice(2);
  let modeArg = 'both';
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    modeArg = args[modeIdx + 1].toLowerCase();
  }

  console.log(`[Chunking Benchmark] Initializing corpus from: ${rootDir}`);
  const corpus = loadCorpus(rootDir);
  console.log(`[Chunking Benchmark] Loaded ${corpus.length} source files.`);

  const goldenPath = path.join(__dirname, 'golden.json');
  const golden: GoldenItem[] = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  console.log(`[Chunking Benchmark] Loaded ${golden.length} golden questions.`);

  // Extract all symbols to ground evaluation
  const symbolMap = new Map<string, Map<string, ExtractedSymbol>>();
  for (const file of corpus) {
    const syms = extractSymbols(file);
    if (syms) {
      const fileMap = new Map<string, ExtractedSymbol>();
      for (const s of syms.symbols) {
        fileMap.set(s.name, s);
      }
      symbolMap.set(normalizePath(file.path), fileMap);
    }
  }

  const modesToRun: Array<'line' | 'syntax'> =
    modeArg === 'line' ? ['line'] : modeArg === 'syntax' ? ['syntax'] : ['line', 'syntax'];

  const results: Record<string, BenchmarkResult> = {};

  for (const m of modesToRun) {
    console.log(`\n========================================`);
    console.log(`RUNNING MODE: ${m.toUpperCase()}`);
    console.log(`========================================`);
    const res = runBenchmarkForMode(m, corpus, golden, symbolMap);
    results[m] = res;

    console.log(`Total Chunks:     ${res.totalChunks}`);
    console.log(`Indexing Time:    ${res.indexingTimeMs} ms`);
    console.log(`File Hit@1:       ${res.fileHit1}%`);
    console.log(`File Hit@3:       ${res.fileHit3}%`);
    console.log(`File Hit@5:       ${res.fileHit5}%`);
    console.log(`Symbol Hit@5:     ${res.symbolHit5}%`);
    console.log(`Whole-Symbol Rate:${res.wholeSymbolRate}%`);
    console.log(`Avg Results:      ${res.avgResults}`);
    console.log(`Avg Chars/query:  ${res.avgChars}`);
    console.log(`Avg Lines/query:  ${res.avgLines}`);
  }

  // If running line mode (or line was executed), save docs/CHUNKING_BASELINE.json
  if (results['line']) {
    const docsDir = path.join(rootDir, 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const baselinePath = path.join(docsDir, 'CHUNKING_BASELINE.json');
    fs.writeFileSync(baselinePath, JSON.stringify(results['line'], null, 2), 'utf8');
    console.log(`\n[Chunking Benchmark] Successfully saved line baseline to ${baselinePath}`);
  }
}

main().catch((err) => {
  console.error('[Chunking Benchmark] Failed:', err);
  process.exit(1);
});
