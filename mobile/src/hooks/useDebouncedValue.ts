import { useEffect, useState } from 'react';

/** Search-box debounce: settles on `value` once it stops changing for `delayMs`. */
export const SEARCH_DEBOUNCE_MS = 250;

export const useDebouncedValue = <T,>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};
