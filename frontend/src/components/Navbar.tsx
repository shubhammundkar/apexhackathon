import React from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Settings, Github, Sparkles, FolderGit2, Sun, Moon, LogIn, LogOut } from 'lucide-react';
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
    <header className="h-14 border-b border-surface-border bg-surface/90 backdrop-blur-md px-4 lg:px-6 flex items-center justify-between sticky top-0 z-40 transition-colors">
      <div className="flex items-center space-x-3">
        <Link to="/" className="flex items-center space-x-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-md shadow-primary-500/25 group-hover:scale-105 transition-transform">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-base tracking-tight bg-gradient-to-r from-slate-900 via-sky-800 to-primary-600 dark:from-white dark:via-slate-200 dark:to-slate-400 bg-clip-text text-transparent">
            Codebase Explainer AI
          </span>
        </Link>

        {activeRepo && (
          <div className="hidden sm:flex items-center space-x-2 pl-3 border-l border-surface-border text-xs text-slate-500 dark:text-slate-400">
            <FolderGit2 className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
            <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">{activeRepo}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Gemini API Status Badge */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-surface-border bg-surface-subtle text-slate-700 dark:text-slate-300">
          <Sparkles className={`w-3.5 h-3.5 ${hasCustomKey || geminiConfigured ? 'text-accent-emerald' : 'text-accent-amber animate-pulse'}`} />
          <span className="hidden md:inline">
            {hasCustomKey ? 'Custom API Key' : geminiConfigured ? 'Server Gemini Ready' : 'API Key Setup'}
          </span>
        </div>

        {/* Optional Auth / Account Button */}
        {user ? (
          <div className="flex items-center space-x-1 bg-surface-subtle border border-surface-border rounded-lg p-0.5 pl-2">
            <div className="flex items-center space-x-1.5 text-xs text-slate-800 dark:text-slate-200">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-primary-500 to-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium max-w-[85px] truncate hidden md:inline">{user.username}</span>
            </div>
            <button
              id="navbar-logout-btn"
              type="button"
              onClick={logout}
              className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Sign out of account"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            id="navbar-signin-btn"
            type="button"
            onClick={openAuthModal}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-primary-500/30 bg-primary-500/10 text-primary-600 dark:text-primary-300 hover:bg-primary-500/20 transition-all flex items-center space-x-1.5 shadow-sm"
            title="Sign in or create free account (optional)"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}

        {/* Theme Exchange Switch Button (Light / Dark) */}
        <button
          id="theme-toggle-btn"
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-300 hover:bg-surface-muted transition-all flex items-center space-x-1.5 text-xs font-medium border border-surface-border group cursor-pointer"
          title={theme === 'dark' ? 'Switch to Light Mode (Sky Blue & White)' : 'Switch to Dark Mode (Midnight)'}
          aria-label="Toggle theme mode"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-4 h-4 text-amber-400 group-hover:rotate-45 transition-transform" />
              <span className="hidden sm:inline font-medium">Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-primary-600 group-hover:-rotate-12 transition-transform" />
              <span className="hidden sm:inline font-medium">Dark Mode</span>
            </>
          )}
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-surface-muted transition-colors flex items-center space-x-1.5 text-xs font-medium border border-surface-border"
          title="Configure Gemini API Settings"
        >
          <Settings className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        {/* GitHub link */}
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-surface-muted transition-colors"
          title="GitHub"
        >
          <Github className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
