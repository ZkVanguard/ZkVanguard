/**
 * Centralized Error Handling Utility
 * Eliminates duplicate try-catch patterns across the codebase
 */

import { logger } from './logger';

export interface ErrorHandlerOptions {
  context: string;
  logError?: boolean;
  rethrow?: boolean;
  fallbackValue?: unknown;
  errorTransform?: (error: unknown) => Error;
}

/**
 * Wraps async functions with consistent error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: ErrorHandlerOptions
): Promise<T | null> {
  const { context, logError = true, rethrow = false, fallbackValue = null } = options;
  
  try {
    return await fn();
  } catch (error) {
    if (logError) {
      logger.error(`${context} failed`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    if (rethrow) {
      throw error;
    }
    
    return fallbackValue as T | null;
  }
}

/**
 * Wraps sync functions with consistent error handling
 */
export function withErrorHandlingSync<T>(
  fn: () => T,
  options: ErrorHandlerOptions
): T | null {
  const { context, logError = true, rethrow = false, fallbackValue = null } = options;
  
  try {
    return fn();
  } catch (error) {
    if (logError) {
      logger.error(`${context} failed`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    if (rethrow) {
      throw error;
    }
    
    return fallbackValue as T | null;
  }
}

/**
 * Creates a safe API call wrapper with automatic retries
 */
export async function safeApiCall<T>(
  apiCall: () => Promise<T>,
  options: {
    context: string;
    maxRetries?: number;
    retryDelay?: number;
    fallbackValue?: T;
  }
): Promise<T> {
  const { context, maxRetries = 2, retryDelay = 1000, fallbackValue } = options;
  
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        logger.warn(`${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`, {
          error: error instanceof Error ? error.message : String(error)
        });
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  logger.error(`${context} failed after ${maxRetries + 1} attempts`, {
    error: lastError instanceof Error ? lastError.message : String(lastError)
  });
  
  if (fallbackValue !== undefined) {
    return fallbackValue;
  }
  
  throw lastError;
}

/**
 * Validates data and throws descriptive errors
 */
export function validateRequired<T>(
  value: T | null | undefined,
  fieldName: string
): T {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is required but was not provided`);
  }
  return value;
}

/**
 * Creates a typed error with additional context
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}
