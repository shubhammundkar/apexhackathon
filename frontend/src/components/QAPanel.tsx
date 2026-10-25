import React, { useState, useEffect } from 'react';
import { SearchCitation, QAResponse, RetrievalStats } from '@codebase-explainer/shared';
import { apiClient } from '../api/client';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  Send,
  Sparkles,
  Bot,
  User,
  FileCode,
  ArrowRight,
  Copy,
  Check,
  Loader2,
  X,
  Database,
} from 'lucide-react';

interface QAPanelProps {
  onAskQuestion: (
    question: string,
    filePath?: string,
    onChunk?: (chunk: string) => void,
    onCitations?: (citations: SearchCitation[]) => void
  ) => Promise<QAResponse>;
  currentFilePath?: string;
  onNavigateToCitation: (citation: SearchCitation) => void;
  isOpen: boolean;
  onClose: () => void;
  owner?: string;
  repo?: string;
  width?: number;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  citations?: SearchCitation[];
  timestamp: string;
  retrieval?: RetrievalStats;
}

type ExplanationTier = 'all' | 'beginner' | 'lowLevel' | 'deepTechnical';

function parseTieredContent(text: string): {
  hasTiers: boolean;
  beginner?: string;
  lowLevel?: string;
  deepTechnical?: string;
} {
  const beginnerRegex = /#{2,4}\s*(?:🟢\s*)?Beginner(?:[\s\w()]+)?\s*([\s\S]*?)(?=#{2,4}\s*(?:🟡|🟣|\w)|$)/i;
  const lowLevelRegex = /#{2,4}\s*(?:🟡\s*)?Low-Level(?:[\s\w()]+)?\s*([\s\S]*?)(?=#{2,4}\s*(?:🟣|\w)|$)/i;
  const deepTechRegex = /#{2,4}\s*(?:🟣\s*)?Deep\s*Technical(?:[\s\w()&]+)?\s*([\s\S]*?)(?=#{2,4}|$)/i;

  const beginnerMatch = text.match(beginnerRegex);
  const lowLevelMatch = text.match(lowLevelRegex);
  const deepTechMatch = text.match(deepTechRegex);

  const hasTiers = Boolean(beginnerMatch || lowLevelMatch || deepTechMatch);

  return {
    hasTiers,
    beginner: beginnerMatch ? beginnerMatch[1].trim() : undefined,
    lowLevel: lowLevelMatch ? lowLevelMatch[1].trim() : undefined,
    deepTechnical: deepTechMatch ? deepTechMatch[1].trim() : undefined,
  };
}

const PRESET_QUESTIONS = [
  'How does the request lifecycle work across the project?',
  'Where are the main entrypoints and API routes defined?',
  'Explain the database and state mechanisms in this repo.',
  'What potential bottlenecks or security risks exist?',
];

export const QAPanel: React.FC<QAPanelProps> = ({
  onAskQuestion,
  currentFilePath,
  onNavigateToCitation,
  isOpen,
  onClose,
  owner,
  repo,
  width,
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scopedToFile, setScopedToFile] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [globalTier, setGlobalTier] = useState<ExplanationTier>('all');
  const [msgTierMap, setMsgTierMap] = useState<Record<string, ExplanationTier>>({});
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);

  // Load previous Q&A history for this repository from MongoDB/backend
  useEffect(() => {
    if (!owner || !repo) return;
    let isMounted = true;
    apiClient
      .getQAHistory(owner, repo)
      .then((data) => {
        if (!isMounted || !data.history || data.history.length === 0) return;
        const loaded: MessageItem[] = [];
        for (const item of data.history) {
          loaded.push({
            id: `${item.id}_u`,
            sender: 'user',
            content: item.question,
            timestamp: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
          loaded.push({
            id: `${item.id}_a`,
            sender: 'assistant',
            content: item.answer,
            citations: item.citations,
            timestamp: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
        }
        setMessages((prev) => (prev.length === 0 ? loaded : prev));
        setIsHistoryLoaded(true);
      })
      .catch((err) => {
        console.warn('Could not load QA history from MongoDB:', err.message);
      });

    return () => {
      isMounted = false;
    };
  }, [owner, repo]);

  if (!isOpen) return null;

  const setTierForMsg = (msgId: string, tier: ExplanationTier) => {
    setMsgTierMap((prev) => ({ ...prev, [msgId]: tier }));
  };

  const handleSend = async (questionText?: string) => {
    const textToSend = (questionText || input).trim();
    if (!textToSend || isLoading) return;

    const userMsg: MessageItem = {
      id: `msg_${Date.now()}_u`,
      sender: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const aiMsgId = `msg_${Date.now()}_a`;
    const initialAiMsg: MessageItem = {
      id: aiMsgId,
      sender: 'assistant',
      content: '',
      citations: [],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg, initialAiMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const activeFile = scopedToFile ? currentFilePath : undefined;
      const res = await onAskQuestion(
        textToSend,
        activeFile,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + chunk } : m))
          );
        },
        (citations) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, citations } : m))
          );
        }
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? { ...m, content: res.answer || m.content, citations: res.citations || m.citations, retrieval: res.retrieval }
            : m
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
              ...m,
              content: `⚠️ Failed to generate answer: ${err.message || 'Unknown error'}. Make sure your Gemini API key is valid.`,
            }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div style={width ? { width: `${width}px` } : undefined} className={`flex flex-col h-full bg-surface border-l border-surface-border shadow-2xl flex-shrink-0 z-30 transition-colors ${width ? 'w-full md:w-auto' : 'w-full sm:w-[450px] lg:w-[520px]'}`}>
      {/* Header */}
      <div className="h-13 border-b border-surface-border px-4 py-2 flex items-center justify-between bg-surface-subtle/80 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-primary-600/20 text-primary-500 dark:text-primary-400 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-xs text-slate-900 dark:text-slate-100 block">Codebase Mentor AI</span>
              {isHistoryLoaded && messages.length > 0 && (
                <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded font-medium border border-emerald-500/20">
                  <Database className="w-2.5 h-2.5" />
                  <span>MongoDB Synced</span>
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Grounded code analysis & 3-way explanations</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded hover:bg-surface-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Global Explanation Mode Bar */}
      <div className="px-3 py-1.5 bg-surface-muted/40 border-b border-surface-border flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>Default View:</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setGlobalTier('beginner')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${globalTier === 'beginner' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
          >
            Beginner
          </button>
          <button
            onClick={() => setGlobalTier('lowLevel')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${globalTier === 'lowLevel' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
          >
            Low-Level
          </button>
          <button
            onClick={() => setGlobalTier('deepTechnical')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${globalTier === 'deepTechnical' ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
          >
            Deep Tech
          </button>
          <button
            onClick={() => setGlobalTier('all')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${globalTier === 'all' ? 'bg-primary-500/20 text-primary-700 dark:text-primary-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
          >
            All
          </button>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-4 py-4 text-center">
            <div className="w-10 h-10 rounded-full bg-primary-600/10 text-primary-500 dark:text-primary-400 flex items-center justify-center mx-auto">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-xs">Ask anything about this repository</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                Answers are grounded in source files and structured in 3 detail levels: Beginner, Low-Level Tech, and Deep Tech.
              </p>
            </div>

            {/* Preset chips */}
            <div className="pt-2 text-left space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block px-1">
                Suggested Prompts
              </span>
              {PRESET_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="w-full text-left p-2 rounded-lg bg-surface-subtle hover:bg-surface-muted border border-surface-border text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs transition-colors flex items-center justify-between group"
                >
                  <span className="truncate mr-2">{q}</span>
                  <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const tiered = parseTieredContent(msg.content);
            const activeTier = msgTierMap[msg.id] || globalTier;

            let displayText = msg.content;
            if (msg.sender === 'assistant' && tiered.hasTiers) {
              if (activeTier === 'beginner' && tiered.beginner) {
                displayText = tiered.beginner;
              } else if (activeTier === 'lowLevel' && tiered.lowLevel) {
                displayText = tiered.lowLevel;
              } else if (activeTier === 'deepTechnical' && tiered.deepTechnical) {
                displayText = tiered.deepTechnical;
              }
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1.5 ${msg.sender === 'user' ? 'items-end' : 'items-start'
                  }`}
              >
                <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 px-1 font-mono">
                  {msg.sender === 'user' ? (
                    <>
                      <span>You</span>
                      <User className="w-3 h-3 text-slate-400" />
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-primary-400" />
                      <span>Gemini AI</span>
                    </>
                  )}
                  <span>• {msg.timestamp}</span>
                </div>

                <div
                  className={`p-3.5 rounded-xl text-xs max-w-[96%] leading-relaxed ${msg.sender === 'user'
                      ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20'
                      : 'bg-surface-subtle border border-surface-border text-slate-800 dark:text-slate-200 w-full'
                    }`}
                >
                  {/* 3-Way Explanation Mode Switcher for Assistant Answers */}
                  {msg.sender === 'assistant' && tiered.hasTiers && (
                    <div className="flex items-center space-x-1 mb-3 p-1 bg-surface rounded-lg border border-surface-border text-[11px] overflow-x-auto">
                      <button
                        onClick={() => setTierForMsg(msg.id, 'beginner')}
                        className={`px-2 py-0.5 rounded font-medium transition-colors flex items-center space-x-1 ${activeTier === 'beginner'
                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-500/30'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                      >
                        <span>Beginner</span>
                      </button>
                      <button
                        onClick={() => setTierForMsg(msg.id, 'lowLevel')}
                        className={`px-2 py-0.5 rounded font-medium transition-colors flex items-center space-x-1 ${activeTier === 'lowLevel'
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                      >
                        <span>Low-Level</span>
                      </button>
                      <button
                        onClick={() => setTierForMsg(msg.id, 'deepTechnical')}
                        className={`px-2 py-0.5 rounded font-medium transition-colors flex items-center space-x-1 ${activeTier === 'deepTechnical'
                            ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold border border-purple-500/30'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                      >
                        <span>Deep Tech</span>
                      </button>
                      <button
                        onClick={() => setTierForMsg(msg.id, 'all')}
                        className={`px-2 py-0.5 rounded font-medium transition-colors flex items-center space-x-1 ${activeTier === 'all'
                            ? 'bg-primary-500/20 text-primary-700 dark:text-primary-300 font-semibold border border-primary-500/30'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                      >
                        <span>All Tiers</span>
                      </button>
                    </div>
                  )}

{msg.sender === 'user' ? (
                    <div className="whitespace-pre-wrap font-sans break-words">{msg.content}</div>
                  ) : (
                    <MarkdownRenderer
                      content={displayText}
                      onNavigateToCitation={onNavigateToCitation}
                      citations={msg.citations}
                    />
                  )}

                  {/* Grounded Citations List */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-surface-border/60 space-y-1.5">
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        Cited Source Evidence ({msg.citations.length})
                      </span>
                      <div className="space-y-1">
                        {msg.citations.slice(0, 4).map((c, i) => (
                          <div
                            key={i}
                            onClick={() => onNavigateToCitation(c)}
                            title={c.symbolName ? `${c.symbolName} · lines ${c.startLine}-${c.endLine}` : `${c.filePath}:${c.startLine}-${c.endLine}`}
                            className="flex items-center justify-between p-1.5 rounded bg-surface hover:bg-surface-muted border border-surface-border cursor-pointer transition-colors group text-[11px]"
                          >
                            <div className="flex items-center space-x-1.5 truncate mr-2">
                              <FileCode className="w-3.5 h-3.5 text-primary-500 dark:text-accent-cyan flex-shrink-0" />
                              <span className="font-mono text-slate-700 dark:text-slate-300 truncate group-hover:text-primary-600 dark:group-hover:text-primary-300">
                                {c.filePath}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono flex-shrink-0">
                                {c.symbolName ? ` • ${c.symbolName} · lines ${c.startLine}-${c.endLine}` : `:${c.startLine}-${c.endLine}`}
                              </span>
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.retrieval && (
                    <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      Used {msg.retrieval.hitsUsed} of {msg.retrieval.totalMatches} matches · ~{msg.retrieval.tokensUsed.toLocaleString()} tokens
                    </div>
                  )}
                </div>

                {msg.sender === 'assistant' && (
                  <button
                    onClick={() => handleCopy(msg.id, msg.content)}
                    className="flex items-center space-x-1 text-[10px] text-slate-500 hover:text-slate-300 px-1 pt-0.5"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3 h-3 text-accent-emerald" />
                        <span>Copied answer</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy answer</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })
        )}


        {isLoading && (
          <div className="flex items-center space-x-2 p-3 bg-surface-subtle border border-surface-border rounded-xl text-xs text-slate-400">
            <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
            <span>Retrieving code chunks and consulting Gemini...</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle/40 space-y-2 flex-shrink-0">
        {currentFilePath && (
          <div className="flex items-center justify-between text-[11px]">
            <label className="flex items-center space-x-1.5 cursor-pointer text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={scopedToFile}
                onChange={(e) => setScopedToFile(e.target.checked)}
                className="rounded border-surface-border bg-surface text-primary-600 focus:ring-0"
              />
              <span className="truncate max-w-[280px]">
                Ask specifically about <code className="text-primary-400 font-mono">{currentFilePath}</code>
              </span>
            </label>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="relative flex items-center"
        >
          <input
            type="text"
            placeholder={
              scopedToFile && currentFilePath
                ? `Ask about ${currentFilePath.split('/').pop()}...`
                : 'Ask anything about this repository...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            className="w-full bg-surface border border-surface-border rounded-lg pl-3 pr-10 py-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-1.5 rounded-md bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-30 disabled:hover:bg-primary-600 transition-colors shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
