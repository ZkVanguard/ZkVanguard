'use client';

import { useState, useEffect } from 'react';
import { Activity, CheckCircle, Clock, XCircle, Zap } from 'lucide-react';
import { getAgentActivity, type AgentTask } from '@/lib/api/agents';

export function AgentActivity({ address }: { address: string }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [realTimeEnabled, setRealTimeEnabled] = useState(true);

  useEffect(() => {
    // Fetch real agent activity from message bus
    async function fetchAgentActivity() {
      try {
        const activity = await getAgentActivity('0x0000000000000000000000000000000000000000'); // TODO: Use actual connected address
        setTasks(activity.slice(0, 10)); // Show last 10 tasks
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch agent activity:', error);
        // Fallback to simulated data
        setTasks([
          {
            id: '1',
            agentName: 'Risk Agent',
            agentType: 'risk-agent',
            action: 'RISK_ASSESSMENT',
            description: 'Portfolio risk analysis completed',
            status: 'completed',
            timestamp: new Date(Date.now() - 1000 * 60 * 5),
            priority: 1,
            createdAt: new Date(Date.now() - 1000 * 60 * 5),
            type: 'risk_assessment'
          },
          {
            id: '2',
            agentName: 'Hedging Agent',
            agentType: 'hedging-agent',
            action: 'HEDGE_RECOMMENDATION',
            description: 'Opening SHORT position on BTC-PERP',
            status: 'in-progress',
            timestamp: new Date(Date.now() - 1000 * 60 * 2),
            priority: 2,
            createdAt: new Date(Date.now() - 1000 * 60 * 2),
            type: 'hedging'
          },
        ]);
        setLoading(false);
      }
    }

    fetchAgentActivity();

    // Poll for updates every 5 seconds if real-time enabled
    let interval: NodeJS.Timeout;
    if (realTimeEnabled) {
      interval = setInterval(fetchAgentActivity, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [address, realTimeEnabled]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96" />;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'in-progress':
        return <Activity className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="mb-6">
        <div className="flex items-center space-x-2">
          <h2 className="text-2xl font-semibold">Agent Activity</h2>
          <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/30">
            Live System
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Real AI agents with simulated tasks • Demonstrating coordination capabilities
        </p>
      </div>
      
      <div className="space-y-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="p-4 bg-gray-900 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                {getStatusIcon(task.status || 'queued')}
                <div className="flex-1">
                  <div className="font-medium text-white mb-1">{task.agentName}</div>
                  <div className="text-sm text-gray-400">{task.action}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500">{getTimeAgo(task.timestamp || task.createdAt || new Date())}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
