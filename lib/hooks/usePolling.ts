import { useEffect, useRef, useState } from 'react';

/**
 * Custom hook for efficient API polling with:
 * - Automatic cleanup on unmount
 * - Visibility-aware: pauses when tab is hidden, resumes when visible
 * - Prevents wasted bandwidth when user isn't looking at the page
 * 
 * @param callback - Function to execute on each poll
 * @param interval - Polling interval in milliseconds
 * @param enabled - Whether polling is active (default: true)
 * 
 * @example
 * ```tsx
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
  const [visible, setVisible] = useState(true);

  // Update callback ref on each render
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Track tab visibility
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibility = () => {
      setVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!enabled || !visible) {
      // Clear interval if polling is disabled or tab is hidden
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
      return;
    }

    // Execute callback immediately when becoming visible or on mount
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
  }, [interval, enabled, visible]);
}
