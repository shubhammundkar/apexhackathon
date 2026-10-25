import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import {
  AnalyzeRepoRequestSchema,
  AskQuestionRequestSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
} from '@codebase-explainer/shared';
import { repositoryManager } from '../services/repositoryManager.js';
import { queryRelevanceService, REJECTION_MESSAGE } from '../services/queryRelevanceService.js';
import { getConfigSummary } from '../config.js';
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  TokenPayload,
} from '../services/authService.js';
import { StoredUserRecord } from '../store/repositoryStore.js';

export const apiRouter = Router();

// ==========================================
// Helper: Extract authenticated user & anonymous session
// ==========================================

export function getUserAndSession(req: Request): {
  userId?: string;
  sessionId?: string;
  user?: TokenPayload;
} {
  const authHeader = req.headers.authorization;
  let user: TokenPayload | undefined = undefined;
  let userId: string | undefined = undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload) {
      user = payload;
      userId = payload.userId;
    }
  }

  const sessionHeader = req.headers['x-session-id'] || req.query.sessionId;
  const sessionId =
    typeof sessionHeader === 'string' && sessionHeader.trim() ? sessionHeader.trim() : undefined;

  return { userId, sessionId, user };
}

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
// 2. USER AUTHENTICATION (OPTIONAL)
// ==========================================

apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  const parseResult = RegisterRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: parseResult.error.errors[0]?.message || 'Invalid registration data',
    });
  }

  const { username, email, password } = parseResult.data;
  const store = repositoryManager.getStore();

  const existingUsername = await store.getUserByUsernameOrEmail(username);
  if (existingUsername) {
    return res.status(409).json({
      error: 'USERNAME_TAKEN',
      message: 'Username is already taken. Please choose another.',
    });
  }

  const existingEmail = await store.getUserByUsernameOrEmail(email);
  if (existingEmail) {
    return res.status(409).json({
      error: 'EMAIL_REGISTERED',
      message: 'Email address is already registered. Please sign in.',
    });
  }

  const newUser: StoredUserRecord = {
    id: `usr_${crypto.randomUUID()}`,
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  await store.saveUser(newUser);
  const token = createToken(newUser);

  res.status(201).json({
    message: 'User registered successfully',
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      createdAt: newUser.createdAt,
    },
  });
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const parseResult = LoginRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: parseResult.error.errors[0]?.message || 'Invalid login credentials',
    });
  }

  const { identifier, password } = parseResult.data;
  const store = repositoryManager.getStore();

  const user = await store.getUserByUsernameOrEmail(identifier);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Incorrect username/email or password',
    });
  }

  user.lastLoginAt = new Date().toISOString();
  await store.saveUser(user);
  const token = createToken(user);

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
    },
  });
});

apiRouter.get('/auth/me', async (req: Request, res: Response) => {
  const { user } = getUserAndSession(req);
  if (!user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Not authenticated or token expired',
    });
  }

  const store = repositoryManager.getStore();
  const dbUser = await store.getUserById(user.userId);
  if (!dbUser) {
    return res.status(404).json({
      error: 'USER_NOT_FOUND',
      message: 'User account no longer found',
    });
  }

  res.json({
    user: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      createdAt: dbUser.createdAt,
    },
  });
});

// ==========================================
// 3. REPOSITORY ANALYSIS JOBS
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

    // Track repository association for user / session
    const { userId, sessionId } = getUserAndSession(req);
    if (userId || sessionId) {
      const parts = repositoryId.split('/');
      const repoName = parts[1] || repositoryId;
      await repositoryManager.getStore().trackUserRepo({
        id: `${userId || sessionId}@${repositoryId.toLowerCase()}`,
        userId,
        sessionId,
        repoId: repositoryId.toLowerCase(),
        name: repoName,
        stars: 0,
        lastAccessedAt: new Date().toISOString(),
      });
    }

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

apiRouter.get('/jobs/:jobId', async (req: Request, res: Response) => {
  const job = await repositoryManager.getJob(req.params.jobId);
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

apiRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  const success = await repositoryManager.cancelJob(req.params.jobId);
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

apiRouter.get('/repositories', async (req: Request, res: Response) => {
  const { userId, sessionId } = getUserAndSession(req);
  const store = repositoryManager.getStore();

  let userRepos: any[] = [];
  if (userId || sessionId) {
    userRepos = await store.getUserRepos({ userId, sessionId });
  }

  const allRepos = await store.listRepositories();
  const seen = new Set<string>();
  const combined: any[] = [];

  for (const ur of userRepos) {
    seen.add(ur.repoId.toLowerCase());
    combined.push({
      id: ur.repoId,
      name: ur.name,
      stars: ur.stars,
      lastAccessedAt: ur.lastAccessedAt,
      isUserRepo: true,
    });
  }

  for (const ar of allRepos) {
    if (!seen.has(ar.id.toLowerCase())) {
      seen.add(ar.id.toLowerCase());
      combined.push({
        id: ar.id,
        name: ar.name,
        stars: ar.stars,
        lastAccessedAt: ar.lastAccessedAt,
        ingestedAt: ar.ingestedAt,
        isUserRepo: false,
      });
    }
  }

  res.json({ repositories: combined });
});

apiRouter.get('/repositories/:owner/:repo', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = await repositoryManager.getRepository(repoId);
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

apiRouter.get('/repositories/:owner/:repo/files', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = await repositoryManager.getRepository(repoId);
  if (!repo) {
    return res.status(404).json({
      error: 'REPOSITORY_NOT_FOUND',
      message: `Repository ${repoId} not found`,
    });
  }

  // Ensure fileTree nodes have responsibilities populated
  const attachResponsibility = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === 'file') {
        if (!node.responsibility) {
          const fileAnalysis = repo.fileAnalysisMap.get(node.path);
          node.responsibility =
            fileAnalysis?.responsibility ||
            repo.analysis?.importantFiles?.find(
              (i) => i.path.toLowerCase() === node.path.toLowerCase()
            )?.responsibility ||
            `Source module implementing ${node.name}`;
        }
      } else if (node.children) {
        attachResponsibility(node.children);
      }
    }
  };
  attachResponsibility(repo.fileTree);

  const allFiles = repo.files.map((f) => {
    const analysis =
      repo.fileAnalysisMap.get(f.path) ||
      repo.analysis?.importantFiles?.find(
        (i) => i.path.toLowerCase() === f.path.toLowerCase()
      );
    return {
      path: f.path,
      name: f.path.split('/').pop() || f.path,
      language: f.language,
      size: f.size,
      lineCount: f.lineCount,
      responsibility:
        analysis?.responsibility || `Implements logic for ${f.path.split('/').pop()}`,
    };
  });

  res.json({
    repositoryId: repoId,
    tree: repo.fileTree,
    totalFiles: repo.files.length,
    files: allFiles,
  });
});

apiRouter.get('/repositories/:owner/:repo/files/content', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = await repositoryManager.getRepository(repoId);
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

apiRouter.get('/repositories/:owner/:repo/analysis', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = await repositoryManager.getRepository(repoId);
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
    const repo = await repositoryManager.getRepository(repoId);
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

    const { question, filePath, apiKey, model } = parseResult.data;

    // Relevance Gate: Reject irrelevant queries immediately before chunk retrieval or Gemini calls
    const allFilePaths = repo.files ? repo.files.map((f: any) => f.path) : [];
    const relevance = queryRelevanceService.classify({
      question,
      filePath,
      repoMetadata: repo.metadata,
      allFilePaths,
    });

    if (!relevance.isRelevant) {
      return res.json({
        question,
        answer: REJECTION_MESSAGE,
        citations: [],
        modelUsed: 'relevance-gate',
        answeredAt: new Date().toISOString(),
        isRelevant: false,
      });
    }

    // Retrieve citations from indexing engine with adaptive limits
    const { citations, stats } = repo.indexer.searchWithStats(question, undefined, filePath);

    // Call Gemini with grounded context
    const geminiService = repositoryManager.getGeminiService();
    const qaResponse = await geminiService.answerQuestion(
      question,
      citations,
      repo.metadata,
      filePath,
      apiKey,
      model,
      {
        detectedStack: repo.analysis?.overview?.detectedStack,
        entryPoints: repo.analysis?.overview?.entryPoints,
        architecturePattern: repo.analysis?.architecture?.pattern,
        architectureDescription: repo.analysis?.architecture?.description,
      }
    );
    qaResponse.retrieval = stats;

    // Save Q&A to store (MongoDB Atlas / SQLite / Memory)
    const { userId, sessionId } = getUserAndSession(req);
    const store = repositoryManager.getStore();
    const qaRecordId = `qa_${crypto.randomUUID()}`;
    await store.saveQAHistory({
      id: qaRecordId,
      repoId,
      commitSha: repo.commitSha,
      userId,
      sessionId,
      question,
      answer: qaResponse.answer,
      citations: qaResponse.citations,
      modelUsed: qaResponse.modelUsed,
      createdAt: qaResponse.answeredAt || new Date().toISOString(),
    });

    if (userId || sessionId) {
      await store.trackUserRepo({
        id: `${userId || sessionId}@${repoId.toLowerCase()}`,
        userId,
        sessionId,
        repoId: repoId.toLowerCase(),
        name: repo.metadata.name || repoId,
        stars: repo.metadata.stars || 0,
        lastAccessedAt: new Date().toISOString(),
      });
    }

    res.json(qaResponse);
  } catch (err: any) {
    next(err);
  }
});

apiRouter.post('/repositories/:owner/:repo/questions/stream', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const repo = await repositoryManager.getRepository(repoId);
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

  const { question, filePath, apiKey, model } = parseResult.data;

  // Relevance Gate: Reject irrelevant queries immediately before chunk retrieval or Gemini calls
  const allFilePaths = repo.files ? repo.files.map((f: any) => f.path) : [];
  const relevance = queryRelevanceService.classify({
    question,
    filePath,
    repoMetadata: repo.metadata,
    allFilePaths,
  });

  if (!relevance.isRelevant) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: citations\ndata: []\n\n`);
    res.write(`event: chunk\ndata: ${JSON.stringify({ text: REJECTION_MESSAGE })}\n\n`);
    res.write(
      `event: done\ndata: ${JSON.stringify({
        isRelevant: false,
        modelUsed: 'relevance-gate',
        answeredAt: new Date().toISOString(),
      })}\n\n`
    );
    res.end();
    return;
  }

  const { citations, stats } = repo.indexer.searchWithStats(question, undefined, filePath);

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send initial citations
  res.write(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`);

  try {
    const geminiService = repositoryManager.getGeminiService();
    const finalAnswer = await geminiService.answerQuestionStream(
      question,
      citations,
      repo.metadata,
      (textChunk) => {
        res.write(`event: chunk\ndata: ${JSON.stringify({ text: textChunk })}\n\n`);
      },
      filePath,
      apiKey,
      model,
      {
        detectedStack: repo.analysis?.overview?.detectedStack,
        entryPoints: repo.analysis?.overview?.entryPoints,
        architecturePattern: repo.analysis?.architecture?.pattern,
        architectureDescription: repo.analysis?.architecture?.description,
      }
    );
    finalAnswer.retrieval = stats;

    // Save Q&A to store (MongoDB Atlas / SQLite / Memory)
    const { userId, sessionId } = getUserAndSession(req);
    const store = repositoryManager.getStore();
    const qaRecordId = `qa_${crypto.randomUUID()}`;
    await store.saveQAHistory({
      id: qaRecordId,
      repoId,
      commitSha: repo.commitSha,
      userId,
      sessionId,
      question,
      answer: finalAnswer.answer,
      citations: finalAnswer.citations,
      modelUsed: finalAnswer.modelUsed,
      createdAt: finalAnswer.answeredAt || new Date().toISOString(),
    });

    if (userId || sessionId) {
      await store.trackUserRepo({
        id: `${userId || sessionId}@${repoId.toLowerCase()}`,
        userId,
        sessionId,
        repoId: repoId.toLowerCase(),
        name: repo.metadata.name || repoId,
        stars: repo.metadata.stars || 0,
        lastAccessedAt: new Date().toISOString(),
      });
    }

    res.write(`event: done\ndata: ${JSON.stringify(finalAnswer)}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message || 'Error generating streaming response' })}\n\n`);
    res.end();
  }
});

// ==========================================
// 6. QUESTION & ANSWER HISTORY
// ==========================================

apiRouter.get('/repositories/:owner/:repo/questions/history', async (req: Request, res: Response) => {
  const repoId = getRepoId(req);
  const { userId, sessionId } = getUserAndSession(req);
  const store = repositoryManager.getStore();

  const history = await store.getQAHistory(repoId, { userId, sessionId });
  res.json({
    repositoryId: repoId,
    history,
  });
});

