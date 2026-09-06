import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { formatDateTime } from '@service-center/shared';
import { api } from '../lib/api';
import { Button, ErrorNotice, Loading } from '../components/ui';

export const RespondAssignmentPage = () => {
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

  if (!token) return <main className="mx-auto max-w-lg p-6"><ErrorNotice error={new Error('This response link is missing its token.')} /></main>;
  if (preview.isLoading) return <main className="mx-auto max-w-lg p-6"><Loading label="Loading assignment…" /></main>;
  if (preview.error) return <main className="mx-auto max-w-lg p-6"><ErrorNotice error={preview.error} /></main>;
  if (done) return <main className="mx-auto max-w-lg p-6"><section className="card p-6"><h1 className="text-xl font-semibold">Thank you</h1><p className="mt-2 text-slate-600">Your assignments are {done}.</p></section></main>;
  if (!preview.data) return null;

  return (
    <main className="mx-auto max-w-lg p-6">
      <section className="card space-y-5 p-6">
        <div><p className="text-sm text-slate-500">Assignment notification</p><h1 className="text-2xl font-semibold">Hi {preview.data.person_first_name}</h1></div>
        <div><h2 className="font-semibold">{preview.data.plan_title}</h2><p className="text-sm text-slate-600">{formatDateTime(preview.data.service_date)}{preview.data.service_time ? ` · ${formatDateTime(preview.data.service_time.starts_at)}` : ''}{preview.data.location ? ` · ${preview.data.location}` : ''}</p></div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{preview.data.assignments.map((assignment, index) => <li key={`${assignment.team_name}-${index}`}>{assignment.team_name}{assignment.position_name ? ` — ${assignment.position_name}` : ''} ({assignment.status})</li>)}</ul>
        <ErrorNotice error={respond.error} />
        <div className="flex gap-3"><Button loading={respond.isPending} onClick={() => respond.mutate('confirmed')}>Confirm</Button><Button variant="secondary" loading={respond.isPending} onClick={() => respond.mutate('declined')}>Decline</Button></div>
      </section>
    </main>
  );
};
