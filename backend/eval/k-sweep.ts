import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { SourceFile, QuestionKind, SearchCitation, RetrievalStats } from '@codebase-explainer/shared';
import { IndexingService } from '../src/services/indexingService';
import { extractSymbols, ExtractedSymbol } from '../src/services/symbolService';
import { detectLanguage } from '../src/services/fileFilterService';

interface GoldenItem {
  id: number;
  question: string;
  expectedFile: string;
  expectedSymbol: string;
  expectedFiles?: string[];
  reviewed: boolean;
  note?: string;
}

interface RunMetrics {
  name: string;
  k?: number;
  isAdaptive: boolean;
  totalQuestions: number;
  fileHitOrRecall: number;
  symbolHit: number;
  wholeSymbolRate: number;
  avgBlocks: number;
  avgChars: number;
  avgLines: number;
  avgTokens: number;
  avgLatencyMs: number;
  byKind: Record<QuestionKind, {
    count: number;
    fileHitOrRecall: number;
    symbolHit: number;
    wholeSymbolRate: number;
    avgBlocks: number;
    avgTokens: number;
    avgLatencyMs: number;
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

async function runSweep() {
  const args = process.argv.slice(2);
  let sweepK = [3, 5, 8, 12];
  let runAdaptive = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sweep-k' && args[i + 1]) {
      sweepK = args[i + 1].split(',').map((n) => parseInt(n.trim(), 10)).filter(Boolean);
      i++;
    } else if (args[i] === '--adaptive') {
      runAdaptive = true;
    }
  }

  const rootDir = path.resolve(__dirname, '../..');
  const corpus = loadCorpus(rootDir);
  const golden: GoldenItem[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf8')
  );

  console.log(`Loaded corpus: ${corpus.length} files. Golden set: ${golden.length} items.`);

  // Extract symbols for files in golden
  const symbolMap = new Map<string, Map<string, ExtractedSymbol>>();
  for (const item of golden) {
    const filesToCheck = item.expectedFiles ? item.expectedFiles : [item.expectedFile];
    for (const ef of filesToCheck) {
      const efNorm = normalizePath(ef);
      if (!symbolMap.has(efNorm)) {
        const fileObj = corpus.find((f) => normalizePath(f.path) === efNorm);
        if (fileObj) {
          const res = extractSymbols(fileObj);
          const fMap = new Map<string, ExtractedSymbol>();
          if (res && res.symbols) {
            for (const s of res.symbols) {
              fMap.set(s.name, s);
            }
          }
          symbolMap.set(efNorm, fMap);
        }
      }
    }
  }

  const indexer = new IndexingService(100, 20, { mode: 'syntax' });
  indexer.indexFiles(corpus);

  const runs: Array<{ name: string; k?: number; isAdaptive: boolean }> = [];
  for (const k of sweepK) {
    runs.push({ name: `Fixed-K=${k}`, k, isAdaptive: false });
  }
  if (runAdaptive) {
    runs.push({ name: 'Adaptive', isAdaptive: true });
  }

  const allRunMetrics: RunMetrics[] = [];

  for (const run of runs) {
    let totalScoreSum = 0;
    let totalSymbolHitCount = 0;
    let totalWholeSymbolCount = 0;
    let totalBlocks = 0;
    let totalChars = 0;
    let totalLines = 0;
    let totalTokens = 0;
    let totalLatency = 0;

    const kindBreakdown: Record<QuestionKind, {
      count: number;
      scoreSum: number;
      symbolHits: number;
      wholeSymbols: number;
      blocks: number;
      tokens: number;
      latencyMs: number;
    }> = {
      NARROW: { count: 0, scoreSum: 0, symbolHits: 0, wholeSymbols: 0, blocks: 0, tokens: 0, latencyMs: 0 },
      NORMAL: { count: 0, scoreSum: 0, symbolHits: 0, wholeSymbols: 0, blocks: 0, tokens: 0, latencyMs: 0 },
      BROAD: { count: 0, scoreSum: 0, symbolHits: 0, wholeSymbols: 0, blocks: 0, tokens: 0, latencyMs: 0 },
    };

    for (const item of golden) {
      const qKind = item.expectedFiles && item.expectedFiles.length > 0 ? 'BROAD' : indexer.classifyQuestion(item.question);

      const t0 = performance.now();
      const { citations, stats } = run.isAdaptive
        ? indexer.searchWithStats(item.question)
        : indexer.searchWithStats(item.question, { maxResults: run.k });
      const latencyMs = performance.now() - t0;

      // File recall / hit calculation
      let fileScore = 0;
      if (item.expectedFiles && item.expectedFiles.length > 0) {
        // BROAD: recall = fraction of expectedFiles retrieved
        let foundCount = 0;
        for (const exp of item.expectedFiles) {
          const expNorm = normalizePath(exp);
          const found = citations.some((c) => {
            const cNorm = normalizePath(c.filePath);
            return cNorm.includes(expNorm) || expNorm.includes(cNorm);
          });
          if (found) foundCount++;
        }
        fileScore = foundCount / item.expectedFiles.length;
      } else {
        const expNorm = normalizePath(item.expectedFile);
        const found = citations.some((c) => {
          const cNorm = normalizePath(c.filePath);
          return cNorm.includes(expNorm) || expNorm.includes(cNorm);
        });
        fileScore = found ? 1 : 0;
      }

      // Symbol hit and whole symbol
      let symbolHit = 0;
      let wholeSymbol = 0;
      const expNorm = normalizePath(item.expectedFile);
      const targetSym = symbolMap.get(expNorm)?.get(item.expectedSymbol);

      if (targetSym) {
        const symLen = targetSym.endLine - targetSym.startLine + 1;
        for (const c of citations) {
          const cNorm = normalizePath(c.filePath);
          if (cNorm.includes(expNorm) || expNorm.includes(cNorm)) {
            const overlapStart = Math.max(c.startLine, targetSym.startLine);
            const overlapEnd = Math.min(c.endLine, targetSym.endLine);
            const overlap = Math.max(0, overlapEnd - overlapStart + 1);
            if (overlap / symLen >= 0.5) {
              symbolHit = 1;
            }
            if (c.startLine <= targetSym.startLine && c.endLine >= targetSym.endLine) {
              wholeSymbol = 1;
            }
          }
        }
      }

      const qChars = citations.reduce((acc, c) => acc + c.snippet.length, 0);
      const qLines = citations.reduce((acc, c) => acc + (c.endLine - c.startLine + 1), 0);
      const qTokens = stats.tokensUsed;

      totalScoreSum += fileScore;
      totalSymbolHitCount += symbolHit;
      totalWholeSymbolCount += wholeSymbol;
      totalBlocks += citations.length;
      totalChars += qChars;
      totalLines += qLines;
      totalTokens += qTokens;
      totalLatency += latencyMs;

      // Group breakdown
      const kb = kindBreakdown[qKind];
      kb.count++;
      kb.scoreSum += fileScore;
      kb.symbolHits += symbolHit;
      kb.wholeSymbols += wholeSymbol;
      kb.blocks += citations.length;
      kb.tokens += qTokens;
      kb.latencyMs += latencyMs;
    }

    const n = golden.length;
    const metrics: RunMetrics = {
      name: run.name,
      k: run.k,
      isAdaptive: run.isAdaptive,
      totalQuestions: n,
      fileHitOrRecall: Math.round((totalScoreSum / n) * 1000) / 10,
      symbolHit: Math.round((totalSymbolHitCount / n) * 1000) / 10,
      wholeSymbolRate: Math.round((totalWholeSymbolCount / n) * 1000) / 10,
      avgBlocks: Math.round((totalBlocks / n) * 10) / 10,
      avgChars: Math.round(totalChars / n),
      avgLines: Math.round(totalLines / n),
      avgTokens: Math.round(totalTokens / n),
      avgLatencyMs: Math.round((totalLatency / n) * 100) / 100,
      byKind: {
        NARROW: {
          count: kindBreakdown.NARROW.count,
          fileHitOrRecall: kindBreakdown.NARROW.count > 0 ? Math.round((kindBreakdown.NARROW.scoreSum / kindBreakdown.NARROW.count) * 1000) / 10 : 0,
          symbolHit: kindBreakdown.NARROW.count > 0 ? Math.round((kindBreakdown.NARROW.symbolHits / kindBreakdown.NARROW.count) * 1000) / 10 : 0,
          wholeSymbolRate: kindBreakdown.NARROW.count > 0 ? Math.round((kindBreakdown.NARROW.wholeSymbols / kindBreakdown.NARROW.count) * 1000) / 10 : 0,
          avgBlocks: kindBreakdown.NARROW.count > 0 ? Math.round((kindBreakdown.NARROW.blocks / kindBreakdown.NARROW.count) * 10) / 10 : 0,
          avgTokens: kindBreakdown.NARROW.count > 0 ? Math.round(kindBreakdown.NARROW.tokens / kindBreakdown.NARROW.count) : 0,
          avgLatencyMs: kindBreakdown.NARROW.count > 0 ? Math.round((kindBreakdown.NARROW.latencyMs / kindBreakdown.NARROW.count) * 100) / 100 : 0,
        },
        NORMAL: {
          count: kindBreakdown.NORMAL.count,
          fileHitOrRecall: kindBreakdown.NORMAL.count > 0 ? Math.round((kindBreakdown.NORMAL.scoreSum / kindBreakdown.NORMAL.count) * 1000) / 10 : 0,
          symbolHit: kindBreakdown.NORMAL.count > 0 ? Math.round((kindBreakdown.NORMAL.symbolHits / kindBreakdown.NORMAL.count) * 1000) / 10 : 0,
          wholeSymbolRate: kindBreakdown.NORMAL.count > 0 ? Math.round((kindBreakdown.NORMAL.wholeSymbols / kindBreakdown.NORMAL.count) * 1000) / 10 : 0,
          avgBlocks: kindBreakdown.NORMAL.count > 0 ? Math.round((kindBreakdown.NORMAL.blocks / kindBreakdown.NORMAL.count) * 10) / 10 : 0,
          avgTokens: kindBreakdown.NORMAL.count > 0 ? Math.round(kindBreakdown.NORMAL.tokens / kindBreakdown.NORMAL.count) : 0,
          avgLatencyMs: kindBreakdown.NORMAL.count > 0 ? Math.round((kindBreakdown.NORMAL.latencyMs / kindBreakdown.NORMAL.count) * 100) / 100 : 0,
        },
        BROAD: {
          count: kindBreakdown.BROAD.count,
          fileHitOrRecall: kindBreakdown.BROAD.count > 0 ? Math.round((kindBreakdown.BROAD.scoreSum / kindBreakdown.BROAD.count) * 1000) / 10 : 0,
          symbolHit: kindBreakdown.BROAD.count > 0 ? Math.round((kindBreakdown.BROAD.symbolHits / kindBreakdown.BROAD.count) * 1000) / 10 : 0,
          wholeSymbolRate: kindBreakdown.BROAD.count > 0 ? Math.round((kindBreakdown.BROAD.wholeSymbols / kindBreakdown.BROAD.count) * 1000) / 10 : 0,
          avgBlocks: kindBreakdown.BROAD.count > 0 ? Math.round((kindBreakdown.BROAD.blocks / kindBreakdown.BROAD.count) * 10) / 10 : 0,
          avgTokens: kindBreakdown.BROAD.count > 0 ? Math.round(kindBreakdown.BROAD.tokens / kindBreakdown.BROAD.count) : 0,
          avgLatencyMs: kindBreakdown.BROAD.count > 0 ? Math.round((kindBreakdown.BROAD.latencyMs / kindBreakdown.BROAD.count) * 100) / 100 : 0,
        },
      },
    };

    allRunMetrics.push(metrics);
  }

  // Print Results Table
  console.log('\n======================================================');
  console.log('              K-SWEEP BENCHMARK RESULTS               ');
  console.log('======================================================\n');

  console.log('| Run | File Hit / Recall (%) | Symbol Hit (%) | Whole-Symbol (%) | Avg Blocks | Avg Chars | Avg Tokens | Latency (ms) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const m of allRunMetrics) {
    console.log(`| ${m.name} | ${m.fileHitOrRecall}% | ${m.symbolHit}% | ${m.wholeSymbolRate}% | ${m.avgBlocks} | ${m.avgChars.toLocaleString()} | ${m.avgTokens.toLocaleString()} | ${m.avgLatencyMs} ms |`);
  }

  console.log('\n--- Breakdown by Question Kind ---');
  for (const m of allRunMetrics) {
    console.log(`\n### ${m.name}:`);
    console.log(`- NARROW (n=${m.byKind.NARROW.count}): File/Recall: ${m.byKind.NARROW.fileHitOrRecall}%, Symbol: ${m.byKind.NARROW.symbolHit}%, Tokens: ${m.byKind.NARROW.avgTokens}, Latency: ${m.byKind.NARROW.avgLatencyMs}ms`);
    console.log(`- NORMAL (n=${m.byKind.NORMAL.count}): File/Recall: ${m.byKind.NORMAL.fileHitOrRecall}%, Symbol: ${m.byKind.NORMAL.symbolHit}%, Tokens: ${m.byKind.NORMAL.avgTokens}, Latency: ${m.byKind.NORMAL.avgLatencyMs}ms`);
    console.log(`- BROAD  (n=${m.byKind.BROAD.count}): File/Recall: ${m.byKind.BROAD.fileHitOrRecall}%, Symbol: ${m.byKind.BROAD.symbolHit}%, Tokens: ${m.byKind.BROAD.avgTokens}, Latency: ${m.byKind.BROAD.avgLatencyMs}ms`);
  }

  // Save last_k_run.json
  const outPath = path.join(__dirname, 'last_k_run.json');
  fs.writeFileSync(outPath, JSON.stringify(allRunMetrics, null, 2), 'utf8');
  console.log(`\nSaved benchmark results to ${outPath}`);
}

runSweep().catch((err) => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
