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
  <article className="space-y-5">
    <header>
      <p className="section-label text-brand-600 dark:text-brand-200">{projection.organization}</p>
      {projection.title && <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] dark:text-white">{projection.title}</h1>}
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
        {[projection.service_type, projection.date ? fmt.calendarDate(projection.date, 'long') : null, projection.location].filter(Boolean).join(' · ')}
      </p>
    </header>
    {projection.times && projection.times.length > 0 && (
      <ul className="flex flex-wrap gap-2 text-sm">
        {projection.times.map((time) => (
          <li key={time.starts_at} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {time.name ? `${time.name}: ` : ''}
            {fmt.dateTime(time.starts_at, { timeZone: projection.timezone, dateStyle: 'short' })}
          </li>
        ))}
      </ul>
    )}
    {projection.items ? (
      <ol className="card divide-y divide-slate-100 overflow-hidden text-sm dark:divide-slate-800">
        {projection.items.map((item, index) =>
          item.kind === 'header' ? (
            <li key={index} className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">{item.title}</li>
          ) : (
            <li key={index} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 text-slate-800 dark:text-slate-100">
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
        <ol className="card list-inside list-decimal divide-y divide-slate-100 overflow-hidden text-sm marker:text-slate-400 dark:divide-slate-800">
          {projection.songs.map((song, index) => (
            <li key={index} className="px-4 py-2.5 text-slate-800 dark:text-slate-100">
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
