import React from 'react';
import { CodeFinding } from '@codebase-explainer/shared';
import { ShieldAlert, Bug, Sparkles, AlertOctagon, HelpCircle, ArrowRight } from 'lucide-react';

interface FindingsCardProps {
  finding: CodeFinding;
  onNavigateToFile?: (path: string, startLine?: number, endLine?: number) => void;
}

const SEVERITY_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  low: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  info: { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: <ShieldAlert className="w-4 h-4 text-rose-400" />,
  bug: <Bug className="w-4 h-4 text-orange-400" />,
  code_smell: <Sparkles className="w-4 h-4 text-amber-400" />,
  architecture: <AlertOctagon className="w-4 h-4 text-blue-400" />,
  missing_test: <HelpCircle className="w-4 h-4 text-purple-400" />,
};

export const FindingsCard: React.FC<FindingsCardProps> = ({ finding, onNavigateToFile }) => {
  const sev = SEVERITY_CONFIG[finding.severity] || SEVERITY_CONFIG['info'];
  const icon = CATEGORY_ICONS[finding.category] || <AlertOctagon className="w-4 h-4 text-slate-400" />;

  return (
    <div className="bg-surface border border-surface-border rounded-xl p-4 sm:p-5 space-y-3.5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start space-x-2.5">
          <div className="p-1.5 rounded-lg bg-surface-subtle border border-surface-border mt-0.5">
            {icon}
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">{finding.title}</h4>
            <div className="flex items-center space-x-2 mt-1">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${sev.bg} ${sev.text} ${sev.border}`}>
                {finding.severity}
              </span>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">
                {finding.category.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>

        {finding.filePath && onNavigateToFile && (
          <button
            onClick={() => onNavigateToFile(finding.filePath, finding.startLine, finding.endLine)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-mono text-primary-400 hover:text-primary-300 bg-primary-600/10 hover:bg-primary-600/20 border border-primary-500/20 transition-colors flex-shrink-0"
          >
            <span className="truncate max-w-[150px]">{finding.filePath}</span>
            {finding.startLine && <span>:{finding.startLine}</span>}
            <ArrowRight className="w-3 h-3 ml-0.5" />
          </button>
        )}
      </div>

      <p className="text-xs text-slate-300 leading-relaxed">
        {finding.description}
      </p>

      {finding.codeSnippet && (
        <div className="bg-surface-subtle rounded-lg p-3 border border-surface-border font-mono text-[11px] text-slate-300 overflow-x-auto">
          <pre>{finding.codeSnippet}</pre>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
        {finding.impact && (
          <div className="bg-rose-500/5 border border-rose-500/15 rounded-lg p-2.5">
            <span className="font-semibold text-rose-300 block mb-1">Impact:</span>
            <span className="text-slate-300 text-[11px] leading-relaxed">{finding.impact}</span>
          </div>
        )}
        {finding.remediation && (
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2.5">
            <span className="font-semibold text-emerald-300 block mb-1">Suggested Remediation:</span>
            <span className="text-slate-300 text-[11px] leading-relaxed">{finding.remediation}</span>
          </div>
        )}
      </div>
    </div>
  );
};
