import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './ui';

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
            <input id="plan-title" />
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
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
        <Modal open={childOpen} title="Child dialog" onClose={() => setChildOpen(false)}>
          <button type="button">Child action</button>
        </Modal>
      </Modal>
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
    render(<UnmountHarness />);
    const opener = screen.getByRole('button', { name: 'Open removable dialog' });
    await user.click(opener);
    await waitFor(() => expect(document.body.style.overflow).toBe('hidden'));

    await user.click(screen.getByRole('button', { name: 'Unmount dialog' }));

    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('only lets the top stacked dialog handle Escape and keeps scrolling locked', async () => {
    const user = userEvent.setup();
    render(<StackedModalHarness />);
    const parentOpener = screen.getByRole('button', { name: 'Open parent' });
    await user.click(parentOpener);

    const childOpener = screen.getByRole('button', { name: 'Open child' });
    await user.click(childOpener);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

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
