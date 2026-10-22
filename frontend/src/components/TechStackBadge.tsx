import React from 'react';
import { TechStackItem } from '@codebase-explainer/shared';

interface TechStackBadgeProps {
  item: TechStackItem;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  framework: { bg: 'bg-indigo-500/10', text: 'text-indigo-700 dark:text-indigo-400', border: 'border-indigo-500/25' },
  language: { bg: 'bg-sky-500/10', text: 'text-sky-700 dark:text-cyan-400', border: 'border-sky-500/25' },
  database: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-500/25' },
  tool: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-500/25' },
  runtime: { bg: 'bg-purple-500/10', text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-500/25' },
  library: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-500/25' },
  dev: { bg: 'bg-slate-500/10', text: 'text-slate-700 dark:text-slate-400', border: 'border-slate-500/25' },
};

export const TechStackBadge: React.FC<TechStackBadgeProps> = ({ item }) => {
  const style = CATEGORY_STYLES[item.category] || CATEGORY_STYLES['library'];

  return (
    <div
      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}
      title={item.evidencePath ? `Detected in: ${item.evidencePath}` : undefined}
    >
      <span className="font-semibold">{item.name}</span>
      {item.version && (
        <span className="opacity-70 text-[10px] font-mono">
          {item.version.replace(/[\^~]/g, '')}
        </span>
      )}
      <span className="text-[10px] uppercase tracking-wider opacity-60 ml-0.5">
        {item.category}
      </span>
    </div>
  );
};
