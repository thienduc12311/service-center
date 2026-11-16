import { useTranslation } from 'react-i18next';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n/useFormatters';
import { Notice } from '../ui';

/**
 * A Service Center admin inside a church as a temporary owner always sees it,
 * so a change made "as the church" is never a surprise.
 */
export const PlatformAccessBanner = () => {
  const { t } = useTranslation('settings');
  const { dateTime } = useFormatters();
  const { user, organizationId } = useAuth();
  const membership = user?.memberships.find((m) => m.organization.id === organizationId);
  if (!membership?.platform_access_expires_at) return null;
  return (
    <Notice tone="warning" className="mb-4">
      {t('platformAccess.banner', {
        church: membership.organization.name,
        time: dateTime(membership.platform_access_expires_at),
      })}
    </Notice>
  );
};
