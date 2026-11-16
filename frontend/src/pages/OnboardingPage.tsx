import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { suggestedWelcomeChoice, type WelcomeChoice } from '@service-center/shared';
import { setStoredOrganizationId } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useChurchCreationPolicy, useMyChurchApplications, useMyChurchJoinRequests } from '../hooks/queries';
import { Icon, type IconName } from '../components/icons';
import { AuthLayout } from '../components/AuthLayout';
import { DeleteAccountDialog } from '../components/settings/AccountPrivacySettings';
import { ChurchApplicationPanel } from '../components/church/ChurchApplicationPanel';
import { ChurchJoinPanel } from '../components/church/ChurchJoinPanel';
import { DisabledChurchNotice } from '../components/church/DisabledChurchNotice';

/**
 * Where a signed-in person without a church lands. Any of their churches that
 * Service Center disabled is explained first; then two choices: join a church
 * that already uses Service Center (a request its owner approves with an
 * invitation), or register a new one (an application for review, or direct
 * creation while that is switched on).
 */
export const OnboardingPage = () => {
  const { t } = useTranslation(['auth', 'common', 'settings']);
  const { user, refreshUser, signOut } = useAuth();
  const policy = useChurchCreationPolicy();
  const joinRequests = useMyChurchJoinRequests();
  const applications = useMyChurchApplications();
  const [picked, setPicked] = useState<WelcomeChoice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const selfServe = policy.data?.self_serve_allowed === true;
  const disabled = user?.disabled_organizations ?? [];
  // Open whichever choice already has a request to show, until the person picks.
  const choice = picked ?? suggestedWelcomeChoice(joinRequests.data ?? [], applications.data ?? []);

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
            {t('settings:churchJoin.choice.title')}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('settings:churchJoin.choice.intro')}</p>
        </div>

        <div role="radiogroup" aria-label={t('settings:churchJoin.choice.label')} className="grid gap-3">
          <WelcomeChoiceOption
            icon="people"
            title={t('settings:churchJoin.choice.join')}
            description={t('settings:churchJoin.choice.joinDescription')}
            selected={choice === 'join'}
            onSelect={() => setPicked('join')}
          />
          <WelcomeChoiceOption
            icon="plus"
            title={selfServe ? t('onboarding.title') : t('settings:churchJoin.choice.register')}
            description={
              selfServe
                ? t('settings:churchJoin.choice.createDescription')
                : t('settings:churchJoin.choice.registerDescription')
            }
            selected={choice === 'register'}
            onSelect={() => setPicked('register')}
          />
        </div>

        {choice === 'join' && (
          <div className="border-t border-app-border pt-5">
            <ChurchJoinPanel />
          </div>
        )}

        {choice === 'register' && (
          <div className="space-y-4 border-t border-app-border pt-5">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {selfServe ? t('onboarding.intro') : t('settings:churchApplication.intro')}
            </p>
            <ChurchApplicationPanel hasChurch={(user?.memberships.length ?? 0) > 0} onChurchReady={openChurch} />
          </div>
        )}
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

export interface WelcomeChoiceOptionProps {
  icon: IconName;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

/** One of the two ways to start, as a selectable card. */
const WelcomeChoiceOption = ({ icon, title, description, selected, onSelect }: WelcomeChoiceOptionProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={`flex w-full items-start gap-3 rounded-xl p-4 text-left ring-1 ring-inset transition
      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
        selected
          ? 'bg-brand-50/70 ring-2 ring-brand-500 dark:bg-brand-500/10 dark:ring-brand-400'
          : 'ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50'
      }`}
  >
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-lg ${
        selected
          ? 'bg-brand-600 text-white'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      <Icon name={icon} className="size-[18px]" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
      <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{description}</span>
    </span>
    <span
      aria-hidden="true"
      className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-inset ${
        selected ? 'bg-brand-600 ring-brand-600' : 'ring-slate-300 dark:ring-slate-600'
      }`}
    >
      {selected && <span className="size-1.5 rounded-full bg-white" />}
    </span>
  </button>
);
