import { TechStackItem, SourceFile, FileAnalysis } from '@codebase-explainer/shared';

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
    const stack: TechStackItem[] = [];
    const entryPoints: { path: string; description: string; type: 'frontend' | 'backend' | 'cli' | 'library' | 'worker' }[] = [];
    let packageManager: string | undefined;
    let hasLockfile = false;
    let scripts: Record<string, string> = {};
    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};

    const pathSet = new Set(allFilePaths.map((p) => p.toLowerCase()));

    // Check lockfiles
    if (pathSet.has('package-lock.json')) {
      packageManager = 'npm';
      hasLockfile = true;
    } else if (pathSet.has('yarn.lock')) {
      packageManager = 'yarn';
      hasLockfile = true;
    } else if (pathSet.has('pnpm-lock.yaml')) {
      packageManager = 'pnpm';
      hasLockfile = true;
    } else if (pathSet.has('bun.lockb')) {
      packageManager = 'bun';
      hasLockfile = true;
    } else if (pathSet.has('cargo.lock')) {
      packageManager = 'cargo';
      hasLockfile = true;
    } else if (pathSet.has('poetry.lock')) {
      packageManager = 'poetry';
      hasLockfile = true;
    }

    // Parse package.json if present
    const packageJsonFile = files.find((f) => f.path.toLowerCase() === 'package.json');
    if (packageJsonFile) {
      try {
        const pkg = JSON.parse(packageJsonFile.content);
        if (!packageManager && pkg.packageManager) {
          packageManager = pkg.packageManager.split('@')[0];
        } else if (!packageManager) {
          packageManager = 'npm';
        }

        scripts = pkg.scripts || {};
        dependencies = pkg.dependencies || {};
        devDependencies = pkg.devDependencies || {};

        stack.push({ name: 'Node.js', category: 'runtime', confidence: 'detected', evidencePath: 'package.json' });

        // Detect frameworks & libraries
        const allDeps = { ...dependencies, ...devDependencies };

        if (allDeps['react']) {
          stack.push({ name: 'React', category: 'framework', version: allDeps['react'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['next']) {
          stack.push({ name: 'Next.js', category: 'framework', version: allDeps['next'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['vue']) {
          stack.push({ name: 'Vue.js', category: 'framework', version: allDeps['vue'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['express']) {
          stack.push({ name: 'Express.js', category: 'framework', version: allDeps['express'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['fastify']) {
          stack.push({ name: 'Fastify', category: 'framework', version: allDeps['fastify'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['@nestjs/core']) {
          stack.push({ name: 'NestJS', category: 'framework', version: allDeps['@nestjs/core'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['tailwindcss']) {
          stack.push({ name: 'Tailwind CSS', category: 'tool', version: allDeps['tailwindcss'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['typescript']) {
          stack.push({ name: 'TypeScript', category: 'language', version: allDeps['typescript'], confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['prisma'] || allDeps['@prisma/client']) {
          stack.push({ name: 'Prisma ORM', category: 'database', confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['mongoose'] || allDeps['mongodb']) {
          stack.push({ name: 'MongoDB', category: 'database', confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['pg'] || allDeps['typeorm']) {
          stack.push({ name: 'PostgreSQL / SQL', category: 'database', confidence: 'detected', evidencePath: 'package.json' });
        }
        if (allDeps['vitest'] || allDeps['jest']) {
          stack.push({ name: allDeps['vitest'] ? 'Vitest' : 'Jest', category: 'dev', confidence: 'detected', evidencePath: 'package.json' });
        }
      } catch {
        // Ignored if invalid JSON
      }
    }

    // Python projects
    const reqFile = files.find((f) => f.path.toLowerCase() === 'requirements.txt');
    if (reqFile) {
      stack.push({ name: 'Python', category: 'language', confidence: 'detected', evidencePath: 'requirements.txt' });
      const lines = reqFile.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.startsWith('django')) stack.push({ name: 'Django', category: 'framework', confidence: 'detected', evidencePath: 'requirements.txt' });
        if (trimmed.startsWith('flask')) stack.push({ name: 'Flask', category: 'framework', confidence: 'detected', evidencePath: 'requirements.txt' });
        if (trimmed.startsWith('fastapi')) stack.push({ name: 'FastAPI', category: 'framework', confidence: 'detected', evidencePath: 'requirements.txt' });
        if (trimmed.startsWith('torch') || trimmed.startsWith('tensorflow')) stack.push({ name: 'PyTorch/TensorFlow', category: 'library', confidence: 'detected', evidencePath: 'requirements.txt' });
      }
    }

    // Cargo / Rust
    const cargoFile = files.find((f) => f.path.toLowerCase() === 'cargo.toml');
    if (cargoFile) {
      stack.push({ name: 'Rust', category: 'language', confidence: 'detected', evidencePath: 'cargo.toml' });
      packageManager = 'cargo';
      if (cargoFile.content.includes('axum')) stack.push({ name: 'Axum', category: 'framework', confidence: 'detected', evidencePath: 'cargo.toml' });
      if (cargoFile.content.includes('actix-web')) stack.push({ name: 'Actix Web', category: 'framework', confidence: 'detected', evidencePath: 'cargo.toml' });
      if (cargoFile.content.includes('tokio')) stack.push({ name: 'Tokio Async', category: 'library', confidence: 'detected', evidencePath: 'cargo.toml' });
    }

    // Go
    const goMod = files.find((f) => f.path.toLowerCase() === 'go.mod');
    if (goMod) {
      stack.push({ name: 'Go', category: 'language', confidence: 'detected', evidencePath: 'go.mod' });
      packageManager = 'go modules';
      if (goMod.content.includes('github.com/gin-gonic/gin')) stack.push({ name: 'Gin', category: 'framework', confidence: 'detected', evidencePath: 'go.mod' });
      if (goMod.content.includes('github.com/gofiber/fiber')) stack.push({ name: 'Fiber', category: 'framework', confidence: 'detected', evidencePath: 'go.mod' });
    }

    // Docker detection
    if (pathSet.has('dockerfile') || pathSet.has('docker-compose.yml') || pathSet.has('compose.yaml')) {
      stack.push({ name: 'Docker', category: 'tool', confidence: 'detected', evidencePath: 'Dockerfile / Compose' });
    }

    // Detect Entrypoints
    const candidateEntrypoints = [
      { pattern: /^(src\/)?(index|main|server|app)\.(ts|js|mjs)$/i, desc: 'Application main entry point', type: 'backend' as const },
      { pattern: /^(src\/)?(main|index|App)\.(tsx|jsx)$/i, desc: 'Frontend application root component / entry', type: 'frontend' as const },
      { pattern: /^(app|src\/app)\/page\.(tsx|jsx|js)$/i, desc: 'Next.js root page entry point', type: 'frontend' as const },
      { pattern: /^(main|app|manage)\.py$/i, desc: 'Python application script or entry point', type: 'backend' as const },
      { pattern: /^(cmd\/.*\/)?main\.go$/i, desc: 'Go binary entry point', type: 'backend' as const },
      { pattern: /^src\/main\.rs$/i, desc: 'Rust binary root entry point', type: 'backend' as const },
      { pattern: /^src\/lib\.rs$/i, desc: 'Rust library crate root', type: 'library' as const },
      { pattern: /^bin\/[a-zA-Z0-9_-]+$/i, desc: 'CLI executable script', type: 'cli' as const },
    ];

    for (const file of files) {
      for (const candidate of candidateEntrypoints) {
        if (candidate.pattern.test(file.path.replace(/\\/g, '/'))) {
          entryPoints.push({
            path: file.path,
            description: candidate.desc,
            type: candidate.type,
          });
          break;
        }
      }
    }

    return {
      stack,
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

      // Functions (cap at top 15 key functions per file to prevent unbounded bloat)
      if (keyFunctions.length < 15) {
        let fnMatch;
        while ((fnMatch = functionRegex.exec(lineText)) !== null) {
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
