import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle, Copy, Check } from 'lucide-react';

interface MermaidDiagramProps {
  chart: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#111520',
        primaryColor: '#6366f1',
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#4f46e5',
        lineColor: '#64748b',
        secondaryColor: '#1e293b',
        tertiaryColor: '#0f172a',
      },
      fontFamily: 'Inter, sans-serif',
      securityLevel: 'loose',
    });

    const renderChart = async () => {
      try {
        setError(null);
        const cleanChart = chart.trim();
        if (!cleanChart) return;

        const id = `mermaid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const { svg } = await mermaid.render(id, cleanChart);
        setSvgContent(svg);
      } catch (err: any) {
        console.warn('Mermaid rendering issue:', err);
        setError('Could not render diagram preview automatically. Raw chart definition shown below.');
      }
    };

    renderChart();
  }, [chart]);

  const handleCopy = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col h-full bg-surface-subtle/30 border border-surface-border rounded-xl overflow-hidden">
      {/* Controls Bar */}
      <div className="h-10 border-b border-surface-border px-3.5 flex items-center justify-between bg-surface/90 text-xs">
        <span className="font-semibold text-slate-300">Architecture Diagram</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setZoom((z) => Math.min(2.0, z + 0.15))}
            className="p-1.5 rounded hover:bg-surface-muted text-slate-400 hover:text-white transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            className="p-1.5 rounded hover:bg-surface-muted text-slate-400 hover:text-white transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 rounded hover:bg-surface-muted text-slate-400 hover:text-white transition-colors"
            title="Reset Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-surface-border mx-1" />
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-surface-muted text-slate-400 hover:text-white transition-colors"
            title="Copy Mermaid source"
          >
            {copied ? <Check className="w-3 h-3 text-accent-emerald" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Mermaid Code'}</span>
          </button>
        </div>
      </div>

      {/* Diagram Canvas */}
      <div className="flex-1 overflow-auto p-6 flex items-center justify-center relative min-h-[300px]" ref={containerRef}>
        {error ? (
          <div className="p-4 max-w-lg bg-surface border border-surface-border rounded-xl space-y-3 text-center">
            <div className="flex items-center justify-center space-x-2 text-accent-amber text-xs font-medium">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            <pre className="text-left bg-surface-subtle p-3 rounded text-[11px] font-mono text-slate-300 overflow-x-auto">
              {chart}
            </pre>
          </div>
        ) : svgContent ? (
          <div
            className="transition-transform duration-150 origin-center mermaid flex items-center justify-center"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="text-xs text-slate-500 font-mono">Loading diagram...</div>
        )}
      </div>
    </div>
  );
};
