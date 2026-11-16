import {
  formatFileSize,
  STORAGE_QUOTA_WARNING_FRACTION,
  storageFractionUsed,
  storageQuotaState,
  type ChurchApplicationStatus,
  type OrganizationPlatformStatus,
} from '@service-center/shared';
import { APPLICATION_STATUS_LABELS } from '../lib/applications';
import { Badge, type BadgeTone } from './ui';

export interface ChurchStatusBadgeProps {
  status: OrganizationPlatformStatus;
}

export const ChurchStatusBadge = ({ status }: ChurchStatusBadgeProps) =>
  status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>;

const APPLICATION_TONES: Record<ChurchApplicationStatus, BadgeTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  withdrawn: 'slate',
};

export interface ApplicationStatusBadgeProps {
  status: ChurchApplicationStatus;
}

export const ApplicationStatusBadge = ({ status }: ApplicationStatusBadgeProps) => (
  <Badge tone={APPLICATION_TONES[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>
);

export interface StorageBarProps {
  usedBytes: number;
  quotaBytes: number;
  /** Marks a per-church override of the platform default. */
  custom?: boolean;
  className?: string;
}

const BAR_TONES = {
  ok: 'bg-brand-500',
  warning: 'bg-amber-500',
  full: 'bg-rose-500',
} as const;

/** "12.3 MB / 200.0 MB" over a thin bar that turns amber at 80% and red when full. */
export const StorageBar = ({ usedBytes, quotaBytes, custom = false, className = '' }: StorageBarProps) => {
  const fraction = storageFractionUsed(usedBytes, quotaBytes);
  const state = storageQuotaState(fraction, STORAGE_QUOTA_WARNING_FRACTION);
  const percent = Math.round(fraction * 100);
  return (
    <div className={`min-w-32 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className="text-slate-700 dark:text-slate-200">
          {formatFileSize(usedBytes)} / {formatFileSize(quotaBytes)}
        </span>
        <span className={state === 'ok' ? 'text-slate-400' : state === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-400'}>
          {percent}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-valuetext={`${percent}% of ${formatFileSize(quotaBytes)}`}
      >
        <div className={`h-full rounded-full ${BAR_TONES[state]}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      {custom && <p className="mt-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-200">Custom quota</p>}
    </div>
  );
};
