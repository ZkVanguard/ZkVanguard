'use client';

import { useState, useCallback, memo } from 'react';
import { Activity, CheckCircle, Clock, XCircle, Shield, Brain, Zap, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZKBadgeInline, type ZKProofData } from '@/components/ZKVerificationBadge';
import { getAgentActivity, type AgentTask } from '@/lib/api/agents';
import { usePolling, useLoading, useToggle } from '@/lib/hooks';

interface AgentActivityProps {
  address: string;
  onTaskComplete?: (task: AgentTask) => void;
}

async function generateTaskProof(task: AgentTask): Promise<ZKProofData> {
  try {
    const response = await fetch('/api/zk-proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario: 'agent_action',
        statement: {
          claim: `Agent ${task.agentName} executed ${task.action}`,
          taskId: task.id,
          timestamp: Date.now(),
        },
        witness: {
          agentType: task.agentType,
          status: task.status,
        },
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.proof) {
        return {
          proofHash: data.proof.merkle_root || data.proof.proof_hash || '0x0',
          merkleRoot: data.proof.merkle_root || '0x0',
          timestamp: Date.now(),
          verified: data.proof.verified !== false,
          protocol: data.proof.protocol || (data.fallback ? 'ZK-STARK (Fallback)' : 'ZK-STARK'),
          securityLevel: data.proof.security_level || 0,
          generationTime: data.duration_ms || 0,
        };
      }
    }
  } catch (error) {
    console.error('ZK proof generation failed:', error);
  }
  
  return {
    proofHash: '0x0',
    merkleRoot: '0x0',
    timestamp: Date.now(),
    verified: false,
    protocol: 'ZK-STARK (Unavailable)',
    securityLevel: 0,
    generationTime: 0,
  };
}

export const AgentActivity = memo(function AgentActivity({ address, onTaskComplete: _onTaskComplete }: AgentActivityProps) {
  const [tasks, setTasks] = useState<(AgentTask & { zkProof?: ZKProofData; impact?: { metric: string; before: string | number; after: string | number } })[]>([]);
  const { isLoading: loading, error, setError } = useLoading(true);
  const [autoRefresh, toggleAutoRefresh] = useToggle(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchActivity = useCallback(async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) setIsRefreshing(true);
    
    try {
      const activity = await getAgentActivity(address || '0x0000000000000000000000000000000000000000');
      
      const tasksWithProofs = await Promise.all(
        activity.slice(0, 15).map(async (task) => {
          if (task.status === 'completed') {
            const zkProof = await generateTaskProof(task);
            return { ...task, zkProof };
          }
          return task;
        })
      );
      
      setTasks(tasksWithProofs);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setTasks([]);
    } finally {
      setIsRefreshing(false);
    }
  }, [address, setError]);

  usePolling(fetchActivity, 5000, autoRefresh);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-[#34C759]" />;
      case 'in-progress':
        return <Activity className="w-5 h-5 text-[#007AFF] animate-pulse" />;
      case 'pending':
      case 'queued':
        return <Clock className="w-5 h-5 text-[#FF9500]" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-[#FF3B30]" />;
      default:
        return <Activity className="w-5 h-5 text-[#86868b]" />;
    }
  };

  const getAgentColor = (agentType?: string) => {
    const colors: Record<string, string> = {
      'lead-agent': 'from-[#AF52DE] to-[#FF2D55]',
      'risk-agent': 'from-[#FF9500] to-[#FF3B30]',
      'hedging-agent': 'from-[#007AFF] to-[#5AC8FA]',
      'settlement-agent': 'from-[#34C759] to-[#30D158]',
      'reporting-agent': 'from-[#5856D6] to-[#AF52DE]',
    };
    return colors[agentType || ''] || 'from-[#8E8E93] to-[#636366]';
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="space-y-2 sm:space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 sm:h-20 animate-pulse bg-[#f5f5f7] rounded-[12px] sm:rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 pb-4 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] sm:text-[11px] font-medium text-[#34C759] uppercase tracking-wide px-1.5 sm:px-2 py-0.5 sm:py-1 bg-[#34C759]/10 rounded-full flex items-center gap-1">
            <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-[#34C759] rounded-full animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={toggleAutoRefresh}
            className={`text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg border transition-colors ${
              autoRefresh 
                ? 'bg-[#AF52DE]/10 text-[#AF52DE] border-[#AF52DE]/30' 
                : 'bg-[#f5f5f7] text-[#86868b] border-[#e8e8ed]'
            }`}
          >
            Auto {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => fetchActivity(true)}
            disabled={isRefreshing}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#86868b] ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      <p className="text-[10px] sm:text-[11px] text-[#86868b] mb-3 sm:mb-4">
        {error ? (
          <span className="text-[#FF9500]">Demo mode • Real agents with ZK verification</span>
        ) : (
          'Real AI agents with ZK-verified decisions • Live market data'
        )}
      </p>
      
      {/* Tasks */}
      <div className="space-y-3">
        <AnimatePresence>
          {tasks.map((task, index) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ delay: index * 0.05 }}
              className={`p-4 rounded-xl border transition-all ${
                task.status === 'completed' 
                  ? 'bg-[#34C759]/5 border-[#34C759]/20 hover:border-[#34C759]/40' 
                  : task.status === 'in-progress'
                  ? 'bg-[#007AFF]/5 border-[#007AFF]/20 hover:border-[#007AFF]/40'
                  : 'bg-[#f5f5f7] border-[#e8e8ed] hover:border-[#d2d2d7]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getAgentColor(task.agentType)} flex items-center justify-center flex-shrink-0`}>
                    {task.agentType === 'lead-agent' && <Brain className="w-5 h-5 text-white" />}
                    {task.agentType === 'risk-agent' && <Activity className="w-5 h-5 text-white" />}
                    {task.agentType === 'hedging-agent' && <Shield className="w-5 h-5 text-white" />}
                    {task.agentType === 'settlement-agent' && <Zap className="w-5 h-5 text-white" />}
                    {task.agentType === 'reporting-agent' && <CheckCircle className="w-5 h-5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[15px] font-semibold text-[#1d1d1f]">{task.agentName}</span>
                      <span className="text-[11px] text-[#86868b] bg-[#f5f5f7] px-2 py-0.5 rounded">
                        {task.action}
                      </span>
                    </div>
                    <p className="text-[13px] text-[#86868b] mb-2">{task.description}</p>
                    
                    {/* Impact indicator */}
                    {task.impact && task.status === 'completed' && (
                      <div className="flex items-center gap-2 text-[11px]">
                        <Zap className="w-3 h-3 text-[#34C759]" />
                        <span className="text-[#86868b]">{task.impact.metric}:</span>
                        <span className="text-[#86868b]">{task.impact.before}</span>
                        <span className="text-[#d2d2d7]">→</span>
                        <span className="text-[#34C759] font-semibold">{task.impact.after}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    {task.status === 'completed' && task.zkProof && (
                      <ZKBadgeInline verified={task.zkProof.verified} size="sm" />
                    )}
                    {getStatusIcon(task.status || 'queued')}
                  </div>
                  <span className="text-[11px] text-[#86868b]">
                    {getTimeAgo(task.timestamp || task.createdAt || new Date())}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {tasks.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-[#f5f5f7] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Brain className="w-8 h-8 text-[#86868b]" />
            </div>
            <p className="text-[15px] text-[#86868b]">No agent activity yet</p>
            <p className="text-[13px] text-[#86868b] mt-1">Try sending a command in the chat</p>
          </div>
        )}
      </div>
    </div>
  );
});
