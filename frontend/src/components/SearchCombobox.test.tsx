import { useState } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { SearchCombobox, type SearchComboboxAsync, type SearchComboboxOption } from './SearchCombobox';
import { SearchableSelect } from './SearchableSelect';

vi.mock('../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: null }) }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/api', () => ({ api: {} }));

afterEach(cleanup);

const people: SearchComboboxOption[] = [
  { id: 'p-an', label: 'Nguyễn Văn An', detail: 'an@example.org' },
  { id: 'p-binh', label: 'Đặng Bình', detail: 'binh@example.org' },
  { id: 'p-alice', label: 'Alice Smith', detail: 'alice@example.org' },
  { id: 'p-chau', label: 'Trần Châu', detail: 'chau@example.org' },
];

interface HarnessProps {
  options?: readonly SearchComboboxOption[];
  suggested?: readonly SearchComboboxOption[];
  excludeIds?: ReadonlySet<string>;
  initial?: string;
  onChange?: (id: string) => void;
  async?: SearchComboboxAsync;
  maxResults?: number;
}

const Harness = ({ options = people, initial = '', onChange, ...props }: HarnessProps) => {
  const [value, setValue] = useState(initial);
  return (
    <LanguageProvider>
      <SearchCombobox
        label="Leader"
        options={options}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange?.(id);
        }}
        suggestedLabel="On this plan"
        restLabel="Everyone"
        {...props}
      />
    </LanguageProvider>
  );
};

const optionNames = () => screen.queryAllByRole('option').map((option) => option.textContent);

describe('SearchCombobox', () => {
  it('matches without accents or case and across words', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.type(input, 'nguyen an');
    expect(optionNames()).toEqual(['Nguyễn Văn Anan@example.org']);

    await user.clear(input);
    await user.type(input, 'DANG');
    expect(optionNames()).toEqual(['Đặng Bìnhbinh@example.org']);

    await user.clear(input);
    await user.type(input, 'alice@');
    expect(optionNames()).toEqual(['Alice Smithalice@example.org']);

    await user.clear(input);
    await user.type(input, 'zzz');
    expect(screen.getByText('No matches.')).toBeTruthy();
  });

  it('chooses with the keyboard and announces the active option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.click(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active?.textContent).toContain('Alice Smith');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowUp}{Enter}');

    expect(onChange).toHaveBeenCalledExactlyOnceWith('p-binh');
    // The choice shows as a chip that can be cleared or changed.
    const change = screen.getByRole('button', { name: 'Change Leader, currently Đặng Bình' });
    expect(document.activeElement).toBe(change);
    await user.click(screen.getByRole('button', { name: 'Clear Đặng Bình' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('combobox', { name: 'Leader' })).toBeTruthy();
  });

  it('closes on Escape without letting a surrounding dialog see it', async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener('keydown', listener);
    render(<Harness />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.click(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    // With the list already closed, Escape is left for the dialog.
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', listener);
    expect(seen).toEqual([true, false]);
  });

  it('lists suggestions first under their heading, before and while typing', async () => {
    const user = userEvent.setup();
    const suggested: SearchComboboxOption[] = [{ id: 'p-chau', label: 'Trần Châu', detail: 'Band · Vocals' }];
    render(<Harness suggested={suggested} excludeIds={new Set(['p-alice'])} />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.click(input);
    const onPlan = screen.getByRole('group', { name: 'On this plan' });
    expect(within(onPlan).getAllByRole('option').map((option) => option.textContent)).toEqual(['Trần ChâuBand · Vocals']);
    const everyone = screen.getByRole('group', { name: 'Everyone' });
    // Suggested people aren't repeated; excluded people aren't offered.
    expect(within(everyone).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Nguyễn Văn Anan@example.org',
      'Đặng Bìnhbinh@example.org',
    ]);

    await user.type(input, 'vocals');
    expect(screen.getByRole('group', { name: 'On this plan' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Everyone' })).toBeNull();
  });

  it('caps the rows and says how to see the rest', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, index) => ({ id: `p-${index}`, label: `Person ${index}` }));
    render(<Harness options={many} />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.click(input);
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByText('Showing 50 of 60 — keep typing to narrow it down')).toBeTruthy();

    await user.type(input, 'person 5');
    // Every word must match: "Person 5", "Person 15"…"Person 45" and "Person 50"–"Person 59".
    expect(screen.getAllByRole('option')).toHaveLength(15);
    expect(screen.queryByText(/keep typing/)).toBeNull();
  });

  it('leaves matching to the server in async mode', async () => {
    const user = userEvent.setup();
    const AsyncHarness = () => {
      const [query, setQuery] = useState('');
      // A server that knows 30 matches and returns the first two.
      const results = query ? people.slice(0, 2) : [];
      return <Harness options={results} async={{ query, onQueryChange: setQuery, total: query ? 30 : null }} />;
    };
    render(<AsyncHarness />);
    const input = await screen.findByRole('combobox', { name: 'Leader' });

    await user.type(input, 'zz');
    // Not filtered locally: "zz" matches neither name.
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Showing 2 of 30 — keep typing to narrow it down')).toBeTruthy();
  });

  it('shows loading while the first server results are on their way', async () => {
    const user = userEvent.setup();
    render(<Harness options={[]} async={{ query: 'an', onQueryChange: vi.fn(), loading: true, hasMore: false }} />);
    await user.click(await screen.findByRole('combobox', { name: 'Leader' }));
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('says when a server page is capped without a total', async () => {
    const user = userEvent.setup();
    render(<Harness async={{ query: 'a', onQueryChange: vi.fn(), hasMore: true }} />);
    await user.click(await screen.findByRole('combobox', { name: 'Leader' }));
    expect(screen.getByText('Showing the first 4 — refine your search to see others')).toBeTruthy();
  });

  it('scrolls the highlighted row into view for the keyboard but not for the pointer', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('combobox', { name: 'Leader' }));
    const [, , third, fourth] = screen.getAllByRole('option');

    // Pointing at rows highlights them without scrolling the list under the user.
    fireEvent.mouseMove(third!, { clientX: 10, clientY: 60 });
    fireEvent.mouseMove(fourth!, { clientX: 10, clientY: 80 });
    expect(fourth!.getAttribute('aria-selected')).toBe('true');
    expect(scrollIntoView).not.toHaveBeenCalled();

    await user.keyboard('{ArrowUp}');
    expect(third!.getAttribute('aria-selected')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // The list scrolled, so another row is now under the still pointer: it keeps the keyboard's choice.
    fireEvent.mouseMove(fourth!, { clientX: 10, clientY: 80 });
    expect(third!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('SearchableSelect', () => {
  it('lists every option grouped and filters by group name too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const positions: SearchComboboxOption[] = [
      { id: 'band-keys', label: 'Keys', group: 'Band' },
      { id: 'band-drums', label: 'Drums', group: 'Band' },
      { id: 'tech-sound', label: 'Sound', group: 'Tech' },
    ];
    render(
      <LanguageProvider>
        <SearchableSelect label="Position" value="" onChange={onChange} options={positions} />
      </LanguageProvider>,
    );
    const input = await screen.findByRole('combobox', { name: 'Position' });
    expect(input.getAttribute('placeholder')).toBe('Search or choose…');

    await user.click(input);
    expect(within(screen.getByRole('group', { name: 'Band' })).getAllByRole('option')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Tech' })).getAllByRole('option')).toHaveLength(1);

    await user.type(input, 'tech');
    await user.click(screen.getByRole('option', { name: 'Sound' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('tech-sound');
  });
});
