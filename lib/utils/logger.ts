/* eslint-disable no-console */
/**
 * Production-safe logging utility
 * - info/debug logs only in development
 * - errors always logged
 * - structured output for monitoring
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

const isDevelopment = process.env.NODE_ENV === 'development';

class Logger {
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!isDevelopment && (level === 'info' || level === 'debug')) {
      return;
    }

    const _timestamp = new Date().toISOString();
    const prefix = this.getPrefix(level);

    if (context && Object.keys(context).length > 0) {
      console[level === 'debug' ? 'log' : level](`${prefix} ${message}`, context);
    } else {
      console[level === 'debug' ? 'log' : level](`${prefix} ${message}`);
    }
  }

  private getPrefix(level: LogLevel): string {
    const prefixes: Record<LogLevel, string> = {
      info: 'ℹ️ ',
      warn: '⚠️ ',
      error: '❌',
      debug: '🔍'
    };
    return prefixes[level] || '';
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error
    };
    this.log('error', message, errorContext);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }
}

export const logger = new Logger();
