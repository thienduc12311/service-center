import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LocalizedError } from '@service-center/shared';
import { api } from '../lib/api';
import { Button, DateTile, ErrorNotice, Loading } from '../components/ui';
import { Icon } from '../components/icons';
import { AuthLayout } from '../components/AuthLayout';
import { LocaleSwitcher, useFormatters, useRecipientLanguage } from '../i18n';

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

  const frame = (content: ReactNode) => (
    <AuthLayout corner={<LocaleSwitcher />} width="md">
      {content}
    </AuthLayout>
  );

  if (!token) return frame(<ErrorNotice error={new LocalizedError({ key: 'auth:respond.missingToken' })} />);
  if (preview.isLoading) return frame(<Loading label={t('respond.loading')} />);
  if (preview.error) return frame(<ErrorNotice error={preview.error} />);
  if (done) {
    return frame(
      <section className="card flex flex-col items-center p-8 text-center shadow-xl shadow-slate-900/5 dark:shadow-none">
        <span
          className={`mb-4 grid size-12 place-items-center rounded-2xl ring-1 ring-inset ${
            done === 'confirmed'
              ? 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25'
              : 'bg-slate-100 text-slate-500 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40'
          }`}
        >
          <Icon name={done === 'confirmed' ? 'check' : 'close'} className="size-6" />
        </span>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{t('respond.thankYou')}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{done === 'confirmed' ? t('respond.doneConfirmed') : t('respond.doneDeclined')}</p>
      </section>,
    );
  }
  if (!preview.data) return null;

  const data = preview.data;
  return frame(
    <section className="card overflow-hidden shadow-xl shadow-slate-900/5 dark:shadow-none">
      <div className="space-y-1 px-6 pt-6 pb-5 sm:px-8">
        <p className="section-label text-brand-600 dark:text-brand-200">{t('respond.eyebrow')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{data.person_first_name ? t('respond.greeting', { name: data.person_first_name }) : t('respond.greetingGeneric')}</h1>
      </div>
      <div className="space-y-4 border-t border-app-border px-6 py-5 sm:px-8">
        <div className="flex items-start gap-4">
          <DateTile value={`${data.service_date.slice(0, 10)}T12:00:00`} />
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900 dark:text-white">{data.plan_title}</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{fmt.calendarDate(data.service_date)}{data.service_time ? ` · ${fmt.time(data.service_time.starts_at)}` : ''}</p>
            {data.location && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                <Icon name="mapPin" className="size-3.5" />
                {data.location}
              </p>
            )}
          </div>
        </div>
        <ul className="surface-inset row-list text-sm">
          {data.assignments.map((assignment, index) => (
            <li key={`${assignment.team_name}-${index}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                {assignment.team_name}{assignment.position_name ? ` — ${assignment.position_name}` : ''}
              </span>
              <span className={`status-${assignment.status} shrink-0 rounded-full px-2 py-0.5 text-xs font-medium`}>
                {t(`common:assignmentStatus.${assignment.status}`)}
              </span>
            </li>
          ))}
        </ul>
        <ErrorNotice error={respond.error} />
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-app-border bg-slate-50/70 px-6 py-4 sm:px-8 dark:bg-slate-950/40">
        <Button size="lg" variant="secondary" icon="close" loading={respond.isPending} onClick={() => respond.mutate('declined')}>{t('common:actions.decline')}</Button>
        <Button size="lg" icon="check" loading={respond.isPending} onClick={() => respond.mutate('confirmed')}>{t('common:actions.confirm')}</Button>
      </div>
    </section>,
  );
};
