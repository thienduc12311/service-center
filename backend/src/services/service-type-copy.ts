import type { CopyServiceTypeInput, ServiceTypeRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export interface CopyServiceTypeContext {
  db: Db;
  orgId: string;
  sourceId: string;
  input: CopyServiceTypeInput;
}

/** The arguments `copy_service_type_as` takes, with every omitted field resolved from the source. */
export interface ResolvedServiceTypeCopy {
  name: string;
  description: string | null;
  recurrence: ServiceTypeRow['recurrence'];
  folderId: string | null;
  teamIds: string[];
}

/**
 * Fills what the request left out from the source: its description,
 * frequency and folder, and — unless `team_ids` names them — either all of
 * its teams (`include_teams`) or none.
 */
export const resolveServiceTypeCopy = (
  source: Pick<ServiceTypeRow, 'description' | 'recurrence' | 'folder_id'>,
  sourceTeamIds: readonly string[],
  input: CopyServiceTypeInput,
): ResolvedServiceTypeCopy => ({
  name: input.name,
  description: input.description === undefined ? source.description : input.description,
  recurrence: input.recurrence ?? source.recurrence,
  folderId: input.folder_id === undefined ? source.folder_id : input.folder_id,
  teamIds: input.team_ids ?? (input.include_teams ? [...sourceTeamIds] : []),
});

/**
 * Copies a service type's settings and the teams that serve it in one
 * transaction (`copy_service_type_as`). People, access grants, plans,
 * templates and default files are never copied.
 */
export const copyServiceType = async ({ db, orgId, sourceId, input }: CopyServiceTypeContext): Promise<ServiceTypeRow> => {
  const source = await unwrap(
    db
      .from('service_types')
      .select('id, description, recurrence, folder_id')
      .eq('id', sourceId)
      .eq('organization_id', orgId)
      .maybeSingle(),
  );
  if (!source) throw HttpError.notFound('Service type not found');

  const sourceTeamIds =
    input.team_ids === undefined && input.include_teams
      ? ((await unwrap(
          db.from('service_type_teams').select('team_id').eq('service_type_id', source.id).eq('organization_id', orgId),
        )) ?? []).map((row) => row.team_id)
      : [];
  const copy = resolveServiceTypeCopy(source, sourceTeamIds, input);

  const id = await unwrap(
    db.rpc('copy_service_type_as', {
      p_service_type: source.id,
      p_name: copy.name,
      p_description: copy.description,
      p_recurrence: copy.recurrence,
      p_folder: copy.folderId,
      p_team_ids: copy.teamIds,
    }),
  );
  if (!id) throw HttpError.notFound('Service type not found');
  return unwrapOne(db.from('service_types').select('*').eq('id', id).single());
};
