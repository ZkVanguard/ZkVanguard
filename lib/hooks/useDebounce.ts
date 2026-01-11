import { useState, useEffect } from 'react';

/**
 * Custom hook for debouncing values
 * Prevents excessive re-renders and API calls from user input
 * Critical for SwapModal amount inputs and search fields
 * 
 * @param value - Value to debounce
 * @param delay - Debounce delay in milliseconds (default: 500ms)
 * @returns Debounced value
 * 
 * @example
 * ```tsx
 * // Before: User types "1000" → 4 API calls for 1, 10, 100, 1000
 * const [amount, setAmount] = useState('');
 * useEffect(() => {
 *   fetchQuote(amount); // Called on every keystroke!
 * }, [amount]);
 * 
 * // After: User types "1000" → 1 API call after 500ms pause
 * const [amount, setAmount] = useState('');
 * const debouncedAmount = useDebounce(amount, 500);
 * useEffect(() => {
 *   fetchQuote(debouncedAmount); // Only called after typing stops
 * }, [debouncedAmount]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up timeout to update debounced value
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clear timeout if value changes before delay completes
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
