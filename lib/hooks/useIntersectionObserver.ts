/**
 * useIntersectionObserver - Lazy load components when they enter viewport
 * 
 * Use for heavy dashboard panels to defer rendering until visible.
 * Reduces initial bundle load and improves TTV (time to visible).
 */
import { useState, useEffect, useRef, useCallback, RefCallback, RefObject } from 'react';

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  freezeOnceVisible?: boolean;
}

export function useIntersectionObserver<T extends HTMLElement = HTMLDivElement>(
  options: UseIntersectionObserverOptions = {}
): [RefCallback<T>, boolean] {
  const { threshold = 0.1, rootMargin = '100px', freezeOnceVisible = true } = options;
  const elementRef = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const frozenRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Skip if already frozen
    if (frozenRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting;
        if (visible) {
          setIsVisible(true);
          if (freezeOnceVisible) {
            frozenRef.current = true;
            observer.unobserve(element);
          }
        } else if (!freezeOnceVisible) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, freezeOnceVisible]);

  // Callback ref to handle element assignment
  const setRef = useCallback((node: T | null) => {
    elementRef.current = node;
  }, []);

  return [setRef, isVisible];
}

/**
 * useInViewport - Simple visibility check
 */
export function useInViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [inViewport, setInViewport] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInViewport(entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return inViewport;
}
