import { useTranslation } from 'react-i18next';
import { formatDuration, type SongWithArrangements } from '@service-center/shared';
import { Badge, Button, EmptyState, SectionHeader } from '../ui';
import { Icon } from '../icons';
import { SONG_VOCABULARY_LABEL_KEYS } from './types';

export interface AllArrangementsPanelProps {
  song: SongWithArrangements;
  canManage: boolean;
  onSelect: (arrangementId: string) => void;
  onAdd: () => void;
}

/** One labelled value of the song information block. */
interface DetailProps {
  label: string;
  value: string | null;
}

/** One line of the copyright block, shown only when the song carries it. */
const Detail = ({ label, value }: DetailProps) =>
  value ? (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  ) : null;

/**
 * The song-level overview: what the library knows about the song, and every
 * arrangement of it side by side.
 */
export const AllArrangementsPanel = ({
  song,
  canManage,
  onSelect,
  onAdd,
}: AllArrangementsPanelProps) => {
  const { t } = useTranslation('songs');
  /** Caption for a stored style/speed value; unknown values show as stored. */
  const vocabularyLabel = (value: string | null): string | null => {
    if (!value) return value;
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key) : value;
  };
  return (
  <div className="space-y-6">
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
        {t('songInfo.title')}
      </h2>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t('songInfo.fields.authors')} value={song.author} />
        <Detail label={t('songInfo.fields.ccli')} value={song.ccli_number} />
        <Detail label={t('songInfo.fields.copyright')} value={song.copyright} />
        <Detail label={t('songInfo.fields.administration')} value={song.administration} />
        <Detail label={t('songInfo.fields.defaultKey')} value={song.default_key} />
        <Detail label={t('arrangement.fields.bpm')} value={song.default_bpm === null ? null : String(song.default_bpm)} />
        <Detail label={t('arrangement.fields.meter')} value={song.meter} />
        <Detail label={t('addSong.fields.style')} value={vocabularyLabel(song.style)} />
        <Detail label={t('addSong.fields.speed')} value={vocabularyLabel(song.speed)} />
      </dl>
    </section>

    <section>
      <SectionHeader
        title={t('allArrangements.heading', { count: song.arrangements.length })}
        action={
          canManage ? (
            <Button variant="secondary" size="sm" icon="plus" onClick={onAdd}>
              {t('allArrangements.add')}
            </Button>
          ) : undefined
        }
      />

      {song.arrangements.length === 0 ? (
        <EmptyState
          icon="music"
          title={t('allArrangements.empty')}
          description={t('allArrangements.emptyDescription')}
          action={
            canManage ? (
              <Button variant="secondary" icon="plus" onClick={onAdd}>
                {t('allArrangements.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {song.arrangements.map((arrangement) => (
            <li key={arrangement.id}>
              <button
                type="button"
                onClick={() => onSelect(arrangement.id)}
                className="card card-interactive group flex h-full w-full gap-3 p-4 text-left"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 font-mono text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
                  {arrangement.song_key ?? <Icon name="music" className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
                    {arrangement.name}
                  </span>
                  {arrangement.is_default && (
                    <Badge tone="bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/30">{t('arrangement.defaultBadge')}</Badge>
                  )}
                </span>

                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  {[
                    arrangement.song_key ?? t('arrangement.noKey'),
                    arrangement.capo === null ? null : t('arrangement.capoValue', { capo: arrangement.capo }),
                    arrangement.bpm === null ? null : t('arrangement.bpmValue', { bpm: arrangement.bpm }),
                    arrangement.meter,
                    arrangement.length_seconds === null
                      ? null
                      : formatDuration(arrangement.length_seconds),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>

                <span className="mt-2 block truncate text-xs text-slate-400">
                  {arrangement.sequence.length > 0
                    ? arrangement.sequence.join(', ')
                    : arrangement.chord_chart
                      ? t('allArrangements.chartAdded')
                      : t('allArrangements.noChart')}
                </span>
                </span>
                <Icon name="chevronRight" className="mt-3 size-4 shrink-0 text-slate-300 transition group-hover:text-brand-500 dark:text-slate-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
  );
};
