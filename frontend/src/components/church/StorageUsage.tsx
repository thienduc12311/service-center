import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  STORAGE_QUOTA_WARNING_FRACTION,
  formatFileSize,
  storageQuotaState,
  type OrganizationStorageUsage,
} from '@service-center/shared';
import { useOrganizationStorage } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Notice } from '../ui';

export interface StorageUsageBarProps {
  usage: OrganizationStorageUsage;
}

const BAR_TONES = {
  ok: 'bg-brand-500',
  warning: 'bg-amber-500',
  full: 'bg-rose-500',
} as const;

/** Used of quota, with the warning or "full" message when it applies. */
export const StorageUsageBar = ({ usage }: StorageUsageBarProps) => {
  const { t } = useTranslation('settings');
  const state = storageQuotaState(usage.fraction_used, STORAGE_QUOTA_WARNING_FRACTION);
  const percent = Math.min(100, Math.round(usage.fraction_used * 100));
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-900 dark:text-white">{t('storage.title')}</span>
        <span className="text-slate-500 dark:text-slate-400">
          {t('storage.usage', { used: formatFileSize(usage.used_bytes), quota: formatFileSize(usage.quota_bytes) })}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-label={t('storage.title')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={`h-full rounded-full ${BAR_TONES[state]}`} style={{ width: `${percent}%` }} />
      </div>
      {state === 'warning' && <Notice tone="warning">{t('storage.warning', { percent })}</Notice>}
      {state === 'full' && <Notice tone="warning">{t('storage.full')}</Notice>}
    </div>
  );
};

/**
 * Owners and admins see a warning across the app once their church has used
 * most of its storage; it links to the usage in Settings.
 */
export const StorageWarningBanner = () => {
  const { t } = useTranslation('settings');
  const { isAdmin } = useAuth();
  const location = useLocation();
  const storage = useOrganizationStorage(isAdmin);
  // The church settings show the same message beside the usage bar.
  const onChurchSettings = location.pathname === '/settings' && new URLSearchParams(location.search).get('section') === 'church';
  if (!isAdmin || !storage.data || onChurchSettings) return null;
  const state = storageQuotaState(storage.data.fraction_used, STORAGE_QUOTA_WARNING_FRACTION);
  if (state === 'ok') return null;
  const percent = Math.min(100, Math.round(storage.data.fraction_used * 100));
  return (
    <Notice tone="warning" className="mb-4">
      {state === 'full' ? t('storage.full') : t('storage.warning', { percent })}{' '}
      <Link to="/settings?section=church" className="font-medium underline underline-offset-2">
        {t('storage.settingsLink')}
      </Link>
    </Notice>
  );
};
