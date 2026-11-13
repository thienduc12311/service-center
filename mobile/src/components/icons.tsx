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
  | 'clock'
  | 'music'
  | 'person'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronUp'
  | 'chevronDown'
  | 'pencil'
  | 'plus'
  | 'minus'
  | 'check'
  | 'close'
  | 'camera'
  | 'image'
  | 'upload'
  | 'download'
  | 'repeat'
  | 'document'
  | 'plans'
  | 'search'
  | 'alert'
  | 'bell'
  | 'trash'
  | 'signOut'
  | 'sun'
  | 'moon'
  | 'chat'
  | 'people'
  | 'mapPin'
  | 'settings'
  | 'sparkle'
  | 'mail'
  | 'info';

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
  clock: (w) => (
    <>
      <Circle cx={12} cy={12} r={9} strokeWidth={w} />
      <Polyline points="12,7 12,12 15.5,14" strokeWidth={w} />
    </>
  ),
  music: (w) => (
    <>
      <Circle cx={7} cy={17.5} r={3} strokeWidth={w} />
      <Circle cx={17} cy={15.5} r={3} strokeWidth={w} />
      <Path d="M10 17.5V7l10-2v10.5" strokeWidth={w} />
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
  chevronUp: (w) => <Polyline points="4.5,14.5 12,7 19.5,14.5" strokeWidth={w} />,
  chevronDown: (w) => <Polyline points="4.5,9.5 12,17 19.5,9.5" strokeWidth={w} />,
  pencil: (w) => (
    <>
      <Path d="M15.5 4.5l4 4L8.5 19.5 3.5 20.5l1-5z" strokeWidth={w} />
      <Line x1={13} y1={7} x2={17} y2={11} strokeWidth={w} />
    </>
  ),
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
  download: (w) => (
    <>
      <Path d="M12 3.5v12" strokeWidth={w} />
      <Polyline points="7,10.5 12,15.5 17,10.5" strokeWidth={w} />
      <Path d="M4 15v3.5A2.5 2.5 0 006.5 21h11a2.5 2.5 0 002.5-2.5V15" strokeWidth={w} />
    </>
  ),
  repeat: (w) => (
    <>
      <Path d="M4.5 11V9.5A3.5 3.5 0 018 6h11" strokeWidth={w} />
      <Polyline points="16,3 19,6 16,9" strokeWidth={w} />
      <Path d="M19.5 13v1.5A3.5 3.5 0 0116 18H5" strokeWidth={w} />
      <Polyline points="8,15 5,18 8,21" strokeWidth={w} />
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
  plans: (w) => (
    <>
      <Rect x={4} y={3.5} width={16} height={17} rx={3.5} strokeWidth={w} />
      <Line x1={8} y1={9} x2={16} y2={9} strokeWidth={w} />
      <Line x1={8} y1={12.5} x2={16} y2={12.5} strokeWidth={w} />
      <Line x1={8} y1={16} x2={12.5} y2={16} strokeWidth={w} />
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
  chat: (w) => <Path d="M4.5 5.5h15a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H11l-4.5 3.5V17.5h-2A1.5 1.5 0 013 16V7a1.5 1.5 0 011.5-1.5z" strokeWidth={w} />,
  people: (w) => (
    <>
      <Circle cx={9} cy={8.5} r={3.5} strokeWidth={w} />
      <Path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" strokeWidth={w} />
      <Path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" strokeWidth={w} />
      <Path d="M18 14.4c2.1.7 3.5 2.7 3.5 5.6" strokeWidth={w} />
    </>
  ),
  mapPin: (w) => (
    <>
      <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" strokeWidth={w} />
      <Circle cx={12} cy={10} r={2.4} strokeWidth={w} />
    </>
  ),
  settings: (w) => (
    <>
      <Circle cx={12} cy={12} r={3} strokeWidth={w} />
      <Path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" strokeWidth={w} />
    </>
  ),
  sparkle: (w) => (
    <Path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" strokeWidth={w} />
  ),
  mail: (w) => (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={3} strokeWidth={w} />
      <Path d="m4 7 8 6 8-6" strokeWidth={w} />
    </>
  ),
  info: (w) => (
    <>
      <Circle cx={12} cy={12} r={9} strokeWidth={w} />
      <Line x1={12} y1={11} x2={12} y2={16.5} strokeWidth={w} />
      <Line x1={12} y1={7.8} x2={12} y2={8} strokeWidth={w} />
    </>
  ),
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
