import fs from 'fs';
import path from 'path';
import { IndexingService } from '../src/services/indexingService';
import { rankFilesForIngestion } from '../src/services/filePriorityService';
import { selectArchitectureContext } from '../src/services/contextSelectionService';
import { GitHubService } from '../src/services/githubService';
import { shouldIncludeFile, detectLanguage } from '../src/services/fileFilterService';
import { SourceFile, ManifestData } from '@codebase-explainer/shared';
import { config } from '../src/config';

const rootDir = path.resolve(__dirname, '../..');

function loadLocalCorpus(): SourceFile[] {
  const dirs = ['backend/src', 'shared/src', 'frontend/src'];
  const corpus: SourceFile[] = [];

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git'].includes(ent.name)) {
          scan(full);
        }
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md'].includes(ext) && !ent.name.endsWith('.d.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          const rel = path.relative(rootDir, full).replace(/\\/g, '/');
          corpus.push({
            path: rel,
            content,
            size: Buffer.byteLength(content, 'utf8'),
            language: detectLanguage(rel),
            lineCount: content.split('\n').length,
          });
        }
      }
    }
  }

  for (const d of dirs) scan(path.join(rootDir, d));
  return corpus;
}

async function runManualVerification() {
  console.log('========================================================================');
  console.log('MANUAL VERIFICATION (a): NARROW, NORMAL, BROAD Retrieval & Stats');
  console.log('========================================================================');

  const corpus = loadLocalCorpus();
  console.log(`Indexed local repository with ${corpus.length} files.`);
  const indexer = new IndexingService(100, 20, { mode: 'syntax' });
  indexer.indexFiles(corpus);

  const testQueries = [
    { query: 'where is verifyToken defined in authService.ts?', expectedKind: 'NARROW' },
    { query: 'what are the token signing parameters and secret key?', expectedKind: 'NORMAL' },
    { query: 'how does a repository get analyzed end to end architecture overview lifecycle flow?', expectedKind: 'BROAD' },
  ];

  for (const { query, expectedKind } of testQueries) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`Question: "${query}"`);
    const { citations, stats } = indexer.searchWithStats(query);

    // UI line format from QAPanel: "Used X of Y matches · ~Z tokens"
    const uiLine = `Used ${stats.hitsUsed} of ${stats.totalMatches} matches · ~${stats.tokensUsed.toLocaleString()} tokens`;
    console.log(`Question Kind: ${stats.questionKind} (expected: ${expectedKind})`);
    console.log(`UI Display Line: "${uiLine}"`);
    console.log(`Retrieval Stats:`, JSON.stringify(stats, null, 2));
    console.log(`Evidence Blocks Returned (${citations.length}):`);
    citations.forEach((c, idx) => {
      console.log(`  [Block ${idx + 1}] ${c.filePath}:${c.startLine}-${c.endLine} (kind: ${c.kind}, role: ${c.role}, score: ${c.score}, symbol: ${c.symbolName || 'none'})`);
    });
  }

  let eligibleNodes: Array<{ path: string; size: number }> = [];
  let sampleFiles: SourceFile[] = [];

  try {
    const githubService = new GitHubService(process.env.GITHUB_TOKEN || config.GITHUB_TOKEN);
    const owner = 'expressjs';
    const repo = 'express';
    console.log(`Fetching tree for ${owner}/${repo}...`);

    const meta = await githubService.fetchMetadata(owner, repo);
    const treeRes = await githubService.fetchTree(owner, repo, meta.defaultBranch);
    console.log(`Total items in tree: ${treeRes.tree.length}`);

    eligibleNodes = treeRes.tree
      .filter((n) => n.type === 'blob')
      .filter((n) => shouldIncludeFile(n.path, n.size || 0, config.MAX_FILE_SIZE_BYTES).shouldInclude)
      .map((n) => ({ path: n.path, size: n.size || 0 }));
    console.log(`Eligible files after filtering: ${eligibleNodes.length}`);
  } catch (netErr: any) {
    console.warn(`[Network/GitHub Note] GitHub API fetch failed (${netErr.message}). Using local 76-file codebase tree for demonstration:`);
    eligibleNodes = corpus.map((c) => ({ path: c.path, size: c.size }));
    sampleFiles = corpus;
  }

  // Rank with filePriorityService
  const rankedNodes = rankFilesForIngestion(eligibleNodes);
  const cap = Math.min(60, eligibleNodes.length - 10);
  const filesToFetch = rankedNodes.slice(0, cap);
  const skippedNodes = rankedNodes.slice(cap);

  const skippedByGroup: Record<string, number> = {};
  for (const sn of skippedNodes) {
    skippedByGroup[sn.group] = (skippedByGroup[sn.group] || 0) + 1;
  }
  const skippedDescriptions = Object.entries(skippedByGroup)
    .map(([group, count]) => `${count} ${group.replace('_', '/')}`)
    .join(', ');

  const warning = `Indexed ${filesToFetch.length} of ${eligibleNodes.length} eligible files. Skipped: ${skippedDescriptions}.`;
  console.log(`\nGenerated Ingestion Warning:\n"${warning}"`);

  // Verify group distribution among kept vs skipped
  const keptGroups: Record<string, number> = {};
  for (const fn of filesToFetch) {
    keptGroups[fn.group] = (keptGroups[fn.group] || 0) + 1;
  }
  console.log(`\nKept files by priority group:`, keptGroups);
  console.log(`Skipped files by priority group:`, skippedByGroup);

  console.log('\n========================================================================');
  console.log('MANUAL VERIFICATION (c): selectArchitectureContext for Repo');
  console.log('========================================================================');

  if (sampleFiles.length === 0) {
    const githubService = new GitHubService(process.env.GITHUB_TOKEN || config.GITHUB_TOKEN);
    const filesToDownload = filesToFetch.slice(0, 30);
    console.log(`Downloading ${filesToDownload.length} files to test selectArchitectureContext...`);
    for (const fn of filesToDownload) {
      try {
        const content = await githubService.fetchRawFile('expressjs', 'express', 'master', fn.path);
        sampleFiles.push({
          path: fn.path,
          content,
          size: Buffer.byteLength(content, 'utf8'),
          language: detectLanguage(fn.path),
          lineCount: content.split('\n').length,
        });
      } catch (err: any) {
        console.warn(`Could not download ${fn.path}: ${err.message}`);
      }
    }
  }

  if (sampleFiles.length === 0) {
    sampleFiles = corpus;
  }

  const manifest: ManifestData = {
    packageName: 'codebase-explainer',
    version: '1.0.0',
    description: 'AI Codebase Explainer',
    dependencies: {},
    devDependencies: {},
    entryPoints: ['backend/src/index.ts', 'backend/src/server.ts'],
  };

  const archResult = selectArchitectureContext(sampleFiles, manifest, {
    maxFiles: 25,
    maxCharsPerFile: 4000,
    totalCharBudget: 60000,
  });

  console.log(`\nArchitecture Context Selected ${archResult.selectedFiles.length} files (${archResult.totalChars} chars):`);
  archResult.selectedFiles.forEach((f, idx) => {
    console.log(`  ${idx + 1}. ${f.path} (${f.content.length} chars)`);
  });
  console.log(`\nFile paths summary sent to model (${archResult.allIndexedPaths.length} paths):`);
  console.log(archResult.pathsListFormatted.slice(0, 300) + '...');
}

runManualVerification().catch((err) => {
  console.error('Manual verification failed:', err);
  process.exit(1);
});
