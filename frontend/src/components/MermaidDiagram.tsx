import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle, Copy, Check } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface MermaidDiagramProps {
  chart: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const isDark = theme === 'dark';

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        darkMode: isDark,
        background: isDark ? '#111520' : '#ffffff',
        primaryColor: isDark ? '#1e293b' : '#f0f9ff',
        primaryTextColor: '#000000',
        primaryBorderColor: '#000000',
        lineColor: '#000000',
        secondaryColor: isDark ? '#0f172a' : '#f8fafc',
        secondaryTextColor: '#000000',
        secondaryBorderColor: '#000000',
        tertiaryColor: isDark ? '#1e293b' : '#ffffff',
        tertiaryTextColor: '#000000',
        tertiaryBorderColor: '#000000',
        mainBkg: isDark ? '#1e293b' : '#f0f9ff',
        nodeBorder: '#000000',
        nodeTextColor: '#000000',
        textColor: '#000000',
        edgeLabelBackground: '#ffffff',
        clusterBkg: isDark ? '#131923' : '#f8fafc',
        clusterBorder: '#000000',
        defaultLinkColor: '#000000',
        titleColor: '#111827',
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
  }, [chart, theme]);

  const handleCopy = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col h-full min-h-[300px] bg-surface-subtle/30 border border-surface-border rounded-xl overflow-hidden">
      {/* Controls Bar */}
      <div className="h-10 border-b border-surface-border px-3.5 flex items-center justify-between bg-surface/90 text-xs">
        <span className="font-bold text-[#111827] dark:text-white">Architecture Diagram</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setZoom((z) => Math.min(2.0, z + 0.15))}
            className="p-1.5 rounded hover:bg-surface-muted text-[#374151] dark:text-slate-300 hover:text-[#111827] dark:hover:text-white transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            className="p-1.5 rounded hover:bg-surface-muted text-[#374151] dark:text-slate-300 hover:text-[#111827] dark:hover:text-white transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 rounded hover:bg-surface-muted text-[#374151] dark:text-slate-300 hover:text-[#111827] dark:hover:text-white transition-colors"
            title="Reset Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="w-[1px] h-3.5 bg-surface-border mx-1" />
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-surface-muted text-[#374151] dark:text-slate-300 hover:text-[#111827] dark:hover:text-white transition-colors font-medium"
            title="Copy Mermaid source"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-accent-emerald" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Mermaid Code'}</span>
          </button>
        </div>
      </div>

      {/* Scoped CSS for 100% High-Contrast Diagram Elements */}
      <style>{`
        .mermaid-diagram-canvas svg {
          font-family: inherit;
        }
        .mermaid-diagram-canvas svg .node rect,
        .mermaid-diagram-canvas svg .node circle,
        .mermaid-diagram-canvas svg .node ellipse,
        .mermaid-diagram-canvas svg .node polygon,
        .mermaid-diagram-canvas svg .node path {
          stroke: #000000 !important;
          stroke-width: 1.75px !important;
        }
        .mermaid-diagram-canvas svg .node .label,
        .mermaid-diagram-canvas svg .node text,
        .mermaid-diagram-canvas svg .node span,
        .mermaid-diagram-canvas svg .node span.nodeLabel,
        .mermaid-diagram-canvas svg .label div,
        .mermaid-diagram-canvas svg .label foreignObject div {
          color: #000000 !important;
          fill: #000000 !important;
          font-weight: 600 !important;
        }
        .mermaid-diagram-canvas svg .edgePath .path,
        .mermaid-diagram-canvas svg .flowchart-link,
        .mermaid-diagram-canvas svg path.path,
        .mermaid-diagram-canvas svg .edgePaths path {
          stroke: #000000 !important;
          stroke-width: 2px !important;
          opacity: 1 !important;
        }
        .mermaid-diagram-canvas svg marker path,
        .mermaid-diagram-canvas svg .arrowheadPath,
        .mermaid-diagram-canvas svg #arrowhead path {
          fill: #000000 !important;
          stroke: #000000 !important;
          opacity: 1 !important;
        }
        .mermaid-diagram-canvas svg .edgeLabel,
        .mermaid-diagram-canvas svg .edgeLabel span,
        .mermaid-diagram-canvas svg .edgeLabel text,
        .mermaid-diagram-canvas svg .edgeLabel div,
        .mermaid-diagram-canvas svg .edgeLabel p {
          color: #000000 !important;
          fill: #000000 !important;
          font-weight: 600 !important;
        }
        .mermaid-diagram-canvas svg .edgeLabel rect {
          fill: #ffffff !important;
          stroke: #000000 !important;
          stroke-width: 1px !important;
          opacity: 0.95 !important;
        }
        .mermaid-diagram-canvas svg .cluster rect {
          stroke: #000000 !important;
          stroke-width: 1.5px !important;
        }
        .mermaid-diagram-canvas svg .cluster text,
        .mermaid-diagram-canvas svg .cluster .nodeLabel,
        .mermaid-diagram-canvas svg .cluster span {
          fill: #000000 !important;
          color: #000000 !important;
          font-weight: 700 !important;
        }
      `}</style>

      {/* Diagram Canvas */}
      <div className="mermaid-diagram-canvas flex-1 overflow-auto p-6 flex items-center justify-center relative min-h-[300px]" ref={containerRef}>
        {error ? (
          <div className="p-4 max-w-lg bg-surface border border-surface-border rounded-xl space-y-3 text-center">
            <div className="flex items-center justify-center space-x-2 text-accent-amber text-xs font-medium">
              <AlertCircle className="w-4 h-4" />
              <span className="text-[#1F2937] dark:text-slate-200">{error}</span>
            </div>
            <pre className="text-left bg-surface-subtle p-3 rounded text-[11px] font-mono text-[#1F2937] dark:text-slate-200 overflow-x-auto">
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
          <div className="text-xs text-[#374151] dark:text-slate-300 font-mono">Loading diagram...</div>
        )}
      </div>
    </div>
  );
};
