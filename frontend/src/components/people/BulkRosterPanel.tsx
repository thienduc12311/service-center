import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  type RosterBulkAction,
  type RosterBulkPreview,
  type RosterBulkProblem,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice } from '../ui';

export interface BulkRosterPanelProps {
  /** Selected Person ids. */
  personIds: string[];
  onDone: () => void;
}

const ACTION_LABELS: Record<RosterBulkAction, string> = {
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  add_to_team: 'Add to team',
  remove_from_team: 'Remove from team',
};

const PROBLEM_LABELS: Record<RosterBulkProblem, string> = {
  not_found: 'not found',
  archived: 'archived — restore first',
  not_eligible: 'needs a current eligibility record for this team',
};

const isTagAction = (action: RosterBulkAction): boolean => action === 'add_tag' || action === 'remove_tag';

/**
 * Bulk tag/team change: preview first (who changes, who already matches, who
 * cannot), then apply exactly that preview in one transaction. If the roster
 * moved in between, the server refuses and asks for a fresh preview.
 */
export const BulkRosterPanel = ({ personIds, onDone }: BulkRosterPanelProps) => {
  const { canAnywhere, can } = useAuth();
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const canTags = canAnywhere('people.manage');
  const manageableTeams = (teams.data ?? []).filter((team) =>
    can('teams.manage', { serviceTypeId: team.service_type_id, teamId: team.id }),
  );

  const [action, setAction] = useState<RosterBulkAction>(canTags ? 'add_tag' : 'add_to_team');
  const [tag, setTag] = useState('');
  const [teamId, setTeamId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [preview, setPreview] = useState<RosterBulkPreview | null>(null);
  const [operationKey, setOperationKey] = useState('');

  const team = manageableTeams.find((t) => t.id === teamId);
  const target = isTagAction(action)
    ? { tag }
    : { team_id: teamId, position_id: positionId || null };
  const ready = isTagAction(action) ? tag.trim().length > 0 : Boolean(teamId);

  const runPreview = useMutation({
    mutationFn: () => api.previewRosterBulk({ person_ids: personIds, action, ...target }),
    onSuccess: (result) => {
      setPreview(result);
      // One key per reviewed preview: a retried apply can never double-apply.
      setOperationKey(crypto.randomUUID());
    },
  });

  const apply = useMutation({
    mutationFn: () =>
      api.applyRosterBulk({
        person_ids: personIds,
        action,
        ...target,
        expected_changes: preview?.changes ?? 0,
        idempotency_key: operationKey,
      }),
    onSuccess: async () => {
      await invalidate();
      setPreview(null);
      onDone();
    },
  });

  const resetPreview = () => {
    setPreview(null);
    apply.reset();
  };

  const stale = apply.error instanceof ApiError && apply.error.status === 409;

  return (
    <div className="card mb-4 space-y-3 p-4" aria-live="polite">
      <div className="flex flex-wrap items-end gap-2">
        <p className="w-full text-sm font-medium">
          {personIds.length} selected
        </p>
        <div>
          <label className="label" htmlFor="bulk-action">
            Change
          </label>
          <select
            id="bulk-action"
            className="input"
            value={action}
            onChange={(e) => {
              setAction(e.target.value as RosterBulkAction);
              resetPreview();
            }}
          >
            {(Object.keys(ACTION_LABELS) as RosterBulkAction[])
              .filter((value) => (isTagAction(value) ? canTags : manageableTeams.length > 0))
              .map((value) => (
                <option key={value} value={value}>
                  {ACTION_LABELS[value]}
                </option>
              ))}
          </select>
        </div>
        {isTagAction(action) ? (
          <div>
            <label className="label" htmlFor="bulk-tag">
              Tag
            </label>
            <input
              id="bulk-tag"
              className="input"
              maxLength={60}
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                resetPreview();
              }}
            />
          </div>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="bulk-team">
                Team
              </label>
              <select
                id="bulk-team"
                className="input"
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setPositionId('');
                  resetPreview();
                }}
              >
                <option value="">Choose a team</option>
                {manageableTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {team && team.positions.length > 0 && (
              <div>
                <label className="label" htmlFor="bulk-position">
                  Position
                </label>
                <select
                  id="bulk-position"
                  className="input"
                  value={positionId}
                  onChange={(e) => {
                    setPositionId(e.target.value);
                    resetPreview();
                  }}
                >
                  <option value="">{action === 'add_to_team' ? 'No specific position' : 'Any position'}</option>
                  {team.positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
        <Button variant="secondary" disabled={!ready} loading={runPreview.isPending} onClick={() => runPreview.mutate()}>
          Preview
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Clear selection
        </Button>
      </div>

      {runPreview.error && <ErrorNotice error={runPreview.error} />}

      {preview && (
        <div className="space-y-2">
          <p className="text-sm">
            <strong>{preview.changes}</strong> will change · {preview.unchanged} already match
            {preview.errors > 0 && (
              <>
                {' '}
                · <strong className="text-app-danger">{preview.errors} can’t be changed</strong>
              </>
            )}
          </p>
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
            {preview.rows.map((row) => (
              <li key={row.person_id} className="flex justify-between gap-3 px-3 py-1.5">
                <span>{row.display_name ?? 'Unknown person'}</span>
                <span
                  className={
                    row.outcome === 'error'
                      ? 'text-app-danger'
                      : row.outcome === 'change'
                        ? 'text-brand-600'
                        : 'text-slate-500'
                  }
                >
                  {row.outcome === 'error' && row.problem
                    ? PROBLEM_LABELS[row.problem]
                    : row.outcome === 'change'
                      ? 'will change'
                      : 'no change'}
                </span>
              </li>
            ))}
          </ul>
          {stale ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              The roster changed since this preview. Preview again before applying.
            </p>
          ) : (
            apply.error && <ErrorNotice error={apply.error} />
          )}
          <div className="flex justify-end gap-2">
            <Button
              disabled={preview.errors > 0 || preview.changes === 0 || stale}
              loading={apply.isPending}
              onClick={() => apply.mutate()}
            >
              Apply to {preview.changes}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
