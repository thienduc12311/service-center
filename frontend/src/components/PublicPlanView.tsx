import { useTranslation } from 'react-i18next';
import { formatDuration, type PublicPlanProjection } from '@service-center/shared';
import { useFormatters } from '../i18n';

export interface PublicPlanViewProps {
  projection: PublicPlanProjection;
}

/** Renders only what the public projection contains (the editor preview uses the same component). */
export const PublicPlanView = ({ projection }: PublicPlanViewProps) => {
  const { t } = useTranslation('auth');
  const fmt = useFormatters();
  return (
  <article className="space-y-4">
    <header>
      <p className="text-xs uppercase tracking-wide text-slate-500">{projection.organization}</p>
      {projection.title && <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{projection.title}</h1>}
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {[projection.service_type, projection.date ? fmt.calendarDate(projection.date, 'long') : null, projection.location].filter(Boolean).join(' · ')}
      </p>
    </header>
    {projection.times && projection.times.length > 0 && (
      <ul className="text-sm">
        {projection.times.map((time) => (
          <li key={time.starts_at}>
            {time.name ? `${time.name}: ` : ''}
            {fmt.dateTime(time.starts_at, { timeZone: projection.timezone, dateStyle: 'short' })}
          </li>
        ))}
      </ul>
    )}
    {projection.items ? (
      <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {projection.items.map((item, index) =>
          item.kind === 'header' ? (
            <li key={index} className="pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{item.title}</li>
          ) : (
            <li key={index} className="flex justify-between gap-3 py-2">
              <span>
                {item.song?.title ?? item.title}
                {item.song?.author && <span className="text-slate-500"> — {item.song.author}</span>}
                {item.song?.key && <span className="ml-2 text-xs text-slate-500">{t('publicPlan.songKey', { key: item.song.key })}</span>}
              </span>
              {item.length_seconds !== undefined && <span className="tabular-nums text-slate-500">{formatDuration(item.length_seconds)}</span>}
            </li>
          ),
        )}
      </ol>
    ) : (
      projection.songs && (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {projection.songs.map((song, index) => (
            <li key={index}>
              {song.title}
              {song.author && <span className="text-slate-500"> — {song.author}</span>}
              {song.key && <span className="ml-2 text-xs text-slate-500">{t('publicPlan.songKey', { key: song.key })}</span>}
            </li>
          ))}
        </ol>
      )
    )}
  </article>
  );
};
