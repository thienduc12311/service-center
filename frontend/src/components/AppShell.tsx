import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { Avatar } from './ui';
import { GlobalSearch } from './GlobalSearch';
import { useTheme } from '../providers/ThemeProvider';

/** One entry of the main navigation; `label` is a common `nav.*` key. */
interface NavItem {
  to: string;
  label: Extract<TranslationKey<'common'>, `nav.${string}`>;
  end?: boolean;
  leadersOnly?: boolean;
}

const NAV: readonly NavItem[] = [
  { to: '/', label: 'nav.dashboard', end: true },
  { to: '/calendar', label: 'nav.calendar' },
  { to: '/plans', label: 'nav.plans' },
  { to: '/songs', label: 'nav.songs' },
  { to: '/media', label: 'nav.media' },
  { to: '/teams', label: 'nav.teams' },
  { to: '/people', label: 'nav.people' },
  { to: '/my-schedule', label: 'nav.mySchedule' },
  { to: '/chat', label: 'nav.chat' },
  { to: '/messages', label: 'nav.messages' },
  // F16: leaders only (the reports API decides each report's access).
  { to: '/reports', label: 'nav.reports', leadersOnly: true },
];

export const AppShell = () => {
  const { t } = useTranslation(['home', 'common']);
  const { user, organizationId, role, switchOrganization, signOut, canAnywhere } = useAuth();
  const leader = canAnywhere('scheduling.manage') || canAnywhere('plans.edit') || canAnywhere('songs.manage');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { resolved, setMode } = useTheme();

  const organization = user?.memberships.find((m) => m.organization.id === organizationId)?.organization;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <button
            onClick={() => navigate('/')}
            className="flex min-w-0 items-center gap-2 text-left"
            aria-label={t('shell.homeLabel')}
          >
            {organization?.logo_url ? (
              <img src={organization.logo_url} alt="" className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-700 text-sm font-bold text-white shadow-sm">SC</span>
            )}
            <span className="hidden max-w-xs truncate text-sm font-semibold text-slate-900 dark:text-white sm:block">
              {organization?.name ?? t('common:app.name')}
            </span>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {organizationId && <GlobalSearch />}
            <button
              type="button"
              onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
              className="grid size-9 place-items-center rounded-xl text-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={resolved === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark')}
            >
              {resolved === 'dark' ? '☀' : '☾'}
            </button>
            {user && user.memberships.length > 1 && (
              <select
                aria-label={t('common:nav.switchOrganization')}
                className="input hidden w-48 sm:block"
                value={organizationId ?? ''}
                onChange={(event) => switchOrganization(event.target.value)}
              >
                {user.memberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Avatar name={user?.profile.full_name ?? user?.profile.email} url={user?.profile.avatar_url} />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="card absolute right-0 mt-2 w-56 overflow-hidden py-1 text-sm"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <div className="border-b border-slate-100 px-4 py-2 dark:border-slate-800">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{user?.profile.full_name ?? t('shell.signedIn')}</p>
                    <p className="truncate text-xs text-slate-500">{user?.profile.email}</p>
                    {role && <p className="mt-1 text-xs text-brand-600">{t(`common:roles.${role}`)}</p>}
                  </div>
                  <NavLink
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {t('common:nav.settings')}
                  </NavLink>
                  <button
                    onClick={() => void signOut()}
                    className="block w-full px-4 py-2 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    {t('common:actions.signOut')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* One scrollable row at every width: the full list never fits beside the
            brand and account controls, and wrapping labels break the bar. */}
        <nav aria-label={t('common:nav.mainNavigation')} className="border-t border-slate-100 dark:border-slate-800">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 sm:px-6">
            {NAV.filter((item) => !item.leadersOnly || leader).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`
                }
              >
                {t(`common:${item.label}`)}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 dark:border-slate-800">
        {t('shell.footer')}
      </footer>
    </div>
  );
};
