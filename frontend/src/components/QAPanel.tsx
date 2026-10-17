import React, { useState } from 'react';
import { SearchCitation, QAResponse } from '@codebase-explainer/shared';
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
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  citations?: SearchCitation[];
  timestamp: string;
}

const PRESET_QUESTIONS = [
  'Where does the application start executing?',
  'Explain the complete architecture and data flow.',
  'What problem does this project solve?',
  'Where is authentication or authorization implemented?',
  'What are the security risks and code smells?',
  'How can I contribute a new feature to this codebase?',
];

export const QAPanel: React.FC<QAPanelProps> = ({
  onAskQuestion,
  currentFilePath,
  onNavigateToCitation,
  isOpen,
  onClose,
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scopedToFile, setScopedToFile] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

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
            ? { ...m, content: res.answer || m.content, citations: res.citations || m.citations }
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
    <div className="flex flex-col h-full bg-surface border-l border-surface-border w-full sm:w-[420px] lg:w-[480px] shadow-2xl flex-shrink-0 z-30">
      {/* Header */}
      <div className="h-12 border-b border-surface-border px-4 flex items-center justify-between bg-surface-subtle/80 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-md bg-primary-600/20 text-primary-400 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-slate-100">Codebase Q&A (Grounded)</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded hover:bg-surface-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-4 py-4 text-center">
            <div className="w-10 h-10 rounded-full bg-primary-600/10 text-primary-400 flex items-center justify-center mx-auto">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-200 text-xs">Ask anything about this repository</h4>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                Answers are grounded strictly in retrieved source files and indexed line citations.
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
                  className="w-full text-left p-2 rounded-lg bg-surface-subtle hover:bg-surface-muted border border-surface-border text-slate-300 hover:text-white text-xs transition-colors flex items-center justify-between group"
                >
                  <span className="truncate mr-2">{q}</span>
                  <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-primary-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col space-y-1.5 ${
                msg.sender === 'user' ? 'items-end' : 'items-start'
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
                className={`p-3.5 rounded-xl text-xs max-w-[92%] leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20'
                    : 'bg-surface-subtle border border-surface-border text-slate-200'
                }`}
              >
                <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                {/* Grounded Citations List */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-surface-border/60 space-y-1.5">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Cited Source Evidence ({msg.citations.length})
                    </span>
                    <div className="space-y-1">
                      {msg.citations.slice(0, 4).map((c, i) => (
                        <div
                          key={i}
                          onClick={() => onNavigateToCitation(c)}
                          className="flex items-center justify-between p-1.5 rounded bg-surface hover:bg-surface-muted border border-surface-border cursor-pointer transition-colors group text-[11px]"
                        >
                          <div className="flex items-center space-x-1.5 truncate mr-2">
                            <FileCode className="w-3.5 h-3.5 text-accent-cyan flex-shrink-0" />
                            <span className="font-mono text-slate-300 truncate group-hover:text-primary-300">
                              {c.filePath}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
                              :{c.startLine}-{c.endLine}
                            </span>
                          </div>
                          <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-primary-400 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
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
          ))
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
            className="w-full bg-surface border border-surface-border rounded-lg pl-3 pr-10 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 disabled:opacity-50"
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
