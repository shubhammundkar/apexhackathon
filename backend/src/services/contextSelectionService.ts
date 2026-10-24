import path from 'path';
import { SourceFile } from '@codebase-explainer/shared';
import { ParsedProjectManifest } from './parserService';
import { config } from '../config';

export interface ArchitectureContextOptions {
  maxFiles?: number;
  maxCharsPerFile?: number;
  totalCharBudget?: number;
}

export interface SelectedArchitectureContext {
  selectedFiles: SourceFile[];
  allIndexedPaths: string[];
  pathsListFormatted: string;
}

/**
 * Normalizes a path for comparison
 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Resolves relative imports like './foo' or '../bar' to full project paths
 */
function resolveImportPath(importingFile: string, importPath: string, fileSet: Map<string, SourceFile>): SourceFile | undefined {
  if (!importPath.startsWith('.')) return undefined;

  const dir = path.posix.dirname(importingFile.replace(/\\/g, '/'));
  const resolved = path.posix.normalize(path.posix.join(dir, importPath));
  const resolvedLower = resolved.toLowerCase();

  // Try exact match
  if (fileSet.has(resolvedLower)) {
    return fileSet.get(resolvedLower);
  }

  // Try common extensions (.ts, .tsx, .js, .jsx, /index.ts, /index.js)
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.js', '/index.tsx'];
  for (const ext of extensions) {
    const candidate = `${resolvedLower}${ext}`;
    if (fileSet.has(candidate)) {
      return fileSet.get(candidate);
    }
  }

  return undefined;
}

/**
 * Selects the highest-priority files for Gemini architecture context
 * Order of importance:
 * 1. Manifests and README
 * 2. Entry points from manifest.entryPoints
 * 3. Routing, controller, service, middleware, DB, auth paths
 * 4. High in-degree imported files
 *
 * Respects ARCH_CONTEXT_MAX_FILES, 4000 char per-file cap, and ARCH_CONTEXT_CHAR_BUDGET.
 * Deterministic and stable.
 */
export function selectArchitectureContext(
  files: SourceFile[],
  manifest: ParsedProjectManifest,
  options?: ArchitectureContextOptions
): SelectedArchitectureContext {
  const maxFiles = options?.maxFiles ?? config.ARCH_CONTEXT_MAX_FILES ?? 25;
  const maxCharsPerFile = options?.maxCharsPerFile ?? 4000;
  const totalCharBudget = options?.totalCharBudget ?? config.ARCH_CONTEXT_CHAR_BUDGET ?? 60000;

  const fileMap = new Map<string, SourceFile>();
  for (const f of files) {
    fileMap.set(normalize(f.path), f);
  }

  // 1. Calculate in-degree for relative imports
  const inDegreeMap = new Map<string, number>();
  const importRegex = /(?:import\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;

  for (const f of files) {
    let match;
    const content = f.content;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (importPath && importPath.startsWith('.')) {
        const target = resolveImportPath(f.path, importPath, fileMap);
        if (target) {
          const normTarget = normalize(target.path);
          inDegreeMap.set(normTarget, (inDegreeMap.get(normTarget) || 0) + 1);
        }
      }
    }
  }

  // Classify priority tier for each file (1 to 4)
  const entryPointPaths = new Set(
    (manifest.entryPoints || []).map((e: any) => normalize(typeof e === 'string' ? e : e?.path || ''))
  );
  const archKeywords = /(^|\/)(app|server|router|routes|controllers?|middleware|models?|services?|db|database|auth)(\/|\.|$)/i;

  const scoredFiles = files.map((file) => {
    const norm = normalize(file.path);
    const base = path.basename(norm);
    let tier = 4;

    // Tier 1: Manifests and README
    if (
      base === 'package.json' ||
      base === 'pyproject.toml' ||
      base === 'requirements.txt' ||
      base === 'go.mod' ||
      base === 'cargo.toml' ||
      base === 'pom.xml' ||
      base === 'dockerfile' ||
      base.startsWith('readme')
    ) {
      tier = 1;
    }
    // Tier 2: Entry points from manifest
    else if (entryPointPaths.has(norm)) {
      tier = 2;
    }
    // Tier 3: Core architectural modules
    else if (archKeywords.test(norm)) {
      tier = 3;
    }

    const inDegree = inDegreeMap.get(norm) || 0;
    const depth = (norm.match(/\//g) || []).length;

    return {
      file,
      tier,
      inDegree,
      depth,
    };
  });

  // Sort: Tier ascending -> inDegree descending -> shallower depth -> alphabetical
  scoredFiles.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.inDegree !== b.inDegree) return b.inDegree - a.inDegree;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.file.path.localeCompare(b.file.path);
  });

  // Collect within maxFiles and totalCharBudget
  const selectedFiles: SourceFile[] = [];
  let accumulatedChars = 0;

  for (const item of scoredFiles) {
    if (selectedFiles.length >= maxFiles) break;

    const originalContent = item.file.content;
    const truncatedContent =
      originalContent.length > maxCharsPerFile
        ? originalContent.slice(0, maxCharsPerFile) + '\n... [truncated]'
        : originalContent;

    const blockChars = truncatedContent.length;
    if (accumulatedChars + blockChars > totalCharBudget && selectedFiles.length > 0) {
      // Exceeds total character budget
      continue;
    }

    selectedFiles.push({
      ...item.file,
      content: truncatedContent,
    });
    accumulatedChars += blockChars;
  }

  // Format all indexed file paths (up to 800 paths)
  const allIndexedPaths = files.map((f) => f.path);
  let pathsListFormatted: string;
  if (allIndexedPaths.length <= 800) {
    pathsListFormatted = allIndexedPaths.join('\n');
  } else {
    const kept = allIndexedPaths.slice(0, 800);
    const remaining = allIndexedPaths.length - 800;
    pathsListFormatted = `${kept.join('\n')}\n... and ${remaining} more files`;
  }

  return {
    selectedFiles,
    allIndexedPaths,
    pathsListFormatted,
  };
}
