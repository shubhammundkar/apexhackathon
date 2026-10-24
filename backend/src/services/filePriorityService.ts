import path from 'path';

export type FilePriorityGroup =
  | 'manifests'
  | 'entrypoints'
  | 'source'
  | 'config'
  | 'tests'
  | 'docs'
  | 'examples_generated';

export interface RankedFileNode {
  path: string;
  size: number;
  group: FilePriorityGroup;
  priority: number;
}

const MANIFEST_FILENAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'dockerfile',
]);

const CONFIG_FILENAMES = new Set([
  'tsconfig.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
]);

/**
 * Categorize a file path into its priority group (1 = highest, 7 = lowest)
 */
export function categorizeFile(filePath: string): { group: FilePriorityGroup; priority: number } {
  const normPath = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normPath);
  const ext = path.extname(baseName);
  const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName;

  // 1. Manifests and Top Docs (package.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml, pom.xml, Dockerfile, README)
  if (
    MANIFEST_FILENAMES.has(baseName) ||
    baseName === 'readme' ||
    baseName.startsWith('readme.') ||
    baseName.startsWith('readme_')
  ) {
    return { group: 'manifests', priority: 1 };
  }

  // 7. Examples, fixtures, snapshots, generated, vendored and minified files
  if (
    normPath.includes('/dist/') ||
    normPath.startsWith('dist/') ||
    normPath.includes('/build/') ||
    normPath.startsWith('build/') ||
    normPath.includes('/examples/') ||
    normPath.startsWith('examples/') ||
    normPath.includes('/example/') ||
    normPath.startsWith('example/') ||
    normPath.includes('/fixtures/') ||
    normPath.startsWith('fixtures/') ||
    normPath.includes('/fixture/') ||
    normPath.startsWith('fixture/') ||
    normPath.includes('/snapshots/') ||
    normPath.startsWith('snapshots/') ||
    normPath.includes('/__snapshots__/') ||
    normPath.includes('/vendor/') ||
    normPath.startsWith('vendor/') ||
    baseName.includes('.min.') ||
    baseName.includes('.generated.')
  ) {
    return { group: 'examples_generated', priority: 7 };
  }

  // 5. Tests
  if (
    normPath.includes('/test/') ||
    normPath.startsWith('test/') ||
    normPath.includes('/tests/') ||
    normPath.startsWith('tests/') ||
    normPath.includes('/__tests__/') ||
    normPath.includes('/spec/') ||
    normPath.startsWith('spec/') ||
    normPath.includes('/specs/') ||
    normPath.startsWith('specs/') ||
    baseName.includes('.test.') ||
    baseName.includes('.spec.') ||
    baseName.endsWith('_test.go') ||
    baseName.endsWith('_test.py') ||
    baseName.startsWith('test_')
  ) {
    return { group: 'tests', priority: 5 };
  }

  // 6. Docs (markdown, rst, text documentation)
  if (
    normPath.includes('/docs/') ||
    normPath.startsWith('docs/') ||
    normPath.includes('/documentation/') ||
    normPath.startsWith('documentation/') ||
    ['.md', '.rst', '.adoc'].includes(ext)
  ) {
    return { group: 'docs', priority: 6 };
  }

  // 2. Entry points (index, main, app, server, cli, manage.py, __init__, bin/*)
  if (
    normPath.startsWith('bin/') ||
    normPath.includes('/bin/') ||
    ['index', 'main', 'app', 'server', 'cli', 'manage'].includes(nameWithoutExt) ||
    baseName === '__init__.py' ||
    baseName === '__main__.py'
  ) {
    return { group: 'entrypoints', priority: 2 };
  }

  // 4. Config
  if (
    CONFIG_FILENAMES.has(baseName) ||
    baseName.startsWith('.env') ||
    baseName.includes('.config.') ||
    baseName.endsWith('.config.js') ||
    baseName.endsWith('.config.ts') ||
    baseName.endsWith('.config.json') ||
    baseName.endsWith('.config.mjs') ||
    baseName.endsWith('.config.cjs') ||
    ['.ini', '.toml'].includes(ext) ||
    (ext === '.json' && (baseName.includes('rc') || baseName.includes('config'))) ||
    (ext === '.yaml' && (baseName.includes('docker') || baseName.includes('compose') || baseName.includes('ci'))) ||
    (ext === '.yml' && (baseName.includes('docker') || baseName.includes('compose') || baseName.includes('ci')))
  ) {
    return { group: 'config', priority: 4 };
  }

  // 3. Source directories and code
  return { group: 'source', priority: 3 };
}

/**
 * Rank files deterministically for ingestion
 * Priority order:
 * 1. manifests and top docs
 * 2. entry points
 * 3. source directories & code
 * 4. config
 * 5. tests
 * 6. docs
 * 7. examples, fixtures, snapshots, generated, vendored, minified
 *
 * Within a group: prefer shallower paths (fewer slashes), then smaller files, then alphabetical.
 */
export function rankFilesForIngestion<T extends { path: string; size: number }>(nodes: T[]): Array<T & RankedFileNode> {
  const annotated = nodes.map((node) => {
    const { group, priority } = categorizeFile(node.path);
    const depth = (node.path.replace(/\\/g, '/').match(/\//g) || []).length;
    return {
      ...node,
      group,
      priority,
      _depth: depth,
    };
  });

  annotated.sort((a, b) => {
    // 1. Priority group
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // 2. Shallower paths first (fewer slashes)
    if (a._depth !== b._depth) {
      return a._depth - b._depth;
    }

    // 3. Smaller files first
    if (a.size !== b.size) {
      return a.size - b.size;
    }

    // 4. Alphabetical tiebreak
    return a.path.localeCompare(b.path);
  });

  return annotated.map(({ _depth, ...rest }) => rest as T & RankedFileNode);
}
