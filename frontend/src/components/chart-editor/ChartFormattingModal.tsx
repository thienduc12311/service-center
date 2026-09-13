import { useEffect, useState, type ReactNode } from 'react';
import {
  CHART_CHORD_COLORS,
  CHART_FONT_OPTIONS,
  CHART_FONT_SIZES,
  DEFAULT_CHART_CHORD_COLOR,
  DEFAULT_CHART_FONT_SIZE,
  type ChartColumns,
  type ChartFormatting,
} from '@service-center/shared';
import { Button, Modal } from '../ui';

export interface ChartFormattingModalProps {
  open: boolean;
  formatting: ChartFormatting;
  onClose: () => void;
  onSave: (formatting: ChartFormatting) => void;
}

/** The empty option's value. Distinct from '' so a font stack cannot collide. */
const USE_DEFAULT = '__default__';

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
    <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
    {children}
  </div>
);

/**
 * How this chart is set and laid out.
 *
 * Every setting can be left on the template's default rather than pinned to a
 * value, so a chart only carries the choices somebody deliberately made — and
 * a later change to the default reaches the charts that never overrode it.
 */
export const ChartFormattingModal = ({
  open,
  formatting,
  onClose,
  onSave,
}: ChartFormattingModalProps) => {
  const [draft, setDraft] = useState<ChartFormatting>(formatting);

  useEffect(() => {
    if (open) setDraft(formatting);
  }, [open, formatting]);

  const update = <K extends keyof ChartFormatting>(field: K, value: ChartFormatting[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return (
    <Modal open={open} title="Formatting" onClose={onClose}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Text</h3>

          <Row label="Font">
            <select
              className="input"
              aria-label="Chart font"
              value={draft.fontFamily ?? USE_DEFAULT}
              onChange={(event) =>
                update('fontFamily', event.target.value === USE_DEFAULT ? null : event.target.value)
              }
            >
              <option value={USE_DEFAULT}>Default: {CHART_FONT_OPTIONS[0]?.label}</option>
              {CHART_FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Size">
            <select
              className="input"
              aria-label="Chart font size"
              value={draft.fontSize ?? USE_DEFAULT}
              onChange={(event) =>
                update(
                  'fontSize',
                  event.target.value === USE_DEFAULT ? null : Number(event.target.value),
                )
              }
            >
              <option value={USE_DEFAULT}>Default: {DEFAULT_CHART_FONT_SIZE}</option>
              {CHART_FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Chord Color">
            <select
              className="input"
              aria-label="Chord colour"
              value={draft.chordColor ?? USE_DEFAULT}
              onChange={(event) =>
                update('chordColor', event.target.value === USE_DEFAULT ? null : event.target.value)
              }
            >
              <option value={USE_DEFAULT}>
                Default:{' '}
                {CHART_CHORD_COLORS.find((color) => color.value === DEFAULT_CHART_CHORD_COLOR)
                  ?.label ?? 'Black'}
              </option>
              {CHART_CHORD_COLORS.map((color) => (
                <option key={color.value} value={color.value}>
                  {color.label}
                </option>
              ))}
            </select>
          </Row>
        </section>

        <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Layout</h3>

          <Row label="Columns">
            <select
              className="input"
              aria-label="Chart columns"
              value={draft.columns}
              onChange={(event) =>
                update('columns', Number(event.target.value) as ChartColumns)
              }
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </Row>
          <p className="text-xs text-slate-500">
            Two columns fit a long chart onto one page. Sections are never split across a column
            or a page break.
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          Save This Chart
        </Button>
      </div>
    </Modal>
  );
};
