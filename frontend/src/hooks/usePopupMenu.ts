import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';

interface PopupMenu {
  open: boolean;
  close: (restoreFocus?: boolean) => void;
  toggle: () => void;
  rootProps: Pick<ComponentPropsWithRef<'div'>, 'ref' | 'onBlur' | 'onKeyDown'>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerId: string;
  menuId: string;
  menuProps: Pick<ComponentPropsWithRef<'div'>, 'ref' | 'id' | 'aria-labelledby'>;
}

const menuItems = (menu: HTMLDivElement | null): HTMLElement[] =>
  [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])];

/** Focus and dismissal for a menu whose items use tabIndex={-1}. */
export const usePopupMenu = (): PopupMenu => {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [entry, setEntry] = useState<'first' | 'last' | null>(null);
  const open = entry !== null;

  const close = useCallback((restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus();
    setEntry(null);
  }, []);

  useLayoutEffect(() => {
    if (!entry) return;
    const options = menuItems(menuRef.current);
    options.at(entry === 'first' ? 0 : -1)?.focus();
  }, [entry]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key, target } = event;
    const onTrigger = target === triggerRef.current;
    if (!open) {
      if (onTrigger && (key === 'ArrowDown' || key === 'ArrowUp')) {
        event.preventDefault();
        setEntry(key === 'ArrowUp' ? 'last' : 'first');
      }
      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (key === 'Tab' && event.shiftKey && !onTrigger) {
      event.preventDefault();
      close(true);
      return;
    }
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;

    event.preventDefault();
    const options = menuItems(menuRef.current);
    if (!options.length) return;
    const index = options.findIndex((option) => option === target);
    if (key === 'Home' || (onTrigger && key === 'ArrowDown')) options[0]?.focus();
    else if (key === 'End' || (onTrigger && key === 'ArrowUp')) options.at(-1)?.focus();
    else {
      const step = key === 'ArrowDown' ? 1 : -1;
      options[(index + step + options.length) % options.length]?.focus();
    }
  };

  return {
    open,
    close,
    toggle: () => {
      if (open) close(true);
      else setEntry('first');
    },
    rootProps: { ref: rootRef, onBlur, onKeyDown },
    triggerRef,
    triggerId,
    menuId,
    menuProps: { ref: menuRef, id: menuId, 'aria-labelledby': triggerId },
  };
};
