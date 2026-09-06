import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { Avatar } from './ui';
import { useTheme } from '../providers/ThemeProvider';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/calendar', label: 'Calendar' },
  { to: '/plans', label: 'Plans' },
  { to: '/songs', label: 'Songs' },
  { to: '/songbooks', label: 'Song books' },
  { to: '/teams', label: 'Teams' },
  { to: '/people', label: 'People' },
  { to: '/my-schedule', label: 'My Schedule' },
];

export const AppShell = () => {
  const { user, organizationId, role, switchOrganization, signOut } = useAuth();
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
            className="flex items-center gap-2 text-left"
            aria-label="Service Center home"
          >
            {organization?.logo_url ? (
              <img src={organization.logo_url} alt="" className="size-9 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
            ) : (
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-700 text-sm font-bold text-white shadow-sm">SC</span>
            )}
            <span className="hidden text-sm font-semibold text-slate-900 dark:text-white sm:block">
              {organization?.name ?? 'Service Center'}
            </span>
          </button>

          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
              className="grid size-9 place-items-center rounded-xl text-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
            >
              {resolved === 'dark' ? '☀' : '☾'}
            </button>
            {user && user.memberships.length > 1 && (
              <select
                aria-label="Active organization"
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
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="font-medium text-slate-800">{user?.profile.full_name ?? 'Signed in'}</p>
                    <p className="truncate text-xs text-slate-500">{user?.profile.email}</p>
                    {role && <p className="mt-1 text-xs capitalize text-brand-600">{role}</p>}
                  </div>
                  <NavLink
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    Settings
                  </NavLink>
                  <NavLink
                    to="/imports"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    Import chord sheet
                  </NavLink>
                  <button
                    onClick={() => void signOut()}
                    className="block w-full px-4 py-2 text-left text-rose-600 hover:bg-rose-50"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile nav — the web app is used on phones too, at the door. */}
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 dark:border-slate-800 lg:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-600 dark:text-slate-300'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 dark:border-slate-800">
        Service Center · Built for every worship community
      </footer>
    </div>
  );
};
