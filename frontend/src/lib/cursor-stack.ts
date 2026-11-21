/**
 * Back-and-forth paging over a forward-only keyset API. The server only
 * answers "the page after cursor X", so the client remembers the cursor each
 * page was read with; going back pops the stack.
 */
export interface CursorStack {
  /** The cursor the page on screen was read with; undefined for the first page. */
  current: string | undefined;
  /** Cursors of the pages before this one, oldest first. */
  previous: ReadonlyArray<string | undefined>;
}

export const FIRST_PAGE: CursorStack = { current: undefined, previous: [] };

/** Moves to the page after the one on screen. */
export const nextPage = (stack: CursorStack, nextCursor: string): CursorStack => ({
  current: nextCursor,
  previous: [...stack.previous, stack.current],
});

/** Moves back one page; the first page stays put. */
export const previousPage = (stack: CursorStack): CursorStack =>
  stack.previous.length === 0
    ? stack
    : { current: stack.previous.at(-1), previous: stack.previous.slice(0, -1) };

export const hasPreviousPage = (stack: CursorStack): boolean => stack.previous.length > 0;

/** 1-based number of the page on screen. */
export const pageNumber = (stack: CursorStack): number => stack.previous.length + 1;
