import React, { useState, useMemo } from 'react';
import { RepositoryFileNode } from '@codebase-explainer/shared';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  ArrowRight,
  Layers,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';

interface InteractiveFileTreeStructureProps {
  tree: RepositoryFileNode[];
  onSelectFile: (filePath: string) => void;
  selectedFilePath?: string | null;
}

interface TreeNodeItemProps {
  node: RepositoryFileNode;
  level: number;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  selectedFilePath?: string | null;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  level,
  expandedFolders,
  toggleFolder,
  onSelectFile,
  selectedFilePath,
}) => {
  const isDir = node.type === 'dir';
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFilePath === node.path;

  // Count total files recursively inside a folder
  const countFilesInNode = (n: RepositoryFileNode): number => {
    if (n.type === 'file') return 1;
    if (!n.children) return 0;
    return n.children.reduce((acc, child) => acc + countFilesInNode(child), 0);
  };

  const totalNestedFiles = isDir ? countFilesInNode(node) : 0;

  if (isDir) {
    return (
      <div className="select-none">
        {/* Folder Header Row */}
        <div
          onClick={() => toggleFolder(node.path)}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
          className="flex items-center justify-between py-2 px-3 hover:bg-surface-subtle/70 cursor-pointer rounded-lg transition-colors group border-b border-surface-border/40"
        >
          <div className="flex items-center space-x-2 truncate">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-primary-400 flex-shrink-0 transition-colors" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-primary-400 flex-shrink-0 transition-colors" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-primary-400/80 flex-shrink-0" />
            )}
            <span className="font-mono text-xs font-bold text-slate-200 group-hover:text-white transition-colors">
              {node.name}/
            </span>
          </div>

          <span className="text-[11px] font-mono text-slate-500 bg-surface px-2 py-0.5 rounded border border-surface-border">
            {totalNestedFiles} {totalNestedFiles === 1 ? 'file' : 'files'}
          </span>
        </div>

        {/* Children indented under folder with connector line */}
        {isExpanded && node.children && node.children.length > 0 && (
          <div className="relative border-l border-surface-border/60 ml-5 pl-1 my-0.5 space-y-1">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                level={level + 1}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                onSelectFile={onSelectFile}
                selectedFilePath={selectedFilePath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File Row with 1-Line Responsibility
  const isDoc = node.name.endsWith('.md') || node.name.endsWith('.txt');

  return (
    <div
      style={{ paddingLeft: `${level * 20 + 8}px` }}
      className={`p-3 rounded-lg border transition-all duration-150 flex flex-col md:flex-row md:items-center justify-between gap-2.5 ${
        isSelected
          ? 'bg-primary-950/30 border-primary-500/50 shadow-sm'
          : 'bg-surface/70 hover:bg-surface border-surface-border/80 hover:border-primary-500/40'
      }`}
    >
      <div className="space-y-1.5 flex-1 min-w-0 mr-2">
        {/* File name & badges */}
        <div className="flex items-center space-x-2 truncate">
          {isDoc ? (
            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
          ) : (
            <FileCode className="w-4 h-4 text-accent-cyan flex-shrink-0" />
          )}
          <span
            onClick={() => onSelectFile(node.path)}
            className="font-mono text-xs font-semibold text-slate-100 hover:text-primary-300 cursor-pointer transition-colors truncate"
          >
            {node.name}
          </span>
          {node.language && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono uppercase bg-surface-subtle text-slate-400 border border-surface-border flex-shrink-0">
              {node.language}
            </span>
          )}
          {node.lineCount && (
            <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
              {node.lineCount} lines
            </span>
          )}
        </div>

        {/* 1-Line "What does it do" description */}
        <div className="text-xs text-slate-300 flex items-start space-x-1.5 pl-6 bg-surface-subtle/60 border border-surface-border/60 py-1 px-2.5 rounded-md">
          <Layers className="w-3.5 h-3.5 text-primary-400 flex-shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="text-primary-400 font-semibold mr-1.5">Responsibility:</span>
            <span className="text-slate-300">
              {node.responsibility || `Source module implementing logic for ${node.name}`}
            </span>
          </div>
        </div>
      </div>

      {/* Inspect Code Button */}
      <button
        onClick={() => onSelectFile(node.path)}
        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600/20 hover:bg-primary-600 text-primary-300 hover:text-white border border-primary-500/30 transition-all flex-shrink-0 self-start md:self-center"
      >
        <span>Inspect Code</span>
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
};

export const InteractiveFileTreeStructure: React.FC<InteractiveFileTreeStructureProps> = ({
  tree,
  onSelectFile,
  selectedFilePath,
}) => {
  const [search, setSearch] = useState('');
  const [selectedLang, setSelectedLang] = useState('all');

  // Collect all folder paths initially to expand by default
  const getAllFolderPaths = (nodes: RepositoryFileNode[]): string[] => {
    let paths: string[] = [];
    for (const node of nodes) {
      if (node.type === 'dir') {
        paths.push(node.path);
        if (node.children) {
          paths = paths.concat(getAllFolderPaths(node.children));
        }
      }
    }
    return paths;
  };

  const allFolderPaths = useMemo(() => getAllFolderPaths(tree), [tree]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(allFolderPaths)
  );

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedFolders(new Set(allFolderPaths));
  const collapseAll = () => setExpandedFolders(new Set());

  // Filter tree recursively based on search and language
  const filterTree = (
    nodes: RepositoryFileNode[],
    query: string,
    lang: string
  ): RepositoryFileNode[] => {
    const q = query.trim().toLowerCase();
    const result: RepositoryFileNode[] = [];

    for (const node of nodes) {
      if (node.type === 'file') {
        const matchesQuery =
          !q ||
          node.name.toLowerCase().includes(q) ||
          node.path.toLowerCase().includes(q) ||
          (node.responsibility && node.responsibility.toLowerCase().includes(q));

        const matchesLang =
          lang === 'all' ||
          (node.language && node.language.toLowerCase() === lang.toLowerCase());

        if (matchesQuery && matchesLang) {
          result.push(node);
        }
      } else if (node.children) {
        const matchingChildren = filterTree(node.children, query, lang);
        if (matchingChildren.length > 0) {
          result.push({
            ...node,
            children: matchingChildren,
          });
        }
      }
    }
    return result;
  };

  const filteredTree = useMemo(
    () => filterTree(tree, search, selectedLang),
    [tree, search, selectedLang]
  );

  // Extract all unique languages for filter chips
  const languages = useMemo(() => {
    const set = new Set<string>();
    const collectLangs = (nodes: RepositoryFileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file' && n.language) {
          set.add(n.language);
        } else if (n.children) {
          collectLangs(n.children);
        }
      }
    };
    collectLangs(tree);
    return Array.from(set).sort();
  }, [tree]);

  // Count total files in the tree
  const totalFilesCount = useMemo(() => {
    let count = 0;
    const countFiles = (nodes: RepositoryFileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') count++;
        else if (n.children) countFiles(n.children);
      }
    };
    countFiles(tree);
    return count;
  }, [tree]);

  return (
    <div className="bg-surface border border-surface-border rounded-xl shadow-sm overflow-hidden flex flex-col">
      {/* Tree Controls Toolbar */}
      <div className="p-4 border-b border-surface-border space-y-3 bg-surface-subtle/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm text-slate-100">
              Interactive Repository File Tree
            </span>
            <span className="text-xs text-primary-400 font-mono bg-primary-950/40 border border-primary-500/30 px-2 py-0.5 rounded-full">
              {totalFilesCount} total files
            </span>
          </div>

          {/* Expand / Collapse All buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={expandAll}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-300 hover:text-white bg-surface hover:bg-surface-muted border border-surface-border transition-colors flex items-center space-x-1"
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
              <span>Expand All</span>
            </button>
            <button
              onClick={collapseAll}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-300 hover:text-white bg-surface hover:bg-surface-muted border border-surface-border transition-colors flex items-center space-x-1"
            >
              <ChevronsDownUp className="w-3.5 h-3.5" />
              <span>Collapse All</span>
            </button>
          </div>
        </div>

        {/* Search bar & Language Filters */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5 pt-1">
          <div className="relative w-full md:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter tree by filename, extension, or responsibility..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface border border-surface-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          {/* Language filter pills */}
          <div className="flex items-center space-x-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
            <button
              onClick={() => setSelectedLang('all')}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex-shrink-0 ${
                selectedLang === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface text-slate-400 hover:text-white border border-surface-border'
              }`}
            >
              All ({totalFilesCount})
            </button>
            {languages.map((lang) => (
              <button
                key={lang}
                onClick={() => setSelectedLang(lang)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize transition-colors flex-shrink-0 ${
                  selectedLang === lang
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface text-slate-400 hover:text-white border border-surface-border'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hierarchical Tree Body */}
      <div className="p-4 space-y-2 overflow-y-auto max-h-[70vh]">
        {filteredTree.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 space-y-2">
            <div>No files in tree matching "{search}".</div>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-xs text-primary-400 hover:underline"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              level={0}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              onSelectFile={onSelectFile}
              selectedFilePath={selectedFilePath}
            />
          ))
        )}
      </div>
    </div>
  );
};
