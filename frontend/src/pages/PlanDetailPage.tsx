import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ASSIGNMENT_STATUS_LABELS,
  ApiError,
  formatDateTime,
  formatDuration,
  parseDuration,
  PLAN_STATUS_LABELS,
  type AssignmentDetail,
  type PlanItemDetail,
  type SchedulingConflict,
} from '@service-center/shared';
import { api } from '../lib/api';
import { usePlan, usePeople, useTeams, useSongs, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Loading,
  Modal,
  PageHeader,
} from '../components/ui';
import { assignmentTone, planTone } from '../lib/format';

export const PlanDetailPage = () => {
  const { planId } = useParams<{ planId: string }>();
  const { canManage, user } = useAuth();
  const invalidate = useInvalidateOrg();
  const plan = usePlan(planId);

  const [addingItem, setAddingItem] = useState(false);
  const [addingPeople, setAddingPeople] = useState(false);

  const notify = useMutation({
    mutationFn: () => api.notifyPlan(planId!),
    onSuccess: invalidate,
  });

  const publish = useMutation({
    mutationFn: (status: 'draft' | 'published') => api.updatePlan(planId!, { status }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (itemIds: string[]) => api.reorderPlanItems(planId!, itemIds),
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.deletePlanItem(planId!, itemId),
    onSuccess: invalidate,
  });

  const removeAssignment = useMutation({
    mutationFn: (assignmentId: string) => api.deleteAssignment(assignmentId),
    onSuccess: invalidate,
  });

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(id, { status }),
    onSuccess: invalidate,
  });

  const byTeam = useMemo(() => {
    const groups = new Map<string, { name: string; color: string; people: AssignmentDetail[] }>();
    for (const assignment of plan.data?.assignments ?? []) {
      const key = assignment.team?.id ?? 'unassigned';
      const group = groups.get(key) ?? {
        name: assignment.team?.name ?? 'Unassigned',
        color: assignment.team?.color ?? '#94a3b8',
        people: [],
      };
      group.people.push(assignment);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [plan.data]);

  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorNotice error={plan.error} />;
  if (!plan.data) return <EmptyState title="Plan not found" />;

  const detail = plan.data;
  const move = (index: number, direction: -1 | 1) => {
    const ids = detail.items.map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <div>
      <PageHeader
        title={detail.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {formatDateTime(detail.service_date)}
            {detail.location && <span>· {detail.location}</span>}
            <Badge tone={planTone[detail.status]}>{PLAN_STATUS_LABELS[detail.status]}</Badge>
            <span>· {formatDuration(detail.total_length_seconds)} of programmed time</span>
          </span>
        }
        actions={
          canManage && (
            <>
              <Button variant="secondary" loading={notify.isPending} onClick={() => notify.mutate()}>
                Send invites
              </Button>
              <Button
                loading={publish.isPending}
                onClick={() => publish.mutate(detail.status === 'published' ? 'draft' : 'published')}
              >
                {detail.status === 'published' ? 'Unpublish' : 'Publish'}
              </Button>
            </>
          )
        }
      />

      <ErrorNotice error={notify.error ?? publish.error ?? reorder.error ?? respond.error} />
      {notify.isSuccess && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Sent {notify.data.notified} invitation{notify.data.notified === 1 ? '' : 's'}.
        </p>
      )}

      {detail.times.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-2">
          {detail.times.map((time) => (
            <li
              key={time.id}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                time.kind === 'service' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span className="font-medium">{time.name ?? time.kind}</span> ·{' '}
              {formatDateTime(time.starts_at)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---------------------------------------------- order of service -- */}
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Order of service
            </h2>
            {canManage && (
              <Button variant="secondary" onClick={() => setAddingItem(true)}>
                Add item
              </Button>
            )}
          </div>

          {detail.items.length === 0 ? (
            <EmptyState title="Nothing in the order yet" description="Add songs, headers and other items." />
          ) : (
            <ol className="card divide-y divide-slate-100">
              {detail.items.map((item, index) => (
                <PlanItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  canManage={canManage}
                  onMove={move}
                  onRemove={() => removeItem.mutate(item.id)}
                  isFirst={index === 0}
                  isLast={index === detail.items.length - 1}
                />
              ))}
            </ol>
          )}

          {detail.notes && (
            <div className="card mt-4 p-4">
              <h3 className="mb-1 text-sm font-semibold text-slate-700">Plan notes</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{detail.notes}</p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- team ----- */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Team</h2>
            {canManage && (
              <Button variant="secondary" onClick={() => setAddingPeople(true)}>
                Schedule people
              </Button>
            )}
          </div>

          {byTeam.length === 0 ? (
            <EmptyState title="Nobody scheduled yet" />
          ) : (
            <div className="space-y-4">
              {byTeam.map((team) => (
                <div key={team.name} className="card overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: team.color }}
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-semibold">{team.name}</h3>
                    <span className="ml-auto text-xs text-slate-400">
                      {team.people.filter((p) => p.status === 'confirmed').length}/{team.people.length} confirmed
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {team.people.map((assignment) => (
                      <li key={assignment.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar
                          name={assignment.person?.full_name ?? assignment.person?.email}
                          url={assignment.person?.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {assignment.person?.full_name ?? assignment.person?.email ?? 'Unknown'}
                          </p>
                          {assignment.position && (
                            <p className="text-xs text-slate-500">{assignment.position.name}</p>
                          )}
                        </div>

                        {assignment.user_id === user?.profile.id &&
                        assignment.status === 'unconfirmed' ? (
                          <div className="flex gap-1">
                            <Button
                              className="!px-2 !py-1 text-xs"
                              onClick={() => respond.mutate({ id: assignment.id, status: 'confirmed' })}
                            >
                              Accept
                            </Button>
                            <Button
                              variant="secondary"
                              className="!px-2 !py-1 text-xs"
                              onClick={() => respond.mutate({ id: assignment.id, status: 'declined' })}
                            >
                              Decline
                            </Button>
                          </div>
                        ) : (
                          <Badge tone={assignmentTone[assignment.status]}>
                            {ASSIGNMENT_STATUS_LABELS[assignment.status]}
                          </Badge>
                        )}

                        {canManage && (
                          <button
                            aria-label={`Remove ${assignment.person?.full_name ?? 'person'}`}
                            className="text-slate-300 hover:text-rose-500"
                            onClick={() => removeAssignment.mutate(assignment.id)}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {canManage && planId && (
        <>
          <AddItemModal open={addingItem} planId={planId} onClose={() => setAddingItem(false)} />
          <SchedulePeopleModal
            open={addingPeople}
            planId={planId}
            onClose={() => setAddingPeople(false)}
          />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- item row --
const PlanItemRow = ({
  item,
  index,
  canManage,
  onMove,
  onRemove,
  isFirst,
  isLast,
}: {
  item: PlanItemDetail;
  index: number;
  canManage: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) => {
  if (item.item_type === 'header') {
    return (
      <li className="flex items-center gap-2 bg-slate-50 px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.title}</h3>
        {canManage && (
          <div className="ml-auto flex items-center gap-1">
            <MoveButtons index={index} onMove={onMove} isFirst={isFirst} isLast={isLast} />
            <RemoveButton onRemove={onRemove} label={item.title} />
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-slate-400">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.song ? (
            <Link to={`/songs/${item.song.id}`} className="font-medium hover:underline">
              {item.title}
            </Link>
          ) : (
            <span className="font-medium">{item.title}</span>
          )}
          {item.item_type === 'song' && (
            <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              {item.key_override ?? item.arrangement?.song_key ?? item.song?.default_key ?? '—'}
            </Badge>
          )}
          {item.arrangement?.bpm && (
            <span className="text-xs text-slate-400">{item.arrangement.bpm} bpm</span>
          )}
        </div>
        {item.description && <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>}
      </div>
      <span className="shrink-0 text-sm tabular-nums text-slate-400">
        {formatDuration(item.length_seconds)}
      </span>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <MoveButtons index={index} onMove={onMove} isFirst={isFirst} isLast={isLast} />
          <RemoveButton onRemove={onRemove} label={item.title} />
        </div>
      )}
    </li>
  );
};

const MoveButtons = ({
  index,
  onMove,
  isFirst,
  isLast,
}: {
  index: number;
  onMove: (index: number, direction: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) => (
  <>
    <button
      aria-label="Move up"
      disabled={isFirst}
      onClick={() => onMove(index, -1)}
      className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"
    >
      ↑
    </button>
    <button
      aria-label="Move down"
      disabled={isLast}
      onClick={() => onMove(index, 1)}
      className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"
    >
      ↓
    </button>
  </>
);

const RemoveButton = ({ onRemove, label }: { onRemove: () => void; label: string }) => (
  <button
    aria-label={`Remove ${label}`}
    onClick={onRemove}
    className="px-1 text-slate-300 hover:text-rose-500"
  >
    ×
  </button>
);

// ------------------------------------------------------------ add an item --
const AddItemModal = ({
  open,
  planId,
  onClose,
}: {
  open: boolean;
  planId: string;
  onClose: () => void;
}) => {
  const invalidate = useInvalidateOrg();
  const [itemType, setItemType] = useState<'song' | 'header' | 'item'>('song');
  const [songQuery, setSongQuery] = useState('');
  const [songId, setSongId] = useState('');
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');

  const songs = useSongs({ q: songQuery || undefined, per_page: 20 });
  const selectedSong = songs.data?.data.find((song) => song.id === songId);

  const create = useMutation({
    mutationFn: () => {
      const arrangement = selectedSong?.arrangements.find((a) => a.is_default) ?? selectedSong?.arrangements[0];
      return api.addPlanItem(planId, {
        item_type: itemType,
        title: itemType === 'song' ? (selectedSong?.title ?? 'Song') : title,
        song_id: itemType === 'song' ? songId : null,
        arrangement_id: itemType === 'song' ? (arrangement?.id ?? null) : null,
        key_override: itemType === 'song' ? (arrangement?.song_key ?? selectedSong?.default_key ?? null) : null,
        length_seconds:
          parseDuration(length) ??
          (itemType === 'song' ? (arrangement?.length_seconds ?? 0) : 0),
        description: description || null,
      });
    },
    onSuccess: async () => {
      await invalidate();
      setTitle('');
      setLength('');
      setDescription('');
      setSongId('');
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal open={open} title="Add to the order" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-2">
          {(['song', 'item', 'header'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setItemType(value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {itemType === 'song' ? (
          <>
            <div>
              <label className="label" htmlFor="song-search">Find a song</label>
              <input
                id="song-search"
                className="input"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="Search by title"
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {(songs.data?.data ?? []).map((song) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => setSongId(song.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    songId === song.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <span>
                    <span className="font-medium">{song.title}</span>
                    {song.author && <span className="ml-2 text-xs text-slate-400">{song.author}</span>}
                  </span>
                  <span className="text-xs text-slate-400">{song.default_key ?? ''}</span>
                </button>
              ))}
              {songs.data?.data.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-400">No songs match that search.</p>
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="item-title">Title</label>
            <input
              id="item-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={itemType === 'header' ? 'Worship Set' : 'Welcome'}
              required
            />
          </div>
        )}

        {itemType !== 'header' && (
          <>
            <div>
              <label className="label" htmlFor="item-length">Length</label>
              <input
                id="item-length"
                className="input"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="4:30"
              />
            </div>
            <div>
              <label className="label" htmlFor="item-notes">Notes</label>
              <textarea
                id="item-notes"
                className="input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}

        <ErrorNotice error={create.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={itemType === 'song' && !songId}
          >
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ------------------------------------------------------- schedule people ---
const SchedulePeopleModal = ({
  open,
  planId,
  onClose,
}: {
  open: boolean;
  planId: string;
  onClose: () => void;
}) => {
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const people = usePeople();
  const [teamId, setTeamId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<SchedulingConflict[]>([]);

  const team = teams.data?.find((t) => t.id === teamId);

  const schedule = useMutation({
    mutationFn: (ignoreConflicts: boolean) =>
      api.createAssignments(planId, {
        assignments: selected.map((userId) => ({
          user_id: userId,
          team_id: teamId,
          position_id: positionId || null,
        })),
        ignore_conflicts: ignoreConflicts,
        notify: true,
      }),
    onSuccess: async () => {
      await invalidate();
      setSelected([]);
      setConflicts([]);
      onClose();
    },
    onError: (error) => {
      // 409 carries the list of who is unavailable, so the scheduler can
      // decide to override rather than being stuck.
      if (error instanceof ApiError && error.status === 409) {
        setConflicts((error.details as SchedulingConflict[]) ?? []);
      }
    },
  });

  const toggle = (userId: string) =>
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );

  // Members of the chosen team come first — they're who you usually want.
  // Only people with a login can be scheduled (assignments reference a real
  // account), so no-login roster entries are excluded here.
  const candidates = useMemo(() => {
    const all = (people.data ?? []).filter((person) => person.has_login);
    if (!team) return all;
    const onTeam = new Set(team.members.map((m) => m.user_id));
    return [...all].sort((a, b) => Number(onTeam.has(b.id)) - Number(onTeam.has(a.id)));
  }, [people.data, team]);

  return (
    <Modal open={open} title="Schedule people" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="schedule-team">Team</label>
          <select
            id="schedule-team"
            className="input"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setPositionId('');
            }}
          >
            <option value="">Choose a team</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {team && team.positions.length > 0 && (
          <div>
            <label className="label" htmlFor="schedule-position">Position</label>
            <select
              id="schedule-position"
              className="input"
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
            >
              <option value="">No specific position</option>
              {team.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className="label">People</span>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {candidates.map((person) => {
              const onTeam = team?.members.some((m) => m.user_id === person.id);
              return (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(person.id)}
                    onChange={() => toggle(person.id)}
                    className="size-4 rounded border-slate-300"
                  />
                  <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
                  <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
                  {onTeam && <span className="text-xs text-brand-600">on team</span>}
                </label>
              );
            })}
          </div>
        </div>

        {conflicts.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
            <p className="font-medium">Scheduling conflicts</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {conflicts.map((conflict, index) => {
                const person = people.data?.find((p) => p.id === conflict.user_id);
                return (
                  <li key={`${conflict.user_id}-${index}`}>
                    {person?.full_name ?? 'Someone'} —{' '}
                    {conflict.conflict_type === 'blockout' ? 'unavailable' : 'already scheduled'}
                    {conflict.detail ? ` (${conflict.detail})` : ''}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {schedule.error && !(schedule.error instanceof ApiError && schedule.error.status === 409) && (
          <ErrorNotice error={schedule.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={schedule.isPending}
            disabled={!teamId || selected.length === 0}
            onClick={() => schedule.mutate(conflicts.length > 0)}
          >
            {conflicts.length > 0 ? 'Schedule anyway' : `Schedule ${selected.length || ''}`.trim()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
