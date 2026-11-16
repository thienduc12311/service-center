import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button, ErrorNotice } from '../ui';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export interface CreateChurchFormProps {
  onCreated: (organizationId: string) => Promise<void>;
}

/**
 * Self-serve church creation. Only shown while the platform allows it
 * (`church_creation_policy`); otherwise people apply instead.
 */
export const CreateChurchForm = ({ onCreated }: CreateChurchFormProps) => {
  const { t } = useTranslation(['auth']);
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
      await onCreated(organization.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
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
  );
};
