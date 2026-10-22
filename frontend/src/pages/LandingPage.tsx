import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../api/client';
import { ProgressBar } from '../components/ProgressBar';
import { IngestionProgress } from '@codebase-explainer/shared';
import {
  Github,
  Sparkles,
  Layers,
  ShieldAlert,
  GitBranch,
  Terminal,
  ArrowRight,
} from 'lucide-react';

const SAMPLE_REPOS = [
  { name: 'expressjs/express', url: 'https://github.com/expressjs/express', desc: 'Fast, unopinionated, minimalist web framework for Node.js' },
  { name: 'pallets/flask', url: 'https://github.com/pallets/flask', desc: 'The Python micro framework for building web applications' },
  { name: 'facebook/react', url: 'https://github.com/facebook/react', desc: 'The library for web and native user interfaces' },
  { name: 'fastapi/fastapi', url: 'https://github.com/fastapi/fastapi', desc: 'Modern, fast (high-performance) Python web framework' },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);

  const pollIntervalRef = React.useRef<any>(null);

  // Poll job status until complete or failed
  const startPolling = (jobId: string, repositoryId: string) => {
    setActiveJobId(jobId);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const job = await apiClient.getJobStatus(jobId);
        setProgress(job.progress);

        if (job.status === 'completed') {
          clearInterval(pollIntervalRef.current);
          setTimeout(() => {
            navigate(`/workspace/${repositoryId}`);
          }, 600);
        } else if (job.status === 'failed') {
          clearInterval(pollIntervalRef.current);
          setErrorMessage(job.progress.error || 'Ingestion failed. Please check repository URL or API limits.');
        }
      } catch (err: any) {
        clearInterval(pollIntervalRef.current);
        setErrorMessage(err.message || 'Error checking job status');
      }
    }, 1200);
  };

  React.useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleAnalyze = async (urlToAnalyze?: string) => {
    const targetUrl = (urlToAnalyze || repoUrl).trim();
    setErrorMessage(null);

    if (!targetUrl) {
      setErrorMessage('Please enter a GitHub repository URL.');
      return;
    }

    try {
      const userApiKey = localStorage.getItem('gemini_custom_api_key') || undefined;
      const userModel = localStorage.getItem('gemini_selected_model') || undefined;

      setProgress({
        stage: 'validating',
        message: 'Validating GitHub URL and initiating worker...',
        percent: 5,
      });

      const response = await apiClient.startAnalysis({
        url: targetUrl,
        apiKey: userApiKey,
        branch: branch.trim() || undefined,
        model: userModel,
      });

      startPolling(response.jobId, response.repositoryId);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(err.message || 'Failed to start repository analysis.');
      }
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    setIsCancelling(true);
    try {
      await apiClient.cancelJob(activeJobId);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setProgress((prev) => (prev ? { ...prev, stage: 'failed', message: 'Cancelled by user', percent: 100 } : null));
      setErrorMessage('Analysis job was cancelled.');
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsCancelling(false);
      setActiveJobId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col justify-between">
      {/* Hero Section */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-12 w-full space-y-8">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-600 dark:text-primary-400 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Grounded Codebase Understanding with Gemini 2.5</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            Understand any unfamiliar codebase <span className="bg-gradient-to-r from-primary-600 via-sky-500 to-indigo-600 dark:from-primary-400 dark:via-indigo-300 dark:to-accent-cyan bg-clip-text text-transparent">in minutes</span>
          </h1>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Paste any public GitHub repository URL. Codebase Explainer AI inspects real source files, maps architecture, visualizes execution flows, surfaces code risks, and answers technical questions with line citations.
          </p>
        </div>

        {/* Input Card */}
        <div className="max-w-3xl mx-auto bg-surface border border-surface-border rounded-2xl p-4 sm:p-6 shadow-xl shadow-sky-500/5 dark:shadow-2xl dark:shadow-black/40 space-y-4 transition-colors">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAnalyze();
            }}
            className="space-y-3"
          >
            <div className="relative flex items-center">
              <Github className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="https://github.com/owner/repository"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={Boolean(activeJobId)}
                className="w-full bg-surface-subtle border border-surface-border rounded-xl pl-11 pr-32 sm:pr-40 py-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all font-mono disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={Boolean(activeJobId) || !repoUrl.trim()}
                className="absolute right-2 px-4 sm:px-6 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-semibold transition-all shadow-md shadow-primary-600/25 flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-primary-600"
              >
                <span>Analyze</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Optional Branch Override Toggle */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center space-x-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>{showAdvanced ? 'Hide advanced branch option' : 'Specify branch or tag (optional)'}</span>
              </button>
            </div>

            {showAdvanced && (
              <div className="pt-2">
                <input
                  type="text"
                  placeholder="e.g. main, master, v2.0 (defaults to default branch)"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={Boolean(activeJobId)}
                  className="w-full bg-surface-subtle border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-500 font-mono"
                />
              </div>
            )}
          </form>

          {/* Error Callout */}
          {errorMessage && (
            <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-300">
              <span className="font-semibold block mb-0.5">Analysis Failed</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Active Ingestion Progress */}
          {progress && (
            <div className="pt-2">
              <ProgressBar
                progress={progress}
                onCancel={handleCancel}
                isCancelling={isCancelling}
              />
            </div>
          )}
        </div>

        {/* Sample Repositories to Try */}
        <div className="max-w-3xl mx-auto space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block px-1">
            Or try an example repository:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {SAMPLE_REPOS.map((sample) => (
              <div
                key={sample.name}
                onClick={() => {
                  setRepoUrl(sample.url);
                  handleAnalyze(sample.url);
                }}
                className="p-3 rounded-xl bg-surface/70 hover:bg-surface border border-surface-border hover:border-primary-400 dark:hover:border-slate-700 cursor-pointer transition-all group flex items-start justify-between shadow-sm"
              >
                <div className="space-y-1 truncate mr-2">
                  <div className="flex items-center space-x-1.5">
                    <Github className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
                    <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                      {sample.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{sample.desc}</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 flex-shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
              </div>
            ))}
          </div>
        </div>

        {/* Feature Grid */}
        <div className="pt-8 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-surface/70 border border-surface-border space-y-2.5 shadow-sm">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Architecture Diagrams</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Auto-generate interactive Mermaid architecture maps detailing frontend, backend, database, and API layers with data flows.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-surface/70 border border-surface-border space-y-2.5 shadow-sm">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-cyan-400 flex items-center justify-center">
              <Terminal className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Execution Flow Tracing</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Trace how requests enter the app and execute step-by-step from verified entry points through routes and services.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-surface/70 border border-surface-border space-y-2.5 shadow-sm">
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Security & Code Audits</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Pinpoint potential bugs, security flaws, missing tests, and architectural smells with exact file and line references.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-surface-border py-4 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
        <p>Built with React, TypeScript, Node.js, Express, and Google Gemini API.</p>
      </footer>
    </div>
  );
};
