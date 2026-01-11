import { useState, useCallback } from 'react';

/**
 * Custom hook for boolean toggle states
 * Reduces useState(false) duplication across 15+ components
 * 
 * @param initialValue - Initial boolean state (default: false)
 * @returns [value, toggle, setTrue, setFalse, setValue]
 * 
 * @example
 * ```tsx
 * // Before: 3+ lines per toggle
 * const [isOpen, setIsOpen] = useState(false);
 * const openModal = () => setIsOpen(true);
 * const closeModal = () => setIsOpen(false);
 * 
 * // After: 1 line with utility methods
 * const [isOpen, toggleModal, openModal, closeModal] = useToggle(false);
 * ```
 */
export function useToggle(
  initialValue: boolean = false
): [boolean, () => void, () => void, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback(() => {
    setValue((v) => !v);
  }, []);

  const setTrue = useCallback(() => {
    setValue(true);
  }, []);

  const setFalse = useCallback(() => {
    setValue(false);
  }, []);

  return [value, toggle, setTrue, setFalse, setValue];
}
