import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { isAdmin, isLeader, personalFeedState, STORAGE_BUCKETS, type OrganizationRow } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useCalendarFeed, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, PageHeader } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { AvatarUpload } from '../components/AvatarUpload';
import { DeliverySettings } from '../components/settings/DeliverySettings';
import { IntegrationSettings } from '../components/settings/IntegrationSettings';
import { MyReminderSettings, ReminderPolicySettings } from '../components/settings/ReminderSettings';
import { AccessSettings } from '../components/settings/AccessSettings';
import { RosterVisibilitySettings } from '../components/settings/RosterVisibilitySettings';
import { FolderSettings } from '../components/settings/FolderSettings';
import { IdentityReconciliationSettings } from '../components/settings/IdentityReconciliationSettings';
import { AvailabilitySettings } from '../components/settings/AvailabilitySettings';
import { AvailabilityReview } from '../components/settings/AvailabilityReview';
import { SchedulingPreferences } from '../components/settings/SchedulingPreferences';
import { ScheduleHelp } from '../components/settings/ScheduleHelp';
import { AcrossOrganizations } from '../components/settings/AcrossOrganizations';
import { ServiceTypeFilesSettings } from '../components/settings/ServiceTypeFilesSettings';
import { LanguageSelect } from '../i18n';
import { AppearanceSettings } from '../components/settings/AppearanceSettings';

export const SettingsPage = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { user, organizationId, role, access, canAnywhere, refreshUser, switchOrganization } = useAuth();
  const calendarFeed = useCalendarFeed();
  const rotateFeed = useMutation({ mutationFn: () => api.rotateCalendarFeed(), onSuccess: () => calendarFeed.refetch() });
  // The status read never carries the URL; only the link created just now does (MOB-022 shares this rule).
  const feedState = personalFeedState(calendarFeed.data, rotateFeed.data ?? null);
  const feed = feedState === 'revealed' ? rotateFeed.data : undefined;
  const organization = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setFullName(user?.profile.full_name ?? '');
    setPhone(user?.profile.phone ?? '');
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: () => api.updateMe({ full_name: fullName, phone: phone || null }),
    onSuccess: () => refreshUser(),
  });

  const invalidate = useInvalidateOrg();
  // The picture follows onto your Person, so rosters and plans re-read too.
  const saveAvatar = async (avatarUrl: string | null) => {
    await api.updateMe({ avatar_url: avatarUrl });
    await Promise.all([refreshUser(), invalidate()]);
  };

  const admin = isAdmin(role);
  const navItems: SettingsNavItem[] = [
    { id: 'profile', label: t('settingsPage.profile.title'), icon: 'person', group: 'me' },
    { id: 'appearance', label: t('profile.appearance.title'), icon: 'sun', group: 'me' },
    { id: 'reminders', label: t('myReminders.title'), icon: 'bell', group: 'me' },
    { id: 'calendar', label: t('settingsPage.calendar.title'), icon: 'calendar', group: 'me' },
    ...(organization
      ? [{ id: 'availability', label: t('settingsPage.availability.title'), icon: 'clock', group: 'me' } satisfies SettingsNavItem]
      : []),
    { id: 'church', label: t('profile.organizations.title'), icon: 'home', group: 'church' },
    ...(admin && organization
      ? [{ id: 'access', label: t('settingsPage.access'), icon: 'people', group: 'church' } satisfies SettingsNavItem]
      : []),
  ];
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  // Unknown or unavailable sections (e.g. Access for a non-admin) fall back to Profile.
  const section: SettingsSection = navItems.find((item) => item.id === requested)?.id ?? 'profile';
  const selectSection = (next: SettingsSection) => setSearchParams(next === 'profile' ? {} : { section: next });

  return (
    <div>
      <PageHeader title={t('settingsPage.title')} subtitle={t('settingsPage.subtitle')} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav items={navItems} label={t('settingsPage.title')} value={section} onChange={selectSection} />

        <div className="min-w-0 max-w-3xl">
          {section === 'profile' && (
          <div id="settings-profile" className="space-y-6">
            <SettingsCard
              title={t('settingsPage.profile.title')}
              description={t('settingsPage.profile.signedInAs', { email: user?.profile.email ?? '' })}
            >
              {user && (
                <div className="mb-5">
                  <AvatarUpload
                    name={user.profile.full_name ?? user.profile.email}
                    url={user.profile.avatar_url}
                    target={{ kind: 'self', userId: user.profile.id }}
                    onChange={saveAvatar}
                  />
                </div>
              )}
              <form
                className="space-y-4"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  saveProfile.mutate();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="profile-name">{t('settingsPage.profile.fullName')}</label>
                    <input id="profile-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="profile-phone">{t('settingsPage.profile.phone')}</label>
                    <input id="profile-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>

                <ErrorNotice error={saveProfile.error} />
                <div className="-mx-5 -mb-5 flex items-center justify-end gap-3 border-t border-app-border bg-slate-50/70 px-5 py-3 dark:bg-slate-950/30">
                  {saveProfile.isSuccess && (
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                      <Icon name="check" className="size-4" />
                      {t('settingsPage.saved')}
                    </span>
                  )}
                  <Button type="submit" loading={saveProfile.isPending}>
                    {t('settingsPage.profile.save')}
                  </Button>
                </div>
              </form>
            </SettingsCard>

            <section className="card p-5" aria-labelledby="language-settings-heading">
              <h2 id="language-settings-heading" className="mb-4 font-semibold text-slate-900 dark:text-white" lang="en">
                Language / <span lang="vi">Ngôn ngữ</span>
              </h2>
              <LanguageSelect organizationName={organization?.name} />
            </section>
          </div>
          )}

          {section === 'appearance' && (
          <div id="settings-appearance">
            <AppearanceSettings />
          </div>
          )}

          {section === 'church' && (
          <div id="settings-church" className="space-y-6">
            <OrganizationSettings
              organization={organization}
              canEdit={admin}
              onChanged={refreshUser}
              onCreated={async (id) => {
                await refreshUser();
                switchOrganization(id);
              }}
            />

            {admin && organization && <RosterVisibilitySettings organization={organization} />}

            {admin && (
              <section className="card p-5">
                <FolderSettings />
              </section>
            )}

            {admin && <DeliverySettings />}

            {admin && <IntegrationSettings />}

            {isLeader(access) && <ReminderPolicySettings />}

            {(canAnywhere('plans.edit') || canAnywhere('media.manage')) && <ServiceTypeFilesSettings />}

            {admin && <IdentityReconciliationSettings />}
          </div>
          )}

          {section === 'access' && admin && organization && (
            <div id="settings-access">
              <AccessSettings />
            </div>
          )}

          {section === 'reminders' && (
          <div id="settings-reminders">
            <MyReminderSettings />
          </div>
          )}

          {section === 'calendar' && (
          <div id="settings-calendar">
            <SettingsCard title={t('settingsPage.calendar.title')} description={t('settingsPage.calendar.description')}>
              <div className="space-y-3">
                {feed?.url ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={feed.url} />
                      <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(feed.url!)}>{t('common:actions.copy')}</Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-200" href={feed.webcal_url ?? undefined}>
                        <Icon name="calendar" className="size-4" />
                        {t('settingsPage.calendar.openInApp')}
                      </a>
                      <Button variant="ghost" size="sm" loading={rotateFeed.isPending} onClick={() => rotateFeed.mutate()}>{t('settingsPage.calendar.rotate')}</Button>
                    </div>
                  </div>
                ) : feedState === 'active' ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{t('settingsPage.calendar.activeHidden')}</p>
                    <Button variant="secondary" loading={rotateFeed.isPending} onClick={() => rotateFeed.mutate()}>{t('settingsPage.calendar.rotate')}</Button>
                  </div>
                ) : feedState === 'none' ? (
                  <div className="flex justify-end">
                    <Button icon="plus" loading={rotateFeed.isPending} onClick={() => rotateFeed.mutate()}>{t('settingsPage.calendar.create')}</Button>
                  </div>
                ) : null}
                <ErrorNotice error={calendarFeed.error ?? rotateFeed.error} />
              </div>
            </SettingsCard>
          </div>
          )}

          {section === 'availability' && organization ? (
            <div id="settings-availability" className="space-y-6">
              <SettingsCard title={t('settingsPage.availability.title')} description={t('settingsPage.availability.description')}>
                <AvailabilityReview />
              </SettingsCard>
              <AvailabilitySettings timezone={organization.timezone} />
              <SettingsCard title={t('settingsPage.preferences.title')} description={t('settingsPage.preferences.description')}>
                <SchedulingPreferences />
              </SettingsCard>
              <ScheduleHelp />
              <AcrossOrganizations />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/** The settings pages, one shown at a time. */
type SettingsSection = 'profile' | 'appearance' | 'church' | 'access' | 'reminders' | 'calendar' | 'availability';

/** Personal settings vs. settings for the whole church. */
type SettingsGroup = 'me' | 'church';

const SETTINGS_GROUPS: readonly SettingsGroup[] = ['me', 'church'];

/** One entry of the settings section navigation. */
interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: IconName;
  group: SettingsGroup;
}

interface SettingsNavProps {
  items: readonly SettingsNavItem[];
  label: string;
  value: SettingsSection;
  onChange: (section: SettingsSection) => void;
}

/**
 * Picks which settings page is shown, grouped into "My settings" and
 * "Church": a sticky vertical list with group headings beside the page on
 * large screens, a horizontally scrolling pill row (groups split by a thin
 * divider) above it on small ones.
 */
const SettingsNav = ({ items, label, value, onChange }: SettingsNavProps) => {
  const { t } = useTranslation('settings');
  const navRef = useRef<HTMLElement>(null);

  // On phones the pill row scrolls sideways; keep the open section in view.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value]);

  const groups = SETTINGS_GROUPS.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (entry) => entry.items.length > 0,
  );

  return (
    <nav ref={navRef} aria-label={label} className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <ul className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:items-stretch lg:overflow-visible lg:px-0">
        {groups.map(({ group, items: groupItems }, index) => (
          <li key={group} className="contents">
            {index > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-app-border lg:hidden" />}
            <p className={`hidden px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase lg:block ${index > 0 ? 'lg:pt-4' : ''}`}>
              {t(`settingsPage.groups.${group}`)}
            </p>
            <ul className="contents lg:flex lg:flex-col lg:gap-1">
              {groupItems.map((item) => {
                const current = value === item.id;
                return (
                  <li key={item.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => onChange(item.id)}
                      aria-current={current ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        current
                          ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                      }`}
                    >
                      <Icon name={item.icon} className="size-4 shrink-0 opacity-80" />
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
};

interface SettingsCardProps {
  title: string;
  description?: ReactNode;
  /** Controls aligned to the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A settings group: title and description over its controls. */
const SettingsCard = ({ title, description, actions, children }: SettingsCardProps) => {
  const headingId = useId();
  return (
    <section className="card overflow-hidden p-5" aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-semibold text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="mt-1 text-sm text-pretty text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
};

const slugify = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

/** Editable organization-profile fields — `member_count` stays a string while typed, parsed to a number on submit. */
interface OrganizationProfileForm {
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  denomination: string;
  member_count: string;
}

const emptyOrganizationProfileForm: OrganizationProfileForm = {
  name: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
  denomination: '',
  member_count: '',
};

const organizationProfileFromRow = (organization: OrganizationRow): OrganizationProfileForm => ({
  name: organization.name,
  address_line1: organization.address_line1 ?? '',
  address_line2: organization.address_line2 ?? '',
  city: organization.city ?? '',
  state_province: organization.state_province ?? '',
  postal_code: organization.postal_code ?? '',
  country: organization.country ?? '',
  denomination: organization.denomination ?? '',
  member_count: organization.member_count != null ? String(organization.member_count) : '',
});

const organizationProfileToInput = (form: OrganizationProfileForm) => ({
  name: form.name.trim(),
  address_line1: form.address_line1.trim() || null,
  address_line2: form.address_line2.trim() || null,
  city: form.city.trim() || null,
  state_province: form.state_province.trim() || null,
  postal_code: form.postal_code.trim() || null,
  country: form.country.trim() || null,
  denomination: form.denomination.trim() || null,
  member_count: form.member_count.trim() ? Number(form.member_count.trim()) : null,
});

interface OrganizationSettingsProps {
  organization: OrganizationRow | undefined;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onCreated: (id: string) => Promise<void>;
}

const OrganizationSettings = ({
  organization,
  canEdit,
  onChanged,
  onCreated,
}: OrganizationSettingsProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [editingProfile, setEditingProfile] = useState(false);
  const [profile, setProfile] = useState<OrganizationProfileForm>(emptyOrganizationProfileForm);

  useEffect(() => {
    if (organization) setProfile(organizationProfileFromRow(organization));
  }, [organization]);

  const saveProfile = useMutation({
    mutationFn: () => api.updateOrganization(organization!.id, organizationProfileToInput(profile)),
    onSuccess: async () => {
      await onChanged();
      setEditingProfile(false);
    },
  });

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createOrganization({
        name,
        slug: `${slugify(name).slice(0, 35)}-${Date.now().toString(36).slice(-4)}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setName('');
      setCreating(false);
      await onCreated(created.id);
    } catch (reason) {
      setError(reason);
    }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !organization) return;
    setUploading(true);
    setError(null);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${organization.id}/logo-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.organizationLogos)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.organizationLogos).getPublicUrl(path);
      await api.updateOrganization(organization.id, { logo_url: data.publicUrl });
      await onChanged();
    } catch (reason) {
      setError(reason);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <section className="card overflow-hidden p-5">
      <div className="flex flex-wrap items-center gap-4">
        {organization?.logo_url ? (
          <img src={organization.logo_url} alt={t('organization.logoAlt', { name: organization.name })} className="size-16 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
        ) : (
          <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-700 text-xl font-bold text-white">SC</div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900 dark:text-white">{organization?.name ?? t('organization.fallbackName')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[organization?.denomination, organization?.city, organization?.country].filter(Boolean).join(' · ') ||
              t('organization.emptyDescription')}
          </p>
        </div>
        {canEdit && organization && (
          <label className="button inline-flex h-9 cursor-pointer items-center gap-2 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">
            <Icon name="upload" className="size-4" />
            {uploading ? t('organization.uploading') : t('organization.updateLogo')}
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} disabled={uploading} />
          </label>
        )}
        {canEdit && organization && (
          <Button variant="secondary" icon={editingProfile ? undefined : 'pencil'} onClick={() => setEditingProfile((value) => !value)}>
            {editingProfile ? t('common:actions.cancel') : t('organization.editDetails')}
          </Button>
        )}
        <Button variant="ghost" icon={creating ? undefined : 'plus'} onClick={() => setCreating((value) => !value)}>
          {creating ? t('common:actions.cancel') : t('organization.new')}
        </Button>
      </div>

      {editingProfile && organization && (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            saveProfile.mutate();
          }}
          className="mt-5 grid grid-cols-1 gap-4 border-t border-app-border pt-5 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="org-profile-name">{t('organization.fields.name')}</label>
            <input
              id="org-profile-name"
              className="input"
              value={profile.name}
              onChange={(e) => setProfile((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('organization.fields.namePlaceholder')}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="org-address1">{t('organization.fields.addressLine1')}</label>
            <input id="org-address1" className="input" value={profile.address_line1} onChange={(e) => setProfile((f) => ({ ...f, address_line1: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-address2">{t('organization.fields.addressLine2')}</label>
            <input id="org-address2" className="input" value={profile.address_line2} onChange={(e) => setProfile((f) => ({ ...f, address_line2: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-city">{t('organization.fields.city')}</label>
            <input id="org-city" className="input" value={profile.city} onChange={(e) => setProfile((f) => ({ ...f, city: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-state">{t('organization.fields.stateProvince')}</label>
            <input id="org-state" className="input" value={profile.state_province} onChange={(e) => setProfile((f) => ({ ...f, state_province: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-postal">{t('organization.fields.postalCode')}</label>
            <input id="org-postal" className="input" value={profile.postal_code} onChange={(e) => setProfile((f) => ({ ...f, postal_code: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-country">{t('organization.fields.country')}</label>
            <input id="org-country" className="input" value={profile.country} onChange={(e) => setProfile((f) => ({ ...f, country: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-denomination">{t('organization.fields.denomination')}</label>
            <input id="org-denomination" className="input" value={profile.denomination} onChange={(e) => setProfile((f) => ({ ...f, denomination: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="org-member-count">{t('organization.fields.memberCount')}</label>
            <input
              id="org-member-count"
              type="number"
              min={0}
              className="input"
              value={profile.member_count}
              onChange={(e) => setProfile((f) => ({ ...f, member_count: e.target.value }))}
            />
          </div>

          <ErrorNotice error={saveProfile.error} />

          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" loading={saveProfile.isPending}>{t('organization.saveDetails')}</Button>
          </div>
        </form>
      )}

      {creating && (
        <form onSubmit={create} className="mt-5 flex flex-col gap-3 border-t border-app-border pt-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="new-org-name">{t('organization.fields.name')}</label>
            <input id="new-org-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('organization.fields.namePlaceholder')} required />
          </div>
          <Button type="submit">{t('organization.create')}</Button>

        </form>
      )}
      <div className="mt-4 empty:hidden">
        <ErrorNotice error={error} />
      </div>
    </section>
  );
};
