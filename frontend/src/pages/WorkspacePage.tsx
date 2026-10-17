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
import { InteractiveFileTreeStructure } from '../components/InteractiveFileTreeStructure';
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
  Search,
  BookOpen,
  Cpu,
  Code2,
  ArrowRight,
  FolderTree,
  Sparkles,
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

  // Files tab dual mode (Directory Catalog vs Code Inspector)
  const [filesViewMode, setFilesViewMode] = useState<'directory' | 'inspector'>('directory');
  const [fileStructureStyle, setFileStructureStyle] = useState<'tree' | 'catalog'>('tree');
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [selectedLangFilter, setSelectedLangFilter] = useState('all');
  const [repositoryFiles, setRepositoryFiles] = useState<{
    path: string;
    name: string;
    language: string;
    size?: number;
    lineCount?: number;
    responsibility: string;
  }[]>([]);

  // Architecture 3-Way Mode (Beginner, Low-Level Technical, Full Technical Blueprint)
  const [archExplanationTier, setArchExplanationTier] = useState<'beginner' | 'lowlevel' | 'deep'>('beginner');

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
        if (treeData.files && treeData.files.length > 0) {
          setRepositoryFiles(treeData.files);
        }

        // Auto-select entrypoint or first file for inspection buffer
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

      // Ensure fileData always has a 1-line responsibility banner
      if (!fileData.analysis && analysis) {
        const found = analysis.importantFiles?.find(
          (f) => f.path.toLowerCase() === filePath.toLowerCase()
        );
        if (found) {
          fileData.analysis = found;
        } else {
          fileData.analysis = {
            path: filePath,
            responsibility: `Implements logic and module exports for ${filePath.split('/').pop()}`,
            language: fileData.language,
            lineCount: fileData.lineCount,
            importance: 'medium',
            exports: [],
            imports: [],
            keyFunctions: [],
            connectedFiles: [],
            summary: `Source code file: ${filePath}`,
          };
        }
      }

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
    setFilesViewMode('inspector');
    setActiveTab('files');
  };

  const handleNavigateToFile = (path: string, startLine?: number, endLine?: number) => {
    const lineRange = startLine && endLine ? { start: startLine, end: endLine } : undefined;
    loadFile(path, lineRange);
    setFilesViewMode('inspector');
    setActiveTab('files');
  };

  const handleNavigateToCitation = (citation: SearchCitation) => {
    loadFile(citation.filePath, { start: citation.startLine, end: citation.endLine });
    setFilesViewMode('inspector');
    setActiveTab('files');
  };

  // Extract ALL files across the repository with 1-line responsibility
  const allFilesList = React.useMemo(() => {
    if (repositoryFiles.length > 0) {
      return repositoryFiles;
    }

    const impMap = new Map<string, string>();
    if (analysis?.importantFiles) {
      analysis.importantFiles.forEach((f) =>
        impMap.set(f.path.toLowerCase(), f.responsibility)
      );
    }

    const extracted: {
      path: string;
      name: string;
      language: string;
      lineCount?: number;
      size?: number;
      responsibility: string;
    }[] = [];

    const traverse = (nodes: RepositoryFileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') {
          const resp =
            n.responsibility ||
            impMap.get(n.path.toLowerCase()) ||
            `Source module implementing ${n.name}`;
          extracted.push({
            path: n.path,
            name: n.name,
            language: n.language || 'text',
            lineCount: n.lineCount,
            size: n.size,
            responsibility: resp,
          });
        } else if (n.children) {
          traverse(n.children);
        }
      }
    };

    traverse(fileTree);
    return extracted;
  }, [repositoryFiles, analysis, fileTree]);

  // Filtered files list for directory search
  const filteredFilesList = React.useMemo(() => {
    return allFilesList.filter((f) => {
      const matchesSearch =
        fileSearchQuery === '' ||
        f.path.toLowerCase().includes(fileSearchQuery.toLowerCase()) ||
        f.responsibility.toLowerCase().includes(fileSearchQuery.toLowerCase());
      const matchesLang =
        selectedLangFilter === 'all' || f.language.toLowerCase() === selectedLangFilter.toLowerCase();
      return matchesSearch && matchesLang;
    });
  }, [allFilesList, fileSearchQuery, selectedLangFilter]);


  // Unique languages for filter chips
  const uniqueLanguages = React.useMemo(() => {
    const set = new Set<string>();
    allFilesList.forEach((f) => {
      if (f.language) set.add(f.language);
    });
    return Array.from(set).sort();
  }, [allFilesList]);

  const handleAskQuestion = async (
    question: string,
    filePath?: string,
    onChunk?: (chunk: string) => void,
    onCitations?: (citations: SearchCitation[]) => void
  ) => {
    if (!owner || !repo) throw new Error('Repository is missing');
    const userApiKey = localStorage.getItem('gemini_custom_api_key') || undefined;
    return await apiClient.askQuestionStream(
      owner,
      repo,
      {
        question,
        filePath,
        apiKey: userApiKey,
      },
      {
        onChunk,
        onCitations,
      }
    );
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
              onClick={() => {
                setActiveTab('files');
                setFilesViewMode('directory');
              }}
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
            <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
              {/* Architecture Header & 3-Way Mode Switcher */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Layers className="w-5 h-5 text-primary-400" />
                      <h2 className="text-lg font-bold text-white tracking-tight">
                        Architecture & System Blueprint
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Structural breakdown of {analysis.overview.projectName} grounded in repository source files.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-primary-600/20 text-primary-300 border border-primary-500/30">
                      Pattern: {analysis.architecture.pattern}
                    </span>
                  </div>
                </div>

                {/* 3-Way Explanation Mode Selector */}
                <div className="pt-3 border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-accent-amber" />
                    <span className="text-xs font-semibold text-slate-300">Explanation Mode:</span>
                  </div>

                  <div className="flex bg-surface-subtle p-1 rounded-lg border border-surface-border space-x-1">
                    <button
                      onClick={() => setArchExplanationTier('beginner')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                        archExplanationTier === 'beginner'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>🟢</span>
                      <span>Beginner (ELI5)</span>
                    </button>

                    <button
                      onClick={() => setArchExplanationTier('lowlevel')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                        archExplanationTier === 'lowlevel'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>🟡</span>
                      <span>Low-Level Technical</span>
                    </button>

                    <button
                      onClick={() => setArchExplanationTier('deep')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                        archExplanationTier === 'deep'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>🟣</span>
                      <span>Full Technical Blueprint</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Dynamic Architecture Explanation Box Based on Selected Tier */}
              {archExplanationTier === 'beginner' && (
                <div className="bg-surface border border-emerald-500/30 rounded-xl p-6 space-y-4 bg-gradient-to-br from-surface to-emerald-950/20">
                  <div className="flex items-center space-x-2 text-emerald-400 text-sm font-bold">
                    <BookOpen className="w-4 h-4" />
                    <span>How This Project Works (Beginner / Plain English)</span>
                  </div>

                  <p className="text-sm text-slate-200 leading-relaxed font-sans">
                    <strong>{analysis.overview.projectName}</strong> is built to solve a clear problem:{' '}
                    <span className="text-emerald-300 font-medium">{analysis.overview.problemSolved}</span>.
                    Think of the application as a coordinated team: the frontend acts as the welcoming storefront that gathers user instructions; the backend server operates as the kitchen manager dispatching tasks; and the database or AI models serve as the intelligence hub providing instant, verified results.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div className="p-3.5 rounded-lg bg-surface-subtle/80 border border-surface-border space-y-1">
                      <div className="text-xs font-bold text-primary-300">1. User Interface (Frontend)</div>
                      <p className="text-[11px] text-slate-400">
                        Presents the interactive dashboard where you enter queries, inspect files, and browse diagrams.
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-subtle/80 border border-surface-border space-y-1">
                      <div className="text-xs font-bold text-accent-cyan">2. Core Server (Backend)</div>
                      <p className="text-[11px] text-slate-400">
                        Processes requests, coordinates security, and runs application logic.
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-subtle/80 border border-surface-border space-y-1">
                      <div className="text-xs font-bold text-accent-amber">3. Reasoning & Storage</div>
                      <p className="text-[11px] text-slate-400">
                        Uses AI intelligence and indexing to provide exact citations without guessing.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {archExplanationTier === 'lowlevel' && (
                <div className="bg-surface border border-amber-500/30 rounded-xl p-6 space-y-4 bg-gradient-to-br from-surface to-amber-950/20">
                  <div className="flex items-center space-x-2 text-amber-400 text-sm font-bold">
                    <Cpu className="w-4 h-4" />
                    <span>Low-Level System Mechanics & Component Interaction</span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans">
                    The codebase follows a <strong>{analysis.architecture.pattern}</strong> style.{' '}
                    {analysis.architecture.description}
                  </p>

                  <div className="bg-surface-subtle border border-surface-border rounded-lg p-4 space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                      Data Flow & Request Lifecycle
                    </span>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {analysis.architecture.dataFlowDescription ||
                        'Clients issue requests to entrypoints, which serialize through middleware pipelines, execute business logic services, query cache/indexing layers, and stream back typed payloads.'}
                    </p>
                  </div>
                </div>
              )}

              {archExplanationTier === 'deep' && (
                <div className="bg-surface border border-purple-500/30 rounded-xl p-6 space-y-4 bg-gradient-to-br from-surface to-purple-950/20">
                  <div className="flex items-center space-x-2 text-purple-400 text-sm font-bold">
                    <Code2 className="w-4 h-4" />
                    <span>Full Technical Blueprint & Architectural Layers</span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    Systems architecture powered by{' '}
                    <span className="text-purple-300 font-mono">
                      {analysis.overview.detectedStack.map((s) => s.name).join(', ')}
                    </span>
                    . Concurrency and async I/O execute across {analysis.stats.indexedFiles} indexed source files with strict type contracts.
                  </p>

                  {/* Architecture Layers Breakdown */}
                  {analysis.architecture.layers.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      {analysis.architecture.layers.map((layer) => (
                        <div key={layer.name} className="p-4 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-slate-200">{layer.name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-900/30 text-purple-300 border border-purple-500/30 uppercase">
                              {layer.type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">{layer.description}</p>
                          {layer.files.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1.5">
                              {layer.files.slice(0, 4).map((f) => (
                                <button
                                  key={f}
                                  onClick={() => handleNavigateToFile(f)}
                                  className="text-[10px] font-mono text-primary-400 hover:underline bg-surface border border-surface-border px-1.5 py-0.5 rounded"
                                >
                                  {f}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Interactive Mermaid Diagram Canvas */}
              <div className="bg-surface border border-surface-border rounded-xl p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FolderTree className="w-4 h-4 text-primary-400" />
                    <h3 className="font-bold text-sm text-slate-100">
                      Architecture Flowchart & Component Wiring
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">Interactive SVG diagram</span>
                </div>

                <div className="min-h-[420px] bg-surface-subtle/40 rounded-lg p-2 border border-surface-border">
                  <MermaidDiagram chart={analysis.architecture.mermaidDiagram} />
                </div>

                {/* Executive Takeaway Under Diagram */}
                <div className="p-4 rounded-lg bg-primary-950/20 border border-primary-500/20 text-xs text-slate-300 flex items-start space-x-2.5">
                  <span className="text-base">💡</span>
                  <div>
                    <strong className="text-primary-300">Architecture at a Glance:</strong> Just by reading this diagram, others can understand that <strong>{analysis.overview.projectName}</strong> organizes its logic using a <em>{analysis.architecture.pattern}</em> architecture to execute <em>{analysis.overview.problemSolved}</em>.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="h-full flex flex-col">
              {/* Files Tab Header Bar with Mode Switcher */}
              <div className="h-12 border-b border-surface-border px-4 flex items-center justify-between bg-surface/90 backdrop-blur-sm flex-shrink-0">
                <div className="flex items-center space-x-2">
                  <div className="flex bg-surface-subtle p-0.5 rounded-lg border border-surface-border">
                    <button
                      onClick={() => setFilesViewMode('directory')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                        filesViewMode === 'directory'
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FolderTree className="w-3.5 h-3.5" />
                      <span>File Structure & Purpose Guide ({allFilesList.length})</span>
                    </button>

                    <button
                      onClick={() => setFilesViewMode('inspector')}
                      disabled={!currentFileContent}
                      className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                        filesViewMode === 'inspector'
                          ? 'bg-primary-600 text-white shadow-sm'
                          : currentFileContent
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-600 cursor-not-allowed'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[180px]">
                        {selectedFilePath ? selectedFilePath.split('/').pop() : 'Source Code Inspector'}
                      </span>
                    </button>
                  </div>
                </div>

                {filesViewMode === 'inspector' ? (
                  <button
                    onClick={() => setFilesViewMode('directory')}
                    className="text-xs text-primary-400 hover:text-primary-300 flex items-center space-x-1 font-medium transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to File Structure</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400 hidden sm:inline">
                    Click any file to inspect code with line-by-line responsibility
                  </span>
                )}
              </div>

              {/* Content Mode 1: Directory Catalog with 1-line Purpose */}
              {filesViewMode === 'directory' && (
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  {/* View Style Switcher Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-surface-border rounded-xl p-4 shadow-sm">
                    <div>
                      <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2">
                        <FolderTree className="w-4 h-4 text-primary-400" />
                        <span>Project File Structure & Purpose Directory</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {allFilesList.length} total files annotated with 1-line responsibilities.
                      </p>
                    </div>

                    <div className="flex bg-surface-subtle p-0.5 rounded-lg border border-surface-border">
                      <button
                        onClick={() => setFileStructureStyle('tree')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
                          fileStructureStyle === 'tree'
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <FolderTree className="w-3.5 h-3.5" />
                        <span>Interactive Tree View</span>
                      </button>
                      <button
                        onClick={() => setFileStructureStyle('catalog')}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
                          fileStructureStyle === 'catalog'
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        <span>Flat Cards View</span>
                      </button>
                    </div>
                  </div>

                  {/* Render Interactive Tree View or Flat Catalog */}
                  {fileStructureStyle === 'tree' ? (
                    <InteractiveFileTreeStructure
                      tree={fileTree}
                      onSelectFile={handleSelectFile}
                      selectedFilePath={selectedFilePath}
                    />
                  ) : (
                    <div className="space-y-4">
                      {/* Search and Filter Controls */}
                      <div className="bg-surface border border-surface-border rounded-xl p-4 space-y-3 shadow-sm">
                        <div className="relative w-full">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Search files by path or responsibility..."
                            value={fileSearchQuery}
                            onChange={(e) => setFileSearchQuery(e.target.value)}
                            className="w-full bg-surface-subtle border border-surface-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                          />
                        </div>

                        {/* Language Filter Chips */}
                        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
                          <button
                            onClick={() => setSelectedLangFilter('all')}
                            className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors flex-shrink-0 ${
                              selectedLangFilter === 'all'
                                ? 'bg-primary-600 text-white'
                                : 'bg-surface-subtle text-slate-400 hover:text-white border border-surface-border'
                            }`}
                          >
                            All ({allFilesList.length})
                          </button>
                          {uniqueLanguages.map((lang) => (
                            <button
                              key={lang}
                              onClick={() => setSelectedLangFilter(lang)}
                              className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium capitalize transition-colors flex-shrink-0 ${
                                selectedLangFilter === lang
                                  ? 'bg-primary-600 text-white'
                                  : 'bg-surface-subtle text-slate-400 hover:text-white border border-surface-border'
                              }`}
                            >
                              {lang}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Cards List */}
                      <div className="space-y-3">
                        {filteredFilesList.length === 0 ? (
                          <div className="bg-surface border border-surface-border rounded-xl p-8 text-center text-xs text-slate-400">
                            No files matching "{fileSearchQuery}".
                          </div>
                        ) : (
                          filteredFilesList.map((file) => (
                            <div
                              key={file.path}
                              className="bg-surface border border-surface-border hover:border-primary-500/50 rounded-xl p-4 transition-all duration-200 space-y-2 group"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center space-x-2.5 truncate">
                                  <FileCode className="w-4 h-4 text-primary-400 flex-shrink-0" />
                                  <span className="font-mono text-xs font-semibold text-slate-100 group-hover:text-primary-300 transition-colors">
                                    {file.path}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-surface-subtle text-slate-400 border border-surface-border">
                                    {file.language}
                                  </span>
                                  {file.lineCount && (
                                    <span className="text-[11px] text-slate-500 font-mono">
                                      {file.lineCount} lines
                                    </span>
                                  )}
                                </div>

                                <button
                                  onClick={() => handleSelectFile(file.path)}
                                  className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-primary-600/20 hover:bg-primary-600 text-primary-300 hover:text-white border border-primary-500/30 transition-all"
                                >
                                  <span>Inspect Code</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* 1-Line Responsibility Banner */}
                              <div className="flex items-start space-x-2 text-xs bg-surface-subtle/80 border border-surface-border/80 px-3 py-2 rounded-lg">
                                <Layers className="w-3.5 h-3.5 text-primary-400 flex-shrink-0 mt-0.5" />
                                <div className="leading-snug">
                                  <span className="font-semibold text-slate-200 mr-1.5">Responsibility:</span>
                                  <span className="text-slate-300">{file.responsibility}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Content Mode 2: Source Code Inspector */}
              {filesViewMode === 'inspector' && (
                <div className="flex-1 overflow-hidden">
                  {currentFileContent ? (
                    <CodeViewer
                      file={currentFileContent}
                      highlightLines={highlightLines}
                      onNavigateToFile={handleSelectFile}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                      Select a file from the list or sidebar to inspect its implementation.
                    </div>
                  )}
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
