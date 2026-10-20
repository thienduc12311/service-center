import { useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { StageBackground, StageObject } from '@service-center/shared';

/** Drawing units; objects are stored as fractions of this box. */
const W = 1000;
const H = 600;

export interface StageCanvasProps {
  ref?: Ref<SVGSVGElement>;
  background: StageBackground;
  objects: readonly StageObject[];
  selectedId: string | null;
  editable: boolean;
  /** Objects to outline as needing attention (staffing changed). */
  flagged: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

interface BackgroundProps {
  kind: StageBackground;
}

const Background = ({ kind }: BackgroundProps) => {
  const { t } = useTranslation('media');
  const line = { fill: 'none', stroke: '#94a3b8', strokeWidth: 3 } as const;
  switch (kind) {
    case 'stage':
      return (
        <g>
          <rect x={60} y={40} width={880} height={430} rx={8} {...line} />
          <line x1={60} y1={470} x2={940} y2={470} stroke="#64748b" strokeWidth={6} />
          <text x={500} y={570} textAnchor="middle" fontSize={22} fill="#64748b">{t('stage.canvas.audience')}</text>
        </g>
      );
    case 'thrust':
      return (
        <g>
          <path d="M60 40 H940 V330 H700 V500 H300 V330 H60 Z" {...line} />
          <text x={500} y={570} textAnchor="middle" fontSize={22} fill="#64748b">{t('stage.canvas.audience')}</text>
        </g>
      );
    case 'round':
      return (
        <g>
          <circle cx={500} cy={300} r={230} {...line} />
          <text x={500} y={30} textAnchor="middle" fontSize={20} fill="#64748b">{t('stage.canvas.audienceAllSides')}</text>
        </g>
      );
    default:
      return null;
  }
};

/**
 * The stage drawing. Objects are dragged with a pointer or nudged with the
 * arrow keys when selected (Shift for bigger steps); nothing here saves.
 */
export const StageCanvas = ({ ref, background, objects, selectedId, editable, flagged, onSelect, onMove }: StageCanvasProps) => {
  const { t } = useTranslation('media');
  const box = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const point = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const startDrag = (event: PointerEvent<SVGGElement>, object: StageObject) => {
    onSelect(object.id);
    if (!editable) return;
    const at = point(event);
    if (!at) return;
    dragging.current = { id: object.id, dx: object.x - at.x, dy: object.y - at.y };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };
  const drag = (event: PointerEvent<SVGGElement>) => {
    const state = dragging.current;
    const at = point(event);
    if (!state || !at) return;
    onMove(state.id, clamp(at.x + state.dx), clamp(at.y + state.dy));
  };
  const endDrag = () => {
    dragging.current = null;
  };

  const nudge = (event: KeyboardEvent<SVGGElement>, object: StageObject) => {
    if (!editable) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onMove(object.id, clamp(object.x + move[0]), clamp(object.y + move[1]));
  };

  return (
    <svg
      ref={(element) => {
        box.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref && typeof ref === 'object') (ref as { current: SVGSVGElement | null }).current = element;
      }}
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="group"
      aria-label={t('stage.canvas.label')}
      className="w-full touch-none select-none rounded-lg bg-white ring-1 ring-slate-200 dark:ring-slate-700"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      <Background kind={background} />
      {objects.map((object) => {
        const cx = object.x * W;
        const cy = object.y * H;
        const w = object.w * W;
        const h = object.h * H;
        const selected = object.id === selectedId;
        const flaggedObject = flagged.has(object.id);
        const fill = object.color ?? (object.kind === 'person' ? '#c7d2fe' : object.kind === 'gear' ? '#e2e8f0' : 'none');
        return (
          <g
            key={object.id}
            transform={`translate(${cx} ${cy}) rotate(${object.rotation})`}
            tabIndex={0}
            role="button"
            aria-pressed={selected}
            aria-label={
              flaggedObject
                ? t('stage.canvas.objectFlagged', { kind: t(`stage.kinds.${object.kind}`), label: object.label })
                : t('stage.canvas.object', { kind: t(`stage.kinds.${object.kind}`), label: object.label })
            }
            style={{ cursor: editable ? 'move' : 'default', outline: 'none' }}
            onPointerDown={(event) => startDrag(event, object)}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onFocus={() => onSelect(object.id)}
            onKeyDown={(event) => nudge(event, object)}
          >
            {object.kind === 'person' ? (
              <ellipse rx={w / 2} ry={h / 2} fill={fill} stroke={flaggedObject ? '#d97706' : selected ? '#4f46e5' : '#6366f1'} strokeWidth={selected || flaggedObject ? 4 : 2} strokeDasharray={flaggedObject ? '8 5' : undefined} />
            ) : object.kind === 'gear' ? (
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={fill} stroke={selected ? '#4f46e5' : '#64748b'} strokeWidth={selected ? 4 : 2} />
            ) : selected ? (
              <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke="#4f46e5" strokeDasharray="6 4" />
            ) : null}
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.max(12, Math.min(22, h * 0.35))}
              fill="#0f172a"
              style={{ pointerEvents: 'none' }}
            >
              {object.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
