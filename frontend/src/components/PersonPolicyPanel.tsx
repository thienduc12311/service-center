import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EligibilityStatus } from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from './ui';
import { useFormatters } from '../i18n';

export interface PersonPolicyPanelProps {
  personId: string;
  /** Eligibility evidence belongs to a member with a login. */
  profileId: string | null;
}

/** Eligibility statuses in display order; labels come from `policy.status.*`. */
const ELIGIBILITY_STATUSES: readonly EligibilityStatus[] = ['clear', 'not_clear', 'pending'];

/**
 * Tags (which drive tag-derived team suggestions) and eligibility evidence
 * for secure teams. Evidence is a provider name and reference only; the
 * newest record of a kind decides, and anything but a current "clear" blocks.
 */
export const PersonPolicyPanel = ({ personId, profileId }: PersonPolicyPanelProps) => {
  const { t } = useTranslation(['people', 'common']);
  const f = useFormatters();
  const { organizationId, canAnywhere } = useAuth();
  const invalidate = useInvalidateOrg();
  const canEdit = canAnywhere('people.manage');

  const tags = useQuery({
    queryKey: [...keys.person(organizationId, personId), 'tags'],
    queryFn: () => api.personTags(personId),
  });
  const records = useQuery({
    queryKey: [...keys.person(organizationId, personId), 'eligibility'],
    queryFn: () => api.listEligibilityRecords(profileId!),
    enabled: Boolean(profileId),
  });

  const [tagText, setTagText] = useState('');
  useEffect(() => setTagText((tags.data ?? []).join(', ')), [tags.data]);

  const saveTags = useMutation({
    mutationFn: () =>
      api.replacePersonTags(
        personId,
        tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
      ),
    onSuccess: invalidate,
  });

  const [kind, setKind] = useState('background_check');
  const [status, setStatus] = useState<EligibilityStatus>('clear');
  const [provider, setProvider] = useState('manual');
  const [reference, setReference] = useState('');
  const [verifiedOn, setVerifiedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');

  const record = useMutation({
    mutationFn: () =>
      api.recordEligibility({
        user_id: profileId!,
        kind: kind.trim(),
        status,
        provider: provider.trim(),
        provider_reference: reference.trim() || null,
        verified_at: new Date(verifiedOn).toISOString(),
        expires_at: new Date(expiresOn).toISOString(),
      }),
    onSuccess: async () => {
      setReference('');
      await invalidate();
    },
  });

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="mb-1 font-semibold">{t('policy.tags')}</h2>
        <div className="flex gap-2">
          <input
            aria-label={t('policy.tags')}
            className="input min-w-0 flex-1"
            value={tagText}
            disabled={!canEdit}
            onChange={(e) => setTagText(e.target.value)}
            placeholder={t('policy.tagsPlaceholder')}
          />
          {canEdit && (
            <Button variant="secondary" loading={saveTags.isPending} onClick={() => saveTags.mutate()}>
              {t('policy.saveTags')}
            </Button>
          )}
        </div>
        <ErrorNotice error={tags.error ?? saveTags.error} />
      </div>

      {profileId && (
        <div>
          <h2 className="mb-1 font-semibold">{t('policy.eligibility')}</h2>
          {(records.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">{t('policy.noRecords')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {(records.data ?? []).map((row) => (
                <li key={row.id} className="py-1.5">
                  <span className="font-medium">{row.kind}</span> ·{' '}
                  {t('policy.recordSummary', {
                    status: t(`policy.status.${row.status}`),
                    verified: f.date(row.verified_at),
                    expires: f.date(row.expires_at),
                  })}
                  <span className="text-slate-400"> ({row.provider})</span>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input aria-label={t('policy.kindLabel')} className="input" value={kind} onChange={(e) => setKind(e.target.value)} />
              <select aria-label={t('policy.statusLabel')} className="input" value={status} onChange={(e) => setStatus(e.target.value as EligibilityStatus)}>
                {ELIGIBILITY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`policy.status.${value}`)}
                  </option>
                ))}
              </select>
              <input aria-label={t('policy.providerLabel')} className="input" value={provider} onChange={(e) => setProvider(e.target.value)} />
              <input aria-label={t('policy.referenceLabel')} className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('policy.referencePlaceholder')} />
              <label className="field">
                {t('policy.verified')}
                <input type="date" className="input" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} />
              </label>
              <label className="field">
                {t('policy.expires')}
                <input type="date" className="input" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </label>
              <div className="sm:col-span-3">
                <Button
                  variant="secondary"
                  disabled={!verifiedOn || !expiresOn || !kind.trim() || !provider.trim()}
                  loading={record.isPending}
                  onClick={() => record.mutate()}
                >
                  {t('policy.addRecord')}
                </Button>
              </div>
            </div>
          )}
          <ErrorNotice error={records.error ?? record.error} />
        </div>
      )}
    </section>
  );
};
