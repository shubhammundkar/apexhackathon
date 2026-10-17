import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  FullRepositoryAnalysis,
  RepositoryFileNode,
  SourceFile,
  FileAnalysis,
  SearchCitation,
} from '@codebase-explainer/shared';
import { FileTree } from '../components/FileTree';
import { CodeViewer } from '../components/CodeViewer';
import { MermaidDiagram } from '../components/MermaidDiagram';
import { TechStackBadge } from '../components/TechStackBadge';
import { FindingsCard } from '../components/FindingsCard';
import { QAPanel } from '../components/QAPanel';
import {
  Star,
  Layers,
  FileCode,
  Compass,
  Package,
  ShieldAlert,
  MessageSquare,
  ArrowLeft,
  Terminal,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  FileText,
} from 'lucide-react';

type TabType = 'overview' | 'architecture' | 'files' | 'flow' | 'dependencies' | 'findings';

export const WorkspacePage: React.FC = () => {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [analysis, setAnalysis] = useState<FullRepositoryAnalysis | null>(null);
  const [fileTree, setFileTree] = useState<RepositoryFileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFileContent, setCurrentFileContent] = useState<(SourceFile & { analysis?: FileAnalysis }) | null>(null);
  const [highlightLines, setHighlightLines] = useState<{ start: number; end: number } | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isQaOpen, setIsQaOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [analysisData, treeData] = await Promise.all([
          apiClient.getAnalysis(owner, repo),
          apiClient.getFileTree(owner, repo),
        ]);

        setAnalysis(analysisData);
        setFileTree(treeData.tree);

        // Auto-select entrypoint or first file
        if (analysisData.overview.entryPoints.length > 0) {
          const entry = analysisData.overview.entryPoints[0].path;
          setSelectedFilePath(entry);
          loadFile(entry);
        } else if (treeData.tree.length > 0) {
          const first = findFirstFile(treeData.tree);
          if (first) {
            setSelectedFilePath(first);
            loadFile(first);
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load repository workspace.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [owner, repo]);

  const findFirstFile = (nodes: RepositoryFileNode[]): string | null => {
    for (const node of nodes) {
      if (node.type === 'file') return node.path;
      if (node.children) {
        const nested = findFirstFile(node.children);
        if (nested) return nested;
      }
    }
    return null;
  };

  const loadFile = async (filePath: string, lineRange?: { start: number; end: number }) => {
    if (!owner || !repo) return;
    try {
      const fileData = await apiClient.getFileContent(owner, repo, filePath);
      setCurrentFileContent(fileData);
      setSelectedFilePath(filePath);
      if (lineRange) {
        setHighlightLines(lineRange);
      } else {
        setHighlightLines(undefined);
      }
    } catch (err: any) {
      console.error('Failed to load file content:', err);
    }
  };

  const handleSelectFile = (path: string) => {
    loadFile(path);
    setActiveTab('files');
  };

  const handleNavigateToFile = (path: string, startLine?: number, endLine?: number) => {
    const lineRange = startLine && endLine ? { start: startLine, end: endLine } : undefined;
    loadFile(path, lineRange);
    setActiveTab('files');
  };

  const handleNavigateToCitation = (citation: SearchCitation) => {
    loadFile(citation.filePath, { start: citation.startLine, end: citation.endLine });
    setActiveTab('files');
  };

  const handleAskQuestion = async (question: string, filePath?: string) => {
    if (!owner || !repo) throw new Error('Repository is missing');
    const userApiKey = localStorage.getItem('gemini_custom_api_key') || undefined;
    return await apiClient.askQuestion(owner, repo, {
      question,
      filePath,
      apiKey: userApiKey,
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(id);
    setTimeout(() => setCopiedCommand(null), 1500);
  };

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center space-x-3 text-slate-400">
        <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
        <span className="text-sm font-medium">Loading repository analysis...</span>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface border border-surface-border rounded-xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 text-base">Repository Not Found</h3>
            <p className="text-xs text-slate-400 mt-1">{error || 'This repository has not been indexed yet.'}</p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-background">
      {/* Workspace Sub-header */}
      <div className="h-12 border-b border-surface-border px-4 flex items-center justify-between bg-surface/70 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center space-x-4">
          <Link
            to="/"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-muted transition-colors flex items-center space-x-1 text-xs"
            title="Analyze another repository"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Repo</span>
          </Link>

          <div className="flex items-center space-x-2">
            <span className="font-mono text-xs font-bold text-slate-100">
              {owner} / <span className="text-primary-400">{repo}</span>
            </span>
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-white"
              title="View on GitHub"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="hidden md:flex items-center space-x-3 text-xs text-slate-400">
            <div className="flex items-center space-x-1">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              <span>{analysis.stats.indexedFiles} files</span>
            </div>
            <div className="flex items-center space-x-1">
              <FileText className="w-3.5 h-3.5 text-primary-400" />
              <span>{analysis.stats.totalLines.toLocaleString()} lines</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation Buttons */}
        <div className="flex items-center space-x-1">
          <nav className="flex space-x-1 bg-surface-subtle p-0.5 rounded-lg border border-surface-border">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'overview'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('architecture')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'architecture'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Architecture</span>
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'files'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Files</span>
            </button>

            <button
              onClick={() => setActiveTab('flow')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'flow'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Flow</span>
            </button>

            <button
              onClick={() => setActiveTab('dependencies')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'dependencies'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Dependencies</span>
            </button>

            <button
              onClick={() => setActiveTab('findings')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'findings'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Findings</span>
              {analysis.findings.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/30 text-rose-300 font-semibold">
                  {analysis.findings.length}
                </span>
              )}
            </button>
          </nav>

          <button
            onClick={() => setIsQaOpen(!isQaOpen)}
            className={`p-1.5 rounded-lg border transition-colors flex items-center space-x-1.5 text-xs font-medium ml-2 ${
              isQaOpen
                ? 'bg-primary-600/20 text-primary-400 border-primary-500/30'
                : 'text-slate-400 hover:text-white bg-surface-subtle border-surface-border'
            }`}
            title="Toggle Gemini Q&A Drawer"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden lg:inline">AI Q&A</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left File Tree Sidebar (Visible when Files tab is open or on large screens) */}
        <aside className="w-64 lg:w-72 flex-shrink-0 hidden md:block">
          <FileTree
            tree={fileTree}
            selectedPath={selectedFilePath || undefined}
            onSelectFile={handleSelectFile}
          />
        </aside>

        {/* Center Content Tab View */}
        <main className="flex-1 overflow-y-auto bg-surface-subtle/20">
          {activeTab === 'overview' && (
            <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
              {/* Headline Banner */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    {analysis.overview.projectName}
                  </h2>
                  <span className="text-xs text-slate-400 font-mono">
                    Model: {analysis.modelUsed}
                  </span>
                </div>
                <p className="text-sm font-medium text-primary-300">
                  {analysis.overview.tagline}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysis.overview.detailedSummary}
                </p>
              </div>

              {/* Problem Solved */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-2">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Problem Solved
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysis.overview.problemSolved}
                </p>
              </div>

              {/* Detected Tech Stack */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Detected Technology Stack
                </h3>
                <div className="flex flex-wrap gap-2">
                  {analysis.overview.detectedStack.map((tech) => (
                    <TechStackBadge key={tech.name} item={tech} />
                  ))}
                </div>
              </div>

              {/* Verified Entry Points */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Execution Entry Points
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {analysis.overview.entryPoints.map((ep) => (
                    <div
                      key={ep.path}
                      onClick={() => handleNavigateToFile(ep.path)}
                      className="p-3.5 rounded-lg bg-surface-subtle border border-surface-border hover:border-primary-500/40 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-primary-400 group-hover:underline truncate">
                          {ep.path}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-primary-600/20 text-primary-300 border border-primary-500/30">
                          {ep.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">{ep.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Start Guide */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Quick Start & Local Setup
                </h3>

                {/* Prerequisites */}
                {analysis.overview.quickStartGuide.prerequisites.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-400 block mb-1.5">
                      Prerequisites:
                    </span>
                    <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                      {analysis.overview.quickStartGuide.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Install Commands */}
                {analysis.overview.quickStartGuide.installCommands.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-400 block mb-1.5">
                      Install Dependencies:
                    </span>
                    <div className="space-y-1.5">
                      {analysis.overview.quickStartGuide.installCommands.map((cmd, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-surface-subtle border border-surface-border font-mono text-xs text-slate-200"
                        >
                          <code>{cmd}</code>
                          <button
                            onClick={() => copyToClipboard(cmd, `inst_${i}`)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-muted transition-colors"
                          >
                            {copiedCommand === `inst_${i}` ? (
                              <Check className="w-3.5 h-3.5 text-accent-emerald" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Run Commands */}
                {analysis.overview.quickStartGuide.runCommands.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-400 block mb-1.5">
                      Run Application:
                    </span>
                    <div className="space-y-1.5">
                      {analysis.overview.quickStartGuide.runCommands.map((cmd, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-surface-subtle border border-surface-border font-mono text-xs text-slate-200"
                        >
                          <code>{cmd}</code>
                          <button
                            onClick={() => copyToClipboard(cmd, `run_${i}`)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-muted transition-colors"
                          >
                            {copiedCommand === `run_${i}` ? (
                              <Check className="w-3.5 h-3.5 text-accent-emerald" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="h-full flex flex-col p-4 sm:p-6 space-y-4">
              <div className="bg-surface border border-surface-border rounded-xl p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100 text-sm">
                    Pattern: {analysis.architecture.pattern}
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {analysis.architecture.description}
                  </p>
                </div>
              </div>

              {/* Interactive Mermaid Diagram */}
              <div className="flex-1 min-h-[450px]">
                <MermaidDiagram chart={analysis.architecture.mermaidDiagram} />
              </div>

              {/* Data Flow Description */}
              {analysis.architecture.dataFlowDescription && (
                <div className="bg-surface border border-surface-border rounded-xl p-4 space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Data Flow Execution Trace
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {analysis.architecture.dataFlowDescription}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'files' && (
            <div className="h-full flex flex-col">
              {currentFileContent ? (
                <CodeViewer
                  file={currentFileContent}
                  highlightLines={highlightLines}
                  onNavigateToFile={handleSelectFile}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Select a file from the sidebar to inspect its implementation.
                </div>
              )}
            </div>
          )}

          {activeTab === 'flow' && (
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
              <div className="bg-surface border border-surface-border rounded-xl p-5">
                <h3 className="font-semibold text-slate-100 text-sm">
                  Execution Flow & Request Lifecycle
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Traced step-by-step from verified application entry points through internal layers.
                </p>
              </div>

              {analysis.executionFlows.map((flow, flowIdx) => (
                <div key={flowIdx} className="bg-surface border border-surface-border rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-surface-border pb-3">
                    <div>
                      <h4 className="font-semibold text-primary-400 text-sm">{flow.name}</h4>
                      <p className="text-xs text-slate-300 mt-0.5">{flow.description}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded text-[10px] font-mono bg-surface-subtle text-slate-300 border border-surface-border">
                      Trigger: {flow.trigger}
                    </span>
                  </div>

                  <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-surface-border before:z-0">
                    {flow.steps.map((st) => (
                      <div key={st.step} className="flex items-start space-x-3.5 relative z-10">
                        <div className="w-6 h-6 rounded-full bg-primary-600 text-white font-mono text-[11px] font-bold flex items-center justify-center flex-shrink-0 shadow-md">
                          {st.step}
                        </div>
                        <div className="flex-1 bg-surface-subtle border border-surface-border rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-semibold text-slate-200">
                              {st.functionOrRoute}
                            </span>
                            <div className="flex items-center space-x-2">
                              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-surface text-slate-400 border border-surface-border">
                                {st.layer}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.isConfirmed ? 'text-accent-emerald bg-emerald-500/10' : 'text-accent-amber bg-amber-500/10'}`}>
                                {st.isConfirmed ? 'Verified' : 'Inferred'}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-300">{st.action}</p>
                          {st.file && (
                            <button
                              onClick={() => handleNavigateToFile(st.file)}
                              className="text-[11px] font-mono text-primary-400 hover:underline flex items-center space-x-1 pt-1"
                            >
                              <span>{st.file}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'dependencies' && (
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
              <div className="bg-surface border border-surface-border rounded-xl p-5 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100 text-sm">Package & Dependency Manifest</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Package Manager: <span className="font-mono text-primary-400">{analysis.dependenciesSummary.packageManager || 'Not detected'}</span>
                    {' • '}
                    Lockfile Present: <span className="text-accent-emerald font-semibold">{analysis.dependenciesSummary.hasLockfile ? 'Yes' : 'No'}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface border border-surface-border rounded-xl p-5 space-y-3">
                  <h4 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                    Runtime Dependencies ({analysis.dependenciesSummary.runtimeDependencies.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {analysis.dependenciesSummary.runtimeDependencies.map((dep) => (
                      <TechStackBadge key={dep.name} item={dep} />
                    ))}
                  </div>
                </div>

                <div className="bg-surface border border-surface-border rounded-xl p-5 space-y-3">
                  <h4 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                    Development Dependencies ({analysis.dependenciesSummary.devDependencies.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {analysis.dependenciesSummary.devDependencies.map((dep) => (
                      <TechStackBadge key={dep.name} item={dep} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'findings' && (
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-4">
              <div className="bg-surface border border-surface-border rounded-xl p-5">
                <h3 className="font-semibold text-slate-100 text-sm">
                  Code Quality, Security & Architecture Audit
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Surfaced code smells, potential bugs, missing tests, and security weaknesses grounded in actual repository files.
                </p>
              </div>

              {analysis.findings.length === 0 ? (
                <div className="bg-surface border border-surface-border rounded-xl p-8 text-center space-y-2">
                  <span className="text-accent-emerald text-sm font-semibold">No critical defects detected</span>
                  <p className="text-xs text-slate-400">
                    The automated audit did not identify high-severity security or architectural flaws in the sampled source files.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {analysis.findings.map((f) => (
                    <FindingsCard
                      key={f.id}
                      finding={f}
                      onNavigateToFile={handleNavigateToFile}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Right Collapsible Gemini Q&A Drawer */}
        <QAPanel
          isOpen={isQaOpen}
          onClose={() => setIsQaOpen(false)}
          onAskQuestion={handleAskQuestion}
          currentFilePath={selectedFilePath || undefined}
          onNavigateToCitation={handleNavigateToCitation}
        />
      </div>
    </div>
  );
};
