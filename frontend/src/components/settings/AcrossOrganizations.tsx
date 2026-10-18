import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, formatDateTime, type CopyAvailabilityResult, type ScheduleSettingsInput } from '@service-center/shared';
import { api } from '../../lib/api';
import { useBlockouts, useCombinedSchedule, useScheduleSettings } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../ui';

const OUTCOME_LABELS: Record<CopyAvailabilityResult['results'][number]['outcome'], string> = {
  copied: 'Copied',
  already_copied: 'Already copied',
  not_member: 'Not a member there',
  failed: 'Could not copy',
};

/**
 * F03 Pass D (optional, opt-in). Your own schedules side by side, each read
 * with that organization's own permissions, plus explicit copying of your
 * blockouts. Sharing busy times shows other schedulers only that you are
 * busy — never what, where, or for which organization.
 */
export const AcrossOrganizations = () => {
  const { user, organizationId } = useAuth();
  const queryClient = useQueryClient();
  const settings = useScheduleSettings();
  const others = (user?.memberships ?? []).filter((m) => m.organization.id !== organizationId);
  const window = useMemo(() => {
    const from = new Date();
    return { from: from.toISOString(), to: addDays(from, 30).toISOString() };
  }, []);
  const combined = useCombinedSchedule(window, Boolean(settings.data?.combined_schedule));
  const blockouts = useBlockouts({ scope: 'mine' });
  const [selectedBlockouts, setSelectedBlockouts] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [includeReason, setIncludeReason] = useState(false);

  const update = useMutation({
    mutationFn: (body: ScheduleSettingsInput) => api.updateScheduleSettings(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', user?.profile.id ?? null] }),
  });
  const copy = useMutation({
    mutationFn: () => api.copyAvailability({
      blockout_ids: selectedBlockouts, target_organization_ids: targets,
      include_reason: includeReason, idempotency_key: crypto.randomUUID(),
    }),
  });

  if (others.length === 0) return null;
  const current: ScheduleSettingsInput = {
    combined_schedule: settings.data?.combined_schedule ?? false,
    share_busy_across_orgs: settings.data?.share_busy_across_orgs ?? false,
  };
  const nameOf = (id: string) => user?.memberships.find((m) => m.organization.id === id)?.organization.name ?? 'Organization';
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="mb-1 font-semibold">Across my organizations</h2>
        <p className="text-sm text-slate-500">You belong to {others.length + 1} organizations. These options are off unless you turn them on.</p>
      </div>
      {settings.isLoading ? <Loading /> : (
        <div className="space-y-1 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={current.combined_schedule} disabled={update.isPending}
              onChange={(e) => update.mutate({ ...current, combined_schedule: e.target.checked })} />
            Show my schedules from every organization together (only I see this)
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={current.share_busy_across_orgs} disabled={update.isPending}
              onChange={(e) => update.mutate({ ...current, share_busy_across_orgs: e.target.checked })} />
            Warn schedulers in my other organizations when I’m busy (they see only “busy”, no details)
          </label>
        </div>
      )}

      {current.combined_schedule && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Next 30 days</h3>
          {combined.isLoading ? <Loading /> : combined.data?.organizations.map((org) => (
            <div key={org.organization_id} className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{org.organization_name}</p>
              {org.status === 'error' ? (
                <p className="text-sm text-rose-600">Couldn’t load this organization: {org.error}</p>
              ) : org.items.length ? (
                <ul className="text-sm">
                  {org.items.map((item) => (
                    <li key={`${item.kind}-${item.item_id}-${item.starts_at}`} className="py-0.5">
                      {formatDateTime(item.starts_at)} — {item.kind === 'blockout' ? `Unavailable${item.title !== 'Unavailable' ? ` (${item.title})` : ''}` : item.title}
                      {item.status === 'unconfirmed' ? ' · awaiting your answer' : ''}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-400">Nothing scheduled.</p>}
            </div>
          ))}
          <ErrorNotice error={combined.error} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Copy blockout dates to another organization</h3>
        {(blockouts.data ?? []).filter((b) => !b.series_id).length === 0 ? (
          <p className="text-sm text-slate-400">Add a one-off blockout above first.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-1">
              {(blockouts.data ?? []).filter((b) => !b.series_id).map((b) => (
                <label key={b.id} className="flex min-h-11 items-center gap-2 px-2">
                  <input type="checkbox" checked={selectedBlockouts.includes(b.id)} onChange={() => setSelectedBlockouts(toggle(selectedBlockouts, b.id))} />
                  {b.local_start_date ?? formatDateTime(b.starts_at)}{b.all_day ? ' · all day' : ''}{b.reason ? ` — ${b.reason}` : ''}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {others.map((m) => (
                <label key={m.organization.id} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={targets.includes(m.organization.id)} onChange={() => setTargets(toggle(targets, m.organization.id))} />
                  {m.organization.name}
                </label>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={includeReason} onChange={(e) => setIncludeReason(e.target.checked)} />
              Include my reasons (their schedulers can read them)
            </label>
            <Button variant="secondary" loading={copy.isPending} disabled={!selectedBlockouts.length || !targets.length} onClick={() => copy.mutate()}>Copy</Button>
            {copy.data && (
              <ul className="text-xs text-slate-600">
                {copy.data.results.map((result) => (
                  <li key={result.organization_id}>{nameOf(result.organization_id)}: {OUTCOME_LABELS[result.outcome]}{result.copied ? ` (${result.copied})` : ''}{result.error ? ` — ${result.error}` : ''}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <ErrorNotice error={settings.error ?? update.error ?? copy.error} />
    </section>
  );
};
