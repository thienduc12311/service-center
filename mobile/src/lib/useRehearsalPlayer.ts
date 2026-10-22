import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import {
  nextRehearsalIndex,
  rehearsalPlaylist,
  type RehearsalManifest,
  type RehearsalRepeatMode,
  type RehearsalTrack,
} from '@service-center/shared';
import { api } from './api';
import {
  REHEARSAL_SKIP_SECONDS,
  clampSeek,
  followItemIndex,
  linkFailureKey,
  lockScreenMetadata,
  nativeTrackMode,
  nextRepeatMode,
  playerErrorAction,
  previousAction,
  rehearsalTrackKey,
  signedUrlExpiry,
  signedUrlNeedsRenewal,
  type NativeAudioPlatform,
  type NativeTrackMode,
  type RehearsalPlayerFailureKey,
} from './rehearsal-player';
import { useAuth } from '../providers/AuthProvider';

/** What the player is doing with the current stop. */
export type NativeRehearsalStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  /** Another site's player; nothing plays here. */
  | 'external'
  /** A video: opens in the device's own player. */
  | 'device_player'
  /** An audio format this device cannot play in the app. */
  | 'unsupported'
  | 'error';

export interface NativeRehearsalPlayerState {
  tracks: RehearsalTrack[];
  index: number;
  track: RehearsalTrack | null;
  mode: NativeTrackMode | null;
  status: NativeRehearsalStatus;
  failure: RehearsalPlayerFailureKey | null;
  repeat: RehearsalRepeatMode;
  /** Seconds, from the player's status updates. */
  position: number;
  duration: number;
}

export interface NativeRehearsalPlayerControls {
  select: (index: number) => void;
  next: () => void;
  previous: () => void;
  togglePlay: () => void;
  /** Moves by `REHEARSAL_SKIP_SECONDS` (negative = back). */
  skip: (direction: 1 | -1) => void;
  seek: (seconds: number) => void;
  cycleRepeat: () => void;
  choose: (itemId: string, fileId: string) => void;
  retry: () => void;
}

/** A link the API issued for one version (never stored beyond this screen). */
interface SignedSource {
  key: string;
  expiresAt: number;
}

const platform: NativeAudioPlatform = Platform.OS === 'android' ? 'android' : 'ios';

/**
 * Background playback with lock-screen controls. `doNotMix` is required for
 * the lock screen, and makes a call or another app's audio pause this player
 * (the module resumes it when the system says so).
 */
const PLAYBACK_MODE = { playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' } as const;

/** The one player that may be sounding in this app (a second screen pauses the first). */
let soundingPlayer: AudioPlayer | null = null;

/**
 * MOB-024: the native counterpart of the website's `useRehearsalPlayer`. One
 * `expo-audio` player owns every audio stop of the plan; a link is requested
 * only for the stop about to play (access rechecked by the API), renewed
 * before it expires or once after a playback error, and a second failure
 * stops with "Try again" — never a silent skip. Video and external links stop
 * the queue and say where they play. Leaving the screen, signing out or
 * switching organization stops playback and clears the lock screen.
 */
export const useRehearsalPlayer = (
  manifest: RehearsalManifest | undefined,
): [NativeRehearsalPlayerState, NativeRehearsalPlayerControls] => {
  const { generation, isCurrentGeneration } = useAuth();
  const [player] = useState<AudioPlayer>(() => createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true }));
  const [choices, setChoices] = useState<Record<string, string>>({});
  const tracks = useMemo(() => (manifest ? rehearsalPlaylist(manifest, choices) : []), [manifest, choices]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<NativeRehearsalStatus>('idle');
  const [failure, setFailure] = useState<RehearsalPlayerFailureKey | null>(null);
  const [repeat, setRepeat] = useState<RehearsalRepeatMode>('off');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const source = useRef<SignedSource | null>(null);
  const request = useRef(0);
  const autoplay = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  /** The key renewed after an error, and where playback resumed; cleared once it plays past that point. */
  const renewed = useRef<{ key: string; at: number } | null>(null);
  const lockScreenActive = useRef(false);
  const audioModeSet = useRef(false);
  const currentItem = useRef<string | null>(null);
  /** The stop the load effect last started; a failed one is retried only by "Try again". */
  const attemptedKey = useRef<string | null>(null);

  const track = tracks[index] ?? null;
  const key = track ? rehearsalTrackKey(track) : null;
  const mode = track ? nativeTrackMode(track, platform) : null;

  const metadataFor = useCallback(
    (target: RehearsalTrack) =>
      lockScreenMetadata(
        target,
        manifest?.items.find((item) => item.item_id === target.item_id) ?? null,
        manifest?.plan_title ?? '',
      ),
    [manifest],
  );

  /**
   * Silence the player and forget its link, so the next play asks the API
   * again. The native player refuses `replace(null)` (iOS), so the paused
   * item stays loaded until the next source or `remove()` on leave.
   */
  const silence = useCallback(() => {
    request.current += 1;
    source.current = null;
    pendingSeek.current = null;
    player.pause();
    if (lockScreenActive.current) {
      player.clearLockScreenControls();
      lockScreenActive.current = false;
    }
    if (soundingPlayer === player) soundingPlayer = null;
  }, [player]);

  const load = useCallback(
    async (target: RehearsalTrack, play: boolean, at: number | null) => {
      const targetMode = nativeTrackMode(target, platform);
      setFailure(null);
      if (targetMode !== 'audio') {
        silence();
        setStatus(targetMode);
        return;
      }
      const id = ++request.current;
      const loadGeneration = generation;
      autoplay.current = play;
      setStatus('loading');
      try {
        if (!audioModeSet.current) {
          await setAudioModeAsync(PLAYBACK_MODE);
          audioModeSet.current = true;
        }
        const link = await api.fileDownload(target.material.file_id, {
          version_id: target.material.version_id ?? undefined,
          disposition: 'inline',
        });
        // A newer request, another track, or another account/organization: drop this answer.
        if (id !== request.current || !isCurrentGeneration(loadGeneration)) return;
        source.current = { key: rehearsalTrackKey(target), expiresAt: signedUrlExpiry(link.expires_at) };
        pendingSeek.current = at && at > 0 ? at : null;
        player.replace({ uri: link.url });
        const metadata = metadataFor(target);
        if (lockScreenActive.current) {
          player.updateLockScreenMetadata(metadata);
        } else {
          player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true });
          lockScreenActive.current = true;
        }
        if (play) {
          if (soundingPlayer && soundingPlayer !== player) soundingPlayer.pause();
          soundingPlayer = player;
          player.play();
        } else {
          setStatus('paused');
        }
      } catch (cause) {
        if (id !== request.current) return;
        silence();
        setStatus('error');
        setFailure(linkFailureKey(cause));
      }
    },
    [generation, isCurrentGeneration, metadataFor, player, silence],
  );

  const move = useCallback(
    (direction: 1 | -1, reason: 'ended' | 'user') => {
      const next = nextRehearsalIndex(tracks.length, index, direction, repeat, reason);
      if (next === null) {
        if (reason === 'user') return;
        // The end of the list: stay on the last stop, stopped.
        player.pause();
        setStatus('paused');
        return;
      }
      autoplay.current = reason === 'ended' || player.playing || status === 'external' || status === 'device_player';
      if (next === index) {
        if (mode === 'audio') {
          void player.seekTo(0).then(() => {
            if (autoplay.current) player.play();
          }, () => setFailure('plans:mobileRehearse.player.playbackFailed'));
        }
        return;
      }
      setIndex(next);
    },
    [tracks.length, index, repeat, player, status, mode],
  );

  // Status updates from the native player: position, end of track, pauses
  // the system made (calls, other apps, unplugged headphones, lock screen).
  const onStatus = useRef<(update: AudioStatus) => void>(() => undefined);
  onStatus.current = (update: AudioStatus) => {
    if (!source.current || mode !== 'audio') return;
    setPosition(update.currentTime);
    if (update.duration > 0) setDuration(update.duration);
    if (update.error) {
      const current = source.current.key;
      if (playerErrorAction(renewed.current?.key === current) === 'renew' && track) {
        // An expired or revoked link: ask once more; access is rechecked.
        renewed.current = { key: current, at: update.currentTime };
        void load(track, update.playing || autoplay.current, update.currentTime);
        return;
      }
      silence();
      setStatus('error');
      setFailure('plans:mobileRehearse.player.playbackFailed');
      return;
    }
    if (update.isLoaded && pendingSeek.current !== null) {
      const at = pendingSeek.current;
      pendingSeek.current = null;
      void player.seekTo(clampSeek(at, update.duration)).catch(() => setPosition(player.currentTime));
    }
    if (renewed.current && update.playing && update.currentTime > renewed.current.at + 2) renewed.current = null;
    if (update.didJustFinish) {
      move(1, 'ended');
      return;
    }
    if (update.playing) setStatus('playing');
    else if (update.isLoaded) setStatus((current) => (current === 'playing' || current === 'loading' ? 'paused' : current));
  };

  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (update) => onStatus.current(update));
    return () => subscription.remove();
  }, [player]);

  // The playlist changed (manifest refresh, rights change, another recording
  // chosen): stay on the same item; if it is gone, stop rather than play another.
  const previousTracks = useRef(tracks);
  useEffect(() => {
    if (previousTracks.current === tracks) return;
    previousTracks.current = tracks;
    const follow = followItemIndex(tracks, currentItem.current);
    if (follow === null) {
      silence();
      setStatus('idle');
      setIndex(0);
      return;
    }
    autoplay.current = player.playing;
    setIndex(follow);
  }, [tracks, player, silence]);
  // Declared after the effect above, so a playlist change still sees the previous item.
  useEffect(() => {
    currentItem.current = track?.item_id ?? null;
  }, [track]);

  // A new stop (or a new version of it) gets its own link.
  useEffect(() => {
    if (attemptedKey.current === key) return;
    attemptedKey.current = key;
    if (!track) {
      silence();
      setStatus('idle');
      return;
    }
    setPosition(0);
    setDuration(0);
    renewed.current = null;
    void load(track, autoplay.current, null);
    // `track` is read only for this key; the key is the dependency.
  }, [key, load, silence]);

  // Another account or organization: stop at once (the screen is replaced too).
  const startedGeneration = useRef(generation);
  useEffect(() => {
    if (startedGeneration.current === generation) return;
    startedGeneration.current = generation;
    silence();
    setStatus('idle');
  }, [generation, silence]);

  // Leaving the screen releases the player and the background audio session.
  useEffect(
    () => () => {
      request.current += 1;
      if (lockScreenActive.current) player.clearLockScreenControls();
      if (soundingPlayer === player) soundingPlayer = null;
      player.pause();
      player.remove();
      void setAudioModeAsync({ shouldPlayInBackground: false }).catch((cause: unknown) => {
        console.warn('[rehearsal] could not reset the audio session', cause);
      });
    },
    [player],
  );

  const togglePlay = useCallback(() => {
    if (!track || mode !== 'audio') return;
    if (player.playing) {
      player.pause();
      return;
    }
    if (!source.current || signedUrlNeedsRenewal(source.current.expiresAt)) {
      // No link yet, or it may expire mid-play: ask again (access is rechecked).
      void load(track, true, source.current ? player.currentTime : null);
      return;
    }
    if (soundingPlayer && soundingPlayer !== player) soundingPlayer.pause();
    soundingPlayer = player;
    autoplay.current = true;
    if (player.duration > 0 && player.currentTime >= player.duration - 0.5) {
      void player.seekTo(0).then(() => player.play(), () => setFailure('plans:mobileRehearse.player.playbackFailed'));
      return;
    }
    player.play();
  }, [track, mode, player, load]);

  const seek = useCallback(
    (seconds: number) => {
      if (mode !== 'audio' || !source.current) return;
      const target = clampSeek(seconds, player.duration);
      setPosition(target);
      void player.seekTo(target).catch(() => setPosition(player.currentTime));
    },
    [mode, player],
  );

  const controls: NativeRehearsalPlayerControls = {
    select: (next) => {
      if (next < 0 || next >= tracks.length) return;
      autoplay.current = true;
      if (next === index && track) {
        void load(track, true, null);
        return;
      }
      setIndex(next);
    },
    next: () => move(1, 'user'),
    previous: () => {
      if (mode === 'audio' && previousAction(player.currentTime) === 'restart') {
        seek(0);
        return;
      }
      move(-1, 'user');
    },
    togglePlay,
    skip: (direction) => seek(player.currentTime + direction * REHEARSAL_SKIP_SECONDS),
    seek,
    cycleRepeat: () => setRepeat(nextRepeatMode),
    choose: (itemId, fileId) => setChoices((current) => ({ ...current, [itemId]: fileId })),
    retry: () => {
      if (!track) return;
      renewed.current = null;
      void load(track, true, position || null);
    },
  };

  return [{ tracks, index, track, mode, status, failure, repeat, position, duration }, controls];
};
