import { describe, expect, it } from 'vitest';
import type { StageObject, StageRosterPerson } from '../types/media.js';
import { refreshStageObjects, stageLayoutIssues } from './stage-layouts.js';
import { createStageTemplateSchema, stageObjectSchema, updatePlanStageLayoutSchema } from '../schemas/media.js';

const person = (id: string, label: string, x: number): StageObject => ({
  id: `o-${id}`, kind: 'person', x, y: 0.5, w: 0.1, h: 0.1, rotation: 15, label, color: null, person_id: id,
});
const drums: StageObject = { id: 'drums', kind: 'gear', x: 0.5, y: 0.2, w: 0.2, h: 0.15, rotation: 0, label: 'Drums', color: '#334455' };
const objects = [drums, person('sam', 'Sam', 0.2), person('riley', 'Riley', 0.4), person('morgan', 'Morgan', 0.6)];
const roster: StageRosterPerson[] = [
  { person_id: 'sam', name: 'Sam Rivera', roles: ['Band: Bass'], prepared: false, archived: false },
  { person_id: 'riley', name: 'Riley', roles: ['Band: Drums'], prepared: false, archived: true },
  { person_id: 'alex', name: 'Alex', roles: ['Band: Keys'], prepared: true, archived: false },
];

describe('stageLayoutIssues', () => {
  it('flags renamed, departed, unscheduled and unplaced people', () => {
    expect(stageLayoutIssues(objects, roster)).toEqual([
      { kind: 'renamed', person_id: 'sam', object_id: 'o-sam', name: 'Sam Rivera' },
      { kind: 'departed', person_id: 'riley', object_id: 'o-riley', name: 'Riley' },
      { kind: 'not_scheduled', person_id: 'morgan', object_id: 'o-morgan', name: 'Morgan' },
      { kind: 'unplaced', person_id: 'alex', object_id: null, name: 'Alex' },
    ]);
  });
});

describe('refreshStageObjects', () => {
  let n = 0;
  const newId = () => `new-${++n}`;

  it('keeps every matched position and only updates labels when asked to keep others', () => {
    const kept = refreshStageObjects(objects, roster, { removeUnscheduled: false, addUnplaced: false }, newId);
    expect(kept).toHaveLength(4);
    expect(kept.find((o) => o.id === 'o-sam')).toEqual({ ...objects[1], label: 'Sam Rivera' });
    expect(kept.find((o) => o.id === 'drums')).toBe(drums);
  });

  it('removes departed/unscheduled people and places missing ones without moving anyone', () => {
    const next = refreshStageObjects(objects, roster, { removeUnscheduled: true, addUnplaced: true }, newId);
    expect(next.map((o) => o.person_id ?? o.id)).toEqual(['drums', 'sam', 'alex']);
    expect(next[1]).toMatchObject({ x: 0.2, y: 0.5, rotation: 15 });
    expect(next[2]).toMatchObject({ kind: 'person', label: 'Alex', y: 0.9 });
  });
});

describe('stage schemas', () => {
  it('refuses people on templates and a person without a Person id', () => {
    expect(createStageTemplateSchema.safeParse({ name: 'Main', objects: [person('11111111-1111-4111-8111-111111111111', 'x', 0.5)] }).success).toBe(false);
    expect(stageObjectSchema.safeParse({ ...drums, kind: 'person' }).success).toBe(false);
    expect(stageObjectSchema.safeParse({ ...drums, x: 1.2 }).success).toBe(false);
    expect(updatePlanStageLayoutSchema.safeParse({ expected_revision: 1, objects: [drums, drums] }).success).toBe(false);
  });
});
