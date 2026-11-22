/**
 * Keyboard shortcuts on the order tab. They only apply when focus is not in a
 * text field, no dialog is open, and the key has no Ctrl/Cmd (so ⌘K search
 * and browser shortcuts keep working).
 */

export type OrderShortcut =
  | 'focus-quick-add'
  | 'select-next'
  | 'select-previous'
  | 'move-down'
  | 'move-up'
  | 'edit'
  | 'remove'
  | 'deselect'
  | 'help';

/** The parts of a keyboard event the shortcut map reads. */
export interface ShortcutKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** One row of the shortcut help: the keys (alternatives) and what they do. */
export interface OrderShortcutHelpRow {
  keys: readonly string[];
  shortcut: OrderShortcut;
}

/** What the help dialog lists, in order. `Alt` reads as ⌥ Option on a Mac. */
export const ORDER_SHORTCUT_HELP: readonly OrderShortcutHelpRow[] = [
  { keys: ['N'], shortcut: 'focus-quick-add' },
  { keys: ['J', '↓'], shortcut: 'select-next' },
  { keys: ['K', '↑'], shortcut: 'select-previous' },
  { keys: ['Alt + ↓'], shortcut: 'move-down' },
  { keys: ['Alt + ↑'], shortcut: 'move-up' },
  { keys: ['Enter', 'E'], shortcut: 'edit' },
  { keys: ['Delete', 'Backspace'], shortcut: 'remove' },
  { keys: ['Esc'], shortcut: 'deselect' },
  { keys: ['?'], shortcut: 'help' },
];

/** Which shortcut a key press means; null when it is not one. */
export const orderShortcutFor = (event: ShortcutKeyEvent): OrderShortcut | null => {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.key === '?') return 'help';
  if (event.altKey) {
    if (event.key === 'ArrowDown') return 'move-down';
    if (event.key === 'ArrowUp') return 'move-up';
    return null;
  }
  if (event.shiftKey) return null;
  switch (event.key) {
    case 'n':
    case 'N':
      return 'focus-quick-add';
    case 'j':
    case 'ArrowDown':
      return 'select-next';
    case 'k':
    case 'ArrowUp':
      return 'select-previous';
    case 'Enter':
    case 'e':
      return 'edit';
    case 'Delete':
    case 'Backspace':
      return 'remove';
    case 'Escape':
      return 'deselect';
    default:
      return null;
  }
};

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'time', 'month', 'week']);

/** Whether typing in `target` would type text (so a letter is not a shortcut). */
export const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
};

/** Whether Enter on `target` already does something of its own (a button or link). */
export const isActivatableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('button, a[href], summary, [role="button"]') !== null;
