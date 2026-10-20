import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setStoredOrganizationId } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from '../components/ui';

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
    <div className="grid min-h-full place-items-center px-4 py-12">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">{t('onboarding.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('onboarding.intro')}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="org-name">{t('onboarding.name')}</label>
          <input
            id="org-name"
            className="input"
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
            className="input"
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

        <Button type="submit" loading={busy} className="w-full">
          {t('onboarding.submit')}
        </Button>

        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full text-center text-sm text-slate-500 hover:underline"
        >
          {t('common:actions.signOut')}
        </button>
      </form>
    </div>
  );
};
