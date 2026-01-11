import { useEffect, useRef } from 'react';

/**
 * Custom hook for efficient API polling with automatic cleanup
 * Eliminates redundant polling logic across components
 * 
 * @param callback - Function to execute on each poll
 * @param interval - Polling interval in milliseconds
 * @param enabled - Whether polling is active (default: true)
 * 
 * @example
 * ```tsx
 * // Before: 25+ lines of interval logic
 * useEffect(() => {
 *   fetchData();
 *   const interval = setInterval(() => fetchData(false), 60000);
 *   return () => clearInterval(interval);
 * }, [fetchData]);
 * 
 * // After: 1 line
 * usePolling(fetchData, 60000);
 * ```
 */
export function usePolling(
  callback: () => void | Promise<void>,
  interval: number,
  enabled: boolean = true
): void {
  const savedCallback = useRef(callback);
  const intervalRef = useRef<NodeJS.Timeout>();

  // Update callback ref on each render
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      // Clear interval if polling is disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
      return;
    }

    // Execute callback immediately on mount
    void savedCallback.current();

    // Setup interval
    intervalRef.current = setInterval(() => {
      void savedCallback.current();
    }, interval);

    // Cleanup on unmount or deps change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval, enabled]);
}
