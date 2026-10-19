import { useEffect, useRef } from 'react';
import { LIVE_STATUS_LABELS } from '@service-center/shared';
import { Countdown, timeOfDay } from './LiveRunPanel';
import type { LiveRunHandle } from './useLiveRun';

export interface LiveStageDisplayProps {
  live: LiveRunHandle;
  onClose: () => void;
}

/**
 * Full-screen stage view for the signed-in viewer: current item, countdown,
 * next item and connection freshness only — no people, notes, files or chat.
 * It reads the same authoritative state as the panel; it never controls.
 */
export const LiveStageDisplay = ({ live, onClose }: LiveStageDisplayProps) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    // Fullscreen is best effort (it needs a user gesture and may be refused).
    if (element?.requestFullscreen && !document.fullscreenElement) {
      element.requestFullscreen().catch(() => undefined);
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onExit = () => {
      if (!document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onExit);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onExit);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  const { state, view } = live;
  const stale = live.connection !== 'live';

  return (
    <div
      ref={container}
      role="dialog"
      aria-modal="true"
      aria-label="Stage display"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-10 text-white"
    >
      <div className="flex items-center justify-between text-lg text-slate-400">
        <span>{state ? LIVE_STATUS_LABELS[state.run.status] : ''}{view?.section ? ` · ${view.section}` : ''}</span>
        <button type="button" className="rounded px-3 py-1 text-sm ring-1 ring-slate-600 hover:bg-slate-800" onClick={onClose}>
          Close (Esc)
        </button>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-8">
        {!state || !view ? (
          <p className="text-4xl text-slate-400">{live.connection === 'revoked' ? 'This run is no longer available.' : 'Loading…'}</p>
        ) : view.current ? (
          <>
            <p className="text-6xl font-semibold leading-tight">{view.current.title}</p>
            <Countdown view={view} large />
            {state.run.status === 'paused' && <p className="text-3xl text-amber-400">Paused</p>}
          </>
        ) : (
          <p className="text-5xl text-slate-300">
            {state.run.status === 'ready' ? `Starting with ${view.next?.title ?? '—'}` : 'Service run finished'}
          </p>
        )}
      </div>
      <div className="flex items-end justify-between text-2xl text-slate-300">
        <span>{view?.current && view.next ? `Next: ${view.next.title}` : ''}</span>
        <span className={stale ? 'text-amber-400' : 'text-slate-500'}>
          {stale ? `Not updated for ${live.lastUpdatedSecondsAgo ?? 0}s` : `Planned finish ${timeOfDay(view?.planned_finish_at ?? null)}`}
        </span>
      </div>
    </div>
  );
};
