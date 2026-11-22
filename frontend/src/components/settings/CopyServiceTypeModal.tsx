import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  planRecurrenceSchema,
  type CopyServiceTypeRequest,
  type PlanRecurrence,
  type ServiceTypeRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useFolderTree, useInvalidateOrg, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Notice, Spinner } from '../ui';
import { flattenFolders } from './folders';

export interface CopyServiceTypeModalProps {
  source: ServiceTypeRow;
  onClose: () => void;
  onCopied?: (copy: ServiceTypeRow) => void;
}

/** The copy form's fields. */
interface CopyServiceTypeForm {
  name: string;
  description: string;
  recurrence: PlanRecurrence;
  /** '' = no folder. */
  folderId: string;
  /** null until the source's serving teams have loaded. */
  teamIds: string[] | null;
}

const RECURRENCES: readonly PlanRecurrence[] = planRecurrenceSchema.options;

/**
 * Copies a service type's settings and which teams serve it. People, access
 * grants, plans, templates and default files are not copied. Choosing another
 * folder places the copy under that folder's permissions, so only
 * administrators may (the server enforces it too).
 */
export const CopyServiceTypeModal = ({ source, onClose, onCopied }: CopyServiceTypeModalProps) => {
  const { t } = useTranslation(['settings', 'teams', 'common']);
  const { isAdmin, organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const tree = useFolderTree();
  const servingTeams = useQuery({
    queryKey: [...keys.serviceTypes(organizationId), source.id, 'teams'],
    queryFn: () => api.serviceTypeTeams(source.id),
  });
  const [form, setForm] = useState<CopyServiceTypeForm>({
    name: t('serviceTypes.copy.defaultName', { name: source.name }),
    description: source.description ?? '',
    recurrence: source.recurrence,
    folderId: source.folder_id ?? '',
    teamIds: null,
  });
  // Tick the source's teams once they arrive (unless the form was already filled).
  useEffect(() => {
    if (servingTeams.data) setForm((current) => (current.teamIds ? current : { ...current, teamIds: servingTeams.data }));
  }, [servingTeams.data]);

  const folders = flattenFolders(tree.data?.folders ?? []);
  const sourceFolder = folders.find(({ node }) => node.id === source.folder_id)?.node.name ?? null;
  const name = form.name.trim();

  // Set synchronously on submit: `copy.isPending` only changes after a re-render, so a
  // double click would otherwise send a second copy (the API has no idempotency key here).
  const sending = useRef(false);
  const copy = useMutation({
    mutationFn: () => {
      const body: CopyServiceTypeRequest = {
        name,
        description: form.description.trim() || null,
        recurrence: form.recurrence,
        folder_id: form.folderId || null,
        team_ids: form.teamIds ?? [],
      };
      return api.copyServiceType(source.id, body);
    },
    onSuccess: async (created) => {
      await invalidate();
      onCopied?.(created);
      onClose();
    },
    // A failed copy may be sent again; a successful one closes the dialog.
    onError: () => {
      sending.current = false;
    },
  });

  const toggleTeam = (teamId: string, on: boolean) =>
    setForm((current) => {
      const chosen = new Set(current.teamIds ?? []);
      if (on) chosen.add(teamId);
      else chosen.delete(teamId);
      return { ...current, teamIds: [...chosen] };
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name || form.teamIds === null || sending.current) return;
    sending.current = true;
    copy.mutate();
  };

  const denied = copy.error instanceof ApiError && (copy.error.status === 403 || copy.error.status === 404);

  return (
    <Modal open title={t('serviceTypes.copy.title', { name: source.name })} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label className="label" htmlFor="copy-st-name">{t('serviceTypes.copy.name')}</label>
          <input
            id="copy-st-name"
            className="input"
            maxLength={120}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
          {!name && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t('serviceTypes.copy.nameRequired')}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="copy-st-recurrence">{t('serviceTypes.copy.recurrence')}</label>
            <select
              id="copy-st-recurrence"
              className="input"
              value={form.recurrence}
              onChange={(event) => setForm({ ...form, recurrence: event.target.value as PlanRecurrence })}
            >
              {RECURRENCES.map((recurrence) => (
                <option key={recurrence} value={recurrence}>
                  {t(`teams:nameStep.recurrence.${recurrence}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="copy-st-folder">{t('serviceTypes.copy.folder')}</label>
            {isAdmin ? (
              <select
                id="copy-st-folder"
                className="input"
                value={form.folderId}
                onChange={(event) => setForm({ ...form, folderId: event.target.value })}
              >
                <option value="">{t('folders.noFolder')}</option>
                {folders.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {'— '.repeat(depth)}
                    {node.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input id="copy-st-folder" className="input" readOnly value={sourceFolder ?? t('folders.noFolder')} />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('serviceTypes.copy.folderAdminOnly')}</p>
              </>
            )}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="copy-st-description">{t('serviceTypes.copy.description')}</label>
          <textarea
            id="copy-st-description"
            className="input"
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>

        <fieldset>
          <legend className="label">{t('serviceTypes.copy.teams')}</legend>
          {teams.isLoading || servingTeams.isLoading ? (
            <Spinner />
          ) : (teams.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">{t('serviceTypes.copy.noTeams')}</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(teams.data ?? []).map((team) => (
                <label key={team.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300 dark:border-slate-700"
                    checked={(form.teamIds ?? []).includes(team.id)}
                    onChange={(event) => toggleTeam(team.id, event.target.checked)}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('serviceTypes.copy.teamsHint')}</p>
        </fieldset>

        <Notice tone="info">{t('serviceTypes.copy.notCopied')}</Notice>

        {denied ? (
          <Notice tone="warning">{t('serviceTypes.copy.denied')}</Notice>
        ) : (
          <ErrorNotice error={copy.error ?? servingTeams.error ?? teams.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={copy.isPending} disabled={!name || form.teamIds === null}>
            {t('serviceTypes.copy.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
