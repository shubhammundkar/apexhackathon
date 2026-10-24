import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, ApiError } from '../api/client';
import { ProgressBar } from '../components/ProgressBar';
import { IngestionProgress, RecentRepositoryItem } from '@codebase-explainer/shared';
import { useAuth } from '../context/AuthContext';
import {
  Github,
  Sparkles,
  ArrowRight,
  GitBranch,
  Clock,
  ChevronDown,
  RefreshCw,
  FolderGit2,
} from 'lucide-react';

const SAMPLE_REPOS = [
  { name: 'expressjs/express', url: 'https://github.com/expressjs/express', desc: 'Fast, unopinionated, minimalist web framework for Node.js' },
  { name: 'pallets/flask', url: 'https://github.com/pallets/flask', desc: 'The Python micro framework for building web applications' },
  { name: 'facebook/react', url: 'https://github.com/facebook/react', desc: 'The library for web and native user interfaces' },
  { name: 'fastapi/fastapi', url: 'https://github.com/fastapi/fastapi', desc: 'Modern, fast (high-performance) Python web framework' },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Inputs
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ingestion States
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [recentRepos, setRecentRepos] = useState<Array<RecentRepositoryItem & { isUserRepo?: boolean }>>([]);
  const [isSlidingToWorkspace, setIsSlidingToWorkspace] = useState(false);

  // -------------------------------------------------------------
  // ANIMATION STAGES:
  // 0: Background visible, surrounding elements hidden behind title
  // 1: (300ms) Title appears in foreground
  // 2: (850ms) Green underline & sparkles draw
  // 3: (1050ms) Elements emerge outward from behind the title
  // 4: (2000ms+) Floating cards settle & Search bar rises into place
  // -------------------------------------------------------------
  const [animStage, setAnimStage] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    setAnimStage(0);
    const timers = [
      setTimeout(() => setAnimStage(1), 300),
      setTimeout(() => setAnimStage(2), 850),
      setTimeout(() => setAnimStage(3), 1050),
      setTimeout(() => setAnimStage(4), 2000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [animKey]);

  const restartAnimation = () => {
    setAnimKey((prev) => prev + 1);
  };

  const pollIntervalRef = useRef<any>(null);

  // Fetch recent repositories
  useEffect(() => {
    let isMounted = true;
    apiClient
      .getRecentRepositories()
      .then((data) => {
        if (isMounted) setRecentRepos(data.repositories || []);
      })
      .catch((err) => {
        console.warn('Could not load recent repositories:', err.message);
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Polling logic
  const startPolling = (jobId: string, repositoryId: string) => {
    setActiveJobId(jobId);
    setActiveRepoId(repositoryId);
    setIsSlidingToWorkspace(true);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const job = await apiClient.getJobStatus(jobId);
        setProgress(job.progress);

        if (job.status === 'completed') {
          clearInterval(pollIntervalRef.current);
          setTimeout(() => {
            navigate(`/workspace/${repositoryId}`);
          }, 800);
        } else if (job.status === 'failed') {
          clearInterval(pollIntervalRef.current);
          setErrorMessage(job.progress.error || 'Ingestion failed. Check repository URL or token limits.');
          setIsSlidingToWorkspace(false);
        }
      } catch (err: any) {
        clearInterval(pollIntervalRef.current);
        setErrorMessage(err.message || 'Error checking ingestion status');
        setIsSlidingToWorkspace(false);
      }
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleAnalyze = async (urlToAnalyze?: string) => {
    const targetUrl = (urlToAnalyze || repoUrl).trim();
    setErrorMessage(null);

    if (!targetUrl) {
      setErrorMessage('Please enter a GitHub repository URL.');
      return;
    }

    try {
      const userApiKey = localStorage.getItem('gemini_custom_api_key') || undefined;
      const userModel = localStorage.getItem('gemini_selected_model') || undefined;

      setProgress({
        stage: 'validating',
        message: 'Connecting to GitHub API and inspecting tree...',
        percent: 10,
      });

      const response = await apiClient.startAnalysis({
        url: targetUrl,
        apiKey: userApiKey,
        branch: branch.trim() || undefined,
        model: userModel,
      });

      startPolling(response.jobId, response.repositoryId);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(err.message || 'Failed to start repository analysis.');
      }
      setProgress(null);
      setIsSlidingToWorkspace(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    setIsCancelling(true);
    try {
      await apiClient.cancelJob(activeJobId);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setProgress((prev) => (prev ? { ...prev, stage: 'failed', message: 'Cancelled by user', percent: 100 } : null));
      setErrorMessage('Analysis job was cancelled.');
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsCancelling(false);
      setActiveJobId(null);
      setIsSlidingToWorkspace(false);
    }
  };

  // Helper to compute emerging transition style from behind center (0,0) outward to target (x,y)
  const getEmergeStyle = (targetX: number, targetY: number, delayMs: number) => {
    const isEmerged = animStage >= 3;
    return {
      transform: isEmerged
        ? `translate3d(${targetX}px, ${targetY}px, 0px) scale(1)`
        : `translate3d(0px, 0px, -60px) scale(0.2)`,
      opacity: isEmerged ? 1 : 0,
      transitionDelay: isEmerged ? `${delayMs}ms` : '0ms',
      zIndex: isEmerged ? 15 : 5,
      pointerEvents: (isEmerged ? 'auto' : 'none') as any,
    };
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-between overflow-x-hidden bg-mentor-grid selection:bg-emerald-500 selection:text-white">
      {/* Background Subtle Radial Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[650px] bg-gradient-to-b from-emerald-500/10 via-emerald-500/5 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Hero Container */}
      <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-16 flex-1 flex flex-col items-center justify-center">

        {/* =========================================================================
            CINEMATIC COMPOSITION VIEW (MATCHING REFERENCE IMAGE 2)
           ========================================================================= */}
        <div
          className={`w-full max-w-6xl transition-all duration-700 ease-in-out ${
            isSlidingToWorkspace
              ? '-translate-x-full opacity-0 pointer-events-none scale-95'
              : 'translate-x-0 opacity-100 scale-100'
          }`}
        >
          {/* Main Relative Canvas */}
          <div className="relative min-h-[520px] sm:min-h-[580px] flex items-center justify-center my-2">

            {/* =====================================================================
                SURROUNDING VISUAL ELEMENTS (EMERGE FROM BEHIND THE TITLE)
               ===================================================================== */}

            {/* 1. DEVELOPER INTERFACE CARD (Upper-Left) */}
            <div
              className="absolute emerge-transition hidden sm:block"
              style={getEmergeStyle(-380, -165, 60)}
            >
              <div className="animate-float-slow">
                <div className="relative group">
                  <div className="w-44 bg-white dark:bg-slate-800 rounded-xl shadow-card-soft border border-slate-200/90 dark:border-slate-700 p-2.5 transition-transform hover:scale-105">
                    <div className="flex items-center space-x-1 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </div>
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700" />
                      <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded-full" />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="h-7 bg-slate-100 dark:bg-slate-700/60 rounded" />
                      <div className="h-7 bg-slate-100 dark:bg-slate-700/60 rounded" />
                      <div className="col-span-2 h-9 bg-slate-100 dark:bg-slate-700/60 rounded" />
                    </div>
                  </div>
                  {/* Developer purple cursor label */}
                  <div className="absolute -bottom-2.5 -right-3 flex items-center space-x-1 px-2.5 py-0.5 rounded-md bg-purple-600 text-white text-[11px] font-bold shadow-md">
                    <span className="text-[10px]">↖</span>
                    <span>Developer</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. VS CODE ICON (Upper Mid-Left) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(-230, -195, 100)}
            >
              <div className="animate-float-mid">
                <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl shadow-card-soft border border-slate-200/90 dark:border-slate-700 flex items-center justify-center hover:scale-110 transition-transform">
                  <svg className="w-6 h-6 text-sky-500 fill-current" viewBox="0 0 24 24">
                    <path d="M17.5 2.5L7.7 10.8 3 7.3 1.5 8.5 5 12l-3.5 3.5 1.5 1.2 4.7-3.5 9.8 8.3 4.5-2.2V4.7L17.5 2.5zm1 14.3l-6.8-5.8 6.8-5.8v11.6z"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* 3. NOTION-STYLE 'N' ICON (Left of Title) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(-280, -75, 140)}
            >
              <div className="animate-float-slow">
                <div className="w-11 h-11 bg-white dark:bg-slate-800 rounded-2xl shadow-card-soft border border-slate-200/90 dark:border-slate-700 flex items-center justify-center font-black text-slate-900 dark:text-white text-lg hover:scale-110 transition-transform">
                  N
                </div>
              </div>
            </div>

            {/* 4. PINK UI DESIGNER LABEL (Left of Mentor) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(-230, 25, 180)}
            >
              <div className="animate-float-fast">
                <div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-pink-500 text-white text-[11px] font-bold shadow-md cursor-pointer hover:scale-105 transition-transform">
                  <span className="text-[10px]">↖</span>
                  <span>UI Designer</span>
                </div>
              </div>
            </div>

            {/* 5. TILTED LAPTOP WITH CODE (Far-Left) */}
            <div
              className="absolute emerge-transition hidden md:block"
              style={getEmergeStyle(-430, 75, 220)}
            >
              <div className="animate-float-mid">
                <div className="relative group">
                  {/* Laptop Screen */}
                  <div className="w-56 bg-slate-950 dark:bg-slate-900 rounded-t-xl p-3 shadow-2xl border-t border-x border-slate-700/80 font-mono text-[9.5px] text-emerald-400 leading-relaxed overflow-hidden">
                    <div className="flex items-center space-x-1.5 pb-2 border-b border-slate-800 mb-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-slate-400 text-[8.5px] pl-1 font-semibold">index.ts</span>
                    </div>
                    <div className="text-sky-400 font-semibold">import express from 'express';</div>
                    <div className="text-purple-400">const app = express();</div>
                    <div className="text-emerald-400">app.use('/api', router);</div>
                    <div className="text-amber-300">app.listen(3001, () =&gt; ...);</div>
                  </div>
                  {/* Laptop Aluminum Base */}
                  <div className="w-64 h-3 bg-gradient-to-b from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-850 rounded-b-lg -ml-4 shadow-md flex justify-center">
                    <div className="w-12 h-1 bg-slate-400 dark:bg-slate-600 rounded-b-sm" />
                  </div>
                  {/* Handwritten annotation: Explore Code */}
                  <div className="absolute -top-7 -right-1 text-slate-700 dark:text-slate-300 font-handwriting text-lg flex items-center space-x-1.5 rotate-[-8deg]">
                    <span className="tracking-wide">Explore Code</span>
                    <span className="text-xl">⤴</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 6. TEAM TOAST NOTIFICATION (Bottom-Left) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(-300, 215, 260)}
            >
              <div className="animate-float-slow">
                <div className="flex items-center space-x-3 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 shadow-card-soft border border-slate-200/90 dark:border-slate-700 hover:shadow-lg transition-shadow">
                  <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                    👥
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-900 dark:text-white">
                      <span>Team</span>
                      <span className="text-[10px] text-slate-400 font-normal">just now</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                      Build. Learn. Collaborate. ✨
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 7. FIGMA ICON CARD (Top Center-Right) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(145, -205, 110)}
            >
              <div className="animate-float-slow">
                <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl shadow-card-soft border border-slate-200/90 dark:border-slate-700 flex items-center justify-center hover:scale-110 transition-transform">
                  <div className="grid grid-cols-2 gap-0.5 w-5 h-7">
                    <div className="w-2.5 h-2.5 rounded-l-full bg-rose-500" />
                    <div className="w-2.5 h-2.5 rounded-r-full bg-amber-500" />
                    <div className="w-2.5 h-2.5 rounded-l-full bg-purple-500" />
                    <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                    <div className="w-2.5 h-2.5 rounded-l-full rounded-br-full bg-emerald-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* 8. CODEBASE MENTOR NOTIFICATION CARD (Upper-Right) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(275, -150, 150)}
            >
              <div className="animate-float-mid">
                <div className="flex items-center space-x-3 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 shadow-card-soft border border-slate-200/90 dark:border-slate-700 hover:shadow-lg transition-shadow">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4 fill-white" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-900 dark:text-white">
                      <span>Codebase Mentor</span>
                      <span className="text-[10px] text-slate-400 font-normal">just now</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                      Let's analyze this repository together. 🚀
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 9. POLAROID PHOTO CARD (Far Upper-Right) */}
            <div
              className="absolute emerge-transition hidden lg:block"
              style={getEmergeStyle(450, -140, 190)}
            >
              <div className="relative w-32 bg-white dark:bg-slate-800 p-2 pb-3.5 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 rotate-[5deg] hover:rotate-0 transition-transform">
                {/* Translucent tape */}
                <div className="w-10 h-3 bg-amber-200/75 mx-auto -mt-3.5 mb-2 rounded-sm shadow-sm" />
                {/* Photo image mockup */}
                <div className="w-full h-20 bg-gradient-to-br from-amber-100 via-emerald-100 to-amber-200 dark:from-amber-950/40 dark:to-emerald-950/40 rounded flex flex-col items-center justify-center p-2 text-center border border-amber-200/40">
                  <span className="font-serif text-[11px] text-amber-950 dark:text-amber-200 italic font-bold leading-tight">
                    Cuidar hoy, el futuro.
                  </span>
                  <div className="w-8 h-0.5 bg-gradient-to-r from-rose-400 to-sky-400 mt-1.5 rounded-full" />
                </div>
              </div>
            </div>

            {/* 10. BLUE TECH LEAD LABEL (Upper-Right of Title) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(285, -45, 230)}
            >
              <div className="animate-float-fast">
                <div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-bold shadow-md cursor-pointer hover:scale-105 transition-transform">
                  <span className="text-[10px]">↖</span>
                  <span>Tech Lead</span>
                </div>
              </div>
            </div>

            {/* 11. ORANGE CLIENT LABEL (Mid-Right) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(365, 30, 270)}
            >
              <div className="animate-float-slow">
                <div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-orange-500 text-white text-[11px] font-bold shadow-md cursor-pointer hover:scale-105 transition-transform">
                  <span className="text-[10px]">↖</span>
                  <span>Client</span>
                </div>
              </div>
            </div>

            {/* 12. FLOATING HTML CODE CARD (Lower-Right) */}
            <div
              className="absolute emerge-transition hidden sm:block"
              style={getEmergeStyle(310, 135, 310)}
            >
              <div className="animate-float-mid">
                <div className="w-40 bg-white dark:bg-slate-800 rounded-xl shadow-card-soft border border-slate-200/90 dark:border-slate-700 p-2.5 font-mono text-[9.5px] text-slate-700 dark:text-slate-300 space-y-0.5 leading-relaxed">
                  <div className="text-slate-400">&lt;!DOCTYPE html&gt;</div>
                  <div className="text-purple-500">&lt;html lang="en"&gt;</div>
                  <div className="text-slate-400 pl-1">&lt;head&gt;</div>
                  <div className="text-amber-500 pl-2">&lt;title&gt;Hello World!&lt;/title&gt;</div>
                  <div className="text-slate-400 pl-1">&lt;/head&gt;</div>
                  <div className="text-slate-400 pl-1">&lt;body&gt;</div>
                  <div className="text-sky-500 pl-2">&lt;h1&gt;Hello World!&lt;/h1&gt;</div>
                  <div className="text-slate-400 pl-1">&lt;/body&gt;</div>
                  <div className="text-purple-500">&lt;/html&gt;</div>
                </div>
              </div>
            </div>

            {/* 13. SMARTPHONE PREVIEW WITH 3D PRODUCT (Far-Right) */}
            <div
              className="absolute emerge-transition hidden md:block"
              style={getEmergeStyle(480, 85, 350)}
            >
              <div className="animate-float-slow">
                <div className="w-28 h-52 bg-slate-950 dark:bg-slate-900 rounded-[2.2rem] p-2 shadow-2xl border-2 border-slate-700 flex flex-col items-center justify-between overflow-hidden">
                  <div className="w-10 h-2 bg-slate-800 rounded-full mt-0.5" />
                  <div className="w-full flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-2xl my-1 p-2 border border-slate-200 dark:border-slate-700">
                    <div className="text-3xl mb-1">🪑</div>
                    <div className="text-[10px] text-slate-400 flex items-center space-x-1">
                      <span>⟲</span>
                      <span>360°</span>
                      <span>⟳</span>
                    </div>
                  </div>
                  <div className="w-10 h-1 bg-slate-700 rounded-full mb-0.5" />
                </div>
              </div>
            </div>

            {/* 14. GITHUB LOGO CIRCLE (Bottom-Right) */}
            <div
              className="absolute emerge-transition hidden sm:block"
              style={getEmergeStyle(185, 215, 390)}
            >
              <div className="animate-float-mid">
                <div className="w-11 h-11 rounded-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center shadow-card-soft border border-slate-200 dark:border-slate-700 hover:scale-110 transition-transform">
                  <Github className="w-6 h-6 fill-current" />
                </div>
              </div>
            </div>

            {/* 15. RESEARCHER AMBER LABEL (Bottom-Right) */}
            <div
              className="absolute emerge-transition"
              style={getEmergeStyle(280, 230, 430)}
            >
              <div className="animate-float-fast">
                <div className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-amber-400 text-slate-950 text-[11px] font-extrabold shadow-md cursor-pointer hover:scale-105 transition-transform">
                  <span className="text-[10px]">↖</span>
                  <span>Researcher</span>
                </div>
              </div>
            </div>

            {/* =====================================================================
                CENTER TITLE (FOREGROUND — Z-INDEX 30)
                "Codebase" in bold black typography
                "Mentor." in vibrant emerald green with underline and spark accents
               ===================================================================== */}
            <div
              className={`relative z-30 select-none text-center px-4 py-2 transition-all duration-700 ${
                animStage >= 1
                  ? 'opacity-100 scale-100 translate-y-0'
                  : 'opacity-0 scale-90 translate-y-4'
              }`}
            >
              {/* Green Spark Accent Marks (/// style) */}
              {animStage >= 2 && (
                <>
                  {/* Left 3 slanted green strokes */}
                  <div className="absolute -top-3 -left-8 flex space-x-1 rotate-[-25deg] pointer-events-none">
                    <span className="w-1 h-5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="w-1 h-4 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="w-1 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  {/* Right 3 slanted green strokes */}
                  <div className="absolute top-1 -right-8 flex space-x-1 rotate-[25deg] pointer-events-none">
                    <span className="w-1 h-3 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="w-1 h-4 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="w-1 h-5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  {/* Additional sparkles */}
                  <div className="absolute -bottom-2 -left-6 text-emerald-500 font-bold text-xl animate-pulse">✦</div>
                  <div className="absolute -bottom-2 -right-5 text-emerald-500 font-bold text-2xl animate-pulse">✦</div>
                </>
              )}

              {/* Line 1: Codebase in Bold Black Typography */}
              <div className="font-display text-5xl sm:text-7xl md:text-8xl font-black tracking-tight leading-none text-slate-950 dark:text-white">
                Codebase
              </div>

              {/* Line 2: Mentor. in Vibrant Emerald Green */}
              <div className="relative inline-block font-display text-5xl sm:text-7xl md:text-8xl font-black tracking-tight leading-none text-emerald-500 mt-1 sm:mt-2">
                <span>Ment</span>
                {/* 'o' with embedded sparkling 4-point star cutout */}
                <span className="relative inline-block">
                  <span>o</span>
                  <span className="absolute inset-0 flex items-center justify-center text-white text-base sm:text-2xl font-black select-none pointer-events-none">
                    ✦
                  </span>
                </span>
                <span>r.</span>

                {/* Hand-drawn Green Underline Drawing */}
                {animStage >= 2 && (
                  <div className="absolute -bottom-3.5 left-0 w-full flex justify-center pointer-events-none">
                    <svg
                      className="w-full h-4 sm:h-5 text-emerald-500 overflow-visible"
                      viewBox="0 0 320 20"
                      fill="none"
                    >
                      <path
                        d="M 5,14 Q 80,6 160,13 Q 240,20 315,10"
                        stroke="currentColor"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        className="animate-draw-underline"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* =====================================================================
              STEP 4: REPOSITORY INPUT BAR (DIRECTLY BENEATH TITLE AT 2000MS+)
             ===================================================================== */}
          <div
            className={`relative max-w-2xl mx-auto mt-6 px-2 z-30 transition-all duration-700 ${
              animStage >= 4
                ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
                : 'opacity-0 translate-y-8 scale-95 pointer-events-none'
            }`}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAnalyze();
              }}
              className="relative flex items-center bg-white dark:bg-slate-900 rounded-full shadow-2xl border-2 border-emerald-500/40 focus-within:border-emerald-500 ring-4 ring-emerald-500/10 p-1.5 sm:p-2 transition-all"
            >
              {/* Left GitHub Icon */}
              <div className="pl-3 pr-2 text-slate-800 dark:text-slate-200">
                <Github className="w-5 h-5 fill-current" />
              </div>

              {/* Main Input Field */}
              <input
                type="text"
                placeholder="Enter GitHub repository URL..."
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={Boolean(activeJobId)}
                className="w-full bg-transparent border-none text-slate-900 dark:text-slate-100 placeholder-slate-400 text-sm sm:text-base font-mono outline-none px-2 disabled:opacity-50"
              />

              {/* Branch Selector Pill */}
              <div className="relative mr-2">
                <button
                  type="button"
                  onClick={() => setShowBranchMenu(!showBranchMenu)}
                  className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 font-semibold flex items-center space-x-1 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <GitBranch className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{branch.trim() || 'main'}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {showBranchMenu && (
                  <div className="absolute right-0 bottom-full mb-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-50">
                    <span className="text-[10px] uppercase font-bold text-slate-400 px-2 block mb-1">Target Branch / Tag</span>
                    <input
                      type="text"
                      placeholder="e.g. main, master, v1.0"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                    />
                    <div className="flex justify-end mt-1.5">
                      <button
                        type="button"
                        onClick={() => setShowBranchMenu(false)}
                        className="text-[11px] font-bold text-emerald-500 px-2 py-0.5 hover:underline"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Analyze Green Button with Sparkle Icon */}
              <button
                type="submit"
                disabled={Boolean(activeJobId) || !repoUrl.trim()}
                className="px-5 sm:px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-500/25 flex items-center space-x-1.5 transition-all disabled:opacity-40 disabled:hover:bg-emerald-500 cursor-pointer"
              >
                <span>✦</span>
                <span>Analyze</span>
              </button>
            </form>

            {/* Hand-drawn Annotation: "Understand any codebase with AI" */}
            <div className="flex items-center justify-center mt-3 text-slate-700 dark:text-slate-300 font-handwriting text-lg sm:text-xl space-x-2">
              <span className="text-2xl rotate-[-20deg]">⤴</span>
              <span>Understand any codebase with AI</span>
            </div>

            {/* Replay Cinematic Animation Trigger */}
            <div className="flex items-center justify-center space-x-2 mt-4 text-xs text-slate-400">
              <button
                type="button"
                onClick={restartAnimation}
                className="inline-flex items-center space-x-1.5 hover:text-emerald-500 transition-colors cursor-pointer"
                title="Replay the entrance animation"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Replay Animation</span>
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mt-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 text-center font-medium">
                {errorMessage}
              </div>
            )}
          </div>

          {/* Sample Repositories Quick-Picks */}
          <div
            className={`max-w-3xl mx-auto mt-12 transition-all duration-700 ${
              animStage >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
            }`}
          >
            <div className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Or Try An Example Repository
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {SAMPLE_REPOS.map((sample) => (
                <button
                  key={sample.name}
                  onClick={() => {
                    setRepoUrl(sample.url);
                    handleAnalyze(sample.url);
                  }}
                  className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 shadow-sm text-left transition-all group"
                >
                  <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-500 truncate">
                    {sample.name}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">
                    {sample.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recently Analyzed Repositories */}
          {recentRepos.length > 0 && (
            <div
              className={`max-w-3xl mx-auto mt-8 space-y-2.5 transition-all duration-700 ${
                animStage >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
              }`}
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Your Recently Analyzed Repositories</span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {recentRepos.map((repo) => (
                  <div
                    key={repo.id}
                    onClick={() => navigate(`/workspace/${repo.id}`)}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 border border-slate-200/90 dark:border-slate-700 hover:border-emerald-500/50 cursor-pointer transition-all group flex items-start justify-between shadow-sm hover:shadow-md"
                  >
                    <div className="space-y-1">
                      <div className="font-mono text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-500 flex items-center space-x-1.5">
                        <FolderGit2 className="w-4 h-4 text-emerald-500" />
                        <span>{repo.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Last inspected {new Date(repo.lastAccessedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* =========================================================================
            SLIDE VIEW: ACTIVE INGESTION RADAR (TRANSITIONS ON SUBMISSION)
           ========================================================================= */}
        {isSlidingToWorkspace && (
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 bg-black/40 backdrop-blur-sm animate-slide-in-right">
            <div className="w-full max-w-xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 space-y-6 text-center">
              
              {/* Radar Scanner Animation */}
              <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 animate-ping" />
                <div className="absolute inset-2 rounded-full border-2 border-emerald-500/40 animate-pulse" />
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500 flex items-center justify-center text-emerald-500">
                  <Sparkles className="w-8 h-8 fill-emerald-500/20" />
                </div>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  Opening {activeRepoId ? <span className="text-emerald-500 font-mono">{activeRepoId}</span> : 'Repository'} Workspace
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Parsing dependencies, building ASTs, and grounding AI citations...
                </p>
              </div>

              {/* Progress Bar */}
              {progress && (
                <div className="pt-2 text-left">
                  <ProgressBar
                    progress={progress}
                    onCancel={handleCancel}
                    isCancelling={isCancelling}
                  />
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <footer className="py-4 border-t border-slate-200/80 dark:border-slate-800 text-center text-xs text-slate-400">
        <p>Codebase Mentor • Real GitHub Ingestion & Grounded Code Explanations</p>
      </footer>
    </div>
  );
};
