import path from 'path';
import { CodeChunk, SearchCitation, SourceFile, CitationRole, ChunkKind, QuestionKind, RetrievalStats } from '@codebase-explainer/shared';
import { config, CHUNKER_VERSION } from '../config';
import { chunkFile, ChunkingOptions } from './chunkingService';

export interface IndexingOptions extends ChunkingOptions {
  symbolBoost?: number;
  pathBoost?: number;
  k1?: number;
  b?: number;
  contextTokenBudget?: number;
  maxExtraBlocks?: number;
}

export interface RetrievalOptions {
  poolSize?: number;
  evidenceTokenBudget?: number;
  narrowMin?: number;
  narrowMax?: number;
  narrowCutoff?: number;
  normalMin?: number;
  normalMax?: number;
  normalCutoff?: number;
  broadMin?: number;
  broadMax?: number;
  broadCutoff?: number;
  maxChunksPerFile?: number;
  maxChunksPerFileBroad?: number;
  maxResults?: number;
}

interface TermPosting {
  chunkIdx: number;
  tfWeighted: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class IndexingService {
  private chunks: CodeChunk[] = [];
  private chunkTokenIndex: Map<string, TermPosting[]> = new Map(); // token -> array of postings
  private chunkDocLengths: number[] = [];
  private avgDocLength: number = 0;
  private fileSourceMap: Map<string, string[]> = new Map(); // filePath -> file lines

  private chunkSizeLines: number;
  private chunkOverlapLines: number;
  private options?: IndexingOptions;

  private symbolBoost: number;
  private pathBoost: number;
  private k1: number;
  private b: number;
  private contextTokenBudget: number;
  private maxExtraBlocks: number;

  constructor(
    chunkSizeLines: number = 100,
    chunkOverlapLines: number = 20,
    options?: IndexingOptions
  ) {
    this.chunkSizeLines = chunkSizeLines;
    this.chunkOverlapLines = chunkOverlapLines;
    this.options = options;

    this.symbolBoost = options?.symbolBoost ?? config.SYMBOL_BOOST ?? 3.0;
    this.pathBoost = options?.pathBoost ?? config.PATH_BOOST ?? 2.0;
    this.k1 = options?.k1 ?? config.BM25_K1 ?? 1.2;
    this.b = options?.b ?? config.BM25_B ?? 0.75;
    this.contextTokenBudget = options?.contextTokenBudget ?? config.CONTEXT_TOKEN_BUDGET ?? 6000;
    this.maxExtraBlocks = options?.maxExtraBlocks ?? config.MAX_EXTRA_BLOCKS ?? 4;
  }

  /**
   * Tokenizer for BOTH indexing and queries:
   * Lowercases; splits camelCase, PascalCase, acronyms, snake_case, kebab-case, dots, slashes, hyphens, digits;
   * also keeps original whole identifier stripped of non-alphanumerics;
   * drops tokens under 2 characters and over 60.
   */
  public tokenize(text: string): string[] {
    if (!text) return [];

    const rawTokens = text.match(/[a-zA-Z0-9_$/.-]+/g) || [];
    const tokens: string[] = [];

    for (const raw of rawTokens) {
      // 1. Keep original whole identifier (lowercase, punctuation stripped)
      const whole = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (whole.length >= 2 && whole.length <= 60) {
        tokens.push(whole);
      }

      // 2. Split on camelCase, PascalCase, acronyms, snake_case, kebab-case, dots, slashes, hyphens, digits
      const separated = raw
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .toLowerCase();

      const parts = separated.split(/\s+/).filter((p) => p.length >= 2 && p.length <= 60);
      for (const p of parts) {
        tokens.push(p);
      }
    }

    return tokens;
  }

  /**
   * Chunks all retrieved source files into indexed code segments
   */
  public indexFiles(files: SourceFile[]): { totalChunks: number } {
    this.chunks = [];
    this.chunkTokenIndex.clear();
    this.chunkDocLengths = [];
    this.fileSourceMap.clear();

    for (const file of files) {
      const fileLines = file.content.split('\n');
      this.fileSourceMap.set(file.path, fileLines);

      const fileChunks = chunkFile(file, {
        mode: this.options?.mode,
        maxChunkChars: this.options?.maxChunkChars,
        chunkSizeLines: this.chunkSizeLines,
        chunkOverlapLines: this.chunkOverlapLines,
      });

      for (const chunk of fileChunks) {
        this.addChunk(chunk);
      }
    }

    const totalDocLength = this.chunkDocLengths.reduce((acc, len) => acc + len, 0);
    this.avgDocLength = this.chunks.length > 0 ? totalDocLength / this.chunks.length : 1;

    return { totalChunks: this.chunks.length };
  }

  private addChunk(chunk: CodeChunk) {
    const chunkIdx = this.chunks.length;
    this.chunks.push(chunk);

    // Field-specific tokenization for BM25 term weighting
    const symbolTokens = this.tokenize(`${chunk.symbolName || ''} ${chunk.className || ''}`);
    const pathTokens = this.tokenize(chunk.filePath);
    const bodyTokens = this.tokenize(chunk.content);
    const searchTokens = this.tokenize(chunk.searchText || `${chunk.filePath} ${chunk.content}`);

    this.chunkDocLengths.push(Math.max(1, searchTokens.length));

    // Calculate term frequencies with field boosts
    const symbolCounts = new Map<string, number>();
    for (const t of symbolTokens) symbolCounts.set(t, (symbolCounts.get(t) || 0) + 1);

    const pathCounts = new Map<string, number>();
    for (const t of pathTokens) pathCounts.set(t, (pathCounts.get(t) || 0) + 1);

    const bodyCounts = new Map<string, number>();
    for (const t of bodyTokens) bodyCounts.set(t, (bodyCounts.get(t) || 0) + 1);

    // Unique terms in this chunk's search text
    const uniqueTerms = new Set<string>([...searchTokens, ...symbolTokens, ...pathTokens, ...bodyTokens]);

    for (const term of uniqueTerms) {
      const bCount = bodyCounts.get(term) || 0;
      const sCount = symbolCounts.get(term) || 0;
      const pCount = pathCounts.get(term) || 0;

      const tfWeighted = bCount * 1.0 + sCount * this.symbolBoost + pCount * this.pathBoost;

      let postings = this.chunkTokenIndex.get(term);
      if (!postings) {
        postings = [];
        this.chunkTokenIndex.set(term, postings);
      }
      postings.push({ chunkIdx, tfWeighted: Math.max(1.0, tfWeighted) });
    }
  }

  /**
   * Classify a query into NARROW, BROAD, or NORMAL
   */
  public classifyQuestion(query: string): QuestionKind {
    const queryLower = query.toLowerCase();

    // 1. NARROW: contains an exact file path or an exact symbol/class name that exists in the index
    for (const chunk of this.chunks) {
      if (chunk.filePath) {
        const fullPath = chunk.filePath.toLowerCase();
        const baseName = path.basename(chunk.filePath).toLowerCase();
        if (queryLower.includes(fullPath) || (baseName.length >= 4 && baseName.includes('.') && queryLower.includes(baseName))) {
          return 'NARROW';
        }
      }

      const sym = chunk.symbolName;
      if (sym && sym.length >= 3) {
        const symRegex = new RegExp(`\\b${escapeRegex(sym)}\\b`, 'i');
        if (symRegex.test(query)) {
          return 'NARROW';
        }
      }

      const cls = chunk.className;
      if (cls && cls.length >= 3) {
        const clsRegex = new RegExp(`\\b${escapeRegex(cls)}\\b`, 'i');
        if (clsRegex.test(query)) {
          return 'NARROW';
        }
      }
    }

    // 2. BROAD: matches words like how does, flow, lifecycle, architecture, overview, end to end, explain, why, or mentions several components
    const broadPattern = /\b(how does|how do|flow|lifecycle|architecture|overview|end to end|end-to-end|explain|why)\b/i;
    if (broadPattern.test(query)) {
      return 'BROAD';
    }

    const componentKeywords = ['frontend', 'backend', 'database', 'store', 'api', 'auth', 'router', 'service', 'controller', 'middleware', 'server', 'client', 'worker', 'ingestion', 'indexer', 'parser'];
    let componentMatches = 0;
    for (const comp of componentKeywords) {
      if (new RegExp(`\\b${comp}\\b`, 'i').test(query)) {
        componentMatches++;
        if (componentMatches >= 2) {
          return 'BROAD';
        }
      }
    }

    // 3. Otherwise NORMAL
    return 'NORMAL';
  }

  /**
   * Backwards-compatible thin wrapper over searchWithStats
   * If maxResults is a number, caps primary hits directly. If undefined, uses adaptive limits.
   */
  public search(query: string, maxResults?: number, filterFilePath?: string): SearchCitation[] {
    const options: RetrievalOptions | undefined = maxResults !== undefined ? { maxResults } : undefined;
    return this.searchWithStats(query, options, filterFilePath).citations;
  }

  /**
   * Retrieves code chunks with true BM25 scoring, adaptive classification, budget bounds, and Small-to-Big Retrieval
   */
  public searchWithStats(
    query: string,
    options?: RetrievalOptions,
    filterFilePath?: string
  ): { citations: SearchCitation[]; stats: RetrievalStats } {
    if (this.chunks.length === 0) {
      const stats: RetrievalStats = {
        questionKind: 'NORMAL',
        poolSize: 0,
        candidatesConsidered: 0,
        hitsUsed: 0,
        blocksReturned: 0,
        droppedByCutoff: 0,
        droppedByFileCap: 0,
        droppedByBudget: 0,
        tokensUsed: 0,
        totalMatches: 0,
      };
      return { citations: [], stats };
    }

    const questionKind = this.classifyQuestion(query);
    const isFixedK = options?.maxResults !== undefined;

    let minHits: number;
    let maxHits: number;
    let cutoffFraction: number;
    let perFileCap: number;

    if (isFixedK) {
      minHits = options!.maxResults!;
      maxHits = options!.maxResults!;
      cutoffFraction = 0;
      perFileCap = Infinity;
    } else {
      switch (questionKind) {
        case 'NARROW':
          minHits = options?.narrowMin ?? config.NARROW_MIN_HITS ?? 2;
          maxHits = options?.narrowMax ?? config.NARROW_MAX_HITS ?? 5;
          cutoffFraction = options?.narrowCutoff ?? config.NARROW_CUTOFF ?? 0.6;
          perFileCap = options?.maxChunksPerFile ?? config.MAX_CHUNKS_PER_FILE ?? 3;
          break;
        case 'BROAD':
          minHits = options?.broadMin ?? config.BROAD_MIN_HITS ?? 4;
          maxHits = options?.broadMax ?? config.BROAD_MAX_HITS ?? 12;
          cutoffFraction = options?.broadCutoff ?? config.BROAD_CUTOFF ?? 0.35;
          perFileCap = options?.maxChunksPerFileBroad ?? config.MAX_CHUNKS_PER_FILE_BROAD ?? 4;
          break;
        case 'NORMAL':
        default:
          minHits = options?.normalMin ?? config.NORMAL_MIN_HITS ?? 3;
          maxHits = options?.normalMax ?? config.NORMAL_MAX_HITS ?? 8;
          cutoffFraction = options?.normalCutoff ?? config.NORMAL_CUTOFF ?? 0.5;
          perFileCap = options?.maxChunksPerFile ?? config.MAX_CHUNKS_PER_FILE ?? 3;
          break;
      }
    }

    const poolCapacity = options?.poolSize ?? (isFixedK ? Math.max(config.RETRIEVAL_POOL ?? 40, maxHits) : (config.RETRIEVAL_POOL ?? 40));
    const tokenBudget = options?.evidenceTokenBudget ?? config.EVIDENCE_TOKEN_BUDGET ?? this.contextTokenBudget ?? 6000;

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      // Fallback: return top chunks or chunks of matching file
      const selected = filterFilePath
        ? this.chunks.filter((c) => c.filePath.toLowerCase().includes(filterFilePath.toLowerCase()))
        : this.chunks.slice(0, maxHits);

      const citations: SearchCitation[] = selected.slice(0, maxHits).map((c) => ({
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        snippet: c.content.slice(0, 500),
        relevanceScore: 1.0,
        kind: c.kind,
        symbolName: c.symbolName,
        className: c.className,
        role: 'hit',
        score: 1.0,
        parentChunkId: c.parentChunkId,
      }));

      const tokensUsed = citations.reduce((acc, c) => acc + Math.ceil(c.snippet.length / 4), 0);
      const stats: RetrievalStats = {
        questionKind,
        poolSize: selected.length,
        candidatesConsidered: selected.length,
        hitsUsed: citations.length,
        blocksReturned: citations.length,
        droppedByCutoff: 0,
        droppedByFileCap: 0,
        droppedByBudget: 0,
        tokensUsed,
        totalMatches: selected.length,
      };
      console.debug('[IndexingService] search stats (empty query):', stats);
      return { citations, stats };
    }

    const totalChunks = this.chunks.length;
    const scores = new Map<number, number>();
    const uniqueQueryTerms = Array.from(new Set(queryTokens));
    const queryMentionsTest = /\b(test|tests|spec|specs|example|examples)\b/i.test(query);

    for (const token of uniqueQueryTerms) {
      const postings = this.chunkTokenIndex.get(token);
      if (!postings) continue;

      const n = postings.length;
      // Robertson-Spärck Jones BM25 IDF
      const idf = Math.log((totalChunks - n + 0.5) / (n + 0.5) + 1.0);

      for (const posting of postings) {
        const chunk = this.chunks[posting.chunkIdx];
        if (filterFilePath && !chunk.filePath.toLowerCase().includes(filterFilePath.toLowerCase())) {
          continue;
        }

        const docLen = this.chunkDocLengths[posting.chunkIdx] || this.avgDocLength;
        const normTf =
          (posting.tfWeighted * (this.k1 + 1.0)) /
          (posting.tfWeighted + this.k1 * (1.0 - this.b + this.b * (docLen / this.avgDocLength)));

        const termScore = idf * normTf;
        scores.set(posting.chunkIdx, (scores.get(posting.chunkIdx) || 0) + termScore);
      }
    }

    if (scores.size === 0) {
      // Fallback if no BM25 matches found
      const selected = filterFilePath
        ? this.chunks.filter((c) => c.filePath.toLowerCase().includes(filterFilePath.toLowerCase()))
        : this.chunks.slice(0, maxHits);

      const citations: SearchCitation[] = selected.slice(0, maxHits).map((c) => ({
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        snippet: c.content.slice(0, 500),
        relevanceScore: 0.5,
        kind: c.kind,
        symbolName: c.symbolName,
        className: c.className,
        role: 'hit',
        score: 0.5,
        parentChunkId: c.parentChunkId,
      }));

      const tokensUsed = citations.reduce((acc, c) => acc + Math.ceil(c.snippet.length / 4), 0);
      const stats: RetrievalStats = {
        questionKind,
        poolSize: 0,
        candidatesConsidered: 0,
        hitsUsed: citations.length,
        blocksReturned: citations.length,
        droppedByCutoff: 0,
        droppedByFileCap: 0,
        droppedByBudget: 0,
        tokensUsed,
        totalMatches: 0,
      };
      console.debug('[IndexingService] search stats (no matches):', stats);
      return { citations, stats };
    }

    // Apply exact symbol/path boost (x5) and test down-ranking (x0.6)
    const queryLower = query.toLowerCase();

    for (const [idx, score] of scores.entries()) {
      const chunk = this.chunks[idx];
      let adjustedScore = score;

      const exactSymbolMatch =
        Boolean(chunk.symbolName && chunk.symbolName.length >= 3 && queryLower.includes(chunk.symbolName.toLowerCase())) ||
        Boolean(chunk.className && chunk.className.length >= 3 && queryLower.includes(chunk.className.toLowerCase()));

      const exactPathMatch =
        queryLower.includes(chunk.filePath.toLowerCase()) ||
        queryLower.includes(path.basename(chunk.filePath).toLowerCase());

      if (exactSymbolMatch || exactPathMatch) {
        adjustedScore *= 5.0;
      }

      if (!queryMentionsTest && (chunk.isTest || chunk.filePath.toLowerCase().includes('example'))) {
        adjustedScore *= 0.6;
      }

      scores.set(idx, adjustedScore);
    }

    // Sort candidate chunks by BM25 score descending
    const totalMatches = scores.size;
    const rankedIndices = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([idx]) => idx);

    // 1. Candidate pool: top RETRIEVAL_POOL chunks
    const poolSize = Math.min(poolCapacity, rankedIndices.length);
    const candidateIndices = rankedIndices.slice(0, poolSize);
    const topScore = candidateIndices.length > 0 ? (scores.get(candidateIndices[0]) || 0) : 0;

    let candidatesConsidered = 0;
    let droppedByCutoff = 0;
    let droppedByFileCap = 0;
    let droppedByBudget = 0;

    const selectedHitIndices: number[] = [];
    const fileHitCount = new Map<string, number>();
    const selectedRangesByFile = new Map<string, Array<{ startLine: number; endLine: number }>>();
    let accumulatedHitTokens = 0;

    // 3. Walk pool in rank order
    for (let i = 0; i < candidateIndices.length; i++) {
      if (selectedHitIndices.length >= maxHits) {
        break;
      }

      const chunkIdx = candidateIndices[i];
      const chunk = this.chunks[chunkIdx];
      const score = scores.get(chunkIdx) || 0;
      candidatesConsidered++;

      // Check containment: skip if chunk's line range is already contained in an already selected chunk in the same file
      const existingRanges = selectedRangesByFile.get(chunk.filePath) || [];
      const isContained = existingRanges.some(
        (r) => r.startLine <= chunk.startLine && r.endLine >= chunk.endLine
      );
      if (isContained) {
        continue;
      }

      // Check relative score cutoff: score < cutoff x topScore (unless leaving fewer than min hits)
      if (!isFixedK && cutoffFraction > 0 && score < cutoffFraction * topScore) {
        if (selectedHitIndices.length >= minHits) {
          droppedByCutoff++;
          continue;
        }
      }

      // Check per-file cap: not applied when question names that file or when filterFilePath is set
      const fileBase = path.basename(chunk.filePath).toLowerCase();
      const questionNamesFile = queryLower.includes(chunk.filePath.toLowerCase()) || (fileBase.length >= 4 && queryLower.includes(fileBase));
      const applyFileCap = !isFixedK && !filterFilePath && !questionNamesFile;

      const currentFileCount = fileHitCount.get(chunk.filePath) || 0;
      if (applyFileCap && currentFileCount >= perFileCap) {
        droppedByFileCap++;
        continue;
      }

      // Check evidence token budget: estimate chars / 4
      const estChunkTokens = Math.ceil(chunk.content.length / 4);
      if (accumulatedHitTokens + estChunkTokens > tokenBudget && selectedHitIndices.length >= minHits) {
        droppedByBudget++;
        break;
      }

      // Accept chunk as a primary hit
      selectedHitIndices.push(chunkIdx);
      accumulatedHitTokens += estChunkTokens;
      fileHitCount.set(chunk.filePath, currentFileCount + 1);
      existingRanges.push({ startLine: chunk.startLine, endLine: chunk.endLine });
      selectedRangesByFile.set(chunk.filePath, existingRanges);
    }

    // 4. Small-to-big expansion and merging on selected hits
    const primaryHits: Array<SearchCitation & { rawSnippet: string; isExpandedPart?: boolean }> = [];
    const parentMap = new Map<string, SearchCitation>();

    for (const idx of selectedHitIndices) {
      const chunk = this.chunks[idx];
      const score = Math.round((scores.get(idx) || 0) * 100) / 100;

      let snippet = chunk.content;
      let startLine = chunk.startLine;
      let endLine = chunk.endLine;
      let isExpandedPart = false;

      // Small-to-big: Expand 'part' hit to whole function if it fits within token budget
      if (chunk.kind === 'part' && chunk.parentSymbol) {
        const sisterParts = this.chunks.filter(
          (c) => c.filePath === chunk.filePath && c.kind === 'part' && c.parentSymbol === chunk.parentSymbol
        );

        if (sisterParts.length > 1) {
          const minPartStart = Math.min(...sisterParts.map((s) => s.startLine));
          const maxPartEnd = Math.max(...sisterParts.map((s) => s.endLine));
          const fileLines = this.fileSourceMap.get(chunk.filePath);

          if (fileLines) {
            const wholeFuncContent = fileLines.slice(minPartStart - 1, maxPartEnd).join('\n');
            const estimatedTokens = Math.ceil(wholeFuncContent.length / 4);

            if (estimatedTokens <= tokenBudget) {
              snippet = wholeFuncContent;
              startLine = minPartStart;
              endLine = maxPartEnd;
              isExpandedPart = true;
            } else {
              // Otherwise expand to hit part plus its immediate neighbours
              const curIdx = chunk.partIndex || 1;
              const neighbourParts = sisterParts.filter((s) => {
                const sIdx = s.partIndex || 1;
                return Math.abs(sIdx - curIdx) <= 1;
              });
              const nStart = Math.min(...neighbourParts.map((s) => s.startLine));
              const nEnd = Math.max(...neighbourParts.map((s) => s.endLine));
              snippet = fileLines.slice(nStart - 1, nEnd).join('\n');
              startLine = nStart;
              endLine = nEnd;
              isExpandedPart = true;
            }
          }
        }
      }

      primaryHits.push({
        filePath: chunk.filePath,
        startLine,
        endLine,
        snippet,
        rawSnippet: chunk.content,
        isExpandedPart,
        relevanceScore: score,
        kind: chunk.kind,
        symbolName: chunk.symbolName,
        className: chunk.className,
        role: 'hit',
        score,
        parentChunkId: chunk.parentChunkId,
      });

      // Small-to-big: A method hit also returns its class_header chunk
      if (chunk.kind === 'method' && chunk.parentChunkId) {
        const parentChunk = this.chunks.find((c) => c.id === chunk.parentChunkId);
        if (parentChunk && !parentMap.has(parentChunk.id)) {
          parentMap.set(parentChunk.id, {
            filePath: parentChunk.filePath,
            startLine: parentChunk.startLine,
            endLine: parentChunk.endLine,
            snippet: parentChunk.content,
            relevanceScore: Math.round(score * 0.8 * 100) / 100,
            kind: 'class_header',
            className: parentChunk.className,
            symbolName: parentChunk.symbolName,
            role: 'parent',
            score: Math.round(score * 0.8 * 100) / 100,
          });
        }
      }
    }

    // Merge overlapping or adjacent hits in the same file into one block
    const mergedHits: SearchCitation[] = [];
    const hitsByFile = new Map<string, Array<SearchCitation & { rawSnippet: string; isExpandedPart?: boolean }>>();

    for (const hit of primaryHits) {
      let list = hitsByFile.get(hit.filePath);
      if (!list) {
        list = [];
        hitsByFile.set(hit.filePath, list);
      }
      list.push(hit);
    }

    for (const [filePath, fileHits] of hitsByFile.entries()) {
      if (fileHits.length === 1) {
        mergedHits.push(fileHits[0]);
        continue;
      }

      fileHits.sort((a, b) => a.startLine - b.startLine);
      const mergedList: SearchCitation[] = [];
      let current = fileHits[0];

      for (let i = 1; i < fileHits.length; i++) {
        const next = fileHits[i];
        const isOverlapping = next.startLine <= current.endLine;
        const isSameSymbolOrPart =
          (Boolean(current.symbolName) && current.symbolName === next.symbolName) ||
          (current.kind === 'part' && next.kind === 'part') ||
          (current.kind === 'module' && next.kind === 'module') ||
          (current.kind === 'window' && next.kind === 'window') ||
          (current.kind === 'doc' && next.kind === 'doc');

        const shouldMerge = isOverlapping || (next.startLine <= current.endLine + 1 && isSameSymbolOrPart);

        if (shouldMerge) {
          const start = Math.min(current.startLine, next.startLine);
          const end = Math.max(current.endLine, next.endLine);
          const fileLines = this.fileSourceMap.get(filePath);
          const snippet = fileLines ? fileLines.slice(start - 1, end).join('\n') : current.snippet;

          const names = [current.symbolName, next.symbolName].filter(Boolean);
          const uniqueNames = Array.from(new Set(names)).join(', ');

          current = {
            filePath,
            startLine: start,
            endLine: end,
            snippet,
            rawSnippet: current.rawSnippet,
            isExpandedPart: current.isExpandedPart || next.isExpandedPart,
            relevanceScore: Math.max(current.relevanceScore || 0, next.relevanceScore || 0),
            kind: current.kind === next.kind ? current.kind : 'group',
            symbolName: uniqueNames || current.symbolName,
            className: current.className || next.className,
            role: 'hit',
            score: Math.max(current.score || 0, next.score || 0),
            parentChunkId: current.parentChunkId || next.parentChunkId,
          };
        } else {
          mergedList.push(current);
          current = next;
        }
      }
      mergedList.push(current);
      mergedHits.push(...mergedList);
    }

    // Re-sort hits so results[0] remains the top-scoring hit
    mergedHits.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Combine hits first in score order, then parents (up to MAX_EXTRA_BLOCKS)
    const maxTotalBlocks = selectedHitIndices.length + this.maxExtraBlocks;
    const candidateParents = Array.from(parentMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

    // Budget check across all returned blocks:
    // If parents or expansions would exceed budget: drop parents/context first, then shrink expanded parts; never drop a hit.
    const selectedParents: SearchCitation[] = [];
    let currentTotalChars = mergedHits.reduce((acc, h) => acc + h.snippet.length, 0);

    for (const parent of candidateParents) {
      if (mergedHits.length + selectedParents.length >= maxTotalBlocks) break;
      const estimatedWithParent = Math.ceil((currentTotalChars + parent.snippet.length) / 4);
      if (estimatedWithParent <= tokenBudget) {
        selectedParents.push(parent);
        currentTotalChars += parent.snippet.length;
      }
    }

    // If still over budget after omitting unneeded parents, shrink expanded parts from lower-scoring hits
    let totalTokens = Math.ceil(currentTotalChars / 4);
    if (totalTokens > tokenBudget) {
      // 1. Drop selected parents first (lowest score first)
      while (selectedParents.length > 0 && totalTokens > tokenBudget) {
        const removed = selectedParents.pop();
        if (removed) {
          currentTotalChars -= removed.snippet.length;
          totalTokens = Math.ceil(currentTotalChars / 4);
        }
      }

      // 2. Shrink expanded parts on mergedHits (from lowest scoring hit to highest, but never drop the hit)
      if (totalTokens > tokenBudget) {
        for (let i = mergedHits.length - 1; i >= 0 && totalTokens > tokenBudget; i--) {
          const hit = mergedHits[i] as any;
          if (hit.isExpandedPart && hit.rawSnippet && hit.snippet.length > hit.rawSnippet.length) {
            const charDiff = hit.snippet.length - hit.rawSnippet.length;
            hit.snippet = hit.rawSnippet;
            currentTotalChars -= charDiff;
            totalTokens = Math.ceil(currentTotalChars / 4);
          }
        }
      }
    }

    const finalResults: SearchCitation[] = [...mergedHits, ...selectedParents];
    // Re-ensure results[0] is the best hit
    if (finalResults.length > 0 && mergedHits.length > 0) {
      finalResults[0] = mergedHits[0];
    }

    const totalCharsFinal = finalResults.reduce((acc, h) => acc + h.snippet.length, 0);
    const finalTokensUsed = Math.ceil(totalCharsFinal / 4);

    const stats: RetrievalStats = {
      questionKind,
      poolSize,
      candidatesConsidered,
      hitsUsed: selectedHitIndices.length,
      blocksReturned: finalResults.length,
      droppedByCutoff,
      droppedByFileCap,
      droppedByBudget,
      tokensUsed: finalTokensUsed,
      totalMatches,
    };

    console.debug('[IndexingService] search stats:', stats);
    return { citations: finalResults, stats };
  }

  public getAllChunks(): CodeChunk[] {
    return this.chunks;
  }
}
