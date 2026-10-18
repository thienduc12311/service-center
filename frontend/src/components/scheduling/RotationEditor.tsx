import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatDateTime,
  type RotationPreviewEntry,
  type TeamRotation,
  type TeamRotationException,
  type TeamRotationSlot,
  type TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useRotations } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, ErrorNotice, Loading } from '../ui';

export interface RotationMember {
  person_id: string;
  position_id: string;
  name: string;
}

export interface RotationsPanelProps {
  team: TeamWithPositions;
  members: RotationMember[];
}

interface RotationDraft {
  id: string | null;
  revision: number;
  name: string;
  cycle_weeks: number;
  anchor_date: string;
  substitute_policy: 'vacancy' | 'fairness';
  slots: TeamRotationSlot[];
  exceptions: TeamRotationException[];
}

const today = (): string => new Date().toISOString().slice(0, 10);
const blankDraft = (): RotationDraft => ({
  id: null, revision: 0, name: '', cycle_weeks: 2, anchor_date: today(), substitute_policy: 'vacancy', slots: [], exceptions: [],
});
const toDraft = (rotation: TeamRotation): RotationDraft => ({
  id: rotation.id, revision: rotation.revision, name: rotation.name, cycle_weeks: rotation.cycle_weeks,
  anchor_date: rotation.anchor_date, substitute_policy: rotation.substitute_policy,
  slots: rotation.slots, exceptions: rotation.exceptions,
});

const ISSUE_LABEL: Record<NonNullable<RotationPreviewEntry['issue']>, string> = {
  not_position_member: 'no longer on this position',
  blockout: 'unavailable (blockout)',
  overlapping_commitment: 'another commitment',
};

/** Versioned team rotations: pattern by week × position, exceptions by local date, preview on real plans. */
export const RotationsPanel = ({ team, members }: RotationsPanelProps) => {
  const { organizationId } = useAuth();
  const client = useQueryClient();
  const rotations = useRotations(team.id);
  const [draft, setDraft] = useState<RotationDraft | null>(null);
  const [preview, setPreview] = useState<RotationPreviewEntry[] | null>(null);
  const [exceptionDate, setExceptionDate] = useState('');
  useEffect(() => { setDraft(null); setPreview(null); }, [team.id]);

  const refresh = () => client.invalidateQueries({ queryKey: keys.rotations(organizationId, team.id) });
  const save = useMutation({
    mutationFn: (value: RotationDraft) => {
      const body = { name: value.name, cycle_weeks: value.cycle_weeks, anchor_date: value.anchor_date,
        substitute_policy: value.substitute_policy, slots: value.slots, exceptions: value.exceptions };
      return value.id ? api.updateRotation(value.id, { ...body, expected_revision: value.revision })
        : api.createRotation({ ...body, team_id: team.id });
    },
    onSuccess: async (saved) => { setDraft(toDraft(saved)); await refresh(); },
  });
  const archive = useMutation({
    mutationFn: (value: RotationDraft) => api.archiveRotation(value.id!, value.revision),
    onSuccess: async () => { setDraft(null); setPreview(null); await refresh(); },
  });
  const loadPreview = useMutation({
    mutationFn: (id: string) => api.previewRotation(id, {
      from: new Date().toISOString(), to: new Date(Date.now() + 84 * 86_400_000).toISOString(),
    }),
    onSuccess: setPreview,
  });

  const membersFor = (positionId: string) => members.filter((member) => member.position_id === positionId);
  const slotPerson = (week: number, positionId: string) =>
    draft?.slots.find((slot) => slot.week_index === week && slot.position_id === positionId)?.person_id ?? '';
  const setSlot = (week: number, positionId: string, personId: string) => setDraft((current) => current && ({
    ...current,
    slots: [...current.slots.filter((slot) => !(slot.week_index === week && slot.position_id === positionId)),
      ...(personId ? [{ week_index: week, position_id: positionId, person_id: personId }] : [])],
  }));
  const setException = (localDate: string, positionId: string, personId: string | null | undefined) => setDraft((current) => current && ({
    ...current,
    exceptions: [...current.exceptions.filter((item) => !(item.local_date === localDate && item.position_id === positionId)),
      ...(personId === undefined ? [] : [{ local_date: localDate, position_id: positionId, person_id: personId, note: null }])],
  }));
  const exceptionDates = [...new Set(draft?.exceptions.map((item) => item.local_date) ?? [])].sort();
  const nameOf = (personId: string | null) => members.find((member) => member.person_id === personId)?.name ?? 'Former member';

  return (
    <section className="card space-y-4 p-4" aria-label={`Rotations for ${team.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">{team.name} rotations</h3>
        {(rotations.data ?? []).map((rotation) => (
          <Button key={rotation.id} variant={draft?.id === rotation.id ? 'primary' : 'secondary'}
            onClick={() => { setDraft(toDraft(rotation)); setPreview(null); }}>{rotation.name}</Button>
        ))}
        <Button variant="secondary" onClick={() => { setDraft(blankDraft()); setPreview(null); }}>New rotation</Button>
      </div>
      {rotations.isLoading && <Loading />}
      <ErrorNotice error={rotations.error ?? save.error ?? archive.error ?? loadPreview.error} />
      {!draft && !rotations.isLoading && (
        <p className="text-sm text-slate-500">
          A rotation suggests who serves each local week. It never overrides membership, blockouts or conflicts — those weeks are left open or filled fairly, as you choose.
        </p>
      )}
      {draft && (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(draft); }}>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm">Name<input className="input mt-1" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="text-sm">Cycle (weeks)
              <select className="input mt-1" value={draft.cycle_weeks} onChange={(e) => {
                const cycle = Number(e.target.value);
                setDraft({ ...draft, cycle_weeks: cycle, slots: draft.slots.filter((slot) => slot.week_index < cycle) });
              }}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </label>
            <label className="text-sm">Week 1 starts on (local date)<input className="input mt-1" type="date" required value={draft.anchor_date} onChange={(e) => setDraft({ ...draft, anchor_date: e.target.value })} /></label>
            <label className="text-sm">When the named person can’t serve
              <select className="input mt-1" value={draft.substitute_policy} onChange={(e) => setDraft({ ...draft, substitute_policy: e.target.value as RotationDraft['substitute_policy'] })}>
                <option value="vacancy">Leave the position open</option>
                <option value="fairness">Suggest a fair substitute</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="p-2 text-left">Position</th>{Array.from({ length: draft.cycle_weeks }, (_, week) => <th key={week} className="p-2 text-left">Week {week + 1}</th>)}</tr></thead>
              <tbody>
                {team.positions.map((position) => (
                  <tr key={position.id} className="border-t">
                    <th className="p-2 text-left font-normal">{position.name}</th>
                    {Array.from({ length: draft.cycle_weeks }, (_, week) => (
                      <td key={week} className="p-1">
                        <select aria-label={`${position.name}, week ${week + 1}`} className="input" value={slotPerson(week, position.id)}
                          onChange={(e) => setSlot(week, position.id, e.target.value)}>
                          <option value="">—</option>
                          {membersFor(position.id).map((member) => <option key={member.person_id} value={member.person_id}>{member.name}</option>)}
                          {slotPerson(week, position.id) && !membersFor(position.id).some((member) => member.person_id === slotPerson(week, position.id))
                            && <option value={slotPerson(week, position.id)}>{nameOf(slotPerson(week, position.id))} (not on this position)</option>}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Exceptions (by local date)</p>
            {exceptionDates.map((localDate) => (
              <div key={localDate} className="flex flex-wrap items-end gap-2 text-sm">
                <span className="w-28 pb-2">{localDate}</span>
                {team.positions.map((position) => {
                  const current = draft.exceptions.find((item) => item.local_date === localDate && item.position_id === position.id);
                  const value = current === undefined ? '__pattern' : current.person_id ?? '__skip';
                  return (
                    <label key={position.id} className="text-xs">{position.name}
                      <select className="input mt-1" value={value} onChange={(e) => setException(localDate, position.id,
                        e.target.value === '__pattern' ? undefined : e.target.value === '__skip' ? null : e.target.value)}>
                        <option value="__pattern">Use pattern</option>
                        <option value="__skip">Skip (fair choice)</option>
                        {membersFor(position.id).map((member) => <option key={member.person_id} value={member.person_id}>{member.name}</option>)}
                      </select>
                    </label>
                  );
                })}
                <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((item) => item.local_date !== localDate) })}>Remove</Button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <label className="text-sm">Add exception date<input className="input mt-1" type="date" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} /></label>
              <Button type="button" variant="secondary" disabled={!exceptionDate || !team.positions.length} onClick={() => {
                const first = team.positions[0];
                if (first) setException(exceptionDate, first.id, null);
                setExceptionDate('');
              }}>Add</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending} disabled={!draft.name.trim()}>{draft.id ? 'Save new version' : 'Create rotation'}</Button>
            {draft.id && <Button type="button" variant="secondary" loading={loadPreview.isPending} onClick={() => loadPreview.mutate(draft.id!)}>Preview next 12 weeks</Button>}
            {draft.id && <Button type="button" variant="secondary" loading={archive.isPending} onClick={() => archive.mutate(draft)}>Archive</Button>}
            {draft.id && <span className="self-center text-xs text-slate-500">Version {draft.revision}</span>}
          </div>
        </form>
      )}
      {preview && (
        <div>
          <p className="mb-2 text-sm font-medium">Mapping onto planned services</p>
          {!preview.length ? <p className="text-sm text-slate-500">No upcoming plans need these positions.</p> : (
            <ul className="space-y-1 text-sm">
              {preview.map((entry) => (
                <li key={`${entry.plan_id}:${entry.position_id}:${entry.person_id ?? 'none'}`}>
                  {entry.local_date} · {entry.plan_title} · {team.positions.find((p) => p.id === entry.position_id)?.name ?? 'Position'} (week {entry.week_index + 1}):{' '}
                  <span className="font-medium">{entry.person_name ?? (entry.source === 'skipped' ? 'skipped — fair choice' : 'nobody named')}</span>
                  {entry.source === 'exception' && <> <Badge tone="bg-sky-50 text-sky-700 ring-sky-600/20">exception</Badge></>}
                  {entry.issue && <span className="ml-1 text-amber-700">⚠ {ISSUE_LABEL[entry.issue]}</span>}
                  <span className="ml-1 text-xs text-slate-400">{formatDateTime(entry.service_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

/** Position members for the editor, from the team payload (`GET /teams`). */
export const rotationMembers = (team: TeamWithPositions): RotationMember[] =>
  team.members.flatMap((member) => (member.position_id
    ? [{ person_id: member.person_id, position_id: member.position_id, name: member.profile?.full_name ?? 'Unnamed person' }]
    : []));
