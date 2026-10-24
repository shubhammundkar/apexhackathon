import path from 'path';
import ts from 'typescript';
import { CodeChunk, ChunkKind, SourceFile } from '@codebase-explainer/shared';
import { CHUNKER_VERSION, config } from '../config';
import { extractSymbols, ExtractedSymbol, FileSymbols } from './symbolService';

export interface ChunkingOptions {
  mode?: 'line' | 'syntax';
  maxChunkChars?: number;
  chunkSizeLines?: number;
  chunkOverlapLines?: number;
}

function isTestFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    norm.includes('/test/') ||
    norm.includes('/tests/') ||
    norm.includes('/__tests__/') ||
    norm.includes('/spec/') ||
    norm.includes('/specs/') ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(norm)
  );
}

function buildSearchHeader(
  filePath: string,
  kind: ChunkKind,
  className?: string,
  symbolName?: string,
  exportsList: string[] = [],
  importsList: string[] = []
): string {
  return `file: ${filePath} | kind: ${kind} | class: ${className || ''} | symbol: ${symbolName || ''} | exports: ${exportsList.join(', ')} | imports: ${importsList.join(', ')}`;
}

/**
 * Fallback line-window chunker preserving exact historical behavior
 */
export function chunkByLineWindow(
  file: SourceFile,
  chunkSizeLines: number = 100,
  chunkOverlapLines: number = 20,
  kind: ChunkKind = 'window'
): CodeChunk[] {
  const lines = file.content.split('\n');
  const totalLines = lines.length;
  const isTest = isTestFile(file.path);
  const chunks: CodeChunk[] = [];

  if (totalLines === 0 || file.content.trim().length === 0) {
    return [];
  }

  if (totalLines <= chunkSizeLines) {
    const chunkContent = file.content;
    const header = buildSearchHeader(file.path, kind);
    chunks.push({
      id: `${file.path}:1-${totalLines}`,
      filePath: file.path,
      startLine: 1,
      endLine: totalLines,
      content: chunkContent,
      language: file.language,
      kind,
      isTest,
      searchText: `${header}\n\n${chunkContent}`,
      chunkerVersion: CHUNKER_VERSION,
    });
    return chunks;
  }

  let start = 0;
  while (start < totalLines) {
    const end = Math.min(start + chunkSizeLines, totalLines);
    const chunkContent = lines.slice(start, end).join('\n');
    const header = buildSearchHeader(file.path, kind);

    chunks.push({
      id: `${file.path}:${start + 1}-${end}`,
      filePath: file.path,
      startLine: start + 1,
      endLine: end,
      content: chunkContent,
      language: file.language,
      kind,
      isTest,
      searchText: `${header}\n\n${chunkContent}`,
      chunkerVersion: CHUNKER_VERSION,
    });

    if (end === totalLines) break;
    start += chunkSizeLines - chunkOverlapLines;
  }

  return chunks;
}

/**
 * Chunks Markdown files by heading hierarchy
 */
function chunkMarkdown(file: SourceFile, maxChunkChars: number): CodeChunk[] {
  const lines = file.content.split('\n');
  const totalLines = lines.length;
  const isTest = isTestFile(file.path);
  const chunks: CodeChunk[] = [];

  const headingStack: Array<{ level: number; text: string }> = [];
  interface Section {
    startLine: number;
    endLine: number;
    headingPath: string;
  }
  const sections: Section[] = [];

  let currentStart = 1;
  let currentHeadingPath = path.basename(file.path);

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      if (i > 0 && i >= currentStart) {
        sections.push({
          startLine: currentStart,
          endLine: i,
          headingPath: currentHeadingPath,
        });
      }
      const level = match[1].length;
      const title = match[2].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: title });
      currentHeadingPath = headingStack.map((h) => h.text).join(' > ');
      currentStart = i + 1;
    }
  }

  if (currentStart <= totalLines) {
    sections.push({
      startLine: currentStart,
      endLine: totalLines,
      headingPath: currentHeadingPath,
    });
  }

  for (const sec of sections) {
    const secContent = lines.slice(sec.startLine - 1, sec.endLine).join('\n');
    if (secContent.trim().length === 0) continue;

    if (secContent.length <= maxChunkChars) {
      const header = buildSearchHeader(file.path, 'doc', undefined, sec.headingPath);
      chunks.push({
        id: `${file.path}:${sec.startLine}-${sec.endLine}`,
        filePath: file.path,
        startLine: sec.startLine,
        endLine: sec.endLine,
        kind: 'doc',
        symbolName: sec.headingPath,
        content: secContent,
        language: file.language,
        isTest,
        searchText: `${header}\n\n${secContent}`,
        chunkerVersion: CHUNKER_VERSION,
      });
    } else {
      // Split large doc sections by paragraphs without overlap
      let pStart = sec.startLine;
      let curLine = sec.startLine;
      while (curLine <= sec.endLine) {
        const chunkCandidate = lines.slice(pStart - 1, curLine).join('\n');
        if (chunkCandidate.length >= maxChunkChars && curLine > pStart) {
          const content = lines.slice(pStart - 1, curLine - 1).join('\n');
          const header = buildSearchHeader(file.path, 'doc', undefined, sec.headingPath);
          chunks.push({
            id: `${file.path}:${pStart}-${curLine - 1}`,
            filePath: file.path,
            startLine: pStart,
            endLine: curLine - 1,
            kind: 'doc',
            symbolName: sec.headingPath,
            content,
            language: file.language,
            isTest,
            searchText: `${header}\n\n${content}`,
            chunkerVersion: CHUNKER_VERSION,
          });
          pStart = curLine;
        }
        curLine++;
      }
      if (pStart <= sec.endLine) {
        const content = lines.slice(pStart - 1, sec.endLine).join('\n');
        if (content.trim().length > 0) {
          const header = buildSearchHeader(file.path, 'doc', undefined, sec.headingPath);
          chunks.push({
            id: `${file.path}:${pStart}-${sec.endLine}`,
            filePath: file.path,
            startLine: pStart,
            endLine: sec.endLine,
            kind: 'doc',
            symbolName: sec.headingPath,
            content,
            language: file.language,
            isTest,
            searchText: `${header}\n\n${content}`,
            chunkerVersion: CHUNKER_VERSION,
          });
        }
      }
    }
  }

  return chunks;
}

/**
 * Chunks Dockerfile by FROM stages
 */
function chunkDockerfile(file: SourceFile): CodeChunk[] {
  const lines = file.content.split('\n');
  const totalLines = lines.length;
  const isTest = isTestFile(file.path);
  const chunks: CodeChunk[] = [];

  const stageStarts: number[] = [];
  for (let i = 0; i < totalLines; i++) {
    if (/^\s*FROM\s+/i.test(lines[i])) {
      stageStarts.push(i + 1);
    }
  }

  if (stageStarts.length === 0) {
    return chunkByLineWindow(file, 100, 20, 'config');
  }

  for (let idx = 0; idx < stageStarts.length; idx++) {
    const sStart = stageStarts[idx];
    const sEnd = idx < stageStarts.length - 1 ? stageStarts[idx + 1] - 1 : totalLines;
    const content = lines.slice(sStart - 1, sEnd).join('\n');
    const stageMatch = lines[sStart - 1].match(/^\s*FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    const stageName = stageMatch ? stageMatch[2] || stageMatch[1] : `stage-${idx + 1}`;
    const header = buildSearchHeader(file.path, 'config', undefined, stageName);

    chunks.push({
      id: `${file.path}:${sStart}-${sEnd}`,
      filePath: file.path,
      startLine: sStart,
      endLine: sEnd,
      kind: 'config',
      symbolName: stageName,
      content,
      language: file.language,
      isTest,
      searchText: `${header}\n\n${content}`,
      chunkerVersion: CHUNKER_VERSION,
    });
  }

  return chunks;
}

/**
 * Chunks YAML / JSON / TOML configs
 */
function chunkConfig(file: SourceFile, maxChunkChars: number): CodeChunk[] {
  const lines = file.content.split('\n');
  const totalLines = lines.length;
  const isTest = isTestFile(file.path);
  const chunks: CodeChunk[] = [];

  if (file.content.length <= maxChunkChars) {
    const header = buildSearchHeader(file.path, 'config');
    return [
      {
        id: `${file.path}:1-${totalLines}`,
        filePath: file.path,
        startLine: 1,
        endLine: totalLines,
        kind: 'config',
        content: file.content,
        language: file.language,
        isTest,
        searchText: `${header}\n\n${file.content}`,
        chunkerVersion: CHUNKER_VERSION,
      },
    ];
  }

  // Split line windows with 0 overlap for deterministic config partitions
  let cur = 1;
  while (cur <= totalLines) {
    let next = cur;
    let charCount = 0;
    while (next <= totalLines) {
      const lineLen = lines[next - 1].length + 1;
      if (charCount + lineLen > maxChunkChars && next > cur) {
        break;
      }
      charCount += lineLen;
      next++;
    }
    const end = next - 1;
    const content = lines.slice(cur - 1, end).join('\n');
    const header = buildSearchHeader(file.path, 'config');

    chunks.push({
      id: `${file.path}:${cur}-${end}`,
      filePath: file.path,
      startLine: cur,
      endLine: end,
      kind: 'config',
      content,
      language: file.language,
      isTest,
      searchText: `${header}\n\n${content}`,
      chunkerVersion: CHUNKER_VERSION,
    });
    cur = next;
  }

  return chunks;
}

/**
 * Extracts top-level module imports for search text
 */
function extractImports(content: string, ext: string): string[] {
  const imports: string[] = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    try {
      const sf = ts.createSourceFile('temp' + ext, content, ts.ScriptTarget.Latest, false);
      for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier) {
          imports.push(stmt.moduleSpecifier.getText(sf).replace(/['"]/g, ''));
        }
      }
    } catch {
      // Ignore parse error
    }
  }
  return imports;
}

/**
 * Splits a statement range inside a symbol body into 'part' chunks if > maxChunkChars
 */
function splitOversizedSymbol(
  file: SourceFile,
  lines: string[],
  symbol: ExtractedSymbol,
  kind: 'function' | 'method',
  maxChunkChars: number,
  isTest: boolean,
  className?: string,
  parentChunkId?: string,
  exportsList: string[] = [],
  importsList: string[] = []
): CodeChunk[] {
  const totalSymbolLines = symbol.endLine - symbol.startLine + 1;
  const symbolContent = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');

  // Try to find AST statement boundaries
  let statementRanges: Array<{ startLine: number; endLine: number }> = [];
  try {
    const ext = path.extname(file.path).toLowerCase();
    const sf = ts.createSourceFile('temp' + ext, file.content, ts.ScriptTarget.Latest, true);
    function findNode(node: ts.Node) {
      const s = sf.getLineAndCharacterOfPosition(node.getStart(sf, false)).line + 1;
      const e = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      if (s >= symbol.startLine && e <= symbol.endLine) {
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          const body = (node as any).body;
          if (body && ts.isBlock(body)) {
            for (const st of body.statements) {
              const stStart = sf.getLineAndCharacterOfPosition(st.getStart(sf, false)).line + 1;
              const stEnd = sf.getLineAndCharacterOfPosition(st.getEnd()).line + 1;
              statementRanges.push({ startLine: stStart, endLine: stEnd });
            }
          }
        }
      }
      ts.forEachChild(node, findNode);
    }
    findNode(sf);
  } catch {
    statementRanges = [];
  }

  // If no AST statements found, fall back to line partitioning
  if (statementRanges.length === 0) {
    let cur = symbol.startLine;
    const parts: CodeChunk[] = [];
    while (cur <= symbol.endLine) {
      let next = cur;
      let chars = 0;
      while (next <= symbol.endLine) {
        const lLen = lines[next - 1].length + 1;
        if (chars + lLen > maxChunkChars && next > cur) break;
        chars += lLen;
        next++;
      }
      const partEnd = next - 1;
      const content = lines.slice(cur - 1, partEnd).join('\n');
      const header = buildSearchHeader(file.path, 'part', className, symbol.name, exportsList, importsList);

      parts.push({
        id: `${file.path}:${cur}-${partEnd}`,
        filePath: file.path,
        startLine: cur,
        endLine: partEnd,
        kind: 'part',
        symbolName: symbol.name,
        className,
        parentChunkId,
        parentSymbol: symbol.name,
        language: file.language,
        isExported: symbol.isExported,
        isTest,
        content,
        searchText: `${header}\n\n${content}`,
        chunkerVersion: CHUNKER_VERSION,
        oversized: content.length > maxChunkChars,
      });
      cur = next;
    }

    // Set partIndex and partCount
    parts.forEach((p, idx) => {
      p.partIndex = idx + 1;
      p.partCount = parts.length;
    });
    return parts;
  }

  // Group statements without breaking across statements
  const chunks: CodeChunk[] = [];
  let partStart = symbol.startLine;
  let partEnd = symbol.startLine;

  for (let i = 0; i < statementRanges.length; i++) {
    const st = statementRanges[i];
    const candidateContent = lines.slice(partStart - 1, st.endLine).join('\n');

    if (candidateContent.length > maxChunkChars && partEnd >= partStart) {
      // Emit current accumulated part
      const content = lines.slice(partStart - 1, partEnd).join('\n');
      if (content.trim().length > 0) {
        const header = buildSearchHeader(file.path, 'part', className, symbol.name, exportsList, importsList);
        chunks.push({
          id: `${file.path}:${partStart}-${partEnd}`,
          filePath: file.path,
          startLine: partStart,
          endLine: partEnd,
          kind: 'part',
          symbolName: symbol.name,
          className,
          parentChunkId,
          parentSymbol: symbol.name,
          language: file.language,
          isExported: symbol.isExported,
          isTest,
          content,
          searchText: `${header}\n\n${content}`,
          chunkerVersion: CHUNKER_VERSION,
          oversized: content.length > maxChunkChars,
        });
      }
      partStart = partEnd + 1;
    }
    partEnd = st.endLine;
  }

  // Final part to symbol.endLine
  if (partStart <= symbol.endLine) {
    const content = lines.slice(partStart - 1, symbol.endLine).join('\n');
    if (content.trim().length > 0) {
      const header = buildSearchHeader(file.path, 'part', className, symbol.name, exportsList, importsList);
      chunks.push({
        id: `${file.path}:${partStart}-${symbol.endLine}`,
        filePath: file.path,
        startLine: partStart,
        endLine: symbol.endLine,
        kind: 'part',
        symbolName: symbol.name,
        className,
        parentChunkId,
        parentSymbol: symbol.name,
        language: file.language,
        isExported: symbol.isExported,
        isTest,
        content,
        searchText: `${header}\n\n${content}`,
        chunkerVersion: CHUNKER_VERSION,
        oversized: content.length > maxChunkChars,
      });
    }
  }

  chunks.forEach((p, idx) => {
    p.partIndex = idx + 1;
    p.partCount = chunks.length;
  });

  return chunks.length > 0 ? chunks : [
    {
      id: `${file.path}:${symbol.startLine}-${symbol.endLine}`,
      filePath: file.path,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      kind: 'part',
      symbolName: symbol.name,
      className,
      parentChunkId,
      parentSymbol: symbol.name,
      language: file.language,
      isExported: symbol.isExported,
      isTest,
      content: symbolContent,
      searchText: `${buildSearchHeader(file.path, 'part', className, symbol.name, exportsList, importsList)}\n\n${symbolContent}`,
      chunkerVersion: CHUNKER_VERSION,
      oversized: true,
      partIndex: 1,
      partCount: 1,
    },
  ];
}

/**
 * Splits module top-level code into chunks of at most maxChunkChars
 */
function createModuleChunks(
  file: SourceFile,
  lines: string[],
  startLine: number,
  endLine: number,
  maxChunkChars: number,
  isTest: boolean,
  exportsList: string[],
  importsList: string[]
): CodeChunk[] {
  // If only blank lines, omit to maintain 'no empty chunks' and clean boundaries
  const rawContent = lines.slice(startLine - 1, endLine).join('\n');
  if (rawContent.trim().length === 0) {
    return [];
  }

  if (rawContent.length <= maxChunkChars) {
    const header = buildSearchHeader(file.path, 'module', undefined, undefined, exportsList, importsList);
    return [
      {
        id: `${file.path}:${startLine}-${endLine}`,
        filePath: file.path,
        startLine,
        endLine,
        kind: 'module',
        content: rawContent,
        language: file.language,
        isTest,
        searchText: `${header}\n\n${rawContent}`,
        chunkerVersion: CHUNKER_VERSION,
      },
    ];
  }

  // Split module at line boundaries without overlap
  const chunks: CodeChunk[] = [];
  let cur = startLine;
  while (cur <= endLine) {
    let next = cur;
    let chars = 0;
    while (next <= endLine) {
      const lLen = lines[next - 1].length + 1;
      if (chars + lLen > maxChunkChars && next > cur) break;
      chars += lLen;
      next++;
    }
    const partEnd = next - 1;
    const content = lines.slice(cur - 1, partEnd).join('\n');
    if (content.trim().length > 0) {
      const header = buildSearchHeader(file.path, 'module', undefined, undefined, exportsList, importsList);
      chunks.push({
        id: `${file.path}:${cur}-${partEnd}`,
        filePath: file.path,
        startLine: cur,
        endLine: partEnd,
        kind: 'module',
        content,
        language: file.language,
        isTest,
        searchText: `${header}\n\n${content}`,
        chunkerVersion: CHUNKER_VERSION,
        oversized: content.length > maxChunkChars,
      });
    }
    cur = next;
  }

  return chunks;
}

/**
 * Performs syntax-aware chunking on a source file
 */
export function chunkFile(file: SourceFile, options?: ChunkingOptions): CodeChunk[] {
  const mode = options?.mode || config.CHUNKING_MODE || 'syntax';
  const maxChunkChars = options?.maxChunkChars || config.MAX_CHUNK_CHARS || 1500;
  const chunkSizeLines = options?.chunkSizeLines || config.CHUNK_SIZE_LINES || 120;
  const chunkOverlapLines = options?.chunkOverlapLines || config.CHUNK_OVERLAP_LINES || 20;

  if (mode === 'line') {
    return chunkByLineWindow(file, chunkSizeLines, chunkOverlapLines, 'window');
  }

  if (!file || !file.content || file.content.trim().length === 0) {
    return [];
  }

  const ext = path.extname(file.path).toLowerCase();
  const baseName = path.basename(file.path).toLowerCase();

  // 1. Doc files
  if (['.md', '.mdx'].includes(ext)) {
    return chunkMarkdown(file, maxChunkChars);
  }

  // 2. Dockerfile
  if (baseName === 'dockerfile' || ext === '.dockerfile') {
    return chunkDockerfile(file);
  }

  // 3. Config files
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
    return chunkConfig(file, maxChunkChars);
  }

  // 4. Source code with symbol extraction
  const fileSymbols = extractSymbols(file);
  if (!fileSymbols) {
    // Unsupported language or parser failure -> fall back to window chunking
    return chunkByLineWindow(file, chunkSizeLines, chunkOverlapLines, 'window');
  }

  const lines = file.content.split('\n');
  const totalLines = lines.length;
  const isTest = isTestFile(file.path);
  const importsList = extractImports(file.content, ext);
  const exportsList = fileSymbols.symbols.filter((s) => s.isExported).map((s) => s.name);

  // Separate class symbols from top-level function symbols
  const classSymbols = fileSymbols.symbols.filter((s) => s.kind === 'class');
  const methodSymbols = fileSymbols.symbols.filter((s) => s.kind === 'method');
  const topFunctions = fileSymbols.symbols.filter((s) => s.kind === 'function');

  // Build top-level blocks to chunk: classes and top functions
  interface TopBlock {
    kind: 'class' | 'function';
    symbol: ExtractedSymbol;
  }
  const topBlocks: TopBlock[] = [
    ...classSymbols.map((s) => ({ kind: 'class' as const, symbol: s })),
    ...topFunctions.map((s) => ({ kind: 'function' as const, symbol: s })),
  ].sort((a, b) => a.symbol.startLine - b.symbol.startLine);

  const rawChunks: CodeChunk[] = [];
  let lastCoveredLine = 0;

  for (let bIdx = 0; bIdx < topBlocks.length; bIdx++) {
    const block = topBlocks[bIdx];
    const bStart = block.symbol.startLine;
    const bEnd = block.symbol.endLine;

    // Check for module code before this block
    if (bStart > lastCoveredLine + 1) {
      const modChunks = createModuleChunks(
        file,
        lines,
        lastCoveredLine + 1,
        bStart - 1,
        maxChunkChars,
        isTest,
        exportsList,
        importsList
      );
      rawChunks.push(...modChunks);
    }

    if (block.kind === 'function') {
      const sym = block.symbol;
      const content = lines.slice(sym.startLine - 1, sym.endLine).join('\n');
      if (content.length <= maxChunkChars) {
        const header = buildSearchHeader(file.path, 'function', undefined, sym.name, exportsList, importsList);
        rawChunks.push({
          id: `${file.path}:${sym.startLine}-${sym.endLine}`,
          filePath: file.path,
          startLine: sym.startLine,
          endLine: sym.endLine,
          kind: 'function',
          symbolName: sym.name,
          content,
          language: file.language,
          isExported: sym.isExported,
          isTest,
          searchText: `${header}\n\n${content}`,
          chunkerVersion: CHUNKER_VERSION,
        });
      } else {
        const parts = splitOversizedSymbol(
          file,
          lines,
          sym,
          'function',
          maxChunkChars,
          isTest,
          undefined,
          undefined,
          exportsList,
          importsList
        );
        rawChunks.push(...parts);
      }
      lastCoveredLine = bEnd;
    } else if (block.kind === 'class') {
      const cls = block.symbol;
      const methods = methodSymbols
        .filter((m) => m.className === cls.name)
        .sort((a, b) => a.startLine - b.startLine);

      if (methods.length === 0) {
        // Class with no methods -> one class_header chunk
        const content = lines.slice(cls.startLine - 1, cls.endLine).join('\n');
        const header = buildSearchHeader(file.path, 'class_header', cls.name, cls.name, exportsList, importsList);
        rawChunks.push({
          id: `${file.path}:${cls.startLine}-${cls.endLine}`,
          filePath: file.path,
          startLine: cls.startLine,
          endLine: cls.endLine,
          kind: 'class_header',
          className: cls.name,
          symbolName: cls.name,
          content,
          language: file.language,
          isExported: cls.isExported,
          isTest,
          searchText: `${header}\n\n${content}`,
          chunkerVersion: CHUNKER_VERSION,
          oversized: content.length > maxChunkChars,
        });
      } else {
        // Class header chunk from cls.startLine to first method startLine - 1
        const firstMStart = methods[0].startLine;
        const headerEnd = Math.max(cls.startLine, firstMStart - 1);
        const headerContent = lines.slice(cls.startLine - 1, headerEnd).join('\n');
        const classHeaderId = `${file.path}:${cls.startLine}-${headerEnd}`;
        const searchHeader = buildSearchHeader(file.path, 'class_header', cls.name, cls.name, exportsList, importsList);

        rawChunks.push({
          id: classHeaderId,
          filePath: file.path,
          startLine: cls.startLine,
          endLine: headerEnd,
          kind: 'class_header',
          className: cls.name,
          symbolName: cls.name,
          content: headerContent,
          language: file.language,
          isExported: cls.isExported,
          isTest,
          searchText: `${searchHeader}\n\n${headerContent}`,
          chunkerVersion: CHUNKER_VERSION,
          oversized: headerContent.length > maxChunkChars,
        });

        // Each method chunk
        for (let mIdx = 0; mIdx < methods.length; mIdx++) {
          const m = methods[mIdx];
          const mStart = m.startLine;
          // Extend endLine to next method start - 1 or class endLine
          const mEnd = mIdx < methods.length - 1 ? methods[mIdx + 1].startLine - 1 : cls.endLine;
          const mContent = lines.slice(mStart - 1, mEnd).join('\n');

          if (mContent.length <= maxChunkChars) {
            const mSearchHeader = buildSearchHeader(file.path, 'method', cls.name, m.name, exportsList, importsList);
            rawChunks.push({
              id: `${file.path}:${mStart}-${mEnd}`,
              filePath: file.path,
              startLine: mStart,
              endLine: mEnd,
              kind: 'method',
              className: cls.name,
              symbolName: m.name,
              parentChunkId: classHeaderId,
              content: mContent,
              language: file.language,
              isExported: cls.isExported,
              isTest,
              searchText: `${mSearchHeader}\n\n${mContent}`,
              chunkerVersion: CHUNKER_VERSION,
            });
          } else {
            const adjustedMethod: ExtractedSymbol = {
              ...m,
              startLine: mStart,
              endLine: mEnd,
            };
            const parts = splitOversizedSymbol(
              file,
              lines,
              adjustedMethod,
              'method',
              maxChunkChars,
              isTest,
              cls.name,
              classHeaderId,
              exportsList,
              importsList
            );
            rawChunks.push(...parts);
          }
        }
      }

      lastCoveredLine = bEnd;
    }
  }

  // Trailing module code after last block
  if (lastCoveredLine < totalLines) {
    const modChunks = createModuleChunks(
      file,
      lines,
      lastCoveredLine + 1,
      totalLines,
      maxChunkChars,
      isTest,
      exportsList,
      importsList
    );
    rawChunks.push(...modChunks);
  }

  // Group tiny sibling symbols (< 200 non-whitespace chars up to maxChunkChars)
  const finalChunks: CodeChunk[] = [];
  let i = 0;

  while (i < rawChunks.length) {
    const chunk = rawChunks[i];
    const nonWs = chunk.content.replace(/\s/g, '').length;

    // Check if eligible for tiny group merging (only top-level functions)
    const isTiny = nonWs < 200 && chunk.kind === 'function';

    if (isTiny) {
      const groupMembers: CodeChunk[] = [chunk];
      let j = i + 1;
      let totalMergedChars = chunk.content.length;

      while (j < rawChunks.length) {
        const next = rawChunks[j];
        const nextNonWs = next.content.replace(/\s/g, '').length;
        const nextTiny =
          nextNonWs < 200 &&
          next.kind === chunk.kind &&
          next.className === chunk.className &&
          next.startLine === groupMembers[groupMembers.length - 1].endLine + 1;

        if (nextTiny && totalMergedChars + next.content.length <= maxChunkChars) {
          groupMembers.push(next);
          totalMergedChars += next.content.length;
          j++;
        } else {
          break;
        }
      }

      if (groupMembers.length > 1) {
        const first = groupMembers[0];
        const last = groupMembers[groupMembers.length - 1];
        const mergedContent = lines.slice(first.startLine - 1, last.endLine).join('\n');
        const memberNames = groupMembers.map((m) => m.symbolName || '').filter(Boolean);
        const header = buildSearchHeader(
          file.path,
          'group',
          first.className,
          memberNames.join(', '),
          exportsList,
          importsList
        );

        finalChunks.push({
          id: `${file.path}:${first.startLine}-${last.endLine}`,
          filePath: file.path,
          startLine: first.startLine,
          endLine: last.endLine,
          kind: 'group',
          className: first.className,
          symbolName: memberNames.join(', '),
          memberNames,
          parentChunkId: first.parentChunkId,
          content: mergedContent,
          language: file.language,
          isExported: first.isExported,
          isTest,
          searchText: `${header}\n\n${mergedContent}`,
          chunkerVersion: CHUNKER_VERSION,
        });
        i = j;
        continue;
      }
    }

    finalChunks.push(chunk);
    i++;
  }

  // Ensure deterministic sort order by startLine
  finalChunks.sort((a, b) => a.startLine - b.startLine);

  return finalChunks;
}
