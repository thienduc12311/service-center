import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AccountDeletionOrganization, BlockedUser } from '@service-center/shared';
import { api } from '../../lib/api';
import { rememberAccountDeleted } from '../../lib/account-deleted-notice';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Avatar, Button, ErrorNotice, Modal, Notice, Spinner } from '../ui';

interface BlockedRowProps {
  person: BlockedUser;
  busy: boolean;
  onUnblock: () => void;
}

const BlockedRow = ({ person, busy, onUnblock }: BlockedRowProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const format = useFormatters();
  const name = person.full_name ?? t('common:fallback.someone');
  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar name={name} url={person.avatar_url} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900 dark:text-white">{name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('account.blockedSince', { date: format.date(person.blocked_at) })}</p>
      </div>
      <Button variant="secondary" size="sm" loading={busy} onClick={onUnblock}>{t('account.unblock')}</Button>
    </li>
  );
};

/** The people this account blocked (App Store Review Guideline 1.2), with unblock. */
const BlockedPeople = () => {
  const { t } = useTranslation('settings');
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const blocked = useQuery({ queryKey: keys.blockedUsers(organizationId), queryFn: () => api.blockedUsers() });
  const unblock = useMutation({
    mutationFn: (userId: string) => api.unblockUser(userId),
    // Their messages and comments come back everywhere.
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.all(organizationId) }),
  });
  const people = blocked.data ?? [];

  return (
    <section className="card p-5" aria-labelledby="blocked-people-heading">
      <h2 id="blocked-people-heading" className="font-semibold text-slate-900 dark:text-white">{t('account.blockedScreenTitle')}</h2>
      <p className="mt-1 text-sm text-pretty text-slate-500 dark:text-slate-400">{t('account.blockedDescription')}</p>
      {blocked.isLoading && <Spinner className="mt-4 size-5" />}
      <ErrorNotice error={blocked.error ?? unblock.error} />
      {blocked.isSuccess && people.length === 0 && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{t('account.blockedEmpty')}</p>
      )}
      {people.length > 0 && (
        <ul className="mt-2 divide-y divide-app-border">
          {people.map((person) => (
            <BlockedRow
              key={person.user_id}
              person={person}
              busy={unblock.isPending && unblock.variables === person.user_id}
              onUnblock={() => unblock.mutate(person.user_id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

interface OrganizationListProps {
  organizations: readonly AccountDeletionOrganization[];
}

const OrganizationList = ({ organizations }: OrganizationListProps) => (
  <ul className="mt-2 list-disc space-y-1 pl-5 font-medium">
    {organizations.map((org) => <li key={org.organization_id}>{org.organization_name}</li>)}
  </ul>
);

export interface DeleteAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * In-app account deletion (App Store Review Guideline 5.1.1(v)), the same
 * flow as the mobile app: what is deleted, a refusal while an organization
 * would be left without an owner, a typed confirmation, then sign-out.
 * Works without an organization, so it is also offered on onboarding.
 */
export const DeleteAccountDialog = ({ open, onClose }: DeleteAccountDialogProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { user, signOut } = useAuth();
  const [typed, setTyped] = useState('');

  const plan = useQuery({
    queryKey: keys.accountDeletionPlan(user?.profile.id ?? null),
    queryFn: () => api.accountDeletionPlan(),
    enabled: open,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      // The login no longer exists; clear this browser. The auth gate then
      // sends the tab to sign-in, which says the account was deleted.
      rememberAccountDeleted();
      await signOut();
    },
    // A refusal can mean someone joined an organization since the plan was read.
    onError: () => void plan.refetch(),
  });

  const confirmWord = t('account.deleteConfirmWord');
  const confirmed = typed.trim().toUpperCase() === confirmWord.toUpperCase();
  const blocked = plan.data?.organizations.filter((org) => org.outcome === 'blocked') ?? [];
  const deleted = plan.data?.organizations.filter((org) => org.outcome === 'deleted') ?? [];
  const close = () => {
    setTyped('');
    remove.reset();
    onClose();
  };

  return (
      <Modal
        open={open}
        title={t('account.deleteAlertTitle')}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>{t('common:actions.cancel')}</Button>
            {plan.data?.can_delete && (
              <Button
                variant="danger"
                icon="trash"
                type="submit"
                form="delete-account-form"
                loading={remove.isPending}
                disabled={!confirmed}
              >
                {t('account.deleteButton')}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <p>{t('account.deleteIntro', { email: user?.profile.email ?? '' })}</p>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{t('account.deleteWhatHappens')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t('account.deleteItemProfile')}</li>
              <li>{t('account.deleteItemActivity')}</li>
              <li>{t('account.deleteItemMemberships')}</li>
            </ul>
          </div>

          {plan.isLoading && <Spinner className="size-5" />}
          <ErrorNotice error={plan.error} />

          {deleted.length > 0 && (
            <Notice tone="warning">
              <p className="font-medium">{t('account.deleteOrganizationsTitle')}</p>
              <p className="mt-1">{t('account.deleteOrganizationsDescription')}</p>
              <OrganizationList organizations={deleted} />
            </Notice>
          )}

          {blocked.length > 0 && (
            <Notice tone="warning">
              <p className="font-medium">{t('account.deleteBlockedTitle')}</p>
              <p className="mt-1">{t('account.deleteBlockedDescription')}</p>
              <OrganizationList organizations={blocked} />
            </Notice>
          )}

          {plan.data?.can_delete && (
            <form
              id="delete-account-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (confirmed) remove.mutate();
              }}
            >
              <label className="label" htmlFor="delete-account-confirm">{t('account.deleteConfirmLabel')}</label>
              <input
                id="delete-account-confirm"
                className="input"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={confirmWord}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </form>
          )}
          <ErrorNotice error={remove.error} />
        </div>
      </Modal>
  );
};

const DeleteAccount = () => {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  return (
    <section className="card p-5" aria-labelledby="delete-account-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="delete-account-heading" className="font-semibold text-slate-900 dark:text-white">{t('account.deleteEntry')}</h2>
          <p className="mt-1 text-sm text-pretty text-slate-500 dark:text-slate-400">{t('account.deleteEntryDescription')}</p>
        </div>
        <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>{t('account.deleteEntry')}</Button>
      </div>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
};

/** Settings → Account & privacy: blocked people and account deletion. */
export const AccountPrivacySettings = () => (
  <div className="space-y-6">
    <BlockedPeople />
    <DeleteAccount />
  </div>
);
