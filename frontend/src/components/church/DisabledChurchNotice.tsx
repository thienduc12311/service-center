import { useTranslation } from 'react-i18next';
import type { DisabledOrganization } from '@service-center/shared';
import { env } from '../../lib/env';
import { Icon } from '../icons';

export interface DisabledChurchNoticeProps {
  organization: DisabledOrganization;
}

/** A church the person belongs to was disabled by Service Center. Owners also see why. */
export const DisabledChurchNotice = ({ organization }: DisabledChurchNoticeProps) => {
  const { t } = useTranslation('settings');
  const church = organization.organization_name;
  return (
    <section
      role="alert"
      className="flex items-start gap-3 rounded-2xl bg-amber-50 p-5 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/25"
    >
      <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1.5">
        <h2 className="font-semibold">{t('disabledChurch.title', { church })}</h2>
        <p>{t('disabledChurch.body', { church })}</p>
        {organization.disabled_reason && <p>{t('disabledChurch.reason', { reason: organization.disabled_reason })}</p>}
        <p>
          <a className="font-medium underline underline-offset-2" href={`mailto:${env.supportEmail}`}>
            {t('disabledChurch.contact', { email: env.supportEmail })}
          </a>
        </p>
      </div>
    </section>
  );
};
