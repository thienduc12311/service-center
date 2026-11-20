import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnreadNotificationCount } from '../hooks/queries';
import { Icon } from './icons';

/** Header bell: links to the notification centre and shows the unread count for the active church. */
export const NotificationBell = () => {
  const { t } = useTranslation('scheduling');
  const unread = useUnreadNotificationCount().data?.unread ?? 0;
  const label = t('notifications.bellLabel', { count: unread });

  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `relative inline-grid size-9 shrink-0 place-items-center rounded-xl transition hover:bg-slate-100 hover:text-slate-900
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500
        dark:hover:bg-slate-800 dark:hover:text-white ${isActive ? 'text-brand-600 dark:text-brand-200' : 'text-slate-500 dark:text-slate-400'}`
      }
    >
      <Icon name="bell" className="size-[18px]" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-app-canvas"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
};
