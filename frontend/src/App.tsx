import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { SettingsModal } from './components/SettingsModal';
import { LandingPage } from './pages/LandingPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { apiClient } from './api/client';

export const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [serverGeminiConfigured, setServerGeminiConfigured] = useState(false);
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // Check server health and config
    apiClient
      .getHealth()
      .then((data) => {
        setServerGeminiConfigured(Boolean(data.config?.geminiConfigured));
      })
      .catch((err) => {
        console.warn('Backend server health check notice:', err.message);
      });

    // Check localStorage for custom key
    const customKey = localStorage.getItem('gemini_custom_api_key');
    setHasCustomKey(Boolean(customKey && customKey.trim().length > 5));
  }, [isSettingsOpen]);

  // Extract active repo from route path e.g. /workspace/owner/repo
  const match = location.pathname.match(/\/workspace\/([^/]+)\/([^/]+)/);
  const activeRepo = match ? `${match[1]}/${match[2]}` : undefined;

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col font-sans">
      <Navbar
        onOpenSettings={() => setIsSettingsOpen(true)}
        geminiConfigured={serverGeminiConfigured}
        hasCustomKey={hasCustomKey}
        activeRepo={activeRepo}
      />

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/workspace/:owner/:repo" element={<WorkspacePage />} />
        </Routes>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        serverGeminiConfigured={serverGeminiConfigured}
      />
    </div>
  );
};

export default App;
