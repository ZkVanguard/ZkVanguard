import { useState, useCallback } from 'react';

/**
 * Custom hook for standardized loading state management
 * Eliminates duplicate loading/error patterns across 10+ components
 * 
 * @param initialLoading - Initial loading state (default: false)
 * @returns {isLoading, error, startLoading, stopLoading, setError, clearError, reset}
 * 
 * @example
 * ```tsx
 * // Before: 6+ lines of loading logic
 * const [loading, setLoading] = useState(false);
 * const [error, setError] = useState<string | null>(null);
 * 
 * // After: 1 line with utilities
 * const { isLoading, error, startLoading, stopLoading, setError } = useLoading();
 * 
 * // Usage
 * async function fetchData() {
 *   startLoading();
 *   try {
 *     await api.call();
 *     stopLoading();
 *   } catch (err) {
 *     setError(err.message);
 *   }
 * }
 * ```
 */
export function useLoading(initialLoading: boolean = false) {
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [error, setErrorState] = useState<string | null>(null);

  const startLoading = useCallback(() => {
    setIsLoading(true);
    setErrorState(null);
  }, []);

  const stopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  const setError = useCallback((error: string | Error | null) => {
    setIsLoading(false);
    setErrorState(error ? (typeof error === 'string' ? error : error.message) : null);
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const reset = useCallback(() => {
    setIsLoading(initialLoading);
    setErrorState(null);
  }, [initialLoading]);

  return {
    isLoading,
    error,
    startLoading,
    stopLoading,
    setError,
    clearError,
    reset,
  };
}
