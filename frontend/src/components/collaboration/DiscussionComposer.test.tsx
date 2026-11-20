import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MentionCandidate } from '@service-center/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { DiscussionComposer, type DiscussionSubmission } from './DiscussionComposer';

vi.mock('../../lib/api', () => ({ getStoredOrganizationId: () => 'org-1', api: {} }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', session: null, can: () => true }),
}));

const candidates: MentionCandidate[] = [
  { person_id: 'p-ann', name: 'Ann Lee' },
  { person_id: 'p-duc', name: 'Đức Nguyễn' },
];

const renderComposer = (people: MentionCandidate[] = candidates) => {
  const onSubmit = vi.fn<(submission: DiscussionSubmission) => void>();
  render(
    <LanguageProvider>
      <DiscussionComposer candidates={people} placeholder="Message" submitLabel="Send" onSubmit={onSubmit} />
    </LanguageProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { onSubmit, input, user: userEvent.setup() };
};

afterEach(cleanup);

describe('DiscussionComposer', () => {
  it('sends on Enter and adds a line on Shift+Enter', async () => {
    const { onSubmit, input, user } = renderComposer();
    await user.type(input, 'first{Shift>}{Enter}{/Shift}second');
    expect(input.value).toBe('first\nsecond');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: 'first\nsecond', mentionIds: [] }));
    expect(input.value).toBe('');
  });

  it('opens a filtered picker on @ and picks with Enter instead of sending', async () => {
    const { onSubmit, input, user } = renderComposer();
    await user.type(input, 'hi @nguy');
    const picker = screen.getByRole('listbox');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Đức Nguyễn']);
    expect(picker).toBeTruthy();

    await user.keyboard('{Enter}');
    expect(input.value).toBe('hi @Đức Nguyễn ');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(input, 'thanks{Enter}');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: 'hi @Đức Nguyễn thanks', mentionIds: ['p-duc'] }));
  });

  it('moves through matches with the arrow keys and closes on Escape', async () => {
    const { input, user } = renderComposer();
    await user.type(input, '@');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input.value).toBe('@Đức Nguyễn ');

    await user.type(input, '@');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open for an @ inside a word, and hides when nothing matches', async () => {
    const { input, user } = renderComposer();
    await user.type(input, 'mail ann@');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.clear(input);
    await user.type(input, '@zz');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('drops a mention whose name was edited before sending', async () => {
    const { onSubmit, input, user } = renderComposer();
    await user.type(input, '@ann{Enter}');
    expect(input.value).toBe('@Ann Lee ');
    await user.type(input, '{Backspace}{Backspace}{Backspace}x{Enter}');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: '@Ann Lx', mentionIds: [] }));
  });

  it('inserts @ from the button and says when there is no one to mention', async () => {
    const { input, user } = renderComposer([]);
    await user.type(input, 'hey');
    await user.click(screen.getByRole('button', { name: 'Mention someone' }));
    expect(input.value).toBe('hey @');
    expect(screen.getByRole('option').textContent).toBe('No one else to mention');
  });
});
