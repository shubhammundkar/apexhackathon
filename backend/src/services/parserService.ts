import { TechStackItem, SourceFile, FileAnalysis } from '@codebase-explainer/shared';
import { config } from '../config.js';

export function filterKeyFunctionsForPrompt(
  keyFunctions: { name: string; line: number; description: string }[],
  exports: string[] = [],
  maxFunctions: number = config.AI_MAX_FUNCTIONS_PER_FILE ?? 20
): { name: string; line: number; description: string }[] {
  const exportSet = new Set(exports);
  const sorted = [...keyFunctions].sort((a, b) => {
    const aExp = exportSet.has(a.name) ? 1 : 0;
    const bExp = exportSet.has(b.name) ? 1 : 0;
    return bExp - aExp;
  });
  return sorted.slice(0, maxFunctions);
}

export interface ParsedProjectManifest {
  stack: TechStackItem[];
  packageManager?: string;
  hasLockfile: boolean;
  entryPoints: { path: string; description: string; type: 'frontend' | 'backend' | 'cli' | 'library' | 'worker' }[];
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export class ParserService {
  /**
   * Detects project dependencies, frameworks, entrypoints, and package managers
   */
  public parseProject(files: SourceFile[], allFilePaths: string[]): ParsedProjectManifest {
    const stackMap = new Map<string, TechStackItem>();
    const addStackItem = (item: TechStackItem) => {
      const key = item.name.toLowerCase();
      const existing = stackMap.get(key);
      if (!existing) {
        stackMap.set(key, item);
      } else {
        if (!existing.version && item.version) {
          existing.version = item.version;
        }
        if ((!existing.evidencePath || existing.evidencePath.includes('extension')) && item.evidencePath) {
          existing.evidencePath = item.evidencePath;
        }
      }
    };

    const entryPoints: { path: string; description: string; type: 'frontend' | 'backend' | 'cli' | 'library' | 'worker' }[] = [];
    let packageManager: string | undefined;
    let hasLockfile = false;
    let scripts: Record<string, string> = {};
    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};

    const pathSet = new Set(allFilePaths.map((p) => p.toLowerCase().replace(/\\/g, '/')));

    // Check lockfiles anywhere in repo
    if (Array.from(pathSet).some((p) => p.endsWith('package-lock.json'))) {
      packageManager = 'npm';
      hasLockfile = true;
    } else if (Array.from(pathSet).some((p) => p.endsWith('yarn.lock'))) {
      packageManager = 'yarn';
      hasLockfile = true;
    } else if (Array.from(pathSet).some((p) => p.endsWith('pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
      hasLockfile = true;
    } else if (Array.from(pathSet).some((p) => p.endsWith('bun.lockb'))) {
      packageManager = 'bun';
      hasLockfile = true;
    } else if (Array.from(pathSet).some((p) => p.endsWith('cargo.lock'))) {
      packageManager = 'cargo';
      hasLockfile = true;
    } else if (Array.from(pathSet).some((p) => p.endsWith('poetry.lock') || p.endsWith('pipfile.lock'))) {
      packageManager = 'poetry';
      hasLockfile = true;
    }

    // Parse all package.json files (root and subdirectories like frontend/package.json or backend/package.json)
    const packageJsonFiles = files.filter((f) => f.path.toLowerCase().replace(/\\/g, '/').endsWith('package.json'));
    for (const packageJsonFile of packageJsonFiles) {
      try {
        const pkg = JSON.parse(packageJsonFile.content);
        if (!packageManager && pkg.packageManager) {
          packageManager = pkg.packageManager.split('@')[0];
        } else if (!packageManager) {
          packageManager = 'npm';
        }

        scripts = { ...scripts, ...(pkg.scripts || {}) };
        dependencies = { ...dependencies, ...(pkg.dependencies || {}) };
        devDependencies = { ...devDependencies, ...(pkg.devDependencies || {}) };

        addStackItem({ name: 'Node.js', category: 'runtime', confidence: 'detected', evidencePath: packageJsonFile.path });

        // Detect frameworks & libraries from package.json
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        if (allDeps['react']) {
          addStackItem({ name: 'React', category: 'framework', version: allDeps['react'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['next']) {
          addStackItem({ name: 'Next.js', category: 'framework', version: allDeps['next'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['vue']) {
          addStackItem({ name: 'Vue.js', category: 'framework', version: allDeps['vue'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['express']) {
          addStackItem({ name: 'Express.js', category: 'framework', version: allDeps['express'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['fastify']) {
          addStackItem({ name: 'Fastify', category: 'framework', version: allDeps['fastify'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['@nestjs/core']) {
          addStackItem({ name: 'NestJS', category: 'framework', version: allDeps['@nestjs/core'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['tailwindcss']) {
          addStackItem({ name: 'Tailwind CSS', category: 'tool', version: allDeps['tailwindcss'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['typescript']) {
          addStackItem({ name: 'TypeScript', category: 'language', version: allDeps['typescript'], confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['prisma'] || allDeps['@prisma/client']) {
          addStackItem({ name: 'Prisma ORM', category: 'database', confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['mongoose'] || allDeps['mongodb']) {
          addStackItem({ name: 'MongoDB', category: 'database', confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['pg'] || allDeps['typeorm']) {
          addStackItem({ name: 'PostgreSQL / SQL', category: 'database', confidence: 'detected', evidencePath: packageJsonFile.path });
        }
        if (allDeps['vitest'] || allDeps['jest']) {
          addStackItem({ name: allDeps['vitest'] ? 'Vitest' : 'Jest', category: 'dev', confidence: 'detected', evidencePath: packageJsonFile.path });
        }
      } catch {
        // Ignored if invalid JSON
      }
    }

    // Python projects: parse requirements.txt or pyproject.toml in root or subdirectories
    const pythonManifests = files.filter((f) => {
      const p = f.path.toLowerCase().replace(/\\/g, '/');
      return p.endsWith('requirements.txt') || p.endsWith('pyproject.toml') || p.endsWith('pipfile') || p.endsWith('setup.py');
    });

    for (const reqFile of pythonManifests) {
      addStackItem({ name: 'Python', category: 'language', confidence: 'detected', evidencePath: reqFile.path });
      const lines = reqFile.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith('django')) addStackItem({ name: 'Django', category: 'framework', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('flask')) addStackItem({ name: 'Flask', category: 'framework', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('fastapi')) addStackItem({ name: 'FastAPI', category: 'framework', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('uvicorn')) addStackItem({ name: 'Uvicorn', category: 'runtime', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('torch') || trimmed.startsWith('tensorflow')) addStackItem({ name: 'PyTorch/TensorFlow', category: 'library', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('pydantic')) addStackItem({ name: 'Pydantic', category: 'library', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('sqlalchemy')) addStackItem({ name: 'SQLAlchemy', category: 'library', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('sqlite')) addStackItem({ name: 'SQLite', category: 'database', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('numpy')) addStackItem({ name: 'NumPy', category: 'library', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('pandas')) addStackItem({ name: 'Pandas', category: 'library', confidence: 'detected', evidencePath: reqFile.path });
        if (trimmed.startsWith('pytest')) addStackItem({ name: 'PyTest', category: 'dev', confidence: 'detected', evidencePath: reqFile.path });
      }
    }

    // Cargo / Rust in any directory
    const cargoFiles = files.filter((f) => f.path.toLowerCase().replace(/\\/g, '/').endsWith('cargo.toml'));
    for (const cargoFile of cargoFiles) {
      addStackItem({ name: 'Rust', category: 'language', confidence: 'detected', evidencePath: cargoFile.path });
      if (!packageManager) packageManager = 'cargo';
      if (cargoFile.content.includes('axum')) addStackItem({ name: 'Axum', category: 'framework', confidence: 'detected', evidencePath: cargoFile.path });
      if (cargoFile.content.includes('actix-web')) addStackItem({ name: 'Actix Web', category: 'framework', confidence: 'detected', evidencePath: cargoFile.path });
      if (cargoFile.content.includes('tokio')) addStackItem({ name: 'Tokio Async', category: 'library', confidence: 'detected', evidencePath: cargoFile.path });
    }

    // Go in any directory
    const goModFiles = files.filter((f) => f.path.toLowerCase().replace(/\\/g, '/').endsWith('go.mod'));
    for (const goMod of goModFiles) {
      addStackItem({ name: 'Go', category: 'language', confidence: 'detected', evidencePath: goMod.path });
      if (!packageManager) packageManager = 'go modules';
      if (goMod.content.includes('github.com/gin-gonic/gin')) addStackItem({ name: 'Gin', category: 'framework', confidence: 'detected', evidencePath: goMod.path });
      if (goMod.content.includes('github.com/gofiber/fiber')) addStackItem({ name: 'Fiber', category: 'framework', confidence: 'detected', evidencePath: goMod.path });
    }

    // Comprehensive Language & Framework Detection from Real Repository Files
    const langEvidence = new Map<string, string>();
    for (const file of files) {
      const normPath = file.path.toLowerCase().replace(/\\/g, '/');
      const ext = normPath.split('.').pop() || '';

      // Languages
      if (ext === 'py' && !langEvidence.has('Python')) langEvidence.set('Python', file.path);
      if ((ext === 'js' || ext === 'mjs' || ext === 'cjs') && !langEvidence.has('JavaScript')) langEvidence.set('JavaScript', file.path);
      if ((ext === 'ts' || ext === 'mts' || ext === 'cts') && !langEvidence.has('TypeScript')) langEvidence.set('TypeScript', file.path);
      if ((ext === 'html' || ext === 'htm') && !langEvidence.has('HTML5')) langEvidence.set('HTML5', file.path);
      if ((ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') && !langEvidence.has('CSS3')) langEvidence.set('CSS3', file.path);
      if ((ext === 'sql' || ext === 'sqlite' || ext === 'sqlite3' || ext === 'db') && !langEvidence.has('SQLite / SQL')) langEvidence.set('SQLite / SQL', file.path);
      if ((ext === 'sh' || ext === 'bash') && !langEvidence.has('Shell Script')) langEvidence.set('Shell Script', file.path);
      if (ext === 'rs' && !langEvidence.has('Rust')) langEvidence.set('Rust', file.path);
      if (ext === 'go' && !langEvidence.has('Go')) langEvidence.set('Go', file.path);
      if (ext === 'java' && !langEvidence.has('Java')) langEvidence.set('Java', file.path);

      // Deep inspection of code content for frameworks and libraries
      if (ext === 'py') {
        const content = file.content;
        if (/from\s+fastapi|import\s+fastapi/i.test(content)) {
          addStackItem({ name: 'FastAPI', category: 'framework', confidence: 'detected', evidencePath: file.path });
        }
        if (/import\s+uvicorn|uvicorn\.run/i.test(content)) {
          addStackItem({ name: 'Uvicorn', category: 'runtime', confidence: 'detected', evidencePath: file.path });
        }
        if (/from\s+flask|import\s+flask/i.test(content)) {
          addStackItem({ name: 'Flask', category: 'framework', confidence: 'detected', evidencePath: file.path });
        }
        if (/from\s+django|import\s+django/i.test(content)) {
          addStackItem({ name: 'Django', category: 'framework', confidence: 'detected', evidencePath: file.path });
        }
        if (/sqlite3(?:\.connect|:)/i.test(content) || normPath.includes('database.py') && content.includes('sqlite')) {
          addStackItem({ name: 'SQLite', category: 'database', confidence: 'detected', evidencePath: file.path });
        }
        if (/from\s+pydantic|import\s+pydantic/i.test(content)) {
          addStackItem({ name: 'Pydantic', category: 'library', confidence: 'detected', evidencePath: file.path });
        }
        if (/from\s+sqlalchemy|import\s+sqlalchemy/i.test(content)) {
          addStackItem({ name: 'SQLAlchemy', category: 'library', confidence: 'detected', evidencePath: file.path });
        }
      }

      if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') {
        const content = file.content;
        if (/from\s+['"]react['"]|require\(['"]react['"]\)/i.test(content)) {
          addStackItem({ name: 'React', category: 'framework', confidence: 'detected', evidencePath: file.path });
        }
        if (/from\s+['"]express['"]|require\(['"]express['"]\)/i.test(content)) {
          addStackItem({ name: 'Express.js', category: 'framework', confidence: 'detected', evidencePath: file.path });
        }
      }
    }

    // Add detected languages to stack with grounded evidence paths
    for (const [lang, evPath] of langEvidence.entries()) {
      addStackItem({
        name: lang,
        category: lang.includes('SQL') ? 'database' : lang.includes('Shell') ? 'tool' : 'language',
        confidence: 'detected',
        evidencePath: evPath,
      });
    }

    // Docker detection anywhere in repo
    const hasDocker = Array.from(pathSet).some((p) => p.endsWith('dockerfile') || p.endsWith('docker-compose.yml') || p.endsWith('compose.yaml'));
    if (hasDocker) {
      addStackItem({ name: 'Docker', category: 'tool', confidence: 'detected', evidencePath: 'Dockerfile / Compose' });
    }

    // Detect Entrypoints supporting nested folder structures (e.g. backend/main.py, frontend/index.html)
    const candidateEntrypoints = [
      { pattern: /(?:^|\/)(?:backend\/|src\/|server\/|app\/|api\/)?(index|main|server|app|run)\.(ts|js|mjs)$/i, desc: 'Application main entry point', type: 'backend' as const },
      { pattern: /(?:^|\/)(?:frontend\/|client\/|web\/|src\/)?(main|index|App)\.(tsx|jsx)$/i, desc: 'Frontend application root component / entry', type: 'frontend' as const },
      { pattern: /(?:^|\/)(?:app|src\/app)\/page\.(tsx|jsx|js)$/i, desc: 'Next.js root page entry point', type: 'frontend' as const },
      { pattern: /(?:^|\/)(?:frontend\/|client\/|web\/|public\/|static\/)?(index|main)\.html$/i, desc: 'Frontend HTML document entry point', type: 'frontend' as const },
      { pattern: /(?:^|\/)(?:backend\/|src\/|server\/|app\/|api\/)?(main|app|manage|run|server|wsgi|asgi)\.py$/i, desc: 'Python application script or entry point', type: 'backend' as const },
      { pattern: /(?:^|\/)(?:cmd\/.*\/)?main\.go$/i, desc: 'Go binary entry point', type: 'backend' as const },
      { pattern: /(?:^|\/)(?:src\/)?main\.rs$/i, desc: 'Rust binary root entry point', type: 'backend' as const },
      { pattern: /(?:^|\/)(?:src\/)?lib\.rs$/i, desc: 'Rust library crate root', type: 'library' as const },
      { pattern: /(?:^|\/)bin\/[a-zA-Z0-9_-]+$/i, desc: 'CLI executable script', type: 'cli' as const },
    ];

    const matchedEntryPaths = new Set<string>();
    for (const file of files) {
      const normPath = file.path.replace(/\\/g, '/');
      for (const candidate of candidateEntrypoints) {
        if (candidate.pattern.test(normPath)) {
          entryPoints.push({
            path: file.path,
            description: candidate.desc,
            type: candidate.type,
          });
          matchedEntryPaths.add(normPath);
          break;
        }
      }
    }

    // Content-based entry point fallback if none found
    if (entryPoints.length === 0) {
      for (const file of files) {
        const normPath = file.path.replace(/\\/g, '/');
        if (matchedEntryPaths.has(normPath)) continue;
        if (normPath.endsWith('.py') && (file.content.includes("if __name__ == '__main__':") || file.content.includes('FastAPI(') || file.content.includes('Flask('))) {
          entryPoints.push({
            path: file.path,
            description: 'Python application execution entrypoint',
            type: 'backend',
          });
          matchedEntryPaths.add(normPath);
          break;
        }
        if (normPath.endsWith('.html')) {
          entryPoints.push({
            path: file.path,
            description: 'Web document user entrypoint',
            type: 'frontend',
          });
          matchedEntryPaths.add(normPath);
          break;
        }
      }
    }

    return {
      stack: Array.from(stackMap.values()),
      packageManager,
      hasLockfile,
      entryPoints,
      scripts,
      dependencies,
      devDependencies,
    };
  }

  /**
   * Inspects a single file to extract key imports, exports, and functions
   */
  public analyzeFileContent(file: SourceFile): FileAnalysis {
    const lines = file.content.split('\n');
    const exports: string[] = [];
    const imports: string[] = [];
    const keyFunctions: { name: string; line: number; description: string }[] = [];
    const connectedFiles: string[] = [];

    // Extract imports and functions via fast regex scanning
    const importRegex = /(?:import\s+(?:(?:(?:\w+|\{[^}]+\})\s+from\s+)?['"]([^'"]+)['"])|(?:const|var|let)\s+(?:(?:\w+|\{[^}]+\})\s*=\s*require\(['"]([^'"]+)['"]\)))/g;
    const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+([a-zA-Z0-9_$]+)/g;
    const functionRegex = /(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|def\s+([a-zA-Z0-9_$]+)|func\s+([a-zA-Z0-9_$]+)|fn\s+([a-zA-Z0-9_$]+))/g;

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;

      // Imports
      let importMatch;
      while ((importMatch = importRegex.exec(lineText)) !== null) {
        const modulePath = importMatch[1] || importMatch[2];
        if (modulePath && !imports.includes(modulePath)) {
          imports.push(modulePath);
          if (modulePath.startsWith('.')) {
            connectedFiles.push(modulePath);
          }
        }
      }

      // Exports
      let exportMatch;
      while ((exportMatch = exportRegex.exec(lineText)) !== null) {
        const symbol = exportMatch[1];
        if (symbol && !exports.includes(symbol)) {
          exports.push(symbol);
        }
      }

      // Functions (cap at configurable MAX_KEY_FUNCTIONS_PER_FILE, default 40)
      const maxFns = config.MAX_KEY_FUNCTIONS_PER_FILE ?? 40;
      if (keyFunctions.length < maxFns) {
        let fnMatch;
        while ((fnMatch = functionRegex.exec(lineText)) !== null) {
          if (keyFunctions.length >= maxFns) break;
          const fnName = fnMatch[1] || fnMatch[2] || fnMatch[3] || fnMatch[4] || fnMatch[5];
          if (fnName && !['if', 'for', 'while', 'switch', 'catch'].includes(fnName)) {
            keyFunctions.push({
              name: fnName,
              line: lineNum,
              description: `Defined at line ${lineNum}`,
            });
          }
        }
      }
    });

    const isCritical = file.path.toLowerCase().includes('main') ||
      file.path.toLowerCase().includes('app') ||
      file.path.toLowerCase().includes('index') ||
      file.path.toLowerCase().includes('server');

    // Extract first meaningful comment or docstring from top 10 lines
    let topComment = '';
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i].trim();
      if (line.startsWith('#') && line.length > 3) {
        topComment = line.replace(/^[#\s*=]+/, '').trim();
        break;
      }
      if ((line.startsWith('//') || line.startsWith('/*')) && line.length > 4) {
        topComment = line.replace(/^[/*\s]+/, '').replace(/\*\/$/, '').trim();
        break;
      }
      if (line.startsWith('"""') || line.startsWith("'''")) {
        topComment = line.replace(/^["'\s]+/, '').replace(/["'\s]+$/, '').trim();
        if (topComment) break;
      }
    }

    // Determine smart 1-line purpose
    const lowerPath = file.path.toLowerCase();
    let oneLinePurpose = '';

    if (topComment && topComment.length > 10 && topComment.length < 120 && !topComment.includes('<') && !topComment.includes('{')) {
      oneLinePurpose = topComment;
    } else if (lowerPath.endsWith('readme.md')) {
      oneLinePurpose = 'Primary project documentation, setup instructions, and overview';
    } else if (lowerPath.endsWith('architecture.md')) {
      oneLinePurpose = 'Architecture specification, design decisions, and system blueprints';
    } else if (lowerPath.endsWith('package.json') || lowerPath.endsWith('requirements.txt') || lowerPath.endsWith('cargo.toml') || lowerPath.endsWith('go.mod')) {
      oneLinePurpose = 'Project manifest defining dependencies, scripts, and runtime requirements';
    } else if (lowerPath.endsWith('dockerfile') || lowerPath.includes('docker-compose')) {
      oneLinePurpose = 'Container specification and deployment configuration';
    } else if (lowerPath.includes('service')) {
      oneLinePurpose = `Core business logic service managing ${file.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'domain'} operations`;
    } else if (lowerPath.includes('route') || lowerPath.includes('controller') || lowerPath.includes('api')) {
      oneLinePurpose = 'API route definitions and HTTP request handler endpoints';
    } else if (lowerPath.includes('model') || lowerPath.includes('schema') || lowerPath.includes('entity')) {
      oneLinePurpose = 'Data model definitions, schema validation, and database entity structures';
    } else if (lowerPath.includes('test')) {
      oneLinePurpose = 'Automated unit or integration test suite verifying system behavior';
    } else if (lowerPath.includes('component') || lowerPath.includes('view') || lowerPath.endsWith('.tsx') || lowerPath.endsWith('.jsx')) {
      oneLinePurpose = 'User interface component rendering views and managing user interactions';
    } else if (lowerPath.includes('util') || lowerPath.includes('helper')) {
      oneLinePurpose = 'Shared utility helper functions and reusable routine library';
    } else if (lowerPath.includes('script')) {
      oneLinePurpose = `Automation and utility script for ${file.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'system tasks'}`;
    } else if (isCritical) {
      oneLinePurpose = `Primary application entry point initializing runtime and core modules`;
    } else if (exports.length > 0) {
      oneLinePurpose = `Module implementing ${file.language} logic exporting ${exports.slice(0, 3).join(', ')}`;
    } else {
      oneLinePurpose = `${file.language} source file containing ${keyFunctions.length > 0 ? keyFunctions.length + ' declared routines' : 'application definitions'}`;
    }

    return {
      path: file.path,
      responsibility: oneLinePurpose,
      language: file.language,
      lineCount: lines.length,
      importance: isCritical ? 'critical' : file.lineCount > 100 ? 'high' : 'medium',
      exports,
      imports,
      keyFunctions,
      connectedFiles,
      summary: `${file.path} (${file.language}, ${file.lineCount} lines): ${oneLinePurpose}`,
    };
  }
}
