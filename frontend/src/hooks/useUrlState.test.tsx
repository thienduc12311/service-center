import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUrlPatch,
  useUrlBoolean,
  useUrlEnum,
  useUrlNumber,
  useUrlSearch,
  useUrlString,
} from './useUrlState';

afterEach(cleanup);

type Sort = 'title' | 'recent';
const SORTS: readonly Sort[] = ['title', 'recent'];

/** Shows the current search string so tests can assert on navigation. */
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
};

const Filters = () => {
  const [sort, setSort] = useUrlEnum<Sort>('sort', SORTS, 'title');
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const [archived, setArchived] = useUrlBoolean('archived');
  const [type, setType] = useUrlString('type');
  return (
    <div>
      <p>sort:{sort} page:{page} archived:{String(archived)} type:{type || '-'}</p>
      <button type="button" onClick={() => setSort('recent', { page: null })}>recent</button>
      <button type="button" onClick={() => setSort('title')}>title</button>
      <button type="button" onClick={() => setPage(page + 1)}>next</button>
      <button type="button" onClick={() => setArchived(!archived)}>archived</button>
      <button type="button" onClick={() => setType('st-1')}>type</button>
    </div>
  );
};

const Search = () => {
  const search = useUrlSearch('q', { page: null });
  const navigate = useNavigate();
  return (
    <div>
      <input aria-label="search" value={search.text} onChange={(event) => search.setText(event.target.value)} />
      <p>query:{search.query || '-'}</p>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </div>
  );
};

const renderAt = (url: string, ui: ReactNode) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );

describe('applyUrlPatch', () => {
  it('sets, encodes and removes parameters in one pass', () => {
    const next = applyUrlPatch(new URLSearchParams('q=old&page=3&keep=1'), {
      q: 'new',
      page: null,
      archived: true,
      limit: 20,
      off: false,
      blank: '',
    });
    expect(next.toString()).toBe('q=new&keep=1&archived=1&limit=20');
  });
});

describe('typed URL params', () => {
  it('reads defaults when absent and ignores unknown or out-of-range values', () => {
    renderAt('/songs?sort=bogus&page=0&archived=yes', <Filters />);
    expect(screen.getByText('sort:title page:1 archived:false type:-')).toBeTruthy();
  });

  it('writes values, drops defaults from the URL, and patches other keys in the same navigation', async () => {
    const user = userEvent.setup();
    renderAt('/songs?page=4', <Filters />);
    expect(screen.getByText(/page:4/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'recent' }));
    expect(screen.getByTestId('search').textContent).toBe('?sort=recent');

    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'archived' }));
    await user.click(screen.getByRole('button', { name: 'type' }));
    expect(screen.getByText('sort:recent page:2 archived:true type:st-1')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'title' }));
    expect(screen.getByTestId('search').textContent).toBe('?page=2&archived=1&type=st-1');
  });
});

describe('useUrlSearch', () => {
  it('debounces typing into one replaced URL entry and resets the page', async () => {
    renderAt('/songs?page=3', <Search />);
    const input = screen.getByRole('textbox', { name: 'search' });
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'amaz ' } });
    // The box updates at once; the URL waits for typing to settle.
    expect((input as HTMLInputElement).value).toBe('amaz ');
    expect(screen.getByTestId('search').textContent).toBe('?page=3');

    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?q=amaz'));
    expect(screen.getByText('query:amaz')).toBeTruthy();
  });

  it('refills the box when the URL changes from elsewhere (Back)', async () => {
    render(
      <MemoryRouter initialEntries={['/songs?q=grace', '/songs?q=amazing']} initialIndex={1}>
        <Search />
        <LocationProbe />
      </MemoryRouter>,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'search' });
    expect(input.value).toBe('amazing');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'back' }));
    });
    await waitFor(() => expect(input.value).toBe('grace'));
    expect(screen.getByText('query:grace')).toBeTruthy();
  });
});
