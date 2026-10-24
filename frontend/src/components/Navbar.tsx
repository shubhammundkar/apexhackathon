import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Github, Settings, Sun, Moon, LogIn, LogOut, FolderGit2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  onOpenSettings: () => void;
  geminiConfigured?: boolean;
  hasCustomKey?: boolean;
  activeRepo?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSettings,
  geminiConfigured,
  hasCustomKey,
  activeRepo,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { user, openAuthModal, logout } = useAuth();

  return (
    <header className="h-16 border-b border-surface-border bg-surface/80 backdrop-blur-md px-4 sm:px-8 flex items-center justify-between sticky top-0 z-40 transition-colors">
      {/* Brand Logo */}
      <div className="flex items-center space-x-4">
        <Link to="/" className="flex items-center space-x-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform text-white font-black text-sm">
            <Sparkles className="w-4 h-4 fill-white" />
          </div>
          <div className="flex items-baseline font-display">
            <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
              Codebase
            </span>
            <span className="text-xl font-black text-emerald-500 tracking-tight ml-1 flex items-center">
              Mentor<span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5"></span>
            </span>
          </div>
        </Link>

        {activeRepo && (
          <div className="hidden sm:flex items-center space-x-2 pl-3 border-l border-surface-border text-xs text-slate-500 dark:text-slate-400">
            <FolderGit2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">{activeRepo}</span>
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2.5 sm:space-x-3.5">
        {/* Gemini API Key Status */}
        <button
          onClick={onOpenSettings}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-surface-border bg-surface-subtle hover:border-emerald-500/40 text-slate-700 dark:text-slate-300 transition-all shadow-sm"
          title="Gemini AI Configuration"
        >
          <Sparkles className={`w-3.5 h-3.5 ${hasCustomKey || geminiConfigured ? 'text-emerald-500' : 'text-amber-500 animate-pulse'}`} />
          <span className="hidden md:inline">
            {hasCustomKey ? 'Custom Key' : geminiConfigured ? 'Gemini Ready' : 'API Setup'}
          </span>
        </button>

        {/* User Account / Sign In */}
        {user ? (
          <div className="flex items-center space-x-1 bg-surface-subtle border border-surface-border rounded-full p-1 pl-2.5">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 hidden md:inline">{user.username}</span>
            <button
              id="navbar-logout-btn"
              type="button"
              onClick={logout}
              className="p-1 rounded-full text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            id="navbar-signin-btn"
            type="button"
            onClick={openAuthModal}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center space-x-1.5 shadow-sm"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign In</span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          id="theme-toggle-btn"
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-surface-muted border border-surface-border transition-all"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme mode"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform" />
          ) : (
            <Moon className="w-4 h-4 text-emerald-600 hover:-rotate-12 transition-transform" />
          )}
        </button>

        {/* Settings modal button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-surface-muted border border-surface-border transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4 text-slate-500" />
        </button>

        {/* GitHub link */}
        <a
          href="https://github.com/shubhammundkar/apexhackathon"
          target="_blank"
          rel="noreferrer"
          className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-surface-muted border border-surface-border transition-colors"
          title="GitHub Repository"
        >
          <Github className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
