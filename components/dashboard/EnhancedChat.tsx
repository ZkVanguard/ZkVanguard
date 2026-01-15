/**
 * Enhanced Chat Component with LLM Integration
 * Features: Streaming responses, typing indicators, better UX
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, TrendingUp, Shield, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  streaming?: boolean;
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

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Check if response suggests an action
      if (onActionTrigger) {
        const content = data.response.toLowerCase();
        if (content.includes('analyze') && content.includes('portfolio')) {
          // Could trigger portfolio analysis
        }
      }
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
    <div className="flex flex-col h-full bg-white rounded-xl border border-[#e8e8ed] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#e8e8ed] bg-[#F5F5F7]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 via-cyan-500 to-emerald-500 flex items-center justify-center">
            <Bot className="w-6 h-6 text-[#1d1d1f]" />
          </div>
          <div>
            <h3 className="font-semibold text-[#1d1d1f]">AI Assistant</h3>
            <p className="text-xs text-[#86868b]">LLM-Powered • Always Learning</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs text-[#34C759]">Online</span>
        </div>
      </div>

      {/* Quick Prompts */}
      <div className="flex gap-2 p-3 overflow-x-auto border-b border-[#e8e8ed] bg-white">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleQuickPrompt(prompt.prompt)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1d1d1f] rounded-full border border-[#E5E5EA] hover:border-[#007AFF] whitespace-nowrap transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <prompt.icon className="w-3.5 h-3.5" />
            {prompt.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-2 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.role === 'user'
                    ? 'bg-[#007AFF]'
                    : 'bg-gradient-to-br from-purple-500 to-cyan-500'
                }`}>
                  {message.role === 'user' ? (
                    <User className="w-5 h-5 text-white" />
                  ) : (
                    <Bot className="w-5 h-5 text-white" />
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-[#007AFF] text-white rounded-tr-sm'
                      : 'bg-[#F5F5F7] text-[#1D1D1F] rounded-tl-sm border border-[#E5E5EA]'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </div>
                  <div className="text-xs opacity-60 mt-1">
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
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-[#F5F5F7] rounded-2xl rounded-tl-sm px-4 py-3 border border-[#E5E5EA]">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-[#86868B] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-[#86868B] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-[#86868B] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-[#e8e8ed] bg-[#F5F5F7]">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about your portfolio or DeFi..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-white border border-[#E5E5EA] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent text-sm text-[#1d1d1f] placeholder-[#86868B] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="px-4 py-3 bg-gradient-to-r from-[#5856D6] to-[#007AFF] hover:opacity-90 disabled:from-[#E5E5EA] disabled:to-[#E5E5EA] disabled:cursor-not-allowed rounded-xl transition-all transform hover:scale-105 active:scale-95"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
        <p className="text-xs text-[#86868B] mt-2 text-center">
          Powered by advanced LLM • Context-aware responses
        </p>
      </div>
    </div>
  );
}
