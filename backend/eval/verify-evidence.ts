import fs from 'fs';
import path from 'path';
import { IndexingService } from '../src/services/indexingService';
import { formatEvidence } from '../src/services/geminiService';
import { SourceFile } from '@codebase-explainer/shared';
import { detectLanguage } from '../src/services/fileFilterService';

const rootDir = path.resolve(__dirname, '../..');

function loadCorpus(): SourceFile[] {
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

const corpus = loadCorpus();
console.log(`Loaded ${corpus.length} files into corpus.`);

const indexer = new IndexingService(100, 20);
indexer.indexFiles(corpus);

const testQueries = [
  'where are GitHub URLs validated?',
  'how are secrets redacted?',
  'how does a Q&A request get rejected as unrelated?',
  'where is path traversal prevented for ingested files?',
  'how are authentication JWT tokens verified?',
];

for (let i = 0; i < testQueries.length; i++) {
  const q = testQueries[i];
  const citations = indexer.search(q, 4);

  console.log(`\n======================================================`);
  console.log(`QUERY #${i + 1}: "${q}"`);
  console.log(`======================================================`);
  console.log(`Returned ${citations.length} citation blocks:`);

  const evidenceBlock = formatEvidence(citations);
  console.log(evidenceBlock);

  // Exact Line Diff Verification
  for (const c of citations) {
    const fullFilePath = path.join(rootDir, c.filePath);
    const diskContent = fs.readFileSync(fullFilePath, 'utf8');
    const diskLines = diskContent.split('\n');
    const expectedSlice = diskLines.slice(c.startLine - 1, c.endLine).join('\n');

    if (expectedSlice === c.snippet) {
      console.log(`[PASS] Exact verbatim file line match: ${c.filePath}:${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1} lines)`);
    } else {
      console.error(`[FAIL] Mismatch for ${c.filePath}:${c.startLine}-${c.endLine}`);
      process.exit(1);
    }
  }
}

console.log('\nAll 5 queries produced 100% verified exact file line citations!');
