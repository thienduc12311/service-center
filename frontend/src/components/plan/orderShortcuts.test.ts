import { describe, expect, it } from 'vitest';
import { ORDER_SHORTCUT_HELP, isTextEntryTarget, orderShortcutFor, orderShortcutHelpFor, shortcutScopeOf, type ShortcutKeyEvent } from './orderShortcuts';

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

describe('orderShortcutHelpFor', () => {
  it('lists every shortcut for an editor', () => {
    expect(orderShortcutHelpFor(true)).toEqual(ORDER_SHORTCUT_HELP);
  });

  it('lists only selecting and help for someone who cannot edit', () => {
    expect(orderShortcutHelpFor(false).map((row) => row.shortcut)).toEqual(['select-next', 'select-previous', 'deselect', 'help']);
  });
});

describe('shortcutScopeOf', () => {
  it('is the order inside the list, the page on the body or a button or link elsewhere, and nothing otherwise', () => {
    const container = document.createElement('div');
    const row = document.createElement('li');
    container.append(row);
    const toolbarButton = document.createElement('button');
    const link = document.createElement('a');
    link.href = '/songs';
    const plain = document.createElement('section');
    document.body.append(container, toolbarButton, link, plain);

    expect(shortcutScopeOf(row, container)).toBe('order');
    expect(shortcutScopeOf(document.body, container)).toBe('page');
    expect(shortcutScopeOf(toolbarButton, container)).toBe('page');
    expect(shortcutScopeOf(link, container)).toBe('page');
    expect(shortcutScopeOf(plain, container)).toBeNull();
    expect(shortcutScopeOf(null, container)).toBeNull();
    document.body.replaceChildren();
  });
});
