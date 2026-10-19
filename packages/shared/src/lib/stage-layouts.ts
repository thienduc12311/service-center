/**
 * F14 Pass B: stage layout rules shared by the API and clients. A saved
 * layout is a snapshot: staffing changes are reported as issues and only a
 * deliberate refresh changes what was placed.
 */
import type {
  StageBackground,
  StageLayoutIssue,
  StageObject,
  StageRosterPerson,
} from '../types/media.js';

export const STAGE_BACKGROUND_LABELS: Record<StageBackground, string> = {
  blank: 'Blank',
  stage: 'Proscenium stage',
  thrust: 'Thrust stage',
  round: 'In the round',
};

export const STAGE_MAX_OBJECTS = 200;

/** Every person object compared with the plan's current staffing. */
export const stageLayoutIssues = (
  objects: readonly StageObject[],
  roster: readonly StageRosterPerson[],
  archivedPersonIds: ReadonlySet<string> = new Set(),
): StageLayoutIssue[] => {
  const byPerson = new Map(roster.map((person) => [person.person_id, person]));
  const issues: StageLayoutIssue[] = [];
  const placed = new Set<string>();
  for (const object of objects) {
    if (object.kind !== 'person' || !object.person_id) continue;
    placed.add(object.person_id);
    const current = byPerson.get(object.person_id);
    if (archivedPersonIds.has(object.person_id) || current?.archived) {
      issues.push({ kind: 'departed', person_id: object.person_id, object_id: object.id, name: current?.name ?? object.label });
    } else if (!current) {
      issues.push({ kind: 'not_scheduled', person_id: object.person_id, object_id: object.id, name: object.label });
    } else if (current.name !== object.label) {
      issues.push({ kind: 'renamed', person_id: object.person_id, object_id: object.id, name: current.name });
    }
  }
  for (const person of roster) {
    if (!placed.has(person.person_id) && !person.archived) {
      issues.push({ kind: 'unplaced', person_id: person.person_id, object_id: null, name: person.name });
    }
  }
  return issues;
};

export interface StageRefreshOptions {
  /** Remove people who are no longer scheduled or have left the roster. */
  removeUnscheduled: boolean;
  /** Place scheduled people who are missing, in a row along the front edge. */
  addUnplaced: boolean;
}

/**
 * A deliberate refresh. Matched people keep their exact position, size and
 * rotation (only their label follows a name change); nobody is rearranged.
 * Returns a new list; the caller saves it with the layout's revision.
 */
export const refreshStageObjects = (
  objects: readonly StageObject[],
  roster: readonly StageRosterPerson[],
  options: StageRefreshOptions,
  newId: () => string,
): StageObject[] => {
  const byPerson = new Map(roster.filter((person) => !person.archived).map((person) => [person.person_id, person]));
  const kept: StageObject[] = [];
  const placed = new Set<string>();
  for (const object of objects) {
    if (object.kind !== 'person' || !object.person_id) {
      kept.push(object);
      continue;
    }
    const current = byPerson.get(object.person_id);
    if (!current) {
      if (!options.removeUnscheduled) kept.push(object);
      continue;
    }
    placed.add(object.person_id);
    kept.push(current.name === object.label ? object : { ...object, label: current.name });
  }
  if (options.addUnplaced) {
    const missing = [...byPerson.values()].filter((person) => !placed.has(person.person_id));
    missing.forEach((person, index) => {
      const columns = Math.min(missing.length, 8);
      kept.push({
        id: newId(),
        kind: 'person',
        x: (index % columns + 0.5) / columns,
        y: Math.min(0.95, 0.9 - Math.floor(index / columns) * 0.08),
        w: 0.08,
        h: 0.06,
        rotation: 0,
        label: person.name,
        color: null,
        person_id: person.person_id,
      });
    });
  }
  return kept.slice(0, STAGE_MAX_OBJECTS);
};

export const STAGE_ISSUE_LABELS: Record<StageLayoutIssue['kind'], string> = {
  not_scheduled: 'No longer scheduled on this plan',
  departed: 'Left the roster',
  renamed: 'Name changed since placed',
  unplaced: 'Scheduled but not placed',
};
