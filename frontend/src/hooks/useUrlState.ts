import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from './useDebouncedValue';

/** A value one URL search parameter can hold; null, undefined, '' and false remove it. */
export type UrlParamValue = string | number | boolean | null | undefined;

/** Several search parameters changed in one navigation (e.g. a filter plus `page`). */
export type UrlParamPatch = Readonly<Record<string, UrlParamValue>>;

export interface UrlUpdateOptions {
  /**
   * Replace the current history entry instead of pushing a new one. Typing
   * and other high-frequency changes replace, so Back leaves the page rather
   * than stepping through every keystroke.
   */
  replace?: boolean;
}

/** Writes one parameter (plus an optional patch of others) in a single navigation. */
export type UrlSetter<T> = (value: T, also?: UrlParamPatch) => void;

/** Applies a patch to search params. Exported for tests and for one-off multi-key updates. */
export const applyUrlPatch = (current: URLSearchParams, patch: UrlParamPatch): URLSearchParams => {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '' || value === false) next.delete(key);
    else next.set(key, value === true ? '1' : String(value));
  }
  return next;
};

/**
 * Changes several search parameters in one navigation. react-router's
 * setter reads the params of the last render, so two setters called in the
 * same handler would overwrite each other; route every multi-key change
 * through one patch instead.
 */
export const useUrlPatch = (): ((patch: UrlParamPatch, options?: UrlUpdateOptions) => void) => {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (patch, options) => setSearchParams((current) => applyUrlPatch(current, patch), { replace: options?.replace ?? false }),
    [setSearchParams],
  );
};

/** A free-text parameter; the default is left out of the URL. Replaces history by default. */
export const useUrlString = (
  key: string,
  defaultValue = '',
  options: UrlUpdateOptions = { replace: true },
): [string, UrlSetter<string>] => {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const value = params.get(key) ?? defaultValue;
  const replace = options.replace ?? true;
  const set = useCallback<UrlSetter<string>>(
    (next, also) => patch({ ...also, [key]: next === defaultValue ? null : next }, { replace }),
    [patch, key, defaultValue, replace],
  );
  return [value, set];
};

/**
 * One of a fixed set of values. Anything else in the URL (a stale link, a
 * typo) reads as the default. Pushes history by default: a filter change is
 * a step Back should undo.
 */
export const useUrlEnum = <T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T,
  options: UrlUpdateOptions = {},
): [T, UrlSetter<T>] => {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const raw = params.get(key);
  const value = allowed.find((candidate) => candidate === raw) ?? defaultValue;
  const replace = options.replace ?? false;
  const set = useCallback<UrlSetter<T>>(
    (next, also) => patch({ ...also, [key]: next === defaultValue ? null : next }, { replace }),
    [patch, key, defaultValue, replace],
  );
  return [value, set];
};

export interface UrlNumberOptions extends UrlUpdateOptions {
  min?: number;
  max?: number;
}

/** An integer parameter (a page number); non-numbers and out-of-range values read as the default. */
export const useUrlNumber = (
  key: string,
  defaultValue: number,
  options: UrlNumberOptions = {},
): [number, UrlSetter<number>] => {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const raw = params.get(key);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const inRange =
    Number.isInteger(parsed) &&
    (options.min === undefined || parsed >= options.min) &&
    (options.max === undefined || parsed <= options.max);
  const value = inRange ? parsed : defaultValue;
  const replace = options.replace ?? false;
  const set = useCallback<UrlSetter<number>>(
    (next, also) => patch({ ...also, [key]: next === defaultValue ? null : next }, { replace }),
    [patch, key, defaultValue, replace],
  );
  return [value, set];
};

/** An on/off parameter: present ("1") is on, absent is off. */
export const useUrlBoolean = (key: string, options: UrlUpdateOptions = {}): [boolean, UrlSetter<boolean>] => {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const value = params.get(key) === '1';
  const replace = options.replace ?? false;
  const set = useCallback<UrlSetter<boolean>>(
    (next, also) => patch({ ...also, [key]: next }, { replace }),
    [patch, key, replace],
  );
  return [value, set];
};

export interface UrlSearchState {
  /** What is in the search box right now (updates on every keystroke). */
  text: string;
  setText: (text: string) => void;
  /** The settled, trimmed search in the URL — what to query with. */
  query: string;
}

/**
 * A search box backed by a URL parameter. The box keeps its own text so
 * typing stays responsive; once it settles (useDebouncedValue) the trimmed
 * text replaces the URL entry, along with `resetOnChange` (e.g. `{ page: null }`).
 * A URL change from elsewhere (Back, a link with `?q=`) refills the box.
 */
export const useUrlSearch = (key = 'q', resetOnChange?: UrlParamPatch): UrlSearchState => {
  const [query, setQuery] = useUrlString(key);
  const [text, setText] = useState(query);
  const settled = useDebouncedValue(text);
  const written = useRef(query);
  const reset = useRef(resetOnChange);
  reset.current = resetOnChange;

  useEffect(() => {
    const next = settled.trim();
    if (next === written.current) return;
    written.current = next;
    setQuery(next, reset.current);
  }, [settled, setQuery]);

  useEffect(() => {
    if (query === written.current) return;
    written.current = query;
    setText(query);
  }, [query]);

  return { text, setText, query };
};
