import React, { useEffect, useRef, useState } from 'react';
import { SourceFile, FileAnalysis } from '@codebase-explainer/shared';
import { Copy, Check, FileCode, Layers, ArrowUpRight } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-yaml.js';

interface CodeViewerProps {
  file: SourceFile & { analysis?: FileAnalysis };
  highlightLines?: { start: number; end: number };
  onNavigateToFile?: (path: string) => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  file,
  highlightLines,
  onNavigateToFile,
}) => {
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    Prism.highlightAll();
  }, [file.content, file.path]);

  // Scroll to highlighted line range if specified
  useEffect(() => {
    if (highlightLines && targetLineRef.current) {
      targetLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightLines, file.path]);

  const handleCopy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lines = file.content.split('\n');

  return (
    <div className="flex flex-col h-full bg-surface-subtle/30 overflow-hidden" ref={containerRef}>
      {/* File Header Bar */}
      <div className="h-11 border-b border-surface-border px-4 flex items-center justify-between bg-surface/90 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center space-x-2.5 truncate mr-2">
          <FileCode className="w-4 h-4 text-primary-500 dark:text-accent-cyan flex-shrink-0" />
          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {file.path}
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-surface-muted text-slate-600 dark:text-slate-400 border border-surface-border">
            {file.language}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {lines.length} lines • {Math.round(file.size / 1024)} KB
          </span>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-surface-subtle hover:bg-surface-muted border border-surface-border transition-colors"
            title="Copy file contents"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-accent-emerald" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* File Analysis Summary Drawer (if parsed) */}
      {file.analysis && (
        <div className="px-4 py-2.5 bg-surface/50 border-b border-surface-border text-xs flex-shrink-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-slate-700 dark:text-slate-300">
            <div className="flex items-center space-x-1">
              <Layers className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
              <span className="font-semibold text-slate-800 dark:text-slate-200">Responsibility:</span>
              <span className="text-slate-600 dark:text-slate-400">{file.analysis.responsibility}</span>
            </div>

            {file.analysis.exports.length > 0 && (
              <div className="flex items-center space-x-1">
                <span className="text-slate-500 font-mono">Exports:</span>
                <span className="font-mono text-[11px] text-primary-600 dark:text-accent-cyan truncate max-w-xs">
                  {file.analysis.exports.slice(0, 4).join(', ')}
                  {file.analysis.exports.length > 4 ? ` +${file.analysis.exports.length - 4}` : ''}
                </span>
              </div>
            )}

            {file.analysis.connectedFiles.length > 0 && onNavigateToFile && (
              <div className="flex items-center space-x-1">
                <span className="text-slate-500">Imports:</span>
                <div className="flex items-center space-x-1.5">
                  {file.analysis.connectedFiles.slice(0, 3).map((cf) => (
                    <button
                      key={cf}
                      onClick={() => onNavigateToFile(cf)}
                      className="inline-flex items-center space-x-0.5 text-[11px] text-primary-600 dark:text-primary-400 hover:underline font-mono"
                    >
                      <span>{cf}</span>
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Code Editor Body with Line Numbers */}
      <div className="flex-1 overflow-auto font-mono text-xs leading-5 p-2 sm:p-4">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted =
                highlightLines &&
                lineNum >= highlightLines.start &&
                lineNum <= highlightLines.end;
              const isStartOfHighlight = highlightLines && lineNum === highlightLines.start;

              return (
                <tr
                  key={lineNum}
                  ref={isStartOfHighlight ? targetLineRef : undefined}
                  className={`hover:bg-surface-subtle/50 transition-colors ${isHighlighted ? 'bg-primary-500/15 dark:bg-primary-600/20 border-l-2 border-primary-500' : ''
                    }`}
                >
                  <td className="w-12 text-right pr-4 text-slate-400 dark:text-slate-500 select-none line-numbers align-top">
                    {lineNum}
                  </td>
                  <td className="text-slate-800 dark:text-slate-200 whitespace-pre font-mono overflow-x-visible">
                    {line || ' '}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
