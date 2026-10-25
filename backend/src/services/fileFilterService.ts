import path from 'path';

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.ps1': 'PowerShell',
  '.dockerfile': 'Dockerfile',
  '.env.example': 'Config',
  '.prisma': 'Prisma Schema',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.proto': 'Protocol Buffers',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};

const SPECIAL_FILES: Record<string, string> = {
  'dockerfile': 'Dockerfile',
  'makefile': 'Makefile',
  'gemfile': 'Ruby Gemfile',
  'rakefile': 'Rakefile',
  'cmakelists.txt': 'CMake',
  'procfile': 'Procfile',
  'jenkinsfile': 'Jenkinsfile',
  'vagrantfile': 'Vagrantfile',
};

// Ignore paths / directories that shouldn't be indexed
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  'bin',
  'obj',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.cache',
  'coverage',
  '.nyc_output',
  'vendor',
  '.gradle',
  '.idea',
  '.vscode',
  'Pods',
  '.dart_tool',
  'pkg',
]);

// File extensions that are binary, media, or non-text
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm', '.mkv',
  '.mp3', '.wav', '.ogg', '.flac', '.aac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.dmg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.pyo', '.pyd', '.class', '.jar', '.war',
  '.db', '.sqlite', '.sqlite3',
]);

// Ignored files (lockfiles often too large to index directly, but can be inspected for dependencies)
const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'composer.lock',
  '.ds_store',
  'thumbs.db',
]);

export function detectLanguage(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = path.basename(normalized).toLowerCase();

  if (SPECIAL_FILES[fileName]) {
    return SPECIAL_FILES[fileName];
  }

  const ext = path.extname(normalized).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || 'Text';
}

export function isSafePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Check for path traversal attempts
  if (normalized.includes('../') || normalized.startsWith('/')) {
    return false;
  }
  return true;
}

export function isSecretFile(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  if (baseName.startsWith('.env') && !baseName.includes('example')) {
    return true;
  }
  if (baseName.endsWith('.pem') || baseName.endsWith('.key') || baseName.endsWith('.keystore') || baseName.endsWith('.p12')) {
    return true;
  }
  if (baseName === 'id_rsa' || baseName === 'id_ed25519' || baseName.includes('credential') || baseName.includes('secret')) {
    return true;
  }
  return false;
}

export interface FileFilterResult {
  shouldInclude: boolean;
  reason?: string;
  isDependencyManifest: boolean;
}

export function shouldIncludeFile(
  filePath: string,
  fileSize: number,
  maxFileSizeBytes: number
): FileFilterResult {
  const normalized = filePath.replace(/\\/g, '/');

  if (!isSafePath(normalized)) {
    return { shouldInclude: false, reason: 'Unsafe path traversal detected', isDependencyManifest: false };
  }

  const parts = normalized.split('/');
  for (const part of parts) {
    if (IGNORED_DIRECTORIES.has(part.toLowerCase())) {
      return { shouldInclude: false, reason: `Ignored directory: ${part}`, isDependencyManifest: false };
    }
  }

  const baseName = path.basename(normalized).toLowerCase();
  const ext = path.extname(normalized).toLowerCase();

  if (isSecretFile(normalized)) {
    return { shouldInclude: false, reason: 'Excluded sensitive secret file', isDependencyManifest: false };
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    return { shouldInclude: false, reason: 'Binary/media file', isDependencyManifest: false };
  }

  // Check if it's a manifest (we want to parse it, but might not chunk it if it's huge)
  const isManifest = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'gemfile',
    'composer.json',
  ].includes(baseName);

  if (IGNORED_FILES.has(baseName)) {
    return { shouldInclude: false, reason: 'Lockfile/build artifact', isDependencyManifest: false };
  }

  // Allow known source extensions or special files
  const isKnownCode = Boolean(EXTENSION_TO_LANGUAGE[ext] || SPECIAL_FILES[baseName]);
  if (!isKnownCode) {
    return { shouldInclude: false, reason: 'Unsupported non-code file type', isDependencyManifest: isManifest };
  }

  if (fileSize > maxFileSizeBytes) {
    return {
      shouldInclude: false,
      reason: `File size (${Math.round(fileSize / 1024)}KB) exceeds limit of ${Math.round(maxFileSizeBytes / 1024)}KB`,
      isDependencyManifest: isManifest,
    };
  }

  return { shouldInclude: true, isDependencyManifest: isManifest };
}

export function redactSecrets(content: string): { content: string; hasRedactions: boolean } {
  let redacted = content;
  let hasRedactions = false;

  const patterns = [
    /(?:api[_-]?key|apikey|secret|token|password|auth|private[_-]?key)\s*[:=]\s*['"][a-zA-Z0-9_\-.~+/=]{8,}['"]/gi,
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9_]{50,100}/g,
    /xox[baprs]-[0-9a-zA-Z]{10,48}/g,
    /AIza[0-9A-Za-z-_]{16,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@[a-zA-Z0-9.-]+/gi,
    /-----BEGIN\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+PRIVATE\s+KEY-----/g,
    /-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+RSA\s+PRIVATE\s+KEY-----/g,
  ];

  for (const regex of patterns) {
    if (regex.test(redacted)) {
      hasRedactions = true;
      regex.lastIndex = 0;
      redacted = redacted.replace(regex, '[REDACTED_SECRET]');
    }
  }

  return { content: redacted, hasRedactions };
}
