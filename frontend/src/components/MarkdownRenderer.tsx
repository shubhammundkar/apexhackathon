import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-markdown.js';
import { SearchCitation } from '@codebase-explainer/shared';
import { Copy, Check, FileCode } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onNavigateToCitation?: (citation: SearchCitation) => void;
  citations?: SearchCitation[];
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

function highlightCode(code: string, language: string): string {
  const normalizedLang = LANGUAGE_MAP[language.toLowerCase()] || language.toLowerCase();
  const grammar = Prism.languages[normalizedLang] || Prism.languages.javascript || Prism.languages.clike;

  if (grammar) {
    try {
      return Prism.highlight(code, grammar, normalizedLang);
    } catch {
      return escapeHtml(code);
    }
  }
  return escapeHtml(code);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Automatically balances unclosed code fences while AI response is streaming,
 * and linkifies inline citations e.g. [docs/Phases.md:201-220] outside code fences.
 */
function preprocessMarkdown(text: string): string {
  if (!text) return '';

  // 1. Ensure balanced code blocks for streaming
  let result = text;
  const matches = result.match(/```/g);
  if (matches && matches.length % 2 !== 0) {
    result = result + '\n```';
  }

  // 2. Linkify citations outside code blocks: [path/to/file.ext:startLine-endLine]
  const parts = result.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part;
      return part.replace(
        /\[([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?\]/g,
        (match, file, start, end) => {
          const endLine = end || start;
          return `[${file}:${start}${end ? `-${end}` : ''}](#citation:${file}:${start}:${endLine})`;
        }
      );
    })
    .join('');
}

const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language = '' }) => {
  const [copied, setCopied] = useState(false);
  const cleanLang = language.toLowerCase().replace(/^language-/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const highlightedHtml = highlightCode(code, cleanLang);

  return (
    <div className="my-2.5 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-950 text-slate-100 shadow-sm text-[11px]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px] text-slate-400 font-mono select-none">
        <span className="uppercase tracking-wider font-semibold text-slate-400">
          {cleanLang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 hover:text-slate-200 transition-colors text-slate-400"
          type="button"
          title="Copy code snippet"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto max-h-[420px]">
        <pre className="font-mono leading-relaxed !bg-transparent !p-0 !m-0">
          <code
            className={cleanLang ? `language-${cleanLang}` : undefined}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  onNavigateToCitation,
  citations,
}) => {
  if (!content || !content.trim()) {
    return null;
  }

  const processedContent = preprocessMarkdown(content);

  return (
    <div className={`prose-container text-xs leading-relaxed text-slate-800 dark:text-slate-200 break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-3 mb-1.5 border-b border-surface-border/60 pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-2.5 mb-1">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-2 mb-1">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 mt-1.5 mb-0.5">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-xs leading-relaxed mb-2 last:mb-0 text-slate-800 dark:text-slate-200">
              {children}
            </p>
          ),
          strong: ({ children }) => {
            const rawText = typeof children === 'string' ? children : (Array.isArray(children) ? children.join('') : '');
            const isKeyLabel = /^(key\s+factor|key\s+takeaway|highlight|core\s+concept|crucial|note|important|pro\s*tip|recommendation):?/i.test(rawText.trim());
            
            if (isKeyLabel) {
              return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 mr-1 align-baseline shadow-xs">
                  ⭐ {children}
                </span>
              );
            }
            return (
              <strong className="font-semibold text-slate-900 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-400/15 px-1 py-0.5 rounded text-[11.5px]">
                {children}
              </strong>
            );
          },
          em: ({ children }) => (
            <em className="italic text-slate-800 dark:text-slate-200">
              {children}
            </em>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-4 my-1.5 space-y-1 text-xs text-slate-800 dark:text-slate-200">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 my-1.5 space-y-1 text-xs text-slate-800 dark:text-slate-200">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-emerald-500 dark:border-accent-cyan pl-3.5 pr-2 py-2 my-2.5 bg-emerald-500/5 dark:bg-emerald-950/25 rounded-r-lg text-slate-800 dark:text-slate-200 shadow-xs border-y border-r border-emerald-500/10 dark:border-emerald-500/20">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-2.5 border-t border-surface-border/80" />
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-surface-border">
              <table className="w-full text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-muted/60 border-b border-surface-border">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="border-r border-surface-border last:border-r-0 px-2.5 py-1.5 font-semibold text-left text-slate-900 dark:text-slate-100">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-t border-r border-surface-border last:border-r-0 px-2.5 py-1 text-slate-700 dark:text-slate-300">
              {children}
            </td>
          ),
          a: ({ children, href }) => {
            // Check if this is an inline citation link
            if (href?.startsWith('#citation:')) {
              const parts = href.replace('#citation:', '').split(':');
              const filePath = parts[0];
              const startLine = parseInt(parts[1], 10) || 1;
              const endLine = parseInt(parts[2], 10) || startLine;

              // Match existing citation object if present
              const matchedCit = citations?.find(
                (c) => c.filePath.endsWith(filePath) || filePath.endsWith(c.filePath)
              );

              const citationObj: SearchCitation = matchedCit || {
                filePath,
                startLine,
                endLine,
                snippet: '',
              };

              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToCitation?.(citationObj);
                  }}
                  title={`Jump to ${filePath} (lines ${startLine}-${endLine})`}
                  className="inline-flex items-center space-x-1 px-1.5 py-0.5 mx-0.5 rounded bg-primary-500/10 hover:bg-primary-500/20 text-primary-600 dark:text-accent-cyan border border-primary-500/20 font-mono text-[10px] transition-colors align-baseline cursor-pointer"
                >
                  <FileCode className="w-2.5 h-2.5 flex-shrink-0" />
                  <span>{children}</span>
                </button>
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 underline hover:text-primary-500 break-all transition-colors"
              >
                {children}
              </a>
            );
          },
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            const rawText = String(children || '').replace(/\n$/, '');
            const isBlock = Boolean(match) || (typeof children === 'string' && children.includes('\n'));

            if (isBlock) {
              return <CodeBlock code={rawText} language={match ? match[1] : ''} />;
            }

            return (
              <code className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-slate-200/80 dark:bg-slate-800/80 text-emerald-700 dark:text-accent-cyan border border-slate-300/70 dark:border-slate-700/70 font-medium break-words">
                {children}
              </code>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
