import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { LoginPage } from '../pages/LoginPage';
import { LanguageProvider } from '../i18n/LanguageProvider';

vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({
    session: null,
    user: { profile: { full_name: 'QA Owner' }, memberships: [] },
    canAnywhere: () => false,
  }),
}));

vi.mock('../providers/ThemeProvider', () => ({
  useTheme: () => ({ resolved: 'light' }),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/api', () => ({ api: {} }));
vi.mock('./church/PlatformAccessBanner', () => ({ PlatformAccessBanner: () => null }));
vi.mock('./church/StorageUsage', () => ({ StorageWarningBanner: () => null }));

afterEach(cleanup);

describe('login language menu', () => {
  it('moves focus through options, restores focus on Escape and keeps it on language change', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LanguageProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: 'Change language: English' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const english = screen.getByRole('menuitemradio', { name: 'English' });
    const vietnamese = screen.getByRole('menuitemradio', { name: 'Tiếng Việt' });
    expect(document.activeElement).toBe(english);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(vietnamese);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(english);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(vietnamese);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(document.documentElement.lang).toBe('vi'));
    expect(trigger.getAttribute('aria-label')).toContain('Tiếng Việt');
    expect(document.activeElement).toBe(trigger);

    // Restore the device choice for subsequent tests.
    await user.keyboard('{Enter}{Enter}');
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});

describe('account menu on Plans', () => {
  const renderPlans = () => render(
    <MemoryRouter initialEntries={['/plans']}>
      <LanguageProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/plans" element={<button type="button">Plan action</button>} />
            <Route path="/settings" element={<h1>Account settings</h1>} />
          </Route>
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );

  it('focuses Settings on Enter and returns focus on Escape from an item or trigger', async () => {
    const user = userEvent.setup();
    renderPlans();
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Settings' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{Enter}');
    trigger.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses on Tab and outside click and keeps Settings navigation working', async () => {
    const user = userEvent.setup();
    renderPlans();
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    const outside = screen.getByRole('button', { name: 'Plan action' });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(trigger);
    await user.click(outside);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(outside);

    await user.click(trigger);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
