import { Router, Request, Response, NextFunction } from 'express';
import {
  AnalyzeRepoRequestSchema,
  AskQuestionRequestSchema,
} from '@codebase-explainer/shared';
import { repositoryManager } from '../services/repositoryManager.js';
import { getConfigSummary } from '../config.js';

export const apiRouter = Router();

// ==========================================
// 1. HEALTH AND DIAGNOSTICS
// ==========================================

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: getConfigSummary(),
  });
});

// ==========================================
// 2. REPOSITORY ANALYSIS JOBS
// ==========================================

apiRouter.post('/repositories/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = AnalyzeRepoRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0]?.message || 'Invalid repository request',
        details: parseResult.error.format(),
      });
    }

    const { url, apiKey, branch, model } = parseResult.data;
    const { jobId, repositoryId } = await repositoryManager.startAnalysis(url, apiKey, branch, model);

    res.status(202).json({
      message: 'Repository analysis started',
      jobId,
      repositoryId,
    });
  } catch (err: any) {
    next(err);
  }
});

// ==========================================
// 3. JOB PROGRESS & STATUS
// ==========================================

apiRouter.get('/jobs/:jobId', (req: Request, res: Response) => {
  const job = repositoryManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: 'JOB_NOT_FOUND',
      message: `Analysis job ${req.params.jobId} not found`,
    });
  }

  res.json({
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

apiRouter.post('/jobs/:jobId/cancel', (req: Request, res: Response) => {
  const success = repositoryManager.cancelJob(req.params.jobId);
  if (!success) {
    return res.status(404).json({
      error: 'JOB_NOT_FOUND',
      message: `Analysis job ${req.params.jobId} not found or already completed`,
    });
  }

  res.json({ message: 'Job cancelled successfully' });
});

// ==========================================
// 4. REPOSITORY DETAILS & FILES
// ==========================================

function getRepoId(req: Request): string {
  // Support both /repositories/:owner/:repo and /repositories/:repoId
  if (req.params.owner && req.params.repo) {
    return `${req.params.owner}/${req.params.repo}`.toLowerCase();
  }
  return decodeURIComponent(req.params.repositoryId || '').toLowerCase();
}

apiRouter.get('/repositories/:owner/:repo', (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = repositoryManager.getRepository(repoId);
  if (!repo) {
    return res.status(404).json({
      error: 'REPOSITORY_NOT_FOUND',
      message: `Repository ${repoId} has not been analyzed yet or session expired`,
    });
  }

  res.json({
    id: repo.id,
    metadata: repo.metadata,
    ingestedAt: repo.ingestedAt,
    fileCount: repo.files.length,
    languages: repo.analysis?.stats.languages || {},
  });
});

apiRouter.get('/repositories/:owner/:repo/files', (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = repositoryManager.getRepository(repoId);
  if (!repo) {
    return res.status(404).json({
      error: 'REPOSITORY_NOT_FOUND',
      message: `Repository ${repoId} not found`,
    });
  }

  res.json({
    repositoryId: repoId,
    tree: repo.fileTree,
    totalFiles: repo.files.length,
  });
});

apiRouter.get('/repositories/:owner/:repo/files/content', (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = repositoryManager.getRepository(repoId);
  if (!repo) {
    return res.status(404).json({
      error: 'REPOSITORY_NOT_FOUND',
      message: `Repository ${repoId} not found`,
    });
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'MISSING_PATH', message: 'Query parameter "path" is required' });
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const file = repo.files.find((f) => f.path.toLowerCase() === normalizedPath.toLowerCase());
  if (!file) {
    return res.status(404).json({
      error: 'FILE_NOT_FOUND',
      message: `File ${filePath} was not found in the indexed repository`,
    });
  }

  const analysis = repo.fileAnalysisMap.get(file.path);

  res.json({
    path: file.path,
    language: file.language,
    size: file.size,
    lineCount: file.lineCount,
    content: file.content,
    analysis,
  });
});

apiRouter.get('/repositories/:owner/:repo/analysis', (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = repositoryManager.getRepository(repoId);
  if (!repo || !repo.analysis) {
    return res.status(404).json({
      error: 'ANALYSIS_NOT_FOUND',
      message: `Analysis for ${repoId} is not available`,
    });
  }

  res.json(repo.analysis);
});

// ==========================================
// 5. CITATION-GROUNDED Q&A
// ==========================================

apiRouter.post('/repositories/:owner/:repo/questions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repoId = getRepoId(req);
    const repo = repositoryManager.getRepository(repoId);
    if (!repo) {
      return res.status(404).json({
        error: 'REPOSITORY_NOT_FOUND',
        message: `Repository ${repoId} not found`,
      });
    }

    const parseResult = AskQuestionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0]?.message || 'Invalid question format',
      });
    }

    const { question, filePath, apiKey } = parseResult.data;

    // Retrieve citations from indexing engine
    const citations = repo.indexer.search(question, 6, filePath);

    // Call Gemini with grounded context
    const geminiService = repositoryManager.getGeminiService();
    const qaResponse = await geminiService.answerQuestion(
      question,
      citations,
      repo.metadata,
      filePath,
      apiKey
    );

    res.json(qaResponse);
  } catch (err: any) {
    next(err);
  }
});
