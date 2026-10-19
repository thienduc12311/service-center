import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  REHEARSAL_PLAYBACK_LABELS,
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
  const manifest = useRehearsalManifest(plan.id);
  const media = useRef<HTMLVideoElement>(null);
  const [state, controls] = useRehearsalPlayer(manifest.data, media);

  useMediaSession(state, controls, manifest.data?.plan_title ?? plan.title);

  if (manifest.isLoading) return <Loading label="Loading rehearsal…" />;
  if (manifest.error && !manifest.data) return <ErrorNotice error={manifest.error} />;
  const data = manifest.data;
  if (!data) return null;
  const items = data.items.filter((item) => item.item_type !== 'header' || data.items.length === 1);
  const hasContent = data.items.some((item) => item.item_type === 'song' || item.materials.length > 0);

  return (
    <div className="space-y-4">
      {manifest.error && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          Could not refresh the rehearsal list — showing what was loaded at{' '}
          {new Date(data.generated_at).toLocaleTimeString()}. Access is rechecked whenever a recording is played.
        </p>
      )}

      <PlayerBar state={state} controls={controls} media={media} items={data.items} />

      {!hasContent ? (
        <div className="card px-6 py-16 text-center text-sm text-slate-500">
          Nothing to rehearse yet. Add songs, or attach recordings and charts on the Files tab.
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Rehearsal order">
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
        <section className="card p-4" aria-label="Plan files">
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">For the whole plan</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.plan_materials.map((material) => (
              <MaterialRow key={material.file_id} material={material} />
            ))}
          </ul>
        </section>
      )}
      {data.truncated && (
        <p className="text-xs text-slate-500">This plan is long; only the first items are shown for rehearsal.</p>
      )}
    </div>
  );
};

const time = (seconds: number): string => formatDuration(Math.max(0, Math.floor(seconds)));

const REPEAT_LABEL: Record<RehearsalPlayerState['repeat'], string> = {
  off: 'Repeat: off',
  all: 'Repeat: all',
  one: 'Repeat: this track',
};

const PlayerBar = ({
  state,
  controls,
  media,
  items,
}: {
  state: RehearsalPlayerState;
  controls: RehearsalPlayerControls;
  media: React.RefObject<HTMLVideoElement | null>;
  items: RehearsalManifestItem[];
}) => {
  const { track, status } = state;
  const item = track ? items.find((candidate) => candidate.item_id === track.item_id) : null;
  const isVideo = track?.material.playback === 'video';
  const external = track?.material.playback === 'external' ? track.material : null;
  const chartKey = item?.chart?.key;

  return (
    <section className="card sticky top-2 z-10 space-y-3 p-4" aria-label="Rehearsal player">
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
          No recordings you can play on this plan. Charts and files below are still available.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900 dark:text-white" aria-live="polite">
                {track ? `${state.index + 1}. ${track.title}` : 'Choose a track'}
              </p>
              {track && (
                <p className="truncate text-xs text-slate-500">
                  {track.material.title}
                  {track.material.version_number ? ` · v${track.material.version_number}` : ''}
                  {track.material.pinned ? ' (pinned for this plan)' : ''}
                  {chartKey && track.material.playback === 'audio'
                    ? ` · Chart in ${chartKey}; the recording plays as recorded (its key is not changed)`
                    : ''}
                </p>
              )}
            </div>
            <span className="text-xs tabular-nums text-slate-500">
              {state.tracks.length} track{state.tracks.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={controls.previous} aria-label="Previous track">
              ⏮
            </Button>
            <Button
              onClick={controls.togglePlay}
              disabled={!state.source || status === 'loading' || Boolean(external)}
              aria-label={status === 'playing' ? 'Pause' : 'Play'}
              loading={status === 'loading'}
            >
              {status === 'playing' ? 'Pause' : 'Play'}
            </Button>
            <Button variant="secondary" onClick={controls.next} aria-label="Next track">
              ⏭
            </Button>
            <Button
              variant="secondary"
              onClick={controls.cycleRepeat}
              aria-pressed={state.repeat !== 'off'}
              aria-label={REPEAT_LABEL[state.repeat]}
            >
              {REPEAT_LABEL[state.repeat]}
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
                  aria-label="Seek"
                  aria-valuetext={`${time(state.position)} of ${time(state.duration)}`}
                  onChange={(event) => controls.seek(Number(event.target.value))}
                />
                <span>{time(state.duration)}</span>
              </label>
            )}
          </div>

          {external?.external_url && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
              This track is a link to {hostname(external.external_url)}. It plays in that site's own player, in a new tab —
              Service Center does not import, host or license it.{' '}
              <a className="font-medium underline" href={external.external_url} target="_blank" rel="noopener noreferrer">
                Open external player
              </a>
            </p>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-rose-700">
              {state.error}{' '}
              <button type="button" className="underline" onClick={controls.retry}>
                Try again
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
};

const hostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'another site';
  }
};

const RehearseItem = ({
  item,
  track,
  current,
  onPlay,
  onChoose,
}: {
  item: RehearsalManifestItem;
  track: RehearsalTrack | null;
  current: boolean;
  onPlay: () => void;
  onChoose: (fileId: string) => void;
}) => {
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
            <span className="sr-only">Service key </span>
            {chart.key ?? '—'}
          </span>
        )}
        {item.arrangement && <span className="text-sm text-slate-500">{item.arrangement.name}</span>}
        {item.tempo_bpm && <span className="text-sm text-slate-400">{item.tempo_bpm} bpm</span>}
        {item.media && (
          <Badge tone="bg-sky-50 text-sky-800 ring-sky-600/20">
            Media: {item.media.title}
            {item.media.archived ? ' (archived)' : ''}
          </Badge>
        )}
        <span className="ml-auto text-sm tabular-nums text-slate-400">{formatDuration(item.length_seconds)}</span>
        {track ? (
          <Button variant={current ? 'primary' : 'secondary'} onClick={onPlay} aria-label={`Play ${item.title}`}>
            {track.material.playback === 'external' ? 'Select' : current ? 'Restart' : 'Play'}
          </Button>
        ) : item.item_type === 'song' || item.media ? (
          <span className="text-xs text-slate-400">No recording</span>
        ) : null}
      </header>
      {playable.length > 1 && (
        <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
          <label>
            Recording:{' '}
            <select
              className="rounded border-slate-200 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
              value={track?.material.file_id ?? ''}
              onChange={(event) => onChoose(event.target.value)}
            >
              {playable.map((material) => (
                <option key={material.file_id} value={material.file_id}>
                  {material.title} ({REHEARSAL_PLAYBACK_LABELS[material.playback]})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {chart && chart.sequence.length > 0 && (
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
          Sequence{chart.sequence_from_plan ? ' for this plan' : ''}: {chart.sequence.join(' · ')}
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
                ? 'The arrangement chosen for this item is no longer available. Edit the item to choose another.'
                : chart.status === 'no_chart'
                  ? 'No chord chart on this arrangement yet.'
                  : "This chart's written key is missing or unreadable, so it can't be shown in the service key. Set the arrangement's key in the song library."}
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
const MaterialRow = ({ material }: { material: RehearsalMaterial }) => {
  const errorRef = useRef<HTMLSpanElement>(null);
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
          {REHEARSAL_PLAYBACK_LABELS[material.playback]}
          {material.version_number ? ` · v${material.version_number}` : ''}
          {material.size_bytes ? ` · ${formatFileSize(material.size_bytes)}` : ''}
          {material.pinned ? ' · pinned' : ''}
          {material.newer_version_available ? ' · newer version exists' : ''}
        </span>
      </span>
      {material.kind === 'link' ? (
        <button type="button" className="text-xs underline" onClick={() => void open(false)}>
          Open on {material.external_url ? hostname(material.external_url) : 'the web'} ↗
        </button>
      ) : material.kind === 'document' ? (
        <span className="text-xs text-slate-400">Open from the Files tab</span>
      ) : (
        <>
          <button type="button" className="text-xs underline" onClick={() => void open(false)}>
            Open
          </button>
          {material.rights.download ? (
            <button type="button" className="text-xs underline" onClick={() => void open(true)}>
              Download
            </button>
          ) : (
            <span className="text-xs text-slate-400">Play only</span>
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
