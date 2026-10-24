import path from 'path';
import { CodeChunk, SearchCitation, SourceFile, CitationRole, ChunkKind } from '@codebase-explainer/shared';
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

interface TermPosting {
  chunkIdx: number;
  tfWeighted: number;
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
   * Retrieves code chunks with true BM25 scoring and Small-to-Big Retrieval
   */
  public search(query: string, maxResults: number = 6, filterFilePath?: string): SearchCitation[] {
    if (this.chunks.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      // Fallback: return top chunks or chunks of matching file
      const selected = filterFilePath
        ? this.chunks.filter((c) => c.filePath.toLowerCase().includes(filterFilePath.toLowerCase()))
        : this.chunks.slice(0, maxResults);

      return selected.slice(0, maxResults).map((c) => ({
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
        : this.chunks.slice(0, maxResults);

      return selected.slice(0, maxResults).map((c) => ({
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

    // Sort small chunk hits by BM25 score descending
    const rankedIndices = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([idx]) => idx);

    const primaryHitIndices = rankedIndices.slice(0, maxResults);
    const primaryHits: SearchCitation[] = [];
    const parentMap = new Map<string, SearchCitation>();

    for (const idx of primaryHitIndices) {
      const chunk = this.chunks[idx];
      const score = Math.round((scores.get(idx) || 0) * 100) / 100;

      let snippet = chunk.content;
      let startLine = chunk.startLine;
      let endLine = chunk.endLine;

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

            if (estimatedTokens <= this.contextTokenBudget) {
              snippet = wholeFuncContent;
              startLine = minPartStart;
              endLine = maxPartEnd;
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
            }
          }
        }
      }

      primaryHits.push({
        filePath: chunk.filePath,
        startLine,
        endLine,
        snippet,
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
    const hitsByFile = new Map<string, SearchCitation[]>();

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

      // Sort by startLine to merge adjacent or overlapping ranges
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
          // Merge adjacent or overlapping
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

    // Combine hits first in score order, then parents
    const maxTotalBlocks = maxResults + this.maxExtraBlocks;
    const candidateParents = Array.from(parentMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

    const finalResults: SearchCitation[] = [...mergedHits];
    let totalChars = mergedHits.reduce((acc, h) => acc + h.snippet.length, 0);

    for (const parent of candidateParents) {
      if (finalResults.length >= maxTotalBlocks) break;
      const estimatedAdditionalTokens = Math.ceil(parent.snippet.length / 4);
      if (Math.ceil((totalChars + parent.snippet.length) / 4) <= this.contextTokenBudget) {
        finalResults.push(parent);
        totalChars += parent.snippet.length;
      }
    }

    return finalResults;
  }

  public getAllChunks(): CodeChunk[] {
    return this.chunks;
  }
}
