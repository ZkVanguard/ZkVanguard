/**
 * Production-safe logging utility
 * 
 * Optimized for multi-user:
 * - Zero allocation for suppressed log levels
 * - info/debug only in development
 * - Structured output for monitoring
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

class Logger {
  // Fast path: check if level is enabled before doing any work
  private isEnabled(level: LogLevel): boolean {
    if (isTest) return false;
    if (isProduction && (level === 'info' || level === 'debug')) return false;
    return true;
  }

  info(message: string, context?: LogContext): void {
    if (!this.isEnabled('info')) return;
    if (context && Object.keys(context).length > 0) {
      // eslint-disable-next-line no-console
      console.info(`ℹ️  ${message}`, context);
    } else {
      // eslint-disable-next-line no-console
      console.info(`ℹ️  ${message}`);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (!this.isEnabled('warn')) return;
    if (context && Object.keys(context).length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  ${message}`, context);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`⚠️  ${message}`);
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (isTest) return;
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error
    };
    // eslint-disable-next-line no-console
    console.error(`❌ ${message}`, errorContext);
  }

  debug(message: string, context?: LogContext): void {
    if (!this.isEnabled('debug')) return;
    if (context && Object.keys(context).length > 0) {
      // eslint-disable-next-line no-console
      console.log(`🔍 ${message}`, context);
    } else {
      // eslint-disable-next-line no-console
      console.log(`🔍 ${message}`);
    }
  }
}

export const logger = new Logger();
