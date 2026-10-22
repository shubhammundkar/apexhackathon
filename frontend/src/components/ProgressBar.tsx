import React from 'react';
import { IngestionProgress, IngestionStage } from '@codebase-explainer/shared';
import { Loader2, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';

interface ProgressBarProps {
  progress: IngestionProgress;
  onCancel?: () => void;
  isCancelling?: boolean;
}

const STAGE_LABELS: Record<IngestionStage, string> = {
  idle: 'Idle',
  validating: 'Validating Repository',
  fetching_metadata: 'Retrieving Metadata',
  fetching_tree: 'Inspecting File Tree',
  filtering: 'Filtering Files',
  downloading_files: 'Downloading Source Files',
  indexing: 'Building Code Index',
  analyzing: 'Gemini Architectural Analysis',
  completed: 'Analysis Complete',
  failed: 'Analysis Failed',
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  onCancel,
  isCancelling,
}) => {
  const isFailed = progress.stage === 'failed';
  const isCompleted = progress.stage === 'completed';

  return (
    <div className="w-full bg-surface border border-surface-border rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {isFailed ? (
            <XCircle className="w-5 h-5 text-accent-rose flex-shrink-0" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-accent-emerald flex-shrink-0" />
          ) : (
            <Loader2 className="w-5 h-5 text-primary-500 dark:text-primary-400 animate-spin flex-shrink-0" />
          )}
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">
                {STAGE_LABELS[progress.stage] || progress.stage}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {progress.percent}%
              </span>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 line-clamp-1">{progress.message}</p>
          </div>
        </div>

        {onCancel && !isCompleted && !isFailed && (
          <button
            onClick={onCancel}
            disabled={isCancelling}
            className="px-2.5 py-1 rounded text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 border border-surface-border transition-colors disabled:opacity-50"
          >
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        )}
      </div>

      {/* Progress track */}
      <div className="w-full h-2 bg-surface-muted rounded-full overflow-hidden relative">
        <div
          className={`h-full transition-all duration-300 ease-out rounded-full ${isFailed
              ? 'bg-rose-500'
              : isCompleted
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-primary-500 via-indigo-500 to-accent-cyan'
            }`}
          style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
        />
      </div>

      {/* Detailed statistics if downloading files */}
      {progress.totalFiles && progress.totalFiles > 0 && (
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
          <span>Files Indexed: {progress.filesProcessed || 0} / {progress.totalFiles}</span>
          {progress.currentFile && (
            <span className="truncate max-w-[200px] text-slate-500">{progress.currentFile}</span>
          )}
        </div>
      )}

      {/* Warnings Banner */}
      {progress.warnings && progress.warnings.length > 0 && (
        <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 space-y-1">
          <div className="flex items-center space-x-1.5 font-medium text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>Ingestion Notices ({progress.warnings.length})</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-300/80">
            {progress.warnings.slice(0, 3).map((w, idx) => (
              <li key={idx} className="line-clamp-1">{w}</li>
            ))}
            {progress.warnings.length > 3 && (
              <li className="text-[10px] text-amber-400 font-medium">+{progress.warnings.length - 3} more notices</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
