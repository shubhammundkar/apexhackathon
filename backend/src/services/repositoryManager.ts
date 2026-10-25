import crypto from 'crypto';
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
import { rankFilesForIngestion } from './filePriorityService.js';
import { config } from '../config.js';
import {
  RepositoryStore,
  StoredFileRecord,
  createRepositoryStore,
} from '../store/index.js';

export interface RepositoryState {
  id: string; // e.g. "owner/repo"
  commitSha: string;
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
  private activeRepositories: Map<string, RepositoryState> = new Map();
  private activeJobs: Map<string, IngestionJob> = new Map();
  private lastStoreSyncMap: Map<string, number> = new Map();
  private githubService: GitHubService;
  private parserService: ParserService;
  private geminiService: GeminiService;
  private store: RepositoryStore;

  constructor(store?: RepositoryStore) {
    this.githubService = new GitHubService(config.GITHUB_TOKEN);
    this.parserService = new ParserService();
    this.geminiService = new GeminiService(config.GEMINI_API_KEY, config.GEMINI_MODEL);
    this.store = store || createRepositoryStore();
  }

  public getStore(): RepositoryStore {
    return this.store;
  }

  public setStore(store: RepositoryStore): void {
    this.store = store;
    this.activeRepositories.clear();
    this.activeJobs.clear();
  }

  public clearMemoryCache(): void {
    this.activeRepositories.clear();
    this.activeJobs.clear();
  }

  public async getJob(jobId: string): Promise<IngestionJob | undefined> {
    const active = this.activeJobs.get(jobId);
    if (active) return active;

    const stored = await this.store.getJob(jobId);
    if (!stored) return undefined;

    return {
      jobId: stored.jobId,
      repositoryId: stored.repoId,
      url: stored.url,
      status: stored.status,
      progress: stored.progress,
      abortController: new AbortController(),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
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

    await this.store.updateJob(jobId, {
      status: job.status,
      progress: job.progress,
      updatedAt: job.updatedAt,
    });

    return true;
  }

  public async getRepository(repoId: string, commitSha?: string): Promise<RepositoryState | undefined> {
    const normalized = repoId.toLowerCase();
    const active = this.activeRepositories.get(normalized);
    if (active && (!commitSha || active.commitSha === commitSha)) {
      await this.store.touchRepository(active.id, active.commitSha);
      return active;
    }

    const stored = await this.store.getRepository(normalized, commitSha);
    if (!stored) {
      return undefined;
    }

    const storedFiles = await this.store.getFiles(stored.repoId, stored.commitSha);
    const sourceFiles: SourceFile[] = storedFiles.map((f) => ({
      path: f.path,
      content: f.content,
      size: f.size,
      language: f.language,
      lineCount: f.lineCount,
    }));

    const fileAnalysisMap = new Map<string, FileAnalysis>(
      Object.entries(stored.fileAnalysisMap || {})
    );

    let cachedIndexer: IndexingService | null = null;

    const repoState: RepositoryState = {
      id: stored.repoId,
      commitSha: stored.commitSha,
      metadata: stored.metadata,
      files: sourceFiles,
      fileTree: stored.fileTree,
      fileAnalysisMap,
      analysis: stored.analysis,
      ingestedAt: stored.ingestedAt,
      get indexer() {
        if (!cachedIndexer) {
          cachedIndexer = new IndexingService(config.CHUNK_SIZE_LINES, config.CHUNK_OVERLAP_LINES);
          cachedIndexer.indexFiles(sourceFiles);
        }
        return cachedIndexer;
      },
      set indexer(idx: IndexingService) {
        cachedIndexer = idx;
      },
    };

    this.activeRepositories.set(normalized, repoState);
    return repoState;
  }

  public async listRepositories(): Promise<{ id: string; name: string; stars: number; ingestedAt: string }[]> {
    const list = await this.store.listRepositories();
    return list.map((r) => ({
      id: r.id,
      name: r.name,
      stars: r.stars,
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

    this.activeJobs.set(jobId, job);
    await this.store.saveJob({
      jobId: job.jobId,
      repoId: job.repositoryId,
      url: job.url,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });

    // Launch background execution
    this.processIngestion(job, owner, repo, apiKey, branchOverride, modelOverride).catch(async (err) => {
      console.error(`Error processing ingestion job ${jobId}:`, err);
      job.status = 'failed';
      job.progress = {
        stage: 'failed',
        message: err.message || 'Ingestion failed with unexpected error',
        percent: 100,
        error: err.message,
      };
      job.updatedAt = new Date().toISOString();
      await this.store.updateJob(jobId, {
        status: job.status,
        progress: job.progress,
        updatedAt: job.updatedAt,
      });
    });

    return { jobId, repositoryId: repoId };
  }

  private async updateJobProgress(
    job: IngestionJob,
    stage: IngestionStage,
    message: string,
    percent: number,
    extra?: Partial<IngestionProgress>,
    forceSync = false
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

    const now = Date.now();
    const lastSync = this.lastStoreSyncMap.get(job.jobId) || 0;
    const isStageBoundary = forceSync || stage === 'completed' || stage === 'failed' || percent >= 100 || stage !== job.progress.stage;

    // Only hit remote DB at stage boundaries or once every 1200ms
    if (isStageBoundary || now - lastSync >= 1200) {
      this.lastStoreSyncMap.set(job.jobId, now);
      // Non-blocking fire-and-forget so ingestion loop never stalls
      Promise.resolve(
        this.store.updateJob(job.jobId, {
          status: job.status,
          progress: job.progress,
          updatedAt: job.updatedAt,
        })
      ).catch((err: any) => {
        console.warn(`[RepositoryManager] Background progress sync notice:`, err.message);
      });
    }
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
    const repoId = `${owner}/${repo}`.toLowerCase();

    // Step 1: Fetch Metadata
    await this.updateJobProgress(job, 'fetching_metadata', `Retrieving repository metadata for ${owner}/${repo}...`, 15);
    const metadata = await this.githubService.fetchMetadata(owner, repo);
    const branch = branchOverride || metadata.defaultBranch || 'main';

    // Step 2: Fetch Commit SHA & Check Store Cache
    const commitSha = await this.githubService.fetchCommitSha(owner, repo, branch);
    const cachedRepo = await this.store.getRepository(repoId, commitSha);
    if (cachedRepo) {
      await this.updateJobProgress(
        job,
        'completed',
        `Repository ${owner}/${repo}@${commitSha} already analyzed. Reusing cached analysis.`,
        100,
        { warnings }
      );
      return;
    }

    // Step 3: Fetch Tree
    await this.updateJobProgress(job, 'fetching_tree', `Retrieving repository tree for branch "${branch}"...`, 25);
    const treeResponse = await this.githubService.fetchTree(owner, repo, branch);

    if (treeResponse.truncated) {
      warnings.push('Repository tree exceeds GitHub API single-response limit. Some nested files may be omitted.');
    }

    // Step 4: Filter Files
    await this.updateJobProgress(job, 'filtering', `Filtering and inspecting ${treeResponse.tree.length} tree nodes...`, 35);
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

    // Rank files deterministically by priority before slicing to MAX_REPO_FILES
    const rankedNodes = rankFilesForIngestion(includedNodes);
    const filesToFetch = rankedNodes.slice(0, config.MAX_REPO_FILES);
    let skippedByGroup: Record<string, number> | undefined;

    if (rankedNodes.length > config.MAX_REPO_FILES) {
      const skippedNodes = rankedNodes.slice(config.MAX_REPO_FILES);
      skippedByGroup = {};
      for (const sn of skippedNodes) {
        skippedByGroup[sn.group] = (skippedByGroup[sn.group] || 0) + 1;
      }
      const skippedDescriptions = Object.entries(skippedByGroup)
        .map(([group, count]) => `${count} ${group.replace('_', '/')}`)
        .join(', ');
      warnings.push(
        `Indexed ${filesToFetch.length} of ${includedNodes.length} eligible files. Skipped: ${skippedDescriptions}.`
      );
    }

    // Step 5: Download Files with 1-Shot In-Memory Tarball Stream & Fallback
    await this.updateJobProgress(job, 'downloading_files', `Initiating 1-shot in-memory archive stream for ${filesToFetch.length} files...`, 40, {
      totalFiles: filesToFetch.length,
      filesProcessed: 0,
      warnings,
    });

    const downloadedMap = new Map<string, SourceFile>();
    const targetPaths = new Set(filesToFetch.map((f) => f.path));
    let completedCount = 0;

    // Fast path: In-memory Tarball streaming (1 HTTP call for all files, zero disk I/O)
    try {
      await this.githubService.fetchTarball(owner, repo, branch, {
        targetPaths,
        maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
        signal: job.abortController.signal,
        onFile: async (filePath, rawContent) => {
          const { content } = redactSecrets(rawContent);
          const language = detectLanguage(filePath);
          const lineCount = content.split('\n').length;

          downloadedMap.set(filePath, {
            path: filePath,
            content,
            size: Buffer.byteLength(content, 'utf-8'),
            language,
            lineCount,
          });

          completedCount++;
          const pct = Math.min(80, Math.round(40 + (completedCount / filesToFetch.length) * 40));
          await this.updateJobProgress(
            job,
            'downloading_files',
            `Extracted ${completedCount}/${filesToFetch.length} files from stream...`,
            pct,
            {
              filesProcessed: completedCount,
              totalFiles: filesToFetch.length,
              currentFile: filePath,
              warnings,
            }
          );
        },
      });
    } catch (tarErr: any) {
      warnings.push(`Tarball archive streaming bypassed (${tarErr.message || 'fallback'}). Using direct fetch.`);
    }

    // Resilient fallback: fetch any files not captured by tarball stream
    const remainingFiles = filesToFetch.filter((f) => !downloadedMap.has(f.path));
    if (remainingFiles.length > 0) {
      const concurrency = 15;
      for (let i = 0; i < remainingFiles.length; i += concurrency) {
        if (job.abortController.signal.aborted) {
          throw new Error('Analysis job was aborted.');
        }

        const batch = remainingFiles.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (fileNode) => {
            try {
              const rawContent = await this.githubService.fetchRawFile(owner, repo, branch, fileNode.path);
              const { content } = redactSecrets(rawContent);
              const language = detectLanguage(fileNode.path);
              const lineCount = content.split('\n').length;

              downloadedMap.set(fileNode.path, {
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
              await this.updateJobProgress(
                job,
                'downloading_files',
                `Downloading files (${completedCount}/${filesToFetch.length})...`,
                pct,
                {
                  filesProcessed: completedCount,
                  totalFiles: filesToFetch.length,
                  currentFile: fileNode.path,
                  warnings,
                }
              );
            }
          })
        );
      }
    }

    const downloadedFiles: SourceFile[] = Array.from(downloadedMap.values());

    // Sort downloadedFiles deterministically by the ingestion priority order
    const priorityIndexMap = new Map(rankedNodes.map((n, idx) => [n.path, idx]));
    downloadedFiles.sort(
      (a, b) => (priorityIndexMap.get(a.path) ?? 999999) - (priorityIndexMap.get(b.path) ?? 999999)
    );

    // Step 6: Indexing and Code Search Engine
    await this.updateJobProgress(job, 'indexing', `Building BM25 code index and parsing project manifest...`, 85);
    const indexer = new IndexingService(config.CHUNK_SIZE_LINES, config.CHUNK_OVERLAP_LINES);
    indexer.indexFiles(downloadedFiles);

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

    // Build directory tree enriched with responsibilities
    const fileTree = this.buildFileTree(downloadedFiles, fileAnalysisMap);

    // Step 7: Gemini Analysis
    await this.updateJobProgress(job, 'analyzing', `Running structured Gemini architectural analysis...`, 90);

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
          repositoryId: repoId,
          analyzedAt: new Date().toISOString(),
          modelUsed: aiResult.modelUsed,
          overview: aiResult.overview,
          architecture: aiResult.architecture,
          importantFiles: Array.from(fileAnalysisMap.values()),
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
            eligibleFiles: includedNodes.length,
            skippedByGroup,
          },
        };
      } catch (err: any) {
        warnings.push(`Gemini AI analysis notice: ${err.message}. Showing rule-based parsed architecture.`);
        fullAnalysis = this.createFallbackAnalysis(metadata, manifest, downloadedFiles, fileAnalysisMap, treeResponse.tree.length, includedNodes.length, skippedByGroup);
      }
    } else {
      warnings.push('GEMINI_API_KEY is not configured on the server. Analysis generated from AST and static parser without AI augmentation.');
      fullAnalysis = this.createFallbackAnalysis(metadata, manifest, downloadedFiles, fileAnalysisMap, treeResponse.tree.length, includedNodes.length, skippedByGroup);
    }

    // Save Repository State to Store
    const nowIso = new Date().toISOString();
    const storedFiles: StoredFileRecord[] = downloadedFiles.map((f) => ({
      repoId,
      commitSha,
      path: f.path,
      language: f.language,
      size: f.size,
      lineCount: f.lineCount,
      sha256: crypto.createHash('sha256').update(f.content).digest('hex'),
      content: f.content,
    }));

    const fileAnalysisObj: Record<string, FileAnalysis> = {};
    for (const [k, v] of fileAnalysisMap.entries()) {
      fileAnalysisObj[k] = v;
    }

    await this.store.saveRepository(
      {
        repoId,
        commitSha,
        metadata,
        analysis: fullAnalysis,
        fileTree,
        fileAnalysisMap: fileAnalysisObj,
        ingestedAt: nowIso,
        lastAccessedAt: nowIso,
      },
      storedFiles
    );

    // Prune repositories beyond MAX_STORED_REPOS
    await this.store.pruneOldRepositories(config.MAX_STORED_REPOS);

    const repoState: RepositoryState = {
      id: repoId,
      commitSha,
      metadata,
      files: downloadedFiles,
      fileTree,
      fileAnalysisMap,
      analysis: fullAnalysis,
      indexer,
      ingestedAt: nowIso,
    };

    this.activeRepositories.set(repoState.id, repoState);

    // Complete Job
    await this.updateJobProgress(job, 'completed', `Repository analysis complete! Indexed ${downloadedFiles.length} files.`, 100, {
      warnings,
    });
  }

  private buildFileTree(files: SourceFile[], fileAnalysisMap?: Map<string, FileAnalysis>): RepositoryFileNode[] {
    const rootNodes: RepositoryFileNode[] = [];
    const dirMap: Map<string, RepositoryFileNode> = new Map();

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
          const analysis = fileAnalysisMap?.get(file.path);
          const fileNode: RepositoryFileNode = {
            path: file.path,
            name: part,
            type: 'file',
            size: file.size,
            language: file.language,
            responsibility: analysis?.responsibility,
            lineCount: file.lineCount,
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
    totalFiles: number,
    eligibleFiles?: number,
    skippedByGroup?: Record<string, number>
  ): FullRepositoryAnalysis {
    return {
      repositoryId: metadata.fullName.toLowerCase(),
      analyzedAt: new Date().toISOString(),
      modelUsed: 'rule-based-static-analyzer',
      overview: {
        projectName: metadata.name,
        tagline: metadata.description || `${metadata.name} open source project`,
        problemSolved: metadata.description 
          ? `${metadata.description}\n\nThis system addresses key operational and architectural challenges in this domain by coordinating ${manifest.stack.map(s => s.name).join(', ') || metadata.primaryLanguage || 'multi-language'} components with dedicated entrypoints (${manifest.entryPoints.map(e => e.path).slice(0, 3).join(', ') || 'root modules'}).`
          : `Provides an end-to-end software architecture for ${metadata.primaryLanguage || 'multi-language'} applications, automating core domain processing and service workflows.`,
        detailedSummary: `${metadata.name} is a software project comprising ${files.length} indexed source files across ${Object.keys(this.calculateLanguageStats(files)).join(', ') || metadata.primaryLanguage || 'code'}.\n\nThe codebase is organized around primary entrypoints (${manifest.entryPoints.map((e) => e.path).join(', ') || 'source modules'}), providing structured execution, modular services, and data flows.\n\nDetected technologies and runtime tooling include ${manifest.stack.map((s) => s.name).join(', ') || 'standard libraries'}, managed with ${manifest.packageManager || 'project configuration'}.`,
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
        mermaidDiagram: this.generateFallbackMermaid(manifest, files, metadata),
        dataFlowDescription: 'Standard execution flow through detected entrypoints.',
      },
      importantFiles: Array.from(fileAnalysisMap.values()),
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
        eligibleFiles,
        skippedByGroup,
      },
    };
  }

  private generateFallbackMermaid(manifest: any, files: SourceFile[], metadata: RepositoryMetadata): string {
    const frontendFiles = files.filter(f => /\.(xml|html|vue|jsx|tsx|css|scss|js)$/i.test(f.path) && /(views|templates|static|frontend|client|web|ui)/i.test(f.path));
    const controllerFiles = files.filter(f => /(controller|routes|api|endpoint|handler|view)/i.test(f.path) && /\.(py|ts|js|go|java|rb|php)$/i.test(f.path));
    const modelFiles = files.filter(f => /(model|schema|entity|record|orm|dao)/i.test(f.path) && /\.(py|ts|js|go|java|rb|php)$/i.test(f.path));
    const serviceFiles = files.filter(f => /(service|logic|manager|util|lib|helper|core)/i.test(f.path) && /\.(py|ts|js|go|java|rb|php)$/i.test(f.path));

    const dbStack = manifest.stack?.find((s: any) => /(postgres|sql|mongo|sqlite|mariadb|redis)/i.test(s.name));
    const dbName = dbStack ? dbStack.name : 'PostgreSQL / Relational Database';

    const feLabel = frontendFiles.length > 0
      ? 'UI Views and Templates (' + frontendFiles[0].path.split('/').pop() + ')'
      : 'User Interface / Client Views';
    const ctrlLabel = controllerFiles.length > 0
      ? 'Controllers and Handlers (' + controllerFiles[0].path.split('/').pop() + ')'
      : 'Application Controllers and Routes';
    const svcLabel = serviceFiles.length > 0
      ? 'Business and Domain Logic (' + serviceFiles[0].path.split('/').pop() + ')'
      : 'Domain Services and Business Engine';
    const modelLabel = modelFiles.length > 0
      ? 'ORM Models and Schema (' + modelFiles[0].path.split('/').pop() + ')'
      : 'ORM Entities and Models';

    return 'graph TD\n' +
      '  subgraph Frontend ["Frontend / View Layer"]\n' +
      '    FE_VIEW["' + feLabel + '"]\n' +
      '    FE_CLIENT["Client Scripts / Event Handlers"]\n' +
      '  end\n\n' +
      '  subgraph Gateway ["Network and Routing Layer"]\n' +
      '    GW_ROUTE["HTTP / RPC Web Dispatcher"]\n' +
      '    GW_AUTH["Authentication and Session Middleware"]\n' +
      '  end\n\n' +
      '  subgraph Backend ["Controllers and Application Logic"]\n' +
      '    BE_CTRL["' + ctrlLabel + '"]\n' +
      '    BE_SVC["' + svcLabel + '"]\n' +
      '  end\n\n' +
      '  subgraph Persistence ["Data Access and Storage"]\n' +
      '    DB_ORM["' + modelLabel + '"]\n' +
      '    DB_STORE[("' + dbName + '")]\n' +
      '  end\n\n' +
      '  FE_VIEW -- "1. User submits action / Form data" --> FE_CLIENT\n' +
      '  FE_CLIENT -- "2. HTTP / JSON-RPC Request" --> GW_ROUTE\n' +
      '  GW_ROUTE --> GW_AUTH\n' +
      '  GW_AUTH -- "3. Validated Session and Params" --> BE_CTRL\n' +
      '  BE_CTRL -- "4. Execute domain action" --> BE_SVC\n' +
      '  BE_SVC -- "5. ORM Query / Mutation" --> DB_ORM\n' +
      '  DB_ORM -- "6. Execute SQL / DB Operations" --> DB_STORE\n' +
      '  DB_STORE -- "7. Return data records" --> DB_ORM\n' +
      '  DB_ORM -- "8. Return active records / instances" --> BE_SVC\n' +
      '  BE_SVC -- "9. Return processed payload" --> BE_CTRL\n' +
      '  BE_CTRL -- "10. Render View Template / JSON Response" --> FE_VIEW';
  }

  public getGeminiService(): GeminiService {
    return this.geminiService;
  }
}

export const repositoryManager = new RepositoryManager();
