import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHART_CHORD_COLORS,
  CHART_FONT_OPTIONS,
  CHART_FONT_SIZES,
  DEFAULT_CHART_CHORD_COLOR,
  DEFAULT_CHART_FONT_SIZE,
  type ChartColumns,
  type ChartFormatting,
  type ChartStyleOption,
  type TranslationKey,
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

/**
 * Catalog keys for the CHART_CHORD_COLORS names, by stored hex value. Font
 * labels are typeface names and are shown as written.
 */
const CHORD_COLOR_LABEL_KEYS: Readonly<Record<string, TranslationKey<'songs'>>> = {
  '#000000': 'formatting.colors.black',
  '#1d4ed8': 'formatting.colors.blue',
  '#b91c1c': 'formatting.colors.red',
  '#15803d': 'formatting.colors.green',
  '#525252': 'formatting.colors.grey',
};

/** One labelled setting in the dialog. */
interface RowProps {
  label: string;
  children: ReactNode;
}

const Row = ({ label, children }: RowProps) => (
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
  const { t } = useTranslation(['songs', 'common']);
  const colorLabel = (color: ChartStyleOption): string => {
    const key = CHORD_COLOR_LABEL_KEYS[color.value];
    return key ? t(key) : color.label;
  };
  const defaultColor = CHART_CHORD_COLORS.find((color) => color.value === DEFAULT_CHART_CHORD_COLOR);
  const [draft, setDraft] = useState<ChartFormatting>(formatting);

  useEffect(() => {
    if (open) setDraft(formatting);
  }, [open, formatting]);

  const update = <K extends keyof ChartFormatting>(field: K, value: ChartFormatting[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  return (
    <Modal open={open} title={t('chartEditor.formatting')} onClose={onClose}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('formatting.text')}</h3>

          <Row label={t('formatting.font')}>
            <select
              className="input"
              aria-label={t('formatting.fontLabel')}
              value={draft.fontFamily ?? USE_DEFAULT}
              onChange={(event) =>
                update('fontFamily', event.target.value === USE_DEFAULT ? null : event.target.value)
              }
            >
              <option value={USE_DEFAULT}>{t('formatting.default', { value: CHART_FONT_OPTIONS[0]?.label ?? '' })}</option>
              {CHART_FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label={t('formatting.size')}>
            <select
              className="input"
              aria-label={t('formatting.sizeLabel')}
              value={draft.fontSize ?? USE_DEFAULT}
              onChange={(event) =>
                update(
                  'fontSize',
                  event.target.value === USE_DEFAULT ? null : Number(event.target.value),
                )
              }
            >
              <option value={USE_DEFAULT}>{t('formatting.default', { value: DEFAULT_CHART_FONT_SIZE })}</option>
              {CHART_FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </Row>

          <Row label={t('formatting.chordColor')}>
            <select
              className="input"
              aria-label={t('formatting.chordColorLabel')}
              value={draft.chordColor ?? USE_DEFAULT}
              onChange={(event) =>
                update('chordColor', event.target.value === USE_DEFAULT ? null : event.target.value)
              }
            >
              <option value={USE_DEFAULT}>
                {t('formatting.default', {
                  value: defaultColor ? colorLabel(defaultColor) : t('formatting.colors.black'),
                })}
              </option>
              {CHART_CHORD_COLORS.map((color) => (
                <option key={color.value} value={color.value}>
                  {colorLabel(color)}
                </option>
              ))}
            </select>
          </Row>
        </section>

        <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('formatting.layout')}</h3>

          <Row label={t('formatting.columns')}>
            <select
              className="input"
              aria-label={t('formatting.columnsLabel')}
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
            {t('formatting.columnsHelp')}
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <Button variant="secondary" onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          {t('formatting.save')}
        </Button>
      </div>
    </Modal>
  );
};
