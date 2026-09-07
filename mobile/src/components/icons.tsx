import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import type { ReactElement } from 'react';
import type { ColorValue } from 'react-native';

/**
 * A small, hand-drawn icon set on a 24px grid with one standardised stroke
 * weight. Deliberately not a thin-line library — the slightly heavier stroke
 * is what keeps the interface feeling technical rather than generic.
 */
export type IconName =
  | 'schedule'
  | 'calendar'
  | 'music'
  | 'book'
  | 'person'
  | 'chevronRight'
  | 'chevronLeft'
  | 'plus'
  | 'minus'
  | 'check'
  | 'close'
  | 'camera'
  | 'image'
  | 'upload'
  | 'document'
  | 'search'
  | 'alert'
  | 'bell'
  | 'trash'
  | 'signOut'
  | 'sun'
  | 'moon';

export interface IconProps {
  name: IconName;
  size?: number;
  color: ColorValue;
  strokeWidth?: number;
}

const paths: Record<IconName, (stroke: number) => ReactElement> = {
  schedule: (w) => (
    <>
      <Rect x={3} y={3.5} width={18} height={17} rx={4} strokeWidth={w} />
      <Polyline points="8,12.5 10.8,15.2 16,9.4" strokeWidth={w} />
    </>
  ),
  calendar: (w) => (
    <>
      <Rect x={3} y={5} width={18} height={16} rx={3.5} strokeWidth={w} />
      <Line x1={3} y1={10} x2={21} y2={10} strokeWidth={w} />
      <Line x1={8.5} y1={2.8} x2={8.5} y2={6.5} strokeWidth={w} />
      <Line x1={15.5} y1={2.8} x2={15.5} y2={6.5} strokeWidth={w} />
    </>
  ),
  music: (w) => (
    <>
      <Circle cx={7} cy={17.5} r={3} strokeWidth={w} />
      <Circle cx={17} cy={15.5} r={3} strokeWidth={w} />
      <Path d="M10 17.5V7l10-2v10.5" strokeWidth={w} />
    </>
  ),
  book: (w) => (
    <>
      <Path d="M5 4.5A1.5 1.5 0 016.5 3H19v15H6.5A1.5 1.5 0 005 19.5z" strokeWidth={w} />
      <Path d="M5 19.5A1.5 1.5 0 016.5 21H19" strokeWidth={w} />
      <Line x1={9} y1={7.5} x2={15} y2={7.5} strokeWidth={w} />
    </>
  ),
  person: (w) => (
    <>
      <Circle cx={12} cy={8} r={4} strokeWidth={w} />
      <Path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" strokeWidth={w} />
    </>
  ),
  chevronRight: (w) => <Polyline points="9.5,4.5 17,12 9.5,19.5" strokeWidth={w} />,
  chevronLeft: (w) => <Polyline points="14.5,4.5 7,12 14.5,19.5" strokeWidth={w} />,
  plus: (w) => (
    <>
      <Line x1={12} y1={5} x2={12} y2={19} strokeWidth={w} />
      <Line x1={5} y1={12} x2={19} y2={12} strokeWidth={w} />
    </>
  ),
  minus: (w) => <Line x1={5} y1={12} x2={19} y2={12} strokeWidth={w} />,
  check: (w) => <Polyline points="4.5,12.5 9.5,17.5 19.5,6.5" strokeWidth={w} />,
  close: (w) => (
    <>
      <Line x1={6} y1={6} x2={18} y2={18} strokeWidth={w} />
      <Line x1={18} y1={6} x2={6} y2={18} strokeWidth={w} />
    </>
  ),
  camera: (w) => (
    <>
      <Path d="M3 8.5A2.5 2.5 0 015.5 6h1.8l1.4-2.2h6.6L16.7 6h1.8A2.5 2.5 0 0121 8.5v9A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5z" strokeWidth={w} />
      <Circle cx={12} cy={13} r={4} strokeWidth={w} />
    </>
  ),
  image: (w) => (
    <>
      <Rect x={3} y={4.5} width={18} height={15} rx={3} strokeWidth={w} />
      <Circle cx={8.5} cy={10} r={1.8} strokeWidth={w} />
      <Path d="M4 17l4.8-4.5 4 3.5 3.2-2.6L20 17.5" strokeWidth={w} />
    </>
  ),
  upload: (w) => (
    <>
      <Path d="M12 15.5V3.5" strokeWidth={w} />
      <Polyline points="7,8.5 12,3.5 17,8.5" strokeWidth={w} />
      <Path d="M4 15v3.5A2.5 2.5 0 006.5 21h11a2.5 2.5 0 002.5-2.5V15" strokeWidth={w} />
    </>
  ),
  document: (w) => (
    <>
      <Path d="M14 3H7.5A2.5 2.5 0 005 5.5v13A2.5 2.5 0 007.5 21h9a2.5 2.5 0 002.5-2.5V8z" strokeWidth={w} />
      <Polyline points="14,3 14,8 19,8" strokeWidth={w} />
      <Line x1={8.5} y1={13} x2={15.5} y2={13} strokeWidth={w} />
      <Line x1={8.5} y1={16.5} x2={13} y2={16.5} strokeWidth={w} />
    </>
  ),
  search: (w) => (
    <>
      <Circle cx={10.5} cy={10.5} r={6.5} strokeWidth={w} />
      <Line x1={15.5} y1={15.5} x2={21} y2={21} strokeWidth={w} />
    </>
  ),
  alert: (w) => (
    <>
      <Path d="M12 3.5L21.5 20H2.5z" strokeWidth={w} />
      <Line x1={12} y1={9.5} x2={12} y2={14} strokeWidth={w} />
      <Line x1={12} y1={16.8} x2={12} y2={17} strokeWidth={w} />
    </>
  ),
  bell: (w) => (
    <>
      <Path d="M6 10a6 6 0 0 1 12 0c0 4 1.2 5.4 2 6.4H4c.8-1 2-2.4 2-6.4Z" strokeWidth={w} />
      <Path d="M10 19.4a2.2 2.2 0 0 0 4 0" strokeWidth={w} />
    </>
  ),
  trash: (w) => (
    <>
      <Line x1={3.5} y1={6.5} x2={20.5} y2={6.5} strokeWidth={w} />
      <Path d="M9 6.5V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5v2" strokeWidth={w} />
      <Path d="M5.5 6.5l1 12.2A2.4 2.4 0 008.9 21h6.2a2.4 2.4 0 002.4-2.3l1-12.2" strokeWidth={w} />
    </>
  ),
  signOut: (w) => (
    <>
      <Path d="M15 3.5h2.5A2.5 2.5 0 0120 6v12a2.5 2.5 0 01-2.5 2.5H15" strokeWidth={w} />
      <Polyline points="9.5,7.5 4.5,12 9.5,16.5" strokeWidth={w} />
      <Line x1={4.5} y1={12} x2={15} y2={12} strokeWidth={w} />
    </>
  ),
  sun: (w) => (
    <>
      <Circle cx={12} cy={12} r={4.5} strokeWidth={w} />
      <Line x1={12} y1={1.5} x2={12} y2={4} strokeWidth={w} />
      <Line x1={12} y1={20} x2={12} y2={22.5} strokeWidth={w} />
      <Line x1={1.5} y1={12} x2={4} y2={12} strokeWidth={w} />
      <Line x1={20} y1={12} x2={22.5} y2={12} strokeWidth={w} />
      <Line x1={4.6} y1={4.6} x2={6.4} y2={6.4} strokeWidth={w} />
      <Line x1={17.6} y1={17.6} x2={19.4} y2={19.4} strokeWidth={w} />
      <Line x1={19.4} y1={4.6} x2={17.6} y2={6.4} strokeWidth={w} />
      <Line x1={6.4} y1={17.6} x2={4.6} y2={19.4} strokeWidth={w} />
    </>
  ),
  moon: (w) => <Path d="M20 14.2A8.6 8.6 0 019.8 4 8.6 8.6 0 1020 14.2z" strokeWidth={w} />,
};

export const Icon = ({ name, size = 20, color, strokeWidth = 1.75 }: IconProps) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {paths[name](strokeWidth)}
  </Svg>
);
