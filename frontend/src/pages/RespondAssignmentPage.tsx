import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LocalizedError } from '@service-center/shared';
import { api } from '../lib/api';
import { Button, ErrorNotice, Loading } from '../components/ui';
import { AnonymousLanguageToggle, useFormatters, useRecipientLanguage } from '../i18n';

const LanguageCorner = () => (
  <div className="flex justify-end pb-4">
    <AnonymousLanguageToggle />
  </div>
);

export const RespondAssignmentPage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const fmt = useFormatters();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState<'confirmed' | 'declined' | null>(null);
  const preview = useQuery({
    queryKey: ['assignment-response', token],
    queryFn: () => api.previewAssignmentResponse(token!),
    enabled: Boolean(token),
  });
  const respond = useMutation({
    mutationFn: (status: 'confirmed' | 'declined') => api.respondToAssignmentNotification(token!, { status }),
    onSuccess: (result) => setDone(result.status),
  });
  // Once the token is verified, show the page in the recipient's saved language.
  useRecipientLanguage(preview.data ? preview.data.preferred_language : undefined);

  if (!token) return <main className="mx-auto max-w-lg p-6"><LanguageCorner /><ErrorNotice error={new LocalizedError({ key: 'auth:respond.missingToken' })} /></main>;
  if (preview.isLoading) return <main className="mx-auto max-w-lg p-6"><LanguageCorner /><Loading label={t('respond.loading')} /></main>;
  if (preview.error) return <main className="mx-auto max-w-lg p-6"><LanguageCorner /><ErrorNotice error={preview.error} /></main>;
  if (done) return <main className="mx-auto max-w-lg p-6"><LanguageCorner /><section className="card p-6"><h1 className="text-xl font-semibold">{t('respond.thankYou')}</h1><p className="mt-2 text-slate-600">{done === 'confirmed' ? t('respond.doneConfirmed') : t('respond.doneDeclined')}</p></section></main>;
  if (!preview.data) return null;

  const data = preview.data;
  return (
    <main className="mx-auto max-w-lg p-6">
      <LanguageCorner />
      <section className="card space-y-5 p-6">
        <div><p className="text-sm text-slate-500">{t('respond.eyebrow')}</p><h1 className="text-2xl font-semibold">{data.person_first_name ? t('respond.greeting', { name: data.person_first_name }) : t('respond.greetingGeneric')}</h1></div>
        <div><h2 className="font-semibold">{data.plan_title}</h2><p className="text-sm text-slate-600">{fmt.calendarDate(data.service_date)}{data.service_time ? ` · ${fmt.time(data.service_time.starts_at)}` : ''}{data.location ? ` · ${data.location}` : ''}</p></div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{data.assignments.map((assignment, index) => <li key={`${assignment.team_name}-${index}`}>{assignment.team_name}{assignment.position_name ? ` — ${assignment.position_name}` : ''} ({t(`common:assignmentStatus.${assignment.status}`)})</li>)}</ul>
        <ErrorNotice error={respond.error} />
        <div className="flex gap-3"><Button loading={respond.isPending} onClick={() => respond.mutate('confirmed')}>{t('common:actions.confirm')}</Button><Button variant="secondary" loading={respond.isPending} onClick={() => respond.mutate('declined')}>{t('common:actions.decline')}</Button></div>
      </section>
    </main>
  );
};
