import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  DEFAULT_REHEARSAL_PLAYBACK_RATE,
  isInlineTrack,
  nextRehearsalIndex,
  rehearsalPlaylist,
  type RehearsalManifest,
  type RehearsalPlaybackRate,
  type RehearsalRepeatMode,
  type RehearsalTrack,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useErrorText } from '../../i18n';

/** Why the current track cannot play; turned into text in the displayed language on each render. */
type RehearsalPlayerFailure =
  | { kind: 'load'; cause: unknown }
  | { kind: 'unsupported' };

/** What the player is doing with the current track. */
export type RehearsalPlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'external' | 'error';

interface SignedSource {
  key: string;
  url: string;
  /** Ask again shortly before this (the API rechecks access every time). */
  expiresAt: number;
}

export interface RehearsalPlayerState {
  tracks: RehearsalTrack[];
  index: number;
  track: RehearsalTrack | null;
  status: RehearsalPlayerStatus;
  error: string | null;
  repeat: RehearsalRepeatMode;
  /** MOB-027 practice speed; pitch is kept, so the recording's key does not change. */
  rate: RehearsalPlaybackRate;
  position: number;
  duration: number;
  /** The `src` for the one media element (null for external tracks). */
  source: string | null;
}

export interface RehearsalPlayerControls {
  select: (index: number, autoplay?: boolean) => void;
  next: () => void;
  previous: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  cycleRepeat: () => void;
  setRate: (rate: RehearsalPlaybackRate) => void;
  choose: (itemId: string, fileId: string) => void;
  retry: () => void;
  /** Wire these to the media element. */
  handlers: {
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
    onTimeUpdate: () => void;
    onLoadedMetadata: () => void;
    onError: () => void;
  };
}

const RENEW_MARGIN_MS = 20_000;
const REPEAT_ORDER: RehearsalRepeatMode[] = ['off', 'all', 'one'];

const trackKey = (track: RehearsalTrack): string => `${track.material.file_id}:${track.material.version_id ?? ''}`;


/**
 * One player for the whole plan: it owns the single media element, asks the
 * API for a short-lived URL only for the track about to play, renews it when
 * it expires and never moves on to another track by itself after an error.
 */
export const useRehearsalPlayer = (
  manifest: RehearsalManifest | undefined,
  media: RefObject<HTMLMediaElement | null>,
): [RehearsalPlayerState, RehearsalPlayerControls] => {
  const { t } = useTranslation('media');
  const errorText = useErrorText();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const tracks = useMemo(() => (manifest ? rehearsalPlaylist(manifest, choices) : []), [manifest, choices]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<RehearsalPlayerStatus>('idle');
  const [error, setError] = useState<RehearsalPlayerFailure | null>(null);
  const [repeat, setRepeat] = useState<RehearsalRepeatMode>('off');
  const [rate, setRate] = useState<RehearsalPlaybackRate>(DEFAULT_REHEARSAL_PLAYBACK_RATE);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [signed, setSigned] = useState<SignedSource | null>(null);
  const autoplay = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const renewing = useRef(false);
  const request = useRef(0);

  const track = tracks[index] ?? null;
  const key = track ? trackKey(track) : null;

  // The playlist changed (manifest refetch, rights change, another recording
  // chosen): stay on the same item if it is still there. Only playlist
  // changes run this — moving between tracks must not.
  const currentItem = useRef<string | null>(null);
  const previousTracks = useRef(tracks);
  useEffect(() => {
    if (previousTracks.current === tracks) return;
    previousTracks.current = tracks;
    if (!tracks.length) {
      setIndex(0);
      return;
    }
    const keep = currentItem.current ? tracks.findIndex((candidate) => candidate.item_id === currentItem.current) : -1;
    setIndex(keep >= 0 ? keep : 0);
  }, [tracks]);
  // Declared after the effect above, so on a playlist change it still sees the previous item.
  useEffect(() => {
    currentItem.current = track?.item_id ?? null;
  }, [track]);

  const load = useCallback(
    async (target: RehearsalTrack, play: boolean, at: number | null) => {
      const id = ++request.current;
      autoplay.current = play;
      resumeAt.current = at;
      setError(null);
      if (!isInlineTrack(target)) {
        setSigned(null);
        setStatus(target.material.playback === 'external' ? 'external' : 'idle');
        return;
      }
      setStatus('loading');
      try {
        const result = await api.fileDownload(target.material.file_id, {
          version_id: target.material.version_id ?? undefined,
          disposition: 'inline',
        });
        if (id !== request.current) return;
        setSigned({
          key: trackKey(target),
          url: result.url,
          expiresAt: result.expires_at ? new Date(result.expires_at).getTime() : Number.POSITIVE_INFINITY,
        });
      } catch (cause) {
        if (id !== request.current) return;
        setSigned(null);
        setStatus('error');
        setError({ kind: 'load', cause });
      }
    },
    [],
  );

  // A new track (or a different version of it) gets its own URL.
  useEffect(() => {
    if (!track) {
      setSigned(null);
      setStatus('idle');
      return;
    }
    if (signed?.key === key) return;
    setPosition(0);
    setDuration(0);
    void load(track, autoplay.current, null);
    // `signed` and `track` are read only for this key; the key is the dependency.
  }, [key, load]);

  // Apply the URL to the element, resume where a renewal left off, play if asked.
  useEffect(() => {
    const element = media.current;
    if (!element || !signed) return;
    if (element.getAttribute('src') !== signed.url) {
      element.setAttribute('src', signed.url);
      element.load();
    }
  }, [signed, media]);

  // Practice speed: `defaultPlaybackRate` survives `load()` for the next track;
  // `preservesPitch` (the browser default) keeps the recording's key.
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.preservesPitch = true;
    element.defaultPlaybackRate = rate;
    element.playbackRate = rate;
  }, [rate, signed, media]);

  // Stop and release the element when the player goes away (navigation, sign-out, org switch).
  useEffect(() => {
    const element = media.current;
    return () => {
      request.current += 1;
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [media]);

  const select = useCallback(
    (next: number, play = true) => {
      if (next < 0 || next >= tracks.length) return;
      autoplay.current = play;
      if (next === index && track) {
        // Same track: just (re)start it.
        void load(track, play, 0);
        return;
      }
      setIndex(next);
    },
    [tracks.length, index, track, load],
  );

  const move = useCallback(
    (direction: 1 | -1, reason: 'ended' | 'user') => {
      const next = nextRehearsalIndex(tracks.length, index, direction, repeat, reason);
      if (next === null) {
        setStatus((current) => (current === 'playing' ? 'paused' : current));
        return;
      }
      autoplay.current = reason === 'ended' || status === 'playing' || status === 'external';
      if (next === index) {
        const element = media.current;
        if (element) {
          element.currentTime = 0;
          void element.play().catch(() => setStatus('paused'));
        }
        return;
      }
      setIndex(next);
    },
    [tracks.length, index, repeat, status, media],
  );

  const togglePlay = useCallback(() => {
    const element = media.current;
    if (!element || !track) return;
    if (!isInlineTrack(track)) return;
    if (signed && Date.now() > signed.expiresAt - RENEW_MARGIN_MS) {
      // Renew first: the old URL may expire mid-play.
      void load(track, true, element.currentTime);
      return;
    }
    if (element.paused) void element.play().catch(() => setStatus('paused'));
    else element.pause();
  }, [media, track, signed, load]);

  const handlers = useMemo(
    () => ({
      onPlay: () => setStatus('playing'),
      onPause: () => setStatus((current) => (current === 'playing' ? 'paused' : current)),
      onEnded: () => move(1, 'ended'),
      onTimeUpdate: () => setPosition(media.current?.currentTime ?? 0),
      onLoadedMetadata: () => {
        const element = media.current;
        if (!element) return;
        setDuration(Number.isFinite(element.duration) ? element.duration : 0);
        if (resumeAt.current !== null) {
          element.currentTime = resumeAt.current;
          resumeAt.current = null;
        }
        setStatus('ready');
        if (autoplay.current) void element.play().catch(() => setStatus('paused'));
      },
      onError: () => {
        const element = media.current;
        if (!track || !element) return;
        // An expired or revoked URL: ask once more (access is rechecked); a
        // second failure stops here instead of skipping to another track.
        if (!renewing.current) {
          renewing.current = true;
          void load(track, !element.paused || autoplay.current, element.currentTime || null).finally(() => {
            window.setTimeout(() => {
              renewing.current = false;
            }, 5000);
          });
          return;
        }
        setStatus('error');
        setError({ kind: 'unsupported' });
      },
    }),
    [media, move, track, load],
  );

  const controls: RehearsalPlayerControls = {
    select,
    next: () => move(1, 'user'),
    previous: () => {
      const element = media.current;
      // Like most players: "previous" restarts a track that has been playing a while.
      if (element && element.currentTime > 3 && status !== 'external') {
        element.currentTime = 0;
        return;
      }
      move(-1, 'user');
    },
    togglePlay,
    seek: (seconds) => {
      const element = media.current;
      if (element && Number.isFinite(seconds)) element.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    },
    cycleRepeat: () => setRepeat((current) => REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length]!),
    setRate,
    choose: (itemId, fileId) => setChoices((current) => ({ ...current, [itemId]: fileId })),
    retry: () => {
      if (track) void load(track, true, position || null);
    },
    handlers,
  };

  const errorMessage = (() => {
    if (!error) return null;
    if (error.kind === 'unsupported') return t('rehearsal.unsupported');
    const cause = error.cause;
    if (cause instanceof ApiError) {
      return cause.status === 404 || cause.status === 403 ? t('rehearsal.unavailable') : errorText(cause);
    }
    return t('rehearsal.loadFailed');
  })();

  return [
    {
      tracks,
      index,
      track,
      status,
      error: errorMessage,
      repeat,
      rate,
      position,
      duration,
      source: signed?.key === key ? signed.url : null,
    },
    controls,
  ];
};
