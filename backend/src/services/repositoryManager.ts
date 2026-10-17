import {
  RepositoryMetadata,
  SourceFile,
  FullRepositoryAnalysis,
  RepositoryFileNode,
  FileAnalysis,
  IngestionProgress,
  IngestionStage,
} from '@codebase-explainer/shared';
import { GitHubService } from './githubService.js';
import { shouldIncludeFile, detectLanguage, redactSecrets } from './fileFilterService.js';
import { ParserService, ParsedProjectManifest } from './parserService.js';
import { IndexingService } from './indexingService.js';
import { GeminiService } from './geminiService.js';
import { config } from '../config.js';

export interface RepositoryState {
  id: string; // e.g. "owner/repo"
  metadata: RepositoryMetadata;
  files: SourceFile[];
  fileTree: RepositoryFileNode[];
  fileAnalysisMap: Map<string, FileAnalysis>;
  analysis?: FullRepositoryAnalysis;
  indexer: IndexingService;
  ingestedAt: string;
}

export interface IngestionJob {
  jobId: string;
  repositoryId: string;
  url: string;
  status: IngestionStage;
  progress: IngestionProgress;
  abortController: AbortController;
  createdAt: string;
  updatedAt: string;
}

export class RepositoryManager {
  private repositories: Map<string, RepositoryState> = new Map();
  private jobs: Map<string, IngestionJob> = new Map();
  private githubService: GitHubService;
  private parserService: ParserService;
  private geminiService: GeminiService;

  constructor() {
    this.githubService = new GitHubService(config.GITHUB_TOKEN);
    this.parserService = new ParserService();
    this.geminiService = new GeminiService(config.GEMINI_API_KEY, config.GEMINI_MODEL);
  }

  public getJob(jobId: string): IngestionJob | undefined {
    return this.jobs.get(jobId);
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.abortController.abort();
    job.status = 'failed';
    job.progress = {
      ...job.progress,
      stage: 'failed',
      message: 'Job was cancelled by user.',
      error: 'Cancelled by user',
    };
    job.updatedAt = new Date().toISOString();
    return true;
  }

  public getRepository(repoId: string): RepositoryState | undefined {
    return this.repositories.get(repoId.toLowerCase());
  }

  public listRepositories(): { id: string; name: string; stars: number; ingestedAt: string }[] {
    return Array.from(this.repositories.values()).map((r) => ({
      id: r.id,
      name: r.metadata.fullName,
      stars: r.metadata.stars,
      ingestedAt: r.ingestedAt,
    }));
  }

  /**
   * Starts ingestion and analysis asynchronously, tracking progress in a job
   */
  public async startAnalysis(
    url: string,
    apiKey?: string,
    branchOverride?: string,
    modelOverride?: string
  ): Promise<{ jobId: string; repositoryId: string }> {
    const { owner, repo } = this.githubService.parseRepoUrl(url);
    const repoId = `${owner}/${repo}`.toLowerCase();
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const job: IngestionJob = {
      jobId,
      repositoryId: repoId,
      url,
      status: 'validating',
      progress: {
        stage: 'validating',
        message: `Validating repository URL ${owner}/${repo}...`,
        percent: 5,
        warnings: [],
      },
      abortController: new AbortController(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    // Launch background execution
    this.processIngestion(job, owner, repo, apiKey, branchOverride, modelOverride).catch((err) => {
      console.error(`Error processing ingestion job ${jobId}:`, err);
      job.status = 'failed';
      job.progress = {
        stage: 'failed',
        message: err.message || 'Ingestion failed with unexpected error',
        percent: 100,
        error: err.message,
      };
      job.updatedAt = new Date().toISOString();
    });

    return { jobId, repositoryId: repoId };
  }

  private updateJobProgress(
    job: IngestionJob,
    stage: IngestionStage,
    message: string,
    percent: number,
    extra?: Partial<IngestionProgress>
  ) {
    job.status = stage;
    job.progress = {
      ...job.progress,
      stage,
      message,
      percent,
      ...extra,
    };
    job.updatedAt = new Date().toISOString();
  }

  private async processIngestion(
    job: IngestionJob,
    owner: string,
    repo: string,
    userApiKey?: string,
    branchOverride?: string,
    modelOverride?: string
  ) {
    const warnings: string[] = [];

    // Step 1: Fetch Metadata
    this.updateJobProgress(job, 'fetching_metadata', `Retrieving repository metadata for ${owner}/${repo}...`, 15);
    const metadata = await this.githubService.fetchMetadata(owner, repo);
    const branch = branchOverride || metadata.defaultBranch || 'main';

    // Step 2: Fetch Tree
    this.updateJobProgress(job, 'fetching_tree', `Retrieving repository tree for branch "${branch}"...`, 25);
    const treeResponse = await this.githubService.fetchTree(owner, repo, branch);

    if (treeResponse.truncated) {
      warnings.push('Repository tree exceeds GitHub API single-response limit. Some nested files may be omitted.');
    }

    // Step 3: Filter Files
    this.updateJobProgress(job, 'filtering', `Filtering and inspecting ${treeResponse.tree.length} tree nodes...`, 35);
    const candidateBlobs = treeResponse.tree.filter((node) => node.type === 'blob');
    const includedNodes: { path: string; size: number }[] = [];

    for (const blob of candidateBlobs) {
      const size = blob.size || 0;
      const filterRes = shouldIncludeFile(blob.path, size, config.MAX_FILE_SIZE_BYTES);
      if (filterRes.shouldInclude) {
        includedNodes.push({ path: blob.path, size });
      }
    }

    if (includedNodes.length === 0) {
      throw new Error('No supported source code files were found in this repository.');
    }

    // Limit files to avoid memory exhaustion
    const filesToFetch = includedNodes.slice(0, config.MAX_REPO_FILES);
    if (includedNodes.length > config.MAX_REPO_FILES) {
      warnings.push(`Repository has ${includedNodes.length} source files; indexed top ${config.MAX_REPO_FILES} critical files.`);
    }

    // Step 4: Download Files with Bounded Concurrency
    this.updateJobProgress(job, 'downloading_files', `Downloading source files (0/${filesToFetch.length})...`, 40, {
      totalFiles: filesToFetch.length,
      filesProcessed: 0,
      warnings,
    });

    const downloadedFiles: SourceFile[] = [];
    const concurrency = 6;
    let completedCount = 0;

    for (let i = 0; i < filesToFetch.length; i += concurrency) {
      if (job.abortController.signal.aborted) {
        throw new Error('Analysis job was aborted.');
      }

      const batch = filesToFetch.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (fileNode) => {
          try {
            const rawContent = await this.githubService.fetchRawFile(owner, repo, branch, fileNode.path);
            const { content } = redactSecrets(rawContent);
            const language = detectLanguage(fileNode.path);
            const lineCount = content.split('\n').length;

            downloadedFiles.push({
              path: fileNode.path,
              content,
              size: Buffer.byteLength(content, 'utf-8'),
              language,
              lineCount,
            });
          } catch (err: any) {
            warnings.push(`Could not fetch file ${fileNode.path}: ${err.message}`);
          } finally {
            completedCount++;
            const pct = Math.min(80, Math.round(40 + (completedCount / filesToFetch.length) * 40));
            this.updateJobProgress(job, 'downloading_files', `Downloading files (${completedCount}/${filesToFetch.length})...`, pct, {
              filesProcessed: completedCount,
              totalFiles: filesToFetch.length,
              currentFile: fileNode.path,
              warnings,
            });
          }
        })
      );
    }

    // Step 5: Indexing and Code Search Engine
    this.updateJobProgress(job, 'indexing', `Building BM25 code index and parsing project manifest...`, 85);
    const indexer = new IndexingService(config.CHUNK_SIZE_LINES, config.CHUNK_OVERLAP_LINES);
    indexer.indexFiles(downloadedFiles);

    // Build directory tree
    const fileTree = this.buildFileTree(downloadedFiles);

    // Parse dependencies and entrypoints
    const manifest = this.parserService.parseProject(
      downloadedFiles,
      treeResponse.tree.map((t) => t.path)
    );

    // Analyze individual files
    const fileAnalysisMap = new Map<string, FileAnalysis>();
    for (const f of downloadedFiles) {
      fileAnalysisMap.set(f.path, this.parserService.analyzeFileContent(f));
    }

    // Step 6: Gemini Analysis
    this.updateJobProgress(job, 'analyzing', `Running structured Gemini architectural analysis...`, 90);

    let fullAnalysis: FullRepositoryAnalysis;
    const canUseGemini = this.geminiService.isConfigured(userApiKey);

    if (canUseGemini) {
      try {
        const aiResult = await this.geminiService.generateRepositoryAnalysis(
          metadata,
          manifest,
          downloadedFiles,
          userApiKey,
          modelOverride
        );

        fullAnalysis = {
          repositoryId: `${owner}/${repo}`.toLowerCase(),
          analyzedAt: new Date().toISOString(),
          modelUsed: aiResult.modelUsed,
          overview: aiResult.overview,
          architecture: aiResult.architecture,
          importantFiles: Array.from(fileAnalysisMap.values()).slice(0, 30),
          executionFlows: aiResult.executionFlows,
          findings: aiResult.findings,
          dependenciesSummary: {
            runtimeDependencies: manifest.stack.filter((s) => s.category !== 'dev'),
            devDependencies: manifest.stack.filter((s) => s.category === 'dev'),
            packageManager: manifest.packageManager,
            hasLockfile: manifest.hasLockfile,
          },
          stats: {
            totalFiles: treeResponse.tree.length,
            indexedFiles: downloadedFiles.length,
            totalLines: downloadedFiles.reduce((acc, f) => acc + f.lineCount, 0),
            languages: this.calculateLanguageStats(downloadedFiles),
          },
        };
      } catch (err: any) {
        warnings.push(`Gemini AI analysis notice: ${err.message}. Showing rule-based parsed architecture.`);
        fullAnalysis = this.createFallbackAnalysis(metadata, manifest, downloadedFiles, fileAnalysisMap, treeResponse.tree.length);
      }
    } else {
      warnings.push('GEMINI_API_KEY is not configured on the server. Analysis generated from AST and static parser without AI augmentation.');
      fullAnalysis = this.createFallbackAnalysis(metadata, manifest, downloadedFiles, fileAnalysisMap, treeResponse.tree.length);
    }

    // Save Repository State
    const repoState: RepositoryState = {
      id: `${owner}/${repo}`.toLowerCase(),
      metadata,
      files: downloadedFiles,
      fileTree,
      fileAnalysisMap,
      analysis: fullAnalysis,
      indexer,
      ingestedAt: new Date().toISOString(),
    };

    this.repositories.set(repoState.id, repoState);

    // Complete Job
    this.updateJobProgress(job, 'completed', `Repository analysis complete! Indexed ${downloadedFiles.length} files.`, 100, {
      warnings,
    });
  }

  private buildFileTree(files: SourceFile[]): RepositoryFileNode[] {
    const rootNodes: RepositoryFileNode[] = [];
    const dirMap: Map<string, RepositoryFileNode> = new Map();

    // Sort files alphabetically
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

    for (const file of sorted) {
      const parts = file.path.split('/');
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (isFile) {
          const fileNode: RepositoryFileNode = {
            path: file.path,
            name: part,
            type: 'file',
            size: file.size,
            language: file.language,
          };

          if (parentPath && dirMap.has(parentPath)) {
            dirMap.get(parentPath)!.children!.push(fileNode);
          } else {
            rootNodes.push(fileNode);
          }
        } else {
          if (!dirMap.has(currentPath)) {
            const dirNode: RepositoryFileNode = {
              path: currentPath,
              name: part,
              type: 'dir',
              size: 0,
              children: [],
            };
            dirMap.set(currentPath, dirNode);

            if (parentPath && dirMap.has(parentPath)) {
              dirMap.get(parentPath)!.children!.push(dirNode);
            } else {
              rootNodes.push(dirNode);
            }
          }
        }
      }
    }

    return rootNodes;
  }

  private calculateLanguageStats(files: SourceFile[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const f of files) {
      stats[f.language] = (stats[f.language] || 0) + 1;
    }
    return stats;
  }

  private createFallbackAnalysis(
    metadata: RepositoryMetadata,
    manifest: ParsedProjectManifest,
    files: SourceFile[],
    fileAnalysisMap: Map<string, FileAnalysis>,
    totalFiles: number
  ): FullRepositoryAnalysis {
    return {
      repositoryId: metadata.fullName.toLowerCase(),
      analyzedAt: new Date().toISOString(),
      modelUsed: 'rule-based-static-analyzer',
      overview: {
        projectName: metadata.name,
        tagline: metadata.description || `${metadata.name} open source project`,
        problemSolved: metadata.description || `Software repository implementing ${metadata.primaryLanguage || 'code'} architecture.`,
        detailedSummary: `Repository with ${files.length} indexed source files, primarily written in ${metadata.primaryLanguage || 'JavaScript/TypeScript'}. Uses ${manifest.packageManager || 'standard package tooling'}.`,
        detectedStack: manifest.stack,
        entryPoints: manifest.entryPoints,
        quickStartGuide: {
          prerequisites: ['Git', `${manifest.packageManager || 'Node.js'} runtime`],
          installCommands: [manifest.packageManager ? `${manifest.packageManager} install` : 'npm install'],
          runCommands: [manifest.scripts['start'] ? `npm start` : manifest.scripts['dev'] ? `npm run dev` : 'npm test'],
          envVariablesRequired: ['Check .env.example if present'],
        },
      },
      architecture: {
        pattern: 'Modular Architecture',
        description: 'Component architecture detected from folder tree and file dependencies.',
        layers: [
          {
            name: 'Core Application',
            type: 'shared',
            description: 'Main source modules',
            files: files.slice(0, 10).map((f) => f.path),
            dependencies: [],
          },
        ],
        mermaidDiagram: `graph TD\n  Client[Application Layer] --> Core[Core Engine]\n  Core --> Utilities[Utils & Helpers]`,
        dataFlowDescription: 'Standard execution flow through detected entrypoints.',
      },
      importantFiles: Array.from(fileAnalysisMap.values()).slice(0, 25),
      executionFlows: [
        {
          name: 'Main Entrypoint Execution',
          trigger: 'Application Start',
          description: 'Initialization from detected entry points',
          steps: manifest.entryPoints.map((ep: { path: string; description: string; type: 'frontend' | 'backend' | 'cli' | 'library' | 'worker' }, i: number) => ({
            step: i + 1,
            layer: ep.type,
            file: ep.path,
            functionOrRoute: 'init',
            action: ep.description,
            isConfirmed: true,
          })),
        },
      ],
      findings: [],
      dependenciesSummary: {
        runtimeDependencies: manifest.stack.filter((s: { category: string }) => s.category !== 'dev'),
        devDependencies: manifest.stack.filter((s: { category: string }) => s.category === 'dev'),
        packageManager: manifest.packageManager,
        hasLockfile: manifest.hasLockfile,
      },
      stats: {
        totalFiles,
        indexedFiles: files.length,
        totalLines: files.reduce((acc, f) => acc + f.lineCount, 0),
        languages: this.calculateLanguageStats(files),
      },
    };
  }

  public getGeminiService(): GeminiService {
    return this.geminiService;
  }
}

export const repositoryManager = new RepositoryManager();
