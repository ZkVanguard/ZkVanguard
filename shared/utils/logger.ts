/**
 * @fileoverview Centralized logging utility with structured logging support
 * @module shared/utils/logger
 * 
 * IMPORTANT: Serverless-compatible - no file transports in production/Vercel
 * because serverless functions have a read-only filesystem.
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Detect serverless environment (Vercel, AWS Lambda, etc.)
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Only create logs directory in non-serverless environments
let logsDir: string | null = null;
if (!isServerless) {
  try {
    logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (err) {
    // In read-only filesystem, just skip file logging
    console.warn('Could not create logs directory, using console-only logging');
    logsDir = null;
  }
}

// Custom log format
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, metadata }) => {
    let metaStr = '';
    if (metadata && Object.keys(metadata).length > 0) {
      metaStr = JSON.stringify(metadata, null, 2);
    }
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Build transports array based on environment
const transports: winston.transport[] = [];

// In serverless/production, always use console (Vercel captures these logs)
if (isServerless || isProduction) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, metadata }) => {
          let metaStr = '';
          if (metadata && Object.keys(metadata).length > 0) {
            metaStr = ` ${JSON.stringify(metadata)}`;
          }
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    })
  );
} else if (logsDir) {
  // In local development with writable filesystem, use file transports
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'agents.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent: isTest,
  format: customFormat,
  defaultMeta: { service: 'zkvanguard' },
  transports,
  // Only add exception handlers in non-serverless environments
  ...(logsDir && !isServerless ? {
    exceptionHandlers: [
      new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log'),
      }),
    ],
    rejectionHandlers: [
      new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log'),
      }),
    ],
  } : {}),
});

// Add console transport for local development (if not already added)
if (!isServerless && !isProduction) {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log agent-specific events
 */
export const agentLogger = createChildLogger({ component: 'agent' });

/**
 * Log contract-specific events
 */
export const contractLogger = createChildLogger({ component: 'contract' });

/**
 * Log integration-specific events
 */
export const integrationLogger = createChildLogger({ component: 'integration' });

export default logger;
