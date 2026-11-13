import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setStoredOrganizationId } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from '../components/ui';
import { Icon } from '../components/icons';
import { AuthLayout } from '../components/AuthLayout';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export const OnboardingPage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const { refreshUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const organization = await api.createOrganization({
        name,
        slug: slug || slugify(name),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setStoredOrganizationId(organization.id);
      await refreshUser();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout width="md">
      <form onSubmit={submit} className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
        <div>
          <span className="mb-4 grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
            <Icon name="home" className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{t('onboarding.title')}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {t('onboarding.intro')}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="org-name">{t('onboarding.name')}</label>
          <input
            id="org-name"
            className="input h-11"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            placeholder={t('onboarding.namePlaceholder')}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="org-slug">{t('onboarding.slug')}</label>
          <input
            id="org-slug"
            className="input h-11 font-mono"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(slugify(e.target.value));
            }}
            pattern="[a-z0-9-]{2,40}"
            required
          />
        </div>

        <ErrorNotice error={error} />

        <Button type="submit" size="lg" loading={busy} className="w-full">
          {t('onboarding.submit')}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => void signOut()}
        className="mx-auto mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        <Icon name="signOut" className="size-4" />
        {t('common:actions.signOut')}
      </button>
    </AuthLayout>
  );
};
