import { StrictMode, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListErrorNotice, Menu, MenuItem, Modal, Tabs, listFailed, listOffline, overflowMask } from './ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../i18n', () => ({
  useErrorText: () => () => 'error',
}));

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

interface ModalHarnessProps {
  empty?: boolean;
}

const ModalHarness = ({ empty = false }: ModalHarnessProps) => {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>New plan</button>
      <button type="button">Upcoming</button>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>Rerender</button>
      <Modal open={open} title={`Create plan ${revision}`} onClose={() => setOpen(false)}>
        {empty ? <button type="button" disabled>Unavailable</button> : (
          <>
            <label htmlFor="plan-title">Title</label>
            <input id="plan-title" onKeyDown={(event) => {
              if (event.key === 'Escape') event.preventDefault();
            }} />
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <div style={{ display: 'none' }}>
              <button type="button">Hidden action</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
};

const UnmountHarness = () => {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShowModal(true)}>Open removable dialog</button>
      {showModal && (
        <Modal open title="Removable dialog" onClose={() => setShowModal(false)}>
          <button type="button" onClick={() => setShowModal(false)}>Unmount dialog</button>
        </Modal>
      )}
    </>
  );
};

const StackedModalHarness = () => {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setParentOpen(true)}>Open parent</button>
      <Modal open={parentOpen} title="Parent dialog" onClose={() => setParentOpen(false)}>
        <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
      </Modal>
      {createPortal(
        <Modal open={childOpen} title="Child dialog" onClose={() => setChildOpen(false)}>
          <input aria-label="Search" autoFocus />
        </Modal>,
        document.body,
      )}
    </>
  );
};

describe('Modal focus behavior', () => {
  it('moves focus inside, contains forward and reverse Tab, and restores the opener on Escape', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const opener = screen.getByRole('button', { name: 'New plan' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Create plan 0' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const close = screen.getByRole('button', { name: 'actions.close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    close.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('uses the close control when content has no enabled controls', async () => {
    const user = userEvent.setup();
    render(<ModalHarness empty />);

    await user.click(screen.getByRole('button', { name: 'New plan' }));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'actions.close' });
    await waitFor(() => expect(document.activeElement).toBe(close));

    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('does not reset focus when the open dialog rerenders', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole('button', { name: 'New plan' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    title.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }));

    expect(screen.getByRole('dialog', { name: 'Create plan 1' })).toBeTruthy();
    expect(document.activeElement).toBe(title);
  });

  it('allows an inner control to consume Escape', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole('button', { name: 'New plan' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('wraps at the selected radio when the group ends the tab order', async () => {
    const user = userEvent.setup();
    render(
      <Modal open title="Choose mode" onClose={vi.fn()}>
        <label><input type="radio" name="mode" defaultChecked /> First</label>
        <label><input type="radio" name="mode" /> Second</label>
      </Modal>,
    );

    const close = screen.getByRole('button', { name: 'actions.close' });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'First' }));
    await user.tab();
    expect(document.activeElement).toBe(close);
  });

  it('preserves a consumer-provided autoFocus target', async () => {
    const user = userEvent.setup();
    render(
      <ModalHarnessWithAutoFocus />,
    );

    const opener = screen.getByRole('button', { name: 'Open focused dialog' });
    await user.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Plan title' })));

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
  });

  it('restores the opener and body scrolling when an open modal unmounts', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<UnmountHarness />);
    const opener = screen.getByRole('button', { name: 'Open removable dialog' });
    await user.click(opener);
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));

    await user.click(screen.getByRole('button', { name: 'Unmount dialog' }));

    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
  });

  it('only lets the top stacked dialog handle Escape and keeps scrolling locked', async () => {
    const user = userEvent.setup();
    render(<StrictMode><StackedModalHarness /></StrictMode>);
    const parentOpener = screen.getByRole('button', { name: 'Open parent' });
    await user.click(parentOpener);

    const childOpener = screen.getByRole('button', { name: 'Open child' });
    await user.click(childOpener);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Child dialog' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeTruthy();
    expect(document.activeElement).toBe(childOpener);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(parentOpener);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores focus to the menu trigger when the invoking menu item was removed', async () => {
    const user = userEvent.setup();
    const MenuDialogHarness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Menu label="More">
            {(close) => <MenuItem onClick={() => { close(); setOpen(true); }}>Details</MenuItem>}
          </Menu>
          <Modal open={open} title="File details" onClose={() => setOpen(false)}>File information</Modal>
        </>
      );
    };
    render(<MenuDialogHarness />);
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Details' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

const ModalHarnessWithAutoFocus = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open focused dialog</button>
      <Modal open={open} title="Focused dialog" onClose={() => setOpen(false)}>
        <label htmlFor="focused-plan-title">Plan title</label>
        <input id="focused-plan-title" autoFocus />
      </Modal>
    </>
  );
};

describe('Menu keyboard support (APG menu button)', () => {
  const renderMenu = () =>
    render(
      <>
        <Menu label="More">
          {() => (
            <>
              <MenuItem onClick={() => undefined}>One</MenuItem>
              <MenuItem onClick={() => undefined}>Two</MenuItem>
              <MenuItem onClick={() => undefined}>Three</MenuItem>
            </>
          )}
        </Menu>
        <button type="button">After</button>
      </>,
    );
  const item = (name: string) => screen.getByRole('menuitem', { name });

  it.each(['{Enter}', ' ', '{ArrowDown}'])('opens with %j and focuses the first item', async (key) => {
    const user = userEvent.setup();
    renderMenu();
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard(key);
    expect(document.activeElement).toBe(item('One'));
  });

  it('opens on ArrowUp with the last item focused', async () => {
    const user = userEvent.setup();
    renderMenu();
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(item('Three'));
  });

  it('moves with arrows, wraps, and supports Home and End', async () => {
    const user = userEvent.setup();
    renderMenu();
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{Enter}{ArrowDown}');
    expect(document.activeElement).toBe(item('Two'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(item('One'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(item('Three'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(item('One'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(item('Three'));
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await user.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab', async () => {
    const user = userEvent.setup();
    renderMenu();
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{Enter}{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('failed list requests (W9-WEB-D2)', () => {
  const settled = { isPaused: false, isPlaceholderData: false };

  it('treats only a list that never loaded as failed, so the empty state is not shown for it', () => {
    expect(listFailed({ ...settled, error: new Error('503'), data: undefined })).toBe(true);
    expect(listFailed({ ...settled, error: null, data: undefined })).toBe(false);
    expect(listFailed({ ...settled, error: null, data: [] })).toBe(false);
    // A failed later page or background refresh keeps the rows that loaded.
    expect(listFailed({ ...settled, error: new Error('504'), data: [{ id: 'a' }] })).toBe(false);
  });

  it('shows the error with a Try again action that refetches', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    render(<ListErrorNotice query={{ ...settled, error: new Error('503'), data: undefined, isFetching: false, refetch }} />);
    expect(screen.getByRole('alert').textContent).toContain('error');
    await user.click(screen.getByRole('button', { name: 'actions.retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('disables Try again while the retry is in flight', () => {
    render(<ListErrorNotice query={{ ...settled, error: new Error('503'), data: undefined, isFetching: true, refetch: vi.fn() }} />);
    expect((screen.getByRole('button', { name: 'actions.retry' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('offline list requests (W10-WEB-D2)', () => {
  it('treats a paused first load as not loaded, so the empty state is not shown for it', () => {
    expect(listOffline({ data: undefined, isPaused: true, isPlaceholderData: false })).toBe(true);
    expect(listFailed({ error: null, data: undefined, isPaused: true, isPlaceholderData: false })).toBe(true);
  });

  it('treats a paused search that still shows the previous search as not loaded', () => {
    expect(listFailed({ error: null, data: [{ id: 'a' }], isPaused: true, isPlaceholderData: true })).toBe(true);
  });

  it('keeps rows that loaded when a later refresh pauses offline', () => {
    expect(listFailed({ error: null, data: [{ id: 'a' }], isPaused: true, isPlaceholderData: false })).toBe(false);
    expect(listFailed({ error: null, data: [], isPaused: true, isPlaceholderData: false })).toBe(false);
  });

  it('shows an offline notice with Try again instead of an error', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    render(
      <ListErrorNotice query={{ error: null, data: undefined, isFetching: false, isPaused: true, isPlaceholderData: false, refetch }} />,
    );
    expect(screen.getByRole('status').textContent).toContain('states.offlineList');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'actions.retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs overflow cue (W2-PLANS-D11)', () => {
  it('fades only the ends that hide tabs', () => {
    expect(overflowMask({ start: false, end: false })).toBeUndefined();
    expect(overflowMask({ start: false, end: true })).toBe('linear-gradient(to right, #000, #000 calc(100% - 2.5rem), transparent)');
    expect(overflowMask({ start: true, end: false })).toBe('linear-gradient(to right, transparent, #000 2.5rem, #000)');
  });

  it('marks a tab strip that is too narrow for its tabs', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    render(
      <Tabs
        label="Plan"
        value="order"
        onChange={vi.fn()}
        items={[{ value: 'order', label: 'Order' }, { value: 'share', label: 'Share' }]}
      />,
    );
    const strip = screen.getByRole('tablist');
    expect(strip.dataset.overflowEnd).toBe('true');
    expect(strip.dataset.overflowStart).toBeUndefined();
    expect(strip.style.maskImage).toContain('transparent');
  });
});
