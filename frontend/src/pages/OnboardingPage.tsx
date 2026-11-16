import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setStoredOrganizationId } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useChurchCreationPolicy } from '../hooks/queries';
import { Icon } from '../components/icons';
import { AuthLayout } from '../components/AuthLayout';
import { DeleteAccountDialog } from '../components/settings/AccountPrivacySettings';
import { ChurchApplicationPanel } from '../components/church/ChurchApplicationPanel';
import { DisabledChurchNotice } from '../components/church/DisabledChurchNotice';

/**
 * Where a signed-in person without a church lands. Any of their churches that
 * Service Center disabled is explained first; then they can register a church
 * (an application for review, or direct creation while that is switched on).
 */
export const OnboardingPage = () => {
  const { t } = useTranslation(['auth', 'common', 'settings']);
  const { user, refreshUser, signOut } = useAuth();
  const policy = useChurchCreationPolicy();
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const selfServe = policy.data?.self_serve_allowed === true;
  const disabled = user?.disabled_organizations ?? [];

  const openChurch = async (organizationId: string) => {
    setStoredOrganizationId(organizationId);
    await refreshUser();
    navigate('/', { replace: true });
  };

  return (
    <AuthLayout width="md">
      {disabled.length > 0 && (
        <div className="mb-6 space-y-3">
          {disabled.map((organization) => (
            <DisabledChurchNotice key={organization.organization_id} organization={organization} />
          ))}
        </div>
      )}

      <div className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
        <div>
          <span className="mb-4 grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
            <Icon name="home" className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {selfServe ? t('onboarding.title') : t('settings:churchApplication.title')}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {selfServe ? t('onboarding.intro') : t('settings:churchApplication.intro')}
          </p>
        </div>

        <ChurchApplicationPanel hasChurch={(user?.memberships.length ?? 0) > 0} onChurchReady={openChurch} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <Icon name="signOut" className="size-4" />
          {t('common:actions.signOut')}
        </button>
        {/* Someone who signed up but never joined a church can still delete their account. */}
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400"
        >
          <Icon name="trash" className="size-4" />
          {t('settings:account.deleteEntry')}
        </button>
      </div>
      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} />
    </AuthLayout>
  );
};
