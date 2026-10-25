import React, { useState } from 'react';
import { SearchCitation } from '@codebase-explainer/shared';
import { FileCode, Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  onNavigateToCitation?: (citation: SearchCitation) => void;
  citations?: SearchCitation[];
}

/**
 * Parses inline formatting:
 * - **bold**
 * - `inline_code`
 * - [filePath:startLine-endLine] or [filePath:line] citations
 */
function renderInlineSpans(
  text: string,
  onNavigateToCitation?: (citation: SearchCitation) => void,
  citations?: SearchCitation[]
): React.ReactNode[] {
  // Regex matching inline code, bold, or citation brackets
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\[(?:[a-zA-Z0-9_\-./]+:\d+(?:-\d+)?(?:,\s*\d+)?|\b[\w./-]+:\d+\b)\])/g;

  const parts = text.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;

    // 1. Inline code: `...`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeText = part.slice(1, -1);
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-surface border border-surface-border text-primary-600 dark:text-primary-300 font-mono text-[11px]"
        >
          {codeText}
        </code>
      );
    }

    // 2. Bold text: **...**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const boldText = part.slice(2, -2);
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-slate-100">
          {renderInlineSpans(boldText, onNavigateToCitation, citations)}
        </strong>
      );
    }

    // 3. Citations: [path/file.ext:10-20] or [path/file.py:289, 305]
    if (part.startsWith('[') && part.endsWith(']') && part.includes(':')) {
      const inner = part.slice(1, -1).trim();
      const match = inner.match(/^([a-zA-Z0-9_\-./]+):(\d+)(?:-(\d+))?/);
      if (match) {
        const filePath = match[1];
        const startLine = parseInt(match[2], 10);
        const endLine = match[3] ? parseInt(match[3], 10) : startLine;

        // Find existing citation object if matched
        const matchedCit = citations?.find(
          (c) => c.filePath.endsWith(filePath) || filePath.endsWith(c.filePath)
        );

        const citationObj: SearchCitation = matchedCit || {
          filePath,
          startLine,
          endLine,
          snippet: '',
          role: 'hit',
        };

        return (
          <button
            key={idx}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToCitation?.(citationObj);
            }}
            title={`Jump to ${filePath} (lines ${startLine}-${endLine})`}
            className="inline-flex items-center space-x-1 px-1.5 py-0.5 mx-1 my-0.5 rounded bg-primary-500/10 hover:bg-primary-500/20 text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 border border-primary-500/20 font-mono text-[10px] transition-colors align-baseline"
          >
            <FileCode className="w-2.5 h-2.5 flex-shrink-0" />
            <span>{filePath}:{startLine}{endLine !== startLine ? `-${endLine}` : ''}</span>
          </button>
        );
      }
    }

    // Plain text
    return <span key={idx}>{part}</span>;
  });
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-2.5 rounded-lg border border-surface-border bg-surface-subtle overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 bg-surface-muted/60 border-b border-surface-border text-[10px] text-slate-500 dark:text-slate-400 font-mono">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 font-mono text-[11px] overflow-x-auto text-slate-800 dark:text-slate-200 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onNavigateToCitation,
  citations,
}) => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Code Block fences: ```lang ... ```
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        elements.push(
          <CodeBlock
            key={`code-${i}`}
            code={codeBuffer.join('\n')}
            language={codeLang}
          />
        );
        inCodeBlock = false;
        codeBuffer = [];
        codeLang = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    // 2. Horizontal Rules: --- or ***
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-surface-border" />);
      continue;
    }

    // 3. Headings: #, ##, ###
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];

      if (level === 1) {
        elements.push(
          <h1 key={`h-${i}`} className="text-base font-bold text-slate-900 dark:text-white mt-3.5 mb-1.5 pb-1 border-b border-surface-border">
            {renderInlineSpans(headingText, onNavigateToCitation, citations)}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2 key={`h-${i}`} className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-3 mb-1.5">
            {renderInlineSpans(headingText, onNavigateToCitation, citations)}
          </h2>
        );
      } else {
        // H3/H4 (Commonly used by 🟢 Beginner, 🟡 Low-Level, 🟣 Deep Technical)
        elements.push(
          <div
            key={`h-${i}`}
            className="flex items-center space-x-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 mt-3 mb-1.5 pb-0.5 border-b border-surface-border/40"
          >
            <span>{renderInlineSpans(headingText, onNavigateToCitation, citations)}</span>
          </div>
        );
      }
      continue;
    }

    // 4. Numbered Lists: 1. Item
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      const num = numberedMatch[1];
      const rest = numberedMatch[2];
      elements.push(
        <div key={`num-${i}`} className="flex items-start space-x-2 my-1 pl-1">
          <span className="font-semibold text-primary-600 dark:text-primary-400 font-mono text-[11px] flex-shrink-0 mt-0.5">
            {num}.
          </span>
          <div className="flex-1 leading-relaxed text-slate-800 dark:text-slate-200">
            {renderInlineSpans(rest, onNavigateToCitation, citations)}
          </div>
        </div>
      );
      continue;
    }

    // 5. Bullet Lists: * Item or - Item
    const bulletMatch = trimmed.match(/^([*\-•])\s+(.*)$/);
    if (bulletMatch) {
      const rest = bulletMatch[2];
      elements.push(
        <div key={`bullet-${i}`} className="flex items-start space-x-2 my-1 pl-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500/80 flex-shrink-0 mt-1.5" />
          <div className="flex-1 leading-relaxed text-slate-800 dark:text-slate-200">
            {renderInlineSpans(rest, onNavigateToCitation, citations)}
          </div>
        </div>
      );
      continue;
    }

    // 6. Blank Line
    if (trimmed.length === 0) {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      continue;
    }

    // 7. Regular Paragraph text
    elements.push(
      <p key={`p-${i}`} className="my-1 leading-relaxed text-slate-800 dark:text-slate-200">
        {renderInlineSpans(rawLine, onNavigateToCitation, citations)}
      </p>
    );
  }

  // Handle unclosed code block if any
  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <CodeBlock
        key="code-unclosed"
        code={codeBuffer.join('\n')}
        language={codeLang}
      />
    );
  }

  return <div className="space-y-0.5 text-xs">{elements}</div>;
};
