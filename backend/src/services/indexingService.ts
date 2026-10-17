import { CodeChunk, SearchCitation, SourceFile } from '@codebase-explainer/shared';

export class IndexingService {
  private chunks: CodeChunk[] = [];
  private chunkTokenIndex: Map<string, Set<number>> = new Map(); // token -> set of chunk indices
  private chunkSizeLines: number;
  private chunkOverlapLines: number;

  constructor(chunkSizeLines: number = 100, chunkOverlapLines: number = 20) {
    this.chunkSizeLines = chunkSizeLines;
    this.chunkOverlapLines = chunkOverlapLines;
  }

  /**
   * Chunks all retrieved source files into indexed code segments
   */
  public indexFiles(files: SourceFile[]): { totalChunks: number } {
    this.chunks = [];
    this.chunkTokenIndex.clear();

    for (const file of files) {
      const lines = file.content.split('\n');
      const totalLines = lines.length;

      if (totalLines <= this.chunkSizeLines) {
        this.addChunk({
          id: `${file.path}:1-${totalLines}`,
          filePath: file.path,
          startLine: 1,
          endLine: totalLines,
          content: file.content,
          language: file.language,
        });
        continue;
      }

      let start = 0;
      while (start < totalLines) {
        const end = Math.min(start + this.chunkSizeLines, totalLines);
        const chunkContent = lines.slice(start, end).join('\n');

        this.addChunk({
          id: `${file.path}:${start + 1}-${end}`,
          filePath: file.path,
          startLine: start + 1,
          endLine: end,
          content: chunkContent,
          language: file.language,
        });

        if (end === totalLines) break;
        start += this.chunkSizeLines - this.chunkOverlapLines;
      }
    }

    return { totalChunks: this.chunks.length };
  }

  private addChunk(chunk: CodeChunk) {
    const chunkIdx = this.chunks.length;
    this.chunks.push(chunk);

    // Tokenize chunk content and path for search indexing
    const tokens = this.tokenize(`${chunk.filePath} ${chunk.content}`);
    for (const token of tokens) {
      let set = this.chunkTokenIndex.get(token);
      if (!set) {
        set = new Set<number>();
        this.chunkTokenIndex.set(token, set);
      }
      set.add(chunkIdx);
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_$/.-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && t.length <= 40);
  }

  /**
   * Retrieves the most relevant code chunks for a query using TF-IDF / BM25 style ranking
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
      }));
    }

    const scores = new Map<number, number>();
    const totalChunks = this.chunks.length;

    for (const token of queryTokens) {
      const matchingChunkIndices = this.chunkTokenIndex.get(token);
      if (!matchingChunkIndices) continue;

      // Inverse Document Frequency
      const idf = Math.log((totalChunks + 1) / (matchingChunkIndices.size + 1)) + 1;

      for (const idx of matchingChunkIndices) {
        const chunk = this.chunks[idx];
        if (filterFilePath && !chunk.filePath.toLowerCase().includes(filterFilePath.toLowerCase())) {
          continue;
        }

        // Boost matches in file path
        const pathBoost = chunk.filePath.toLowerCase().includes(token) ? 3.0 : 1.0;
        const currentScore = scores.get(idx) || 0;
        scores.set(idx, currentScore + idf * pathBoost);
      }
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults);

    return ranked.map(([idx, score]) => {
      const chunk = this.chunks[idx];
      return {
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        snippet: chunk.content,
        relevanceScore: Math.round(score * 100) / 100,
      };
    });
  }

  public getAllChunks(): CodeChunk[] {
    return this.chunks;
  }
}
