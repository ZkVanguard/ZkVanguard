'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Brain } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { sendAgentCommand } from '@/lib/api/agents';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agentType?: string;
  aiPowered?: boolean;
}

export function ChatInterface({ address: _address }: { address: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI-powered Lead Agent with Crypto.com AI integration. I can analyze your portfolio, assess risk, suggest hedges, and execute settlements using natural language understanding. Try: "Analyze my portfolio" or "What\'s my risk level?"',
      timestamp: new Date(),
      aiPowered: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = input;
    setInput('');
    setLoading(true);

    try {
      // Use Crypto.com AI for intent parsing
      const aiService = getCryptocomAIService();
      const intent = await aiService.parseIntent(userInput);
      
      logger.debug('AI Intent classified', { intent });

      // Route to appropriate agent based on intent
      let response;
      if (intent.intent === 'analyze_portfolio') {
        const analysis = await aiService.analyzePortfolio(_address, {});
        response = {
          response: `Portfolio Analysis (AI-Powered):\n\nTotal Value: $${(analysis.totalValue / 1000000).toFixed(2)}M\nPositions: ${analysis.positions}\nHealth Score: ${analysis.healthScore.toFixed(0)}%\n\nRecommendations:\n${analysis.recommendations.join('\n')}`,
          agent: 'ai_portfolio',
        };
      } else if (intent.intent === 'assess_risk') {
        const risk = await aiService.assessRisk({});
        response = {
          response: `Risk Assessment (AI-Powered):\n\nOverall Risk: ${risk.overallRisk.toUpperCase()}\nRisk Score: ${risk.riskScore.toFixed(1)}/100\nVolatility: ${(risk.volatility * 100).toFixed(1)}%\nVaR (95%): ${(risk.var95 * 100).toFixed(1)}%\nSharpe Ratio: ${risk.sharpeRatio.toFixed(2)}`,
          agent: 'ai_risk',
        };
      } else {
        // Fallback to agent command
        response = await sendAgentCommand(userInput);
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response || 'I\'ve processed your request.',
        timestamp: new Date(),
        agentType: response.agent,
        aiPowered: true,
      };
      
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Agent command failed:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I encountered an error processing your request. Please try again.',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 flex flex-col h-[600px]">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xl font-semibold flex items-center space-x-2">
          <Bot className="w-5 h-5 text-blue-500" />
          <span>AI Assistant</span>
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex items-start space-x-2 max-w-[80%]`}>
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}
              <div
                className={`p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-100'
                }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                {message.aiPowered && message.role === 'assistant' && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-cyan-400">
                    <Brain className="w-3 h-3" />
                    <span>Crypto.com AI</span>
                  </div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-75" />
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-150" />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask me anything..."
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
