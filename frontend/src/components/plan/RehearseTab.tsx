import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  formatDuration,
  formatFileSize,
  isPlayable,
  type PlanDetail,
  type RehearsalManifestItem,
  type RehearsalMaterial,
  type RehearsalTrack,
} from '@service-center/shared';
import { useRehearsalManifest } from '../../hooks/queries';
import { ChordChart } from '../ChordChart';
import { Badge, Button, ErrorNotice, Loading } from '../ui';
import { fileErrorMessage } from '../files/fileActions';
import { api } from '../../lib/api';
import {
  useRehearsalPlayer,
  type RehearsalPlayerControls,
  type RehearsalPlayerState,
} from '../rehearsal/useRehearsalPlayer';
import { useFormatters } from '../../i18n';

export interface RehearseTabProps {
  plan: PlanDetail;
}

/**
 * F14: the plan as an ordered rehearsal playlist. Everything comes from the
 * rehearsal manifest — the plan order, the F11 chart in the service key and
 * only the file versions this person may read right now — and the player
 * asks for a short-lived link only for the track it is about to play.
 */
export const RehearseTab = ({ plan }: RehearseTabProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const manifest = useRehearsalManifest(plan.id);
  const media = useRef<HTMLVideoElement>(null);
  const [state, controls] = useRehearsalPlayer(manifest.data, media);

  useMediaSession(state, controls, manifest.data?.plan_title ?? plan.title);

  if (manifest.isLoading) return <Loading label={t('rehearse.loading')} />;
  if (manifest.error && !manifest.data) return <ErrorNotice error={manifest.error} />;
  const data = manifest.data;
  if (!data) return null;
  const items = data.items.filter((item) => item.item_type !== 'header' || data.items.length === 1);
  const hasContent = data.items.some((item) => item.item_type === 'song' || item.materials.length > 0);

  return (
    <div className="space-y-4">
      {manifest.error && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          {t('rehearse.refreshFailed', { time: format.time(data.generated_at) })}
        </p>
      )}

      <PlayerBar state={state} controls={controls} media={media} items={data.items} />

      {!hasContent ? (
        <div className="card px-6 py-16 text-center text-sm text-slate-500">
          {t('rehearse.empty')}
        </div>
      ) : (
        <ol className="space-y-4" aria-label={t('rehearse.orderLabel')}>
          {items.map((item) =>
            item.item_type === 'header' ? (
              <li key={item.item_id}>
                <h3 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{item.title}</h3>
              </li>
            ) : (
              <RehearseItem
                key={item.item_id}
                item={item}
                track={state.tracks.find((candidate) => candidate.item_id === item.item_id) ?? null}
                current={state.track?.item_id === item.item_id}
                onPlay={() => {
                  const at = state.tracks.findIndex((candidate) => candidate.item_id === item.item_id);
                  if (at >= 0) controls.select(at, true);
                }}
                onChoose={(fileId) => controls.choose(item.item_id, fileId)}
              />
            ),
          )}
        </ol>
      )}

      {data.plan_materials.length > 0 && (
        <section className="card p-4" aria-label={t('rehearse.planFiles')}>
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{t('rehearse.wholePlan')}</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.plan_materials.map((material) => (
              <MaterialRow key={material.file_id} material={material} />
            ))}
          </ul>
        </section>
      )}
      {data.truncated && (
        <p className="text-xs text-slate-500">{t('rehearse.truncated')}</p>
      )}
    </div>
  );
};

const time = (seconds: number): string => formatDuration(Math.max(0, Math.floor(seconds)));

interface PlayerBarProps {
  state: RehearsalPlayerState;
  controls: RehearsalPlayerControls;
  media: React.RefObject<HTMLVideoElement | null>;
  items: RehearsalManifestItem[];
}

const PlayerBar = ({ state, controls, media, items }: PlayerBarProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { track, status } = state;
  const item = track ? items.find((candidate) => candidate.item_id === track.item_id) : null;
  const isVideo = track?.material.playback === 'video';
  const external = track?.material.playback === 'external' ? track.material : null;
  const chartKey = item?.chart?.key;

  return (
    <section className="card sticky top-2 z-10 space-y-3 p-4" aria-label={t('rehearse.player')}>
      {/* The one media element: it plays every inline track, audio or video. */}
      <video
        ref={media}
        className={isVideo && state.source ? 'max-h-64 w-full rounded bg-black' : 'hidden'}
        playsInline
        preload="metadata"
        {...controls.handlers}
      />
      {state.tracks.length === 0 ? (
        <p className="text-sm text-slate-500">
          {t('rehearse.noTracks')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900 dark:text-white" aria-live="polite">
                {track ? t('rehearse.trackTitle', { number: state.index + 1, title: track.title }) : t('rehearse.chooseTrack')}
              </p>
              {track && (
                <p className="truncate text-xs text-slate-500">
                  {track.material.title}
                  {track.material.version_number ? ` · ${t('rehearse.version', { number: track.material.version_number })}` : ''}
                  {track.material.pinned ? ` ${t('rehearse.pinnedForPlan')}` : ''}
                  {chartKey && track.material.playback === 'audio'
                    ? ` · ${t('rehearse.chartKeyNote', { key: chartKey })}`
                    : ''}
                </p>
              )}
            </div>
            <span className="text-xs tabular-nums text-slate-500">
              {t('rehearse.tracks', { count: state.tracks.length })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={controls.previous} aria-label={t('rehearse.previousTrack')}>
              ⏮
            </Button>
            <Button
              onClick={controls.togglePlay}
              disabled={!state.source || status === 'loading' || Boolean(external)}
              aria-label={status === 'playing' ? t('rehearse.pause') : t('rehearse.play')}
              loading={status === 'loading'}
            >
              {status === 'playing' ? t('rehearse.pause') : t('rehearse.play')}
            </Button>
            <Button variant="secondary" onClick={controls.next} aria-label={t('rehearse.nextTrack')}>
              ⏭
            </Button>
            <Button
              variant="secondary"
              onClick={controls.cycleRepeat}
              aria-pressed={state.repeat !== 'off'}
              aria-label={t(`rehearse.repeat.${state.repeat}`)}
            >
              {t(`rehearse.repeat.${state.repeat}`)}
            </Button>
            {!external && (
              <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-xs tabular-nums text-slate-500">
                <span>{time(state.position)}</span>
                <input
                  type="range"
                  className="flex-1"
                  min={0}
                  max={Math.max(1, Math.floor(state.duration))}
                  step={1}
                  value={Math.floor(state.position)}
                  disabled={!state.duration}
                  aria-label={t('rehearse.seek')}
                  aria-valuetext={t('rehearse.seekValue', { position: time(state.position), duration: time(state.duration) })}
                  onChange={(event) => controls.seek(Number(event.target.value))}
                />
                <span>{time(state.duration)}</span>
              </label>
            )}
          </div>

          {external?.external_url && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
              {t('rehearse.externalTrack', { host: hostname(external.external_url) ?? t('rehearse.anotherSite') })}{' '}
              <a className="font-medium underline" href={external.external_url} target="_blank" rel="noopener noreferrer">
                {t('rehearse.openExternal')}
              </a>
            </p>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-rose-700">
              {state.error}{' '}
              <button type="button" className="underline" onClick={controls.retry}>
                {t('common:actions.retry')}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
};

/** The link's host, or null when it is not a parseable URL. */
const hostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

interface RehearseItemProps {
  item: RehearsalManifestItem;
  track: RehearsalTrack | null;
  current: boolean;
  onPlay: () => void;
  onChoose: (fileId: string) => void;
}

const RehearseItem = ({ item, track, current, onPlay, onChoose }: RehearseItemProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const playable = item.materials.filter(isPlayable);
  const chart = item.chart;
  return (
    <li className={`card overflow-hidden ${current ? 'ring-2 ring-indigo-400' : ''}`} aria-current={current ? 'true' : undefined}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        {item.song ? (
          <Link to={`/songs/${item.song.id}`} className="font-medium hover:underline">
            {item.title}
          </Link>
        ) : (
          <span className="font-medium">{item.title}</span>
        )}
        {chart && (
          <span className="text-sm text-slate-500">
            <span className="sr-only">{t('rehearse.serviceKey')} </span>
            {chart.key ?? '—'}
          </span>
        )}
        {item.arrangement && <span className="text-sm text-slate-500">{item.arrangement.name}</span>}
        {item.tempo_bpm && <span className="text-sm text-slate-400">{t('rehearse.bpm', { bpm: item.tempo_bpm })}</span>}
        {item.media && (
          <Badge tone="bg-sky-50 text-sky-800 ring-sky-600/20">
            {t(item.media.archived ? 'rehearse.mediaArchived' : 'rehearse.media', { title: item.media.title })}
          </Badge>
        )}
        <span className="ml-auto text-sm tabular-nums text-slate-400">{formatDuration(item.length_seconds)}</span>
        {track ? (
          <Button variant={current ? 'primary' : 'secondary'} onClick={onPlay} aria-label={t('rehearse.playItem', { title: item.title })}>
            {track.material.playback === 'external' ? t('common:actions.select') : current ? t('rehearse.restart') : t('rehearse.play')}
          </Button>
        ) : item.item_type === 'song' || item.media ? (
          <span className="text-xs text-slate-400">{t('rehearse.noRecording')}</span>
        ) : null}
      </header>
      {playable.length > 1 && (
        <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
          <label className="flex items-center gap-2">
            {t('rehearse.recording')}
            <select
              className="input w-auto py-1 text-xs"
              value={track?.material.file_id ?? ''}
              onChange={(event) => onChoose(event.target.value)}
            >
              {playable.map((material) => (
                <option key={material.file_id} value={material.file_id}>
                  {t('rehearse.recordingOption', { title: material.title, playback: t(`playback.${material.playback}`) })}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {chart && chart.sequence.length > 0 && (
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
          {t(chart.sequence_from_plan ? 'rehearse.sequenceForPlan' : 'rehearse.sequence', { sequence: chart.sequence.join(' · ') })}
        </p>
      )}
      {chart && (
        <div className="px-4 py-4">
          {chart.status === 'ready' && chart.chordpro ? (
            // Already in the service key: rendered as given, no second transpose.
            <ChordChart chordpro={chart.chordpro} />
          ) : (
            <p role="status" className={`text-sm ${chart.status === 'arrangement_missing' ? 'text-rose-700' : 'text-slate-500'}`}>
              {chart.status === 'arrangement_missing'
                ? t('rehearse.arrangementMissing')
                : chart.status === 'no_chart'
                  ? t('rehearse.noChart')
                  : t('rehearse.keyUnreadable')}
            </p>
          )}
        </div>
      )}
      {item.materials.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 px-4 dark:divide-slate-800 dark:border-slate-800">
          {item.materials.map((material) => (
            <MaterialRow key={material.file_id} material={material} />
          ))}
        </ul>
      )}
    </li>
  );
};

/** One file in the list: open/download per its rights, links clearly external. */
interface MaterialRowProps {
  material: RehearsalMaterial;
}

const MaterialRow = ({ material }: MaterialRowProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const errorRef = useRef<HTMLSpanElement>(null);
  const linkHost = material.external_url ? hostname(material.external_url) : null;
  const open = async (download: boolean) => {
    if (errorRef.current) errorRef.current.textContent = '';
    if (material.kind === 'link' && material.external_url) {
      window.open(material.external_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const tab = window.open('', '_blank');
    try {
      const result = await api.fileDownload(material.file_id, {
        version_id: material.version_id ?? undefined,
        disposition: download ? 'attachment' : 'inline',
      });
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else {
        window.location.assign(result.url);
      }
    } catch (cause) {
      tab?.close();
      if (errorRef.current) errorRef.current.textContent = fileErrorMessage(cause);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
        {material.title}
        <span className="ml-2 text-xs text-slate-400">
          {[
            t(`playback.${material.playback}`),
            ...(material.version_number ? [t('rehearse.version', { number: material.version_number })] : []),
            ...(material.size_bytes ? [formatFileSize(material.size_bytes)] : []),
            ...(material.pinned ? [t('rehearse.pinned')] : []),
            ...(material.newer_version_available ? [t('rehearse.newerVersion')] : []),
          ].join(' · ')}
        </span>
      </span>
      {material.kind === 'link' ? (
        <button type="button" className="text-xs underline" onClick={() => void open(false)}>
          {linkHost ? t('rehearse.openOn', { host: linkHost }) : t('rehearse.openOnWeb')}
        </button>
      ) : material.kind === 'document' ? (
        <span className="text-xs text-slate-400">{t('rehearse.openFromFiles')}</span>
      ) : (
        <>
          <button type="button" className="text-xs underline" onClick={() => void open(false)}>
            {t('common:actions.open')}
          </button>
          {material.rights.download ? (
            <button type="button" className="text-xs underline" onClick={() => void open(true)}>
              {t('common:actions.download')}
            </button>
          ) : (
            <span className="text-xs text-slate-400">{t('rehearse.playOnly')}</span>
          )}
        </>
      )}
      <span ref={errorRef} role="alert" className="w-full text-xs text-rose-700 empty:hidden" />
    </li>
  );
};

/** Browser/OS media keys and lock-screen controls where the browser supports them. */
const useMediaSession = (state: RehearsalPlayerState, controls: RehearsalPlayerControls, album: string) => {
  const latest = useRef(controls);
  latest.current = controls;
  const title = state.track?.title;
  useEffect(() => {
    if (!('mediaSession' in navigator) || !title) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title, album });
    const actions: Array<[MediaSessionAction, () => void]> = [
      ['play', () => latest.current.togglePlay()],
      ['pause', () => latest.current.togglePlay()],
      ['previoustrack', () => latest.current.previous()],
      ['nexttrack', () => latest.current.next()],
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every browser supports every action; the on-page controls remain.
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
      session.metadata = null;
    };
  }, [title, album]);
};
