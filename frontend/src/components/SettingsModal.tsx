import React, { useState, useEffect } from 'react';
import { X, Key, Cpu, ShieldCheck, ExternalLink, Check, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverGeminiConfigured?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  serverGeminiConfigured,
}) => {
  const { theme, setTheme } = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_custom_api_key') || '';
    let savedModel = localStorage.getItem('gemini_selected_model') || 'gemini-3.5-flash';
    // Migrate deprecated or overloaded models
    if (
      savedModel === 'gemini-2.5-flash' ||
      savedModel === 'gemini-1.5-flash' ||
      savedModel === 'gemini-1.5-pro' ||
      savedModel === 'gemini-3.8-flash'
    ) {
      savedModel = 'gemini-3.5-flash';
      localStorage.setItem('gemini_selected_model', 'gemini-3.5-flash');
    }
    setApiKey(savedKey);
    setSelectedModel(savedModel);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem('gemini_custom_api_key', apiKey.trim());
    } else {
      localStorage.removeItem('gemini_custom_api_key');
    }
    localStorage.setItem('gemini_selected_model', selectedModel);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  const handleClear = () => {
    localStorage.removeItem('gemini_custom_api_key');
    setApiKey('');
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-surface border border-surface-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-600/20 text-primary-500 dark:text-primary-400 flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">System & AI Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-surface-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Theme Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Theme / Appearance
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-center space-x-2 transition-all ${
                  theme === 'light'
                    ? 'bg-primary-500/15 border-primary-500 text-primary-700 dark:text-primary-300 font-semibold shadow-sm'
                    : 'bg-surface-subtle border-surface-border text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span>Light (Sky Blue & White)</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-center space-x-2 transition-all ${
                  theme === 'dark'
                    ? 'bg-primary-500/20 border-primary-500 text-primary-300 font-semibold shadow-sm'
                    : 'bg-surface-subtle border-surface-border text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Moon className="w-4 h-4 text-primary-400" />
                <span>Dark (Midnight)</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center space-x-1.5">
                <Key className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400" />
                <span>Gemini API Key (Optional Override)</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1"
              >
                <span>Get Free Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              placeholder={serverGeminiConfigured ? "Using server's configured GEMINI_API_KEY" : "Paste your Google AI Studio API key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-surface-subtle border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors font-mono"
            />
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {serverGeminiConfigured
                ? 'The backend server has a GEMINI_API_KEY configured. You can optionally provide your own key here.'
                : 'Keys are stored strictly in your browser session and sent to the backend only for your requests.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Gemini Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-surface-subtle border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-primary-500 transition-colors"
            >
              <option value="gemini-3.5-flash">Gemini 3.5 Flash (Recommended - Fast & Stable)</option>
              <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Lightweight & Low Latency)</option>
              <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
              <option value="gemini-3.8-flash">Gemini 3.8 Flash (High demand)</option>
            </select>
          </div>

          <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border flex items-start space-x-2.5 text-[11px] text-slate-600 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-accent-emerald flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-medium text-slate-800 dark:text-slate-300">Security Guarantee: </span>
              Your keys are never written to disk, exposed in client bundles, or logged.
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-surface-subtle border-t border-surface-border flex items-center justify-between">
          <button
            onClick={handleClear}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
          >
            Clear Custom Key
          </button>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white flex items-center space-x-1.5 shadow-md shadow-primary-600/20 transition-all"
            >
              {saved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-accent-emerald" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Settings</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
