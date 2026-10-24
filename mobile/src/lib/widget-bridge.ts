import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { ScheduleWidgetProps, ScheduleWidgetTimelineEntry } from './schedule-widget';

/**
 * MOB-033: the one place that writes to the iOS widget. The native module
 * exists only in a development/release build with the widget extension
 * (never in Expo Go, never on Android in this stage), so every call is a
 * no-op elsewhere and the widget definition is loaded lazily.
 */
interface ScheduleWidgetHandle {
  updateTimeline: (entries: ScheduleWidgetTimelineEntry[]) => void;
  updateSnapshot: (props: ScheduleWidgetProps) => void;
}

let handle: ScheduleWidgetHandle | null | undefined;

const widget = (): ScheduleWidgetHandle | null => {
  if (handle !== undefined) return handle;
  handle = null;
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoWidgets')) return handle;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where the native module exists
  try {
    const loaded = require('../widgets/ScheduleWidget') as { default: ScheduleWidgetHandle };
    handle = loaded.default;
  } catch (error) {
    console.warn('[widget] could not register the widget', error instanceof Error ? error.message : 'unknown error');
  }
  return handle;
};

/** Whether this build can show the widget at all (for the settings copy). */
export const widgetsSupported = (): boolean => widget() !== null;

/** A widget write that fails is reported and dropped: the widget is a shortcut, never a reason to stop the app. */
const safely = (action: string, write: (target: ScheduleWidgetHandle) => void): void => {
  const target = widget();
  if (!target) return;
  try {
    write(target);
  } catch (error) {
    console.warn(`[widget] ${action} failed`, error instanceof Error ? error.message : 'unknown error');
  }
};

export const writeScheduleWidgetTimeline = (entries: ScheduleWidgetTimelineEntry[]): void => {
  safely('timeline update', (target) => target.updateTimeline(entries));
};

/** Replaces whatever the widget shows with props that hold nothing personal. */
export const clearScheduleWidget = (props: ScheduleWidgetProps): void => {
  safely('clear', (target) => target.updateSnapshot(props));
};
