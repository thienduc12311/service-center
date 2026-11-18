import { Avatar } from './ui';
import { Icon } from './icons';

export interface AccountMenuButtonProps {
  label: string;
  name: string | null | undefined;
  avatarUrl?: string | null;
  expanded: boolean;
  onToggle: () => void;
}

/** The account-menu trigger keeps its explicit name when visual text is hidden. */
export const AccountMenuButton = ({ label, name, avatarUrl, expanded, onToggle }: AccountMenuButtonProps) => (
  <button
    type="button"
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={expanded}
    onClick={onToggle}
    className="flex items-center gap-2 rounded-full p-0.5 pr-1 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 sm:pr-2.5 dark:hover:bg-slate-800"
  >
    <Avatar name={name} url={avatarUrl} size="sm" />
    <span className="hidden max-w-36 truncate text-sm font-medium text-slate-700 sm:block dark:text-slate-200">
      {name}
    </span>
    <Icon name="chevronDown" className="hidden size-3.5 text-slate-400 sm:block" />
  </button>
);
