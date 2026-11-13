import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, IconButton } from './ui';
import { Icon, type IconName } from './icons';
import { GlobalSearch } from './GlobalSearch';
import { useTheme } from '../providers/ThemeProvider';
import { LocaleSwitcher } from '../i18n';

type NavLabelKey = Extract<TranslationKey<'common'>, `nav.${string}`>;
type NavGroupKey = Extract<TranslationKey<'common'>, `nav.groups.${string}`>;

/** One entry of the main navigation; `label` is a common `nav.*` key. */
interface NavItem {
  to: string;
  label: NavLabelKey;
  icon: IconName;
  end?: boolean;
  leadersOnly?: boolean;
}

/** A titled block of navigation entries in the sidebar. */
interface NavGroup {
  label: NavGroupKey;
  items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'nav.groups.overview',
    items: [
      { to: '/', label: 'nav.dashboard', icon: 'home', end: true },
      { to: '/my-schedule', label: 'nav.mySchedule', icon: 'schedule' },
      { to: '/calendar', label: 'nav.calendar', icon: 'calendar' },
    ],
  },
  {
    label: 'nav.groups.planning',
    items: [
      { to: '/plans', label: 'nav.plans', icon: 'plans' },
      { to: '/songs', label: 'nav.songs', icon: 'music' },
      { to: '/media', label: 'nav.media', icon: 'media' },
    ],
  },
  {
    label: 'nav.groups.people',
    items: [
      { to: '/teams', label: 'nav.teams', icon: 'team' },
      { to: '/people', label: 'nav.people', icon: 'people' },
    ],
  },
  {
    label: 'nav.groups.communication',
    items: [
      { to: '/chat', label: 'nav.chat', icon: 'chat' },
      { to: '/messages', label: 'nav.messages', icon: 'mail' },
    ],
  },
  {
    label: 'nav.groups.insights',
    // F16: leaders only (the reports API decides each report's access).
    items: [{ to: '/reports', label: 'nav.reports', icon: 'chart', leadersOnly: true }],
  },
];

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium outline-none transition
   focus-visible:ring-2 focus-visible:ring-brand-500 ${
     isActive
       ? 'bg-brand-50 text-brand-700 shadow-[inset_0_0_0_1px_var(--app-brand-100)] dark:bg-brand-500/15 dark:text-brand-100 dark:shadow-none'
       : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white'
   }`;

interface SidebarContentProps {
  leader: boolean;
  onNavigate?: () => void;
}

/** The sidebar body, shared by the desktop rail and the small-screen drawer. */
const SidebarContent = ({ leader, onNavigate }: SidebarContentProps) => {
  const { t } = useTranslation(['home', 'common']);
  const { user, organizationId, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const organization = user?.memberships.find((m) => m.organization.id === organizationId)?.organization;

  return (
    <div className="flex h-full flex-col">
      {/* In the drawer, leave room for its close button. */}
      <div className={`flex h-16 shrink-0 items-center pl-4 ${onNavigate ? 'pr-14' : 'pr-4'}`}>
        <button
          onClick={() => {
            navigate('/');
            onNavigate?.();
          }}
          className="flex min-w-0 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label={t('shell.homeLabel')}
        >
          {organization?.logo_url ? (
            <img
              src={organization.logo_url}
              alt=""
              className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
            />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-700 text-sm font-bold text-white shadow-sm shadow-brand-600/30">
              SC
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
              {organization?.name ?? t('common:app.name')}
            </span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t('common:app.name')}</span>
          </span>
        </button>
      </div>

      {user && user.memberships.length > 1 && (
        <div className="px-4 pb-2">
          <select
            aria-label={t('common:nav.switchOrganization')}
            className="input h-9 py-1.5 text-[13px]"
            value={organizationId ?? ''}
            onChange={(event) => switchOrganization(event.target.value)}
          >
            {user.memberships.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav aria-label={t('common:nav.mainNavigation')} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.leadersOnly || leader);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
                {t(`common:${group.label}`)}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} onClick={onNavigate} className={navLinkClass}>
                      {({ isActive }) => (
                        <>
                          <Icon
                            name={item.icon}
                            className={`size-[18px] transition ${
                              isActive
                                ? 'text-brand-600 dark:text-brand-200'
                                : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                            }`}
                          />
                          <span className="truncate">{t(`common:${item.label}`)}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-app-border p-3">
        <NavLink to="/settings" onClick={onNavigate} className={navLinkClass}>
          {({ isActive }) => (
            <>
              <Icon
                name="settings"
                className={`size-[18px] ${isActive ? 'text-brand-600 dark:text-brand-200' : 'text-slate-400 dark:text-slate-500'}`}
              />
              {t('common:nav.settings')}
            </>
          )}
        </NavLink>
      </div>
    </div>
  );
};

export const AppShell = () => {
  const { t } = useTranslation(['home', 'common']);
  const { user, organizationId, role, signOut, canAnywhere } = useAuth();
  const leader = canAnywhere('scheduling.manage') || canAnywhere('plans.edit') || canAnywhere('songs.manage');
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { resolved, setMode } = useTheme();
  const location = useLocation();
  const organization = user?.memberships.find((m) => m.organization.id === organizationId)?.organization;

  // A route change (including back/forward) always closes the small-screen drawer.
  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-full lg:pl-64">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-app-border bg-app-surface/70 backdrop-blur-xl print:hidden lg:block">
        <SidebarContent leader={leader} />
      </aside>

      {/* Small-screen drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <button
            type="button"
            aria-label={t('common:nav.closeNavigation')}
            className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="animate-slide-in-left absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-app-border bg-app-surface shadow-2xl">
            <IconButton
              icon="close"
              label={t('common:nav.closeNavigation')}
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3.5 right-3 z-10"
            />
            <SidebarContent leader={leader} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-app-border bg-app-canvas/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
            <IconButton
              icon="menu"
              label={t('common:nav.openNavigation')}
              onClick={() => setDrawerOpen(true)}
              className="-ml-1.5 lg:hidden"
            />
            <span className="truncate text-sm font-semibold text-slate-900 lg:hidden dark:text-white">
              {organization?.name ?? t('common:app.name')}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
              {organizationId && <GlobalSearch />}
              <IconButton
                icon={resolved === 'dark' ? 'sun' : 'moon'}
                label={resolved === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark')}
                onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
              />
              <LocaleSwitcher />

              <span className="mx-1.5 hidden h-6 w-px bg-app-border sm:block" aria-hidden="true" />

              <div className="relative">
                <button
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2 rounded-full p-0.5 pr-1 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 sm:pr-2.5 dark:hover:bg-slate-800"
                >
                  <Avatar name={user?.profile.full_name ?? user?.profile.email} url={user?.profile.avatar_url} size="sm" />
                  <span className="hidden max-w-36 truncate text-sm font-medium text-slate-700 sm:block dark:text-slate-200">
                    {user?.profile.full_name ?? user?.profile.email}
                  </span>
                  <Icon name="chevronDown" className="hidden size-3.5 text-slate-400 sm:block" />
                </button>

                {menuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label={t('common:actions.closeMenu')}
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div
                      role="menu"
                      className="card animate-pop-in absolute right-0 z-50 mt-2 w-64 overflow-hidden p-1 text-sm shadow-lg shadow-slate-900/10"
                    >
                      <div className="flex items-center gap-3 px-3 py-3">
                        <Avatar name={user?.profile.full_name ?? user?.profile.email} url={user?.profile.avatar_url} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {user?.profile.full_name ?? t('shell.signedIn')}
                          </p>
                          <p className="truncate text-xs text-slate-500">{user?.profile.email}</p>
                          {role && (
                            <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                              {t(`common:roles.${role}`)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="my-1 h-px bg-app-border" />
                      <NavLink
                        to="/settings"
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Icon name="settings" className="size-4 opacity-70" />
                        {t('common:nav.settings')}
                      </NavLink>
                      <button
                        role="menuitem"
                        onClick={() => void signOut()}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                      >
                        <Icon name="signOut" className="size-4 opacity-80" />
                        {t('common:actions.signOut')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>

        <footer className="px-4 py-6 text-center text-xs text-slate-400 sm:px-6 lg:px-8 dark:text-slate-500">
          {t('shell.footer')}
        </footer>
      </div>
    </div>
  );
};
