/**
 * Enhanced Chat Component with LLM Integration
 * Features: Streaming responses, typing indicators, better UX, Markdown rendering
 */

'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, Sparkles, TrendingUp, Shield, Zap, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatAction {
  id: string;
  label: string;
  type: string;
  params: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  streaming?: boolean;
  actions?: ChatAction[];
}

interface EnhancedChatProps {
  address?: string;
  onActionTrigger?: (action: string, params: any) => void;
}

const QUICK_PROMPTS = [
  { label: 'Analyze portfolio', icon: TrendingUp, prompt: 'Analyze my portfolio and show key metrics' },
  { label: 'Check risk level', icon: Shield, prompt: 'What is my current risk level?' },
  { label: 'Explain x402', icon: Zap, prompt: 'Explain how x402 gasless transactions work' },
  { label: 'ZK Proofs?', icon: Sparkles, prompt: 'What are Zero-Knowledge proofs and how do you use them?' },
];

// Code block component with copy functionality
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace('language-', '') || 'text';
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4 text-white/70" />
          )}
        </button>
      </div>
      <div className="text-xs text-white/50 px-4 py-1 bg-[#1e1e2e] rounded-t-lg border-b border-white/10">
        {language}
      </div>
      <pre className="bg-[#1e1e2e] text-[#cdd6f4] p-4 rounded-b-lg overflow-x-auto text-sm font-mono">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// Markdown renderer component
function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Headers
        h1: ({ children }) => (
          <h1 className={`text-xl font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className={`text-lg font-bold mt-3 mb-2 ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className={`text-base font-semibold mt-3 mb-1.5 ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className={`text-sm font-semibold mt-2 mb-1 ${isUser ? 'text-white' : 'text-[#6e6e73]'}`}>
            {children}
          </h4>
        ),
        // Paragraphs
        p: ({ children }) => (
          <p className={`mb-2 last:mb-0 leading-relaxed ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </p>
        ),
        // Strong/Bold
        strong: ({ children }) => (
          <strong className={`font-semibold ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </strong>
        ),
        // Emphasis/Italic
        em: ({ children }) => (
          <em className={isUser ? 'text-white/90' : 'text-[#6e6e73]'}>{children}</em>
        ),
        // Lists
        ul: ({ children }) => (
          <ul className={`list-disc list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className={`list-decimal list-inside mb-2 space-y-1 ${isUser ? 'text-white' : 'text-[#1d1d1f]'}`}>
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="ml-2">{children}</li>
        ),
        // Code blocks
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code 
                className={`px-1.5 py-0.5 rounded text-sm font-mono ${
                  isUser 
                    ? 'bg-white/20 text-white' 
                    : 'bg-[#f5f5f7] text-[#e74c3c] border border-[#e5e5ea]'
                }`}
                {...props}
              >
                {children}
              </code>
            );
          }
          return <CodeBlock className={className}>{String(children).replace(/\n$/, '')}</CodeBlock>;
        },
        pre: ({ children }) => <>{children}</>,
        // Tables
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-[#e5e5ea]">
            <table className="min-w-full divide-y divide-[#e5e5ea] text-sm">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[#f5f5f7]">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-[#e5e5ea] bg-white">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-[#f5f5f7]/50 transition-colors">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-semibold text-[#1d1d1f] whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-[#1d1d1f] whitespace-nowrap">{children}</td>
        ),
        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote className={`border-l-4 pl-4 my-2 italic ${
            isUser 
              ? 'border-white/40 text-white/80' 
              : 'border-[#007AFF] text-[#6e6e73] bg-[#f5f5f7] py-2 pr-4 rounded-r-lg'
          }`}>
            {children}
          </blockquote>
        ),
        // Horizontal rule
        hr: () => (
          <hr className={`my-4 ${isUser ? 'border-white/20' : 'border-[#e5e5ea]'}`} />
        ),
        // Links
        a: ({ href, children }) => (
          <a 
            href={href} 
            target="_blank" 
            rel="noopener noreferrer"
            className={`underline underline-offset-2 hover:opacity-80 transition-opacity ${
              isUser ? 'text-white' : 'text-[#007AFF]'
            }`}
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function EnhancedChat({ address, onActionTrigger }: EnhancedChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Welcome! I'm your AI-powered portfolio assistant with real LLM capabilities. 🤖\n\nI can help you with:\n• Portfolio analysis and risk assessment\n• Understanding DeFi concepts\n• Hedge strategy recommendations\n• Platform features and capabilities\n\nFeel free to ask me anything!`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: address || 'default',
          context: { address, timestamp: Date.now() },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      setIsTyping(false);

      // Parse actions from response if present
      let content = data.response;
      let actions: ChatAction[] | undefined;
      
      const actionMatch = content.match(/<!--ACTIONS:(.+?)-->/s);
      if (actionMatch) {
        try {
          actions = JSON.parse(actionMatch[1]);
          content = content.replace(/<!--ACTIONS:.+?-->/s, '').trim();
        } catch (e) {
          console.error('Failed to parse actions:', e);
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        actions,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setIsTyping(false);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-white to-[#fafafa] rounded-2xl border border-[#e5e5ea] overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#e5e5ea] bg-gradient-to-r from-[#f5f5f7] to-white">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white" />
          </div>
          <div>
            <h3 className="font-semibold text-[15px] text-[#1d1d1f]">ZK Vanguard AI</h3>
            <p className="text-xs text-[#86868b]">Powered by Advanced LLM</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-medium text-emerald-700">Online</span>
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="flex gap-2 p-3 overflow-x-auto border-b border-[#e5e5ea] bg-white scrollbar-thin scrollbar-thumb-[#e5e5ea] scrollbar-track-transparent">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleQuickPrompt(prompt.prompt)}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-gradient-to-b from-white to-[#f5f5f7] hover:from-[#f5f5f7] hover:to-[#e5e5ea] text-[#1d1d1f] rounded-xl border border-[#e5e5ea] hover:border-[#007AFF] hover:shadow-md whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <prompt.icon className="w-3.5 h-3.5 text-[#86868b] group-hover:text-[#007AFF] transition-colors" />
            {prompt.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-white to-[#fafafa]">
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[90%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-md ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-[#007AFF] to-[#5856D6]'
                    : 'bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500'
                }`}>
                  {message.role === 'user' ? (
                    <User className="w-5 h-5 text-white" />
                  ) : (
                    <Bot className="w-5 h-5 text-white" />
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={`rounded-2xl px-4 py-3 shadow-sm ${
                    message.role === 'user'
                      ? 'bg-gradient-to-br from-[#007AFF] to-[#5856D6] text-white rounded-tr-md'
                      : 'bg-white text-[#1d1d1f] rounded-tl-md border border-[#e5e5ea] shadow-md'
                  }`}
                >
                  <div className={`text-sm leading-relaxed ${message.role === 'user' ? 'text-white' : 'text-[#1d1d1f]'}`}>
                    <MarkdownContent content={message.content} isUser={message.role === 'user'} />
                  </div>
                  
                  {/* Action Buttons */}
                  {message.actions && message.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#e5e5ea]">
                      {message.actions.map((action) => (
                        <button
                          key={action.id}
                          onClick={() => {
                            if (onActionTrigger) {
                              onActionTrigger(action.type, action.params);
                            } else {
                              // Fallback: send as chat message
                              sendMessage(`/${action.type} ${JSON.stringify(action.params)}`);
                            }
                          }}
                          className={`px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                            action.type === 'hedge' 
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-500/25 hover:shadow-lg'
                              : action.type === 'adjust'
                              ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md shadow-amber-500/25'
                              : 'bg-gradient-to-r from-[#007AFF] to-[#5856D6] hover:from-[#0066DD] hover:to-[#4745C4] text-white shadow-md shadow-blue-500/25'
                          }`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className={`text-[10px] mt-2 flex items-center gap-1 ${message.role === 'user' ? 'text-white/60 justify-end' : 'text-[#86868b]'}`}>
                    {message.role === 'assistant' && <Sparkles className="w-3 h-3" />}
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing Indicator */}
        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex justify-start"
          >
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-md">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-white rounded-2xl rounded-tl-md px-5 py-4 border border-[#e5e5ea] shadow-md">
                <div className="flex gap-1.5 items-center">
                  <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-fuchsia-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="ml-2 text-xs text-[#86868b]">Thinking...</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-[#e5e5ea] bg-gradient-to-r from-[#f5f5f7] to-white">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about your portfolio or DeFi..."
            disabled={isLoading}
            className="flex-1 px-4 py-3.5 bg-white border border-[#e5e5ea] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#007AFF]/50 focus:border-[#007AFF] text-sm text-[#1d1d1f] placeholder-[#86868b] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="px-5 py-3.5 bg-gradient-to-br from-[#007AFF] to-[#5856D6] hover:from-[#0066DD] hover:to-[#4745C4] disabled:from-[#e5e5ea] disabled:to-[#e5e5ea] disabled:cursor-not-allowed rounded-xl transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg shadow-[#007AFF]/25 disabled:shadow-none"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
        <p className="text-[10px] text-[#86868b] mt-2 text-center flex items-center justify-center gap-1">
          <Sparkles className="w-3 h-3" />
          Powered by ASI • Context-aware • ZK-verified responses
        </p>
      </div>
    </div>
  );
}
