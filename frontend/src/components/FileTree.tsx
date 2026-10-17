import React, { useState } from 'react';
import { RepositoryFileNode } from '@codebase-explainer/shared';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  Search,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface FileTreeProps {
  tree: RepositoryFileNode[];
  selectedPath?: string;
  onSelectFile: (path: string) => void;
}

interface TreeNodeProps {
  node: RepositoryFileNode;
  selectedPath?: string;
  onSelectFile: (path: string) => void;
  level: number;
  showResponsibilities?: boolean;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  selectedPath,
  onSelectFile,
  level,
  showResponsibilities,
}) => {
  const [isOpen, setIsOpen] = useState(level < 1); // Expand top level by default

  const isSelected = selectedPath === node.path;
  const isDir = node.type === 'dir';

  const handleClick = () => {
    if (isDir) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        title={node.responsibility ? `${node.path} — ${node.responsibility}` : node.path}
        style={{ paddingLeft: `${level * 14 + 10}px` }}
        className={`group flex items-center justify-between py-1.5 pr-2.5 cursor-pointer text-xs rounded-md transition-colors select-none ${
          isSelected
            ? 'bg-primary-600/20 text-primary-300 font-medium'
            : 'text-slate-300 hover:bg-surface-subtle hover:text-white'
        }`}
      >
        <div className="flex items-center space-x-1.5 truncate mr-2">
          {isDir ? (
            <>
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              )}
              {isOpen ? (
                <FolderOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-primary-400/80 flex-shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              {node.name.endsWith('.md') || node.name.endsWith('.txt') ? (
                <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              ) : (
                <FileCode className="w-3.5 h-3.5 text-accent-cyan flex-shrink-0" />
              )}
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>

        {!isDir && (
          <span className="text-[10px] text-slate-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
            {node.size > 1024 ? `${Math.round(node.size / 1024)}K` : `${node.size}B`}
          </span>
        )}
      </div>

      {!isDir && showResponsibilities && node.responsibility && (
        <div
          style={{ paddingLeft: `${level * 14 + 28}px` }}
          className="text-[10px] text-slate-400 truncate pr-2 leading-tight pb-1 -mt-0.5"
        >
          ↳ {node.responsibility}
        </div>
      )}

      {isDir && isOpen && node.children && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              level={level + 1}
              showResponsibilities={showResponsibilities}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({ tree, selectedPath, onSelectFile }) => {
  const [search, setSearch] = useState('');
  const [showResponsibilities, setShowResponsibilities] = useState(true);

  // Flatten tree for search if query exists
  const filterNodes = (nodes: RepositoryFileNode[], query: string): RepositoryFileNode[] => {
    if (!query) return nodes;

    const filtered: RepositoryFileNode[] = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        if (
          node.path.toLowerCase().includes(query.toLowerCase()) ||
          (node.responsibility && node.responsibility.toLowerCase().includes(query.toLowerCase()))
        ) {
          filtered.push(node);
        }
      } else if (node.children) {
        const matchingChildren = filterNodes(node.children, query);
        if (matchingChildren.length > 0) {
          filtered.push({ ...node, children: matchingChildren });
        }
      }
    }
    return filtered;
  };

  const displayTree = search.trim() ? filterNodes(tree, search.trim()) : tree;

  return (
    <div className="flex flex-col h-full bg-surface-subtle/50 border-r border-surface-border">
      {/* Search Header */}
      <div className="p-3 border-b border-surface-border space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface border border-surface-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
          <span>Files Tree</span>
          <button
            onClick={() => setShowResponsibilities(!showResponsibilities)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              showResponsibilities
                ? 'bg-primary-600/30 text-primary-300 border border-primary-500/40'
                : 'bg-surface hover:text-white text-slate-400 border border-surface-border'
            }`}
            title="Toggle 1-line responsibility notes under filenames"
          >
            {showResponsibilities ? '✓ 1-Liners ON' : '+ 1-Liners'}
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {displayTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            No matching files found.
          </div>
        ) : (
          displayTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              level={0}
              showResponsibilities={showResponsibilities}
            />
          ))
        )}
      </div>
    </div>
  );
};
