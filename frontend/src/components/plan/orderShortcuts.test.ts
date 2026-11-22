import { describe, expect, it } from 'vitest';
import { isTextEntryTarget, orderShortcutFor, type ShortcutKeyEvent } from './orderShortcuts';

const press = (key: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('orderShortcutFor', () => {
  it.each([
    [press('n'), 'focus-quick-add'],
    [press('j'), 'select-next'],
    [press('ArrowDown'), 'select-next'],
    [press('k'), 'select-previous'],
    [press('ArrowUp'), 'select-previous'],
    [press('ArrowDown', { altKey: true }), 'move-down'],
    [press('ArrowUp', { altKey: true }), 'move-up'],
    [press('Enter'), 'edit'],
    [press('e'), 'edit'],
    [press('Delete'), 'remove'],
    [press('Backspace'), 'remove'],
    [press('Escape'), 'deselect'],
    [press('?', { shiftKey: true }), 'help'],
  ] as const)('maps %o to %s', (event, shortcut) => {
    expect(orderShortcutFor(event)).toBe(shortcut);
  });

  it('leaves Ctrl/Cmd combinations (⌘K search, copy, reload) and other keys alone', () => {
    expect(orderShortcutFor(press('k', { metaKey: true }))).toBeNull();
    expect(orderShortcutFor(press('k', { ctrlKey: true }))).toBeNull();
    expect(orderShortcutFor(press('ArrowDown', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(orderShortcutFor(press('J', { shiftKey: true }))).toBeNull();
    expect(orderShortcutFor(press('j', { altKey: true }))).toBeNull();
    expect(orderShortcutFor(press('x'))).toBeNull();
  });
});

describe('isTextEntryTarget', () => {
  it('treats text fields, text areas, selects and editable content as typing', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true);
    expect(isTextEntryTarget(editable)).toBe(true);
  });

  it('does not treat buttons, checkboxes or rows as typing', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isTextEntryTarget(checkbox)).toBe(false);
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    expect(isTextEntryTarget(document.createElement('li'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
