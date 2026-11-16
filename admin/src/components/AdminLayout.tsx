import { NavLink, Outlet } from 'react-router-dom';
import { useAdminOverview } from '../hooks/queries';
import { useAdminAuth } from '../providers/AdminAuthProvider';
import { Icon, type IconName } from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Only an exact match marks it active (Overview at `/`). */
  end?: boolean;
  /** A count shown beside the label. */
  badge?: number;
}

export interface NavLinksProps {
  items: readonly NavItem[];
  layout: 'sidebar' | 'bar';
}

const NavLinks = ({ items, layout }: NavLinksProps) => (
  <ul className={layout === 'sidebar' ? 'space-y-0.5' : 'flex gap-1'}>
    {items.map((item) => (
      <li key={item.to} className="shrink-0">
        <NavLink
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
              isActive
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`
          }
        >
          <Icon name={item.icon} className="size-[18px]" />
          <span className={layout === 'sidebar' ? 'flex-1' : ''}>{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span
              className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 tabular-nums dark:bg-amber-500/20 dark:text-amber-200"
              aria-label={`${item.badge} pending`}
            >
              {item.badge}
            </span>
          )}
        </NavLink>
      </li>
    ))}
  </ul>
);

const Brand = () => (
  <div className="flex items-center gap-2.5">
    <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
    <div className="leading-tight">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Service Center</p>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Platform admin</p>
    </div>
  </div>
);

/** Sidebar on wide screens; a top bar with a scrolling nav row on narrow ones. */
export const AdminLayout = () => {
  const { email, signOut } = useAdminAuth();
  const overview = useAdminOverview();

  const items: NavItem[] = [
    { to: '/', label: 'Overview', icon: 'home', end: true },
    { to: '/churches', label: 'Churches', icon: 'grid' },
    { to: '/applications', label: 'Applications', icon: 'document', badge: overview.data?.pending_applications },
    { to: '/users', label: 'Users', icon: 'people' },
    { to: '/admins', label: 'Super admins', icon: 'person' },
    { to: '/activity', label: 'Activity', icon: 'clock' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];

  const account = (
    <div className="min-w-0">
      <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={email ?? undefined}>
        {email}
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        <Icon name="signOut" className="size-4" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-full lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <aside className="hidden w-56 shrink-0 flex-col border-r border-app-border bg-app-surface lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="px-4 pt-5 pb-4">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2">
          <NavLinks items={items} layout="sidebar" />
        </nav>
        <div className="border-t border-app-border px-4 py-3">{account}</div>
      </aside>

      <header className="border-b border-app-border bg-app-surface lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <Brand />
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title={email ? `Signed in as ${email}` : undefined}
          >
            <Icon name="signOut" className="size-4" />
            Sign out
          </button>
        </div>
        <nav aria-label="Main" className="overflow-x-auto px-2 pb-2">
          <NavLinks items={items} layout="bar" />
        </nav>
      </header>

      <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
