import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Countdown, useTimeOfDay } from './LiveRunPanel';
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
  const { t } = useTranslation(['media', 'common']);
  const timeOfDay = useTimeOfDay();
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
      aria-label={t('live.stageDisplay')}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-10 text-white"
    >
      <div className="flex items-center justify-between text-lg text-slate-400">
        <span>{state ? t(`live.status.${state.run.status}`) : ''}{view?.section ? ` · ${view.section}` : ''}</span>
        <button type="button" className="rounded px-3 py-1 text-sm ring-1 ring-slate-600 hover:bg-slate-800" onClick={onClose}>
          {t('live.stage.close')}
        </button>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-8">
        {!state || !view ? (
          <p className="text-4xl text-slate-400">{live.connection === 'revoked' ? t('live.stage.unavailable') : t('common:states.loading')}</p>
        ) : view.current ? (
          <>
            <p className="text-6xl font-semibold leading-tight">{view.current.title}</p>
            <Countdown view={view} large />
            {state.run.status === 'paused' && <p className="text-3xl text-amber-400">{t('live.status.paused')}</p>}
          </>
        ) : (
          <p className="text-5xl text-slate-300">
            {state.run.status === 'ready' ? t('live.stage.startingWith', { title: view.next?.title ?? '—' }) : t('live.stage.finished')}
          </p>
        )}
      </div>
      <div className="flex items-end justify-between text-2xl text-slate-300">
        <span>{view?.current && view.next ? t('live.next', { title: view.next.title }) : ''}</span>
        <span className={stale ? 'text-amber-400' : 'text-slate-500'}>
          {stale
            ? t('live.stage.notUpdated', { count: live.lastUpdatedSecondsAgo ?? 0 })
            : t('live.finish.planned', { time: timeOfDay(view?.planned_finish_at ?? null) })}
        </span>
      </div>
    </div>
  );
};
