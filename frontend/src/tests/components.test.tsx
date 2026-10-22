import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressBar } from '../components/ProgressBar';
import { TechStackBadge } from '../components/TechStackBadge';
import { FindingsCard } from '../components/FindingsCard';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { CodeFinding, IngestionProgress, TechStackItem } from '@codebase-explainer/shared';

describe('Frontend UI Components', () => {
  describe('ProgressBar Component', () => {
    it('renders stage label, percentage, and file count', () => {
      const mockProgress: IngestionProgress = {
        stage: 'downloading_files',
        message: 'Downloading source files (45/100)...',
        percent: 65,
        filesProcessed: 45,
        totalFiles: 100,
        currentFile: 'src/index.ts',
        warnings: ['Notice 1', 'Notice 2'],
      };

      const handleCancel = vi.fn();
      render(<ProgressBar progress={mockProgress} onCancel={handleCancel} />);

      expect(screen.getAllByText(/DOWNLOADING SOURCE FILES/i).length).toBeGreaterThan(0);
      expect(screen.getByText('65%')).toBeInTheDocument();
      expect(screen.getByText(/Files Indexed: 45 \/ 100/i)).toBeInTheDocument();
      expect(screen.getByText(/Ingestion Notices \(2\)/i)).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelBtn);
      expect(handleCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('TechStackBadge Component', () => {
    it('displays tech name, version and category', () => {
      const item: TechStackItem = {
        name: 'React',
        category: 'framework',
        version: '^18.3.0',
        confidence: 'detected',
        evidencePath: 'package.json',
      };

      render(<TechStackBadge item={item} />);

      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('18.3.0')).toBeInTheDocument();
      expect(screen.getByText('framework')).toBeInTheDocument();
    });
  });

  describe('FindingsCard Component', () => {
    it('displays audit finding with severity, impact and remediation', () => {
      const finding: CodeFinding = {
        id: 'f-1',
        title: 'Hardcoded Secret Detected',
        category: 'security',
        severity: 'critical',
        description: 'Possible credentials found in source file.',
        filePath: 'src/config.ts',
        startLine: 12,
        endLine: 14,
        codeSnippet: 'const key = "12345";',
        impact: 'Exposes sensitive services to unauthorized actors.',
        remediation: 'Use environment variables instead of hardcoded strings.',
        isConfirmed: true,
      };

      const handleNav = vi.fn();
      render(<FindingsCard finding={finding} onNavigateToFile={handleNav} />);

      expect(screen.getByText('Hardcoded Secret Detected')).toBeInTheDocument();
      expect(screen.getByText('critical')).toBeInTheDocument();
      expect(screen.getByText(/Exposes sensitive services/i)).toBeInTheDocument();
      expect(screen.getByText(/Use environment variables/i)).toBeInTheDocument();

      const fileBtn = screen.getByRole('button', { name: /src\/config\.ts/i });
      fireEvent.click(fileBtn);
      expect(handleNav).toHaveBeenCalledWith('src/config.ts', 12, 14);
    });
  });

  describe('ThemeContext and Mode Toggle', () => {
    it('allows toggling between dark and light modes', () => {
      const ThemeConsumer = () => {
        const { theme, toggleTheme } = useTheme();
        return (
          <div>
            <span data-testid="current-theme">{theme}</span>
            <button onClick={toggleTheme} data-testid="toggle-btn">Toggle</button>
          </div>
        );
      };

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      const themeSpan = screen.getByTestId('current-theme');
      const toggleBtn = screen.getByTestId('toggle-btn');

      const initialTheme = themeSpan.textContent;
      expect(['light', 'dark']).toContain(initialTheme);

      fireEvent.click(toggleBtn);
      expect(themeSpan.textContent).toBe(initialTheme === 'dark' ? 'light' : 'dark');
      expect(document.documentElement.classList.contains(themeSpan.textContent!)).toBe(true);
    });
  });
});

