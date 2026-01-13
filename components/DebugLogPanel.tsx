'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Eye, EyeOff, Trash2, Download, X, Maximize2, Minimize2 } from 'lucide-react';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  source: string;
  message: string;
  data?: Record<string, unknown>;
}

interface DebugLogPanelProps {
  logs?: LogEntry[];
  onClear?: () => void;
  maxHeight?: string;
  className?: string;
  title?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  showFilters?: boolean;
  floatingMode?: boolean;
}

// Global log store for app-wide logging
class LogStore {
  private static instance: LogStore;
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  static getInstance(): LogStore {
    if (!LogStore.instance) {
      LogStore.instance = new LogStore();
    }
    return LogStore.instance;
  }

  addLog(level: LogEntry['level'], source: string, message: string, data?: Record<string, unknown>) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      level,
      source,
      message,
      data,
    };
    
    this.logs = [...this.logs.slice(-this.maxLogs + 1), entry];
    this.notify();
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  clear() {
    this.logs = [];
    this.notify();
  }

  subscribe(callback: (logs: LogEntry[]) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    this.listeners.forEach(cb => cb(this.logs));
  }
}

export const logStore = LogStore.getInstance();

// Convenience logging functions
export const debugLog = {
  info: (source: string, message: string, data?: Record<string, unknown>) => 
    logStore.addLog('info', source, message, data),
  success: (source: string, message: string, data?: Record<string, unknown>) => 
    logStore.addLog('success', source, message, data),
  warning: (source: string, message: string, data?: Record<string, unknown>) => 
    logStore.addLog('warning', source, message, data),
  error: (source: string, message: string, data?: Record<string, unknown>) => 
    logStore.addLog('error', source, message, data),
  debug: (source: string, message: string, data?: Record<string, unknown>) => 
    logStore.addLog('debug', source, message, data),
};

export function DebugLogPanel({
  logs: externalLogs,
  onClear,
  maxHeight = '300px',
  className = '',
  title = 'Debug Logs',
  collapsible = true,
  defaultCollapsed = false,
  showFilters = true,
  floatingMode = false,
}: DebugLogPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<LogEntry['level'] | 'all'>('all');
  const [internalLogs, setInternalLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use external logs if provided, otherwise use global store
  const logs = externalLogs || internalLogs;

  useEffect(() => {
    if (!externalLogs) {
      const unsubscribe = logStore.subscribe(setInternalLogs);
      setInternalLogs(logStore.getLogs());
      return () => {
        unsubscribe();
      };
    }
  }, [externalLogs]);

  useEffect(() => {
    if (!isCollapsed) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isCollapsed]);

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      logStore.clear();
    }
  };

  const handleDownload = () => {
    const content = filteredLogs.map(l => 
      `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${l.data ? '\n  Data: ' + JSON.stringify(l.data) : ''}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelColors = {
    info: 'text-blue-400',
    success: 'text-emerald-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-purple-400',
  };

  const levelIcons = {
    info: '📊',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    debug: '🔍',
  };

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E5EA] bg-[#F5F5F7]">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#34C759]" />
          <span className="text-sm font-semibold text-[#1D1D1F]">{title}</span>
          <span className="text-xs text-[#6E6E73] bg-[#E5E5EA] px-2 py-0.5 rounded">
            {filteredLogs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showFilters && !isCollapsed && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogEntry['level'] | 'all')}
              className="text-xs bg-white border border-[#E5E5EA] rounded px-2 py-1 focus:outline-none focus:border-[#007AFF] text-[#1D1D1F]"
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
          )}
          <button
            onClick={handleDownload}
            className="p-1 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
            title="Download logs"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            className="p-1 text-[#86868B] hover:text-[#FF3B30] transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {floatingMode && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
            >
              {isCollapsed ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Log Content */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div 
              className="p-3 bg-[#1D1D1F] overflow-y-auto font-mono text-xs"
              style={{ maxHeight: isExpanded ? '80vh' : maxHeight }}
            >
              {filteredLogs.length === 0 ? (
                <div className="text-[#86868B] text-center py-4">
                  No logs yet. Activity will appear here...
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`mb-2 pb-2 border-b border-gray-800/50 last:border-0 ${levelColors[log.level]}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex-shrink-0">{levelIcons[log.level]}</span>
                      <span className="text-[#86868B] flex-shrink-0">
                        [{log.timestamp.toLocaleTimeString()}]
                      </span>
                      <span className="text-[#5856D6] flex-shrink-0">[{log.source}]</span>
                      <span className="text-white/90">{log.message}</span>
                    </div>
                    {log.data && (
                      <div className="ml-6 mt-1 text-[#86868B] text-[10px] bg-white/5 rounded px-2 py-1">
                        {JSON.stringify(log.data, null, 2)}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  if (floatingMode) {
    return (
      <motion.div
        ref={containerRef}
        drag
        dragMomentum={false}
        className={`fixed bottom-4 right-4 z-50 bg-white rounded-xl border border-[#E5E5EA] shadow-xl ${
          isExpanded ? 'w-[600px]' : 'w-[400px]'
        } ${className}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {panelContent}
      </motion.div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-[#E5E5EA] overflow-hidden ${className}`}>
      {panelContent}
    </div>
  );
}

/**
 * Floating toggle button for debug panel
 */
export function DebugLogToggle() {
  const [isOpen, setIsOpen] = useState(false);
  const [logCount, setLogCount] = useState(0);

  useEffect(() => {
    const unsubscribe = logStore.subscribe((logs) => {
      setLogCount(logs.length);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-[#E5E5EA] shadow-lg hover:bg-[#F5F5F7] transition-colors"
      >
        <Terminal className="w-4 h-4 text-[#34C759]" />
        <span className="text-sm font-semibold text-[#1D1D1F]">Logs</span>
        {logCount > 0 && (
          <span className="text-xs bg-[#5856D6] text-white px-2 py-0.5 rounded-full">
            {logCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-16 left-4 z-50 w-[500px]"
          >
            <div className="bg-white rounded-xl border border-[#E5E5EA] shadow-xl">
              <DebugLogPanel
                logs={logStore.getLogs()}
                onClear={() => logStore.clear()}
                maxHeight="400px"
                collapsible={false}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
