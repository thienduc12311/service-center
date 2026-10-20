/**
 * F11: a printable running order — planned times for one service time, keys
 * and sequences from the shared chart resolver, leaders resolved from the
 * plan's staffing, and only the note categories the printer chose from the
 * notes they are allowed to read.
 */

import type { PlanNote, NoteCategoryRow } from '../types/collaboration.js';
import type { PlanDetail } from '../types/domain.js';
import type { PlanSchedule } from '../types/plan-order.js';
import { escapeHtml } from './chart-html.js';
import { resolvePlanItemChartContext } from './chart-context.js';
import { formatDuration } from './dates.js';
import { computePlanSchedule, resolveItemLeader, selectServiceTime } from './plan-order.js';
import type { ItemLeader } from '../types/plan-order.js';
import { translatorFor, type FixedTranslator } from '../i18n/engine.js';
import { formatLocaleFor, type SupportedLocale } from '../i18n/locales.js';

export interface RunSheetRow {
  itemId: string;
  kind: 'header' | 'song' | 'item';
  segment: 'pre' | 'service' | 'post';
  /** Local clock time ("10:05"), or null without a service time. */
  start: string | null;
  durationSeconds: number;
  title: string;
  key: string | null;
  arrangementName: string | null;
  sequence: readonly string[];
  description: string | null;
  leader: string | null;
  /** Selected-category notes on this item, as "Category: body". */
  notes: string[];
}

export interface RunSheetDocument {
  /** Language of every application-owned label; authored content is unchanged. */
  locale: SupportedLocale;
  title: string;
  subtitle: string;
  timeZone: string;
  serviceTimeLabel: string | null;
  plannedFinish: string | null;
  totals: { pre: number; service: number; post: number };
  /** Warnings the printer should see, in words. */
  warnings: string[];
  rows: RunSheetRow[];
  /** Plan-level notes in the selected categories. */
  planNotes: string[];
}

export interface RunSheetInput {
  plan: PlanDetail;
  organizationName: string;
  /** The organization's IANA zone: times print as the congregation reads them. */
  timeZone: string;
  timeId?: string | null;
  /** Notes the reader can see (the notes API already enforces audience). */
  notes: readonly PlanNote[];
  categories: readonly NoteCategoryRow[];
  /** Category ids to print; `null` prints notes without a category. */
  selectedCategoryIds: ReadonlyArray<string | null>;
  includeLeaders: boolean;
  /** Position names from teams, for unfilled leader positions. */
  positionNames?: ReadonlyMap<string, string>;
  /** Language for labels, warnings and clock formatting; defaults to English. */
  locale?: SupportedLocale;
}

type PlansTranslator = FixedTranslator<'plans'>;

/** A resolved leader in words, in the printer's language. Names stay as authored. */
export const itemLeaderText = (leader: ItemLeader, t: PlansTranslator): string | null => {
  switch (leader.kind) {
    case 'none':
      return null;
    case 'person':
      return leader.name ?? t('runSheet.leader.someoneOnRoster');
    case 'position': {
      const position = leader.position_name ?? t('runSheet.leader.position');
      if (leader.holders.length === 0) return t('runSheet.leader.unfilled', { position });
      const names = leader.holders.map((holder) => {
        const name = holder.name ?? t('runSheet.leader.someone');
        return holder.prepared ? t('runSheet.leader.notYetAsked', { name }) : name;
      });
      return t('runSheet.leader.holders', { position, names: names.join(', ') });
    }
  }
};

/** Clock times always in the organization's zone; only the presentation follows the language. */
const clock = (instant: string, timeZone: string, locale: SupportedLocale): string =>
  new Intl.DateTimeFormat(formatLocaleFor(locale), { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

export const runSheetDocumentFromPlan = (input: RunSheetInput): { document: RunSheetDocument; schedule: PlanSchedule } => {
  const { plan, timeZone } = input;
  const locale = input.locale ?? 'en';
  const t = translatorFor(locale, 'plans');
  const time = selectServiceTime(plan.times, input.timeId) ?? null;
  const schedule = computePlanSchedule({ items: plan.items, time });
  const timing = new Map(schedule.items.map((row) => [row.item_id, row]));
  const selected = new Set(input.selectedCategoryIds);
  const categoryName = new Map(input.categories.map((category) => [category.id, category.name]));
  const noteLine = (note: PlanNote): string =>
    t('runSheet.noteLine', {
      category: (note.category_id ? categoryName.get(note.category_id) : undefined) ?? t('runSheet.note'),
      body: note.body,
    });
  const printable = input.notes.filter((note) => selected.has(note.category_id));

  const rows: RunSheetRow[] = plan.items.map((item) => {
    const context = resolvePlanItemChartContext(item);
    const ready = context.status === 'ready' ? context : null;
    const slot = timing.get(item.id);
    const leader = input.includeLeaders
      ? itemLeaderText(resolveItemLeader({ item, assignments: plan.assignments, positionNames: input.positionNames }), t)
      : null;
    return {
      itemId: item.id,
      kind: item.item_type,
      segment: item.service_segment ?? 'service',
      start: slot && item.item_type !== 'header' ? clock(slot.starts_at, timeZone, locale) : null,
      durationSeconds: item.item_type === 'header' ? 0 : item.length_seconds,
      title: item.title,
      key: ready?.displayKey ?? null,
      arrangementName: ready?.arrangement?.name ?? null,
      sequence: ready?.sequence ?? [],
      description: item.description,
      leader,
      notes: printable.filter((note) => note.plan_item_id === item.id).map(noteLine),
    };
  });

  const warnings = schedule.warnings.map((warning) => {
    switch (warning.code) {
      case 'runs_over':
        return t('runSheet.warnings.runsOver', { duration: formatDuration(warning.seconds ?? 0) });
      case 'no_service_time':
        return t('runSheet.warnings.noServiceTime');
      case 'segment_out_of_order': {
        const title = plan.items.find((item) => item.id === warning.item_id)?.title ?? t('runSheet.anItem');
        return t('runSheet.warnings.segmentOutOfOrder', { title });
      }
    }
  });

  return {
    schedule,
    document: {
      locale,
      title: plan.title,
      subtitle: [input.organizationName, plan.location].filter(Boolean).join(' · '),
      timeZone,
      serviceTimeLabel: time
        ? t('runSheet.serviceTimeLabel', {
            name: time.name ?? t('runSheet.serviceFallback'),
            when: new Intl.DateTimeFormat(formatLocaleFor(locale), { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(time.starts_at)),
          })
        : null,
      plannedFinish: schedule.planned_finish_at ? clock(schedule.planned_finish_at, timeZone, locale) : null,
      totals: { pre: schedule.pre_seconds, service: schedule.service_seconds, post: schedule.post_seconds },
      warnings,
      rows,
      planNotes: printable.filter((note) => !note.plan_item_id).map(noteLine),
    },
  };
};

const renderRow = (row: RunSheetRow, t: PlansTranslator): string => {
  if (row.kind === 'header') {
    return `<tr class="header"><td></td><td></td><th colspan="2" scope="row">${escapeHtml(row.title)}</th></tr>`;
  }
  const details = [
    row.key ? escapeHtml(t('runSheet.key', { key: row.key })) : '',
    row.arrangementName ? escapeHtml(row.arrangementName) : '',
    row.sequence.length ? escapeHtml(row.sequence.join(' · ')) : '',
  ].filter(Boolean).join(' — ');
  const notes = row.notes.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join('');
  return `<tr>
      <td class="time">${escapeHtml(row.start ?? '')}</td>
      <td class="len">${escapeHtml(formatDuration(row.durationSeconds))}</td>
      <td><div class="title">${escapeHtml(row.title)}</div>${details ? `<div class="meta">${details}</div>` : ''}${row.description ? `<div class="desc">${escapeHtml(row.description)}</div>` : ''}${notes}</td>
      <td class="leader">${escapeHtml(row.leader ?? '')}</td>
    </tr>`;
};

export const renderRunSheetHtml = (doc: RunSheetDocument): string => {
  const t = translatorFor(doc.locale, 'plans');
  const segments = (['pre', 'service', 'post'] as const)
    .map((segment) => {
      const rows = doc.rows.filter((row) => row.segment === segment);
      if (!rows.length) return '';
      return `<tbody><tr class="segment"><th colspan="4" scope="rowgroup">${escapeHtml(t(`runSheet.segment.${segment}`))} · ${escapeHtml(formatDuration(doc.totals[segment]))}</th></tr>${rows.map((row) => renderRow(row, t)).join('')}</tbody>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${doc.locale}"><head><meta charset="utf-8"><title>${escapeHtml(t('runSheet.documentTitle', { title: doc.title }))}</title>
<style>
  @page { size: letter portrait; margin: 0.5in; }
  body { font: 11pt/1.35 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0; } .sub { color: #555; margin: 2pt 0 8pt; }
  .warn { border: 1px solid #b45309; color: #92400e; padding: 4pt 6pt; margin: 4pt 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #ddd; }
  thead th { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  tr.segment th { background: #f1f5f9; font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; }
  tr.header th { font-weight: 700; font-size: 10pt; text-transform: uppercase; }
  .time, .len { white-space: nowrap; font-variant-numeric: tabular-nums; width: 1%; }
  .title { font-weight: 600; } .meta, .desc { color: #444; font-size: 10pt; }
  .note { font-size: 9.5pt; color: #333; border-left: 2px solid #94a3b8; padding-left: 4pt; margin-top: 2pt; white-space: pre-wrap; }
  .leader { width: 22%; font-size: 10pt; }
  tr { break-inside: avoid; }
</style></head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="sub">${escapeHtml([doc.subtitle, doc.serviceTimeLabel].filter(Boolean).join(' · '))}${doc.plannedFinish ? ` · ${escapeHtml(t('runSheet.plannedFinish', { time: doc.plannedFinish }))}` : ''} · ${escapeHtml(t('runSheet.timesIn', { zone: doc.timeZone }))}</p>
  ${doc.warnings.map((warning) => `<p class="warn">${escapeHtml(warning)}</p>`).join('')}
  ${doc.planNotes.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join('')}
  <table>
    <thead><tr><th scope="col">${escapeHtml(t('runSheet.columns.start'))}</th><th scope="col">${escapeHtml(t('runSheet.columns.length'))}</th><th scope="col">${escapeHtml(t('runSheet.columns.item'))}</th><th scope="col">${escapeHtml(t('runSheet.columns.leader'))}</th></tr></thead>
    ${segments}
  </table>
</body></html>`;
};
