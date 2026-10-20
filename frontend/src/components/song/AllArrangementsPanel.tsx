import { useTranslation } from 'react-i18next';
import { formatDuration, type SongWithArrangements } from '@service-center/shared';
import { Badge, Button, EmptyState } from '../ui';
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
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700 dark:text-slate-300">{value}</dd>
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
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t('songInfo.title')}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('allArrangements.heading', { count: song.arrangements.length })}
        </h2>
        {canManage && (
          <Button variant="secondary" className="!py-1 text-xs" onClick={onAdd}>
            {t('allArrangements.add')}
          </Button>
        )}
      </div>

      {song.arrangements.length === 0 ? (
        <EmptyState
          title={t('allArrangements.empty')}
          description={t('allArrangements.emptyDescription')}
          action={
            canManage ? (
              <Button variant="secondary" onClick={onAdd}>
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
                className="card w-full p-4 text-left transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
                    {arrangement.name}
                  </span>
                  {arrangement.is_default && (
                    <Badge tone="bg-brand-50 text-brand-700 ring-brand-600/20">{t('arrangement.defaultBadge')}</Badge>
                  )}
                </div>

                <p className="mt-1 text-xs text-slate-500">
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
                </p>

                <p className="mt-2 truncate text-xs text-slate-400">
                  {arrangement.sequence.length > 0
                    ? arrangement.sequence.join(', ')
                    : arrangement.chord_chart
                      ? t('allArrangements.chartAdded')
                      : t('allArrangements.noChart')}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
  );
};
