import type { ReactElement } from 'react';

/**
 * The website's icon set: the same 24px grid and stroke weight as the native
 * app's `mobile/src/components/icons.tsx`, so a screen reads the same on both.
 * Icons are decorative — always pair one with visible text or an aria-label.
 */
export type IconName =
  | 'home'
  | 'schedule'
  | 'calendar'
  | 'clock'
  | 'music'
  | 'person'
  | 'people'
  | 'team'
  | 'plans'
  | 'media'
  | 'chat'
  | 'mail'
  | 'chart'
  | 'settings'
  | 'help'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'pencil'
  | 'plus'
  | 'check'
  | 'close'
  | 'search'
  | 'alert'
  | 'info'
  | 'bell'
  | 'trash'
  | 'signOut'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'more'
  | 'mapPin'
  | 'document'
  | 'upload'
  | 'sparkle'
  | 'grid'
  | 'play';

export interface IconProps {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}

const paths: Record<IconName, ReactElement> = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v9.5A2.5 2.5 0 0 0 8 21h8a2.5 2.5 0 0 0 2.5-2.5V9" />
      <path d="M10 21v-5.5h4V21" />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="4" />
      <polyline points="8,12.5 10.8,15.2 16,9.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8.5" y1="2.8" x2="8.5" y2="6.5" />
      <line x1="15.5" y1="2.8" x2="15.5" y2="6.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 15.5,14" />
    </>
  ),
  music: (
    <>
      <circle cx="7" cy="17.5" r="3" />
      <circle cx="17" cy="15.5" r="3" />
      <path d="M10 17.5V7l10-2v10.5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.4c2.1.7 3.5 2.7 3.5 5.6" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5" cy="10" r="2.3" />
      <circle cx="19" cy="10" r="2.3" />
      <path d="M7 20.5v-1.5a5 5 0 0 1 10 0v1.5" />
      <path d="M1.8 18.5a3.5 3.5 0 0 1 4.6-3.3" />
      <path d="M22.2 18.5a3.5 3.5 0 0 0-4.6-3.3" />
    </>
  ),
  plans: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="3.5" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="12.5" x2="16" y2="12.5" />
      <line x1="8" y1="16" x2="12.5" y2="16" />
    </>
  ),
  media: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="8.5" cy="10" r="1.8" />
      <path d="M4 17l4.8-4.5 4 3.5 3.2-2.6L20 17.5" />
    </>
  ),
  chat: (
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V17.5h-2A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <rect x="7.5" y="11" width="3" height="6" rx="1" />
      <rect x="13" y="7" width="3" height="10" rx="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
      <line x1="12" y1="17" x2="12" y2="17.2" />
    </>
  ),
  chevronRight: <polyline points="9.5,4.5 17,12 9.5,19.5" />,
  chevronLeft: <polyline points="14.5,4.5 7,12 14.5,19.5" />,
  chevronDown: <polyline points="5.5,9 12,15.5 18.5,9" />,
  pencil: (
    <>
      <path d="M15.5 4.5l4 4L8.5 19.5 3.5 20.5l1-5z" />
      <line x1="13" y1="7" x2="17" y2="11" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  check: <polyline points="4.5,12.5 9.5,17.5 19.5,6.5" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5L21.5 20H2.5z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <line x1="12" y1="16.8" x2="12" y2="17" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.8" x2="12" y2="8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.2 5.4 2 6.4H4c.8-1 2-2.4 2-6.4Z" />
      <path d="M10 19.4a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  trash: (
    <>
      <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
      <path d="M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" />
      <path d="M5.5 6.5l1 12.2A2.4 2.4 0 0 0 8.9 21h6.2a2.4 2.4 0 0 0 2.4-2.3l1-12.2" />
    </>
  ),
  signOut: (
    <>
      <path d="M15 3.5h2.5A2.5 2.5 0 0 1 20 6v12a2.5 2.5 0 0 1-2.5 2.5H15" />
      <polyline points="9.5,7.5 4.5,12 9.5,16.5" />
      <line x1="4.5" y1="12" x2="15" y2="12" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <line x1="12" y1="1.5" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22.5" y2="12" />
      <line x1="4.6" y1="4.6" x2="6.4" y2="6.4" />
      <line x1="17.6" y1="17.6" x2="19.4" y2="19.4" />
      <line x1="19.4" y1="4.6" x2="17.6" y2="6.4" />
      <line x1="6.4" y1="17.6" x2="4.6" y2="19.4" />
    </>
  ),
  moon: <path d="M20 14.2A8.6 8.6 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2z" />,
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18.5" cy="12" r="1.2" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <polyline points="14,3 14,8 19,8" />
      <line x1="8.5" y1="13" x2="15.5" y2="13" />
      <line x1="8.5" y1="16.5" x2="13" y2="16.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V3.5" />
      <polyline points="7,8.5 12,3.5 17,8.5" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  play: <path d="M7.5 4.8v14.4a1 1 0 0 0 1.5.9l11.4-7.2a1 1 0 0 0 0-1.8L9 3.9a1 1 0 0 0-1.5.9z" />,
};

export const Icon = ({ name, className = 'size-5', strokeWidth = 1.75 }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    className={`shrink-0 ${className}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {paths[name]}
  </svg>
);
