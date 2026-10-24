import { HStack, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, privacySensitive, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import { SCHEDULE_WIDGET_NAME, type ScheduleWidgetProps } from '../lib/schedule-widget';

/**
 * MOB-033: the iOS schedule widget (WidgetKit, through expo-widgets). This
 * function is serialized into the widget extension and runs there without the
 * app: only `@expo/ui/swift-ui` views and modifiers, no hooks, imports or
 * module constants. Its props are the snapshot the app wrote; titles are
 * privacy-sensitive, so the OS redacts them on a locked device.
 */
const ScheduleWidget = (props: ScheduleWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const brand = '#4f46e5';
  const first = props.entries[0];

  if (props.state !== 'ready' || !first) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[widgetURL(props.appUrl)]}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(brand)]}>{props.heading}</Text>
        {props.organizationName ? (
          <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), lineLimit(1)]}>
            {props.organizationName}
          </Text>
        ) : null}
        <Text modifiers={[font({ textStyle: 'footnote' }), lineLimit(3)]}>{props.message}</Text>
        <Spacer />
      </VStack>
    );
  }

  if (environment.widgetFamily === 'accessoryRectangular' || environment.widgetFamily === 'accessoryInline') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(first.url)]}>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1), privacySensitive()]}>{first.title}</Text>
        <Text modifiers={[font({ textStyle: 'caption' }), lineLimit(1)]}>{first.when}</Text>
        {first.detail ? <Text modifiers={[font({ textStyle: 'caption2' }), lineLimit(1), privacySensitive()]}>{first.detail}</Text> : null}
      </VStack>
    );
  }

  if (environment.widgetFamily === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={3} modifiers={[widgetURL(first.url)]}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(brand)]}>{props.heading}</Text>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(2), privacySensitive()]}>{first.title}</Text>
        <Text modifiers={[font({ textStyle: 'caption' })]}>{first.when}</Text>
        {first.detail ? (
          <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), lineLimit(2), privacySensitive()]}>
            {first.detail}
          </Text>
        ) : null}
        {first.status ? <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle('orange')]}>{first.status}</Text> : null}
        <Spacer />
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={6} modifiers={[widgetURL(first.url)]}>
      <HStack spacing={6}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(brand)]}>{props.heading}</Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), lineLimit(1)]}>
          {props.organizationName}
        </Text>
      </HStack>
      {props.entries.map((entry) => (
        <Link key={entry.key} destination={entry.url}>
          <HStack spacing={6}>
            <VStack alignment="leading" spacing={1}>
              <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(1), privacySensitive()]}>{entry.title}</Text>
              <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), lineLimit(1)]}>
                {entry.status ? `${entry.when} · ${entry.status}` : entry.when}
              </Text>
            </VStack>
            <Spacer />
          </HStack>
        </Link>
      ))}
      {first.rehearseUrl ? (
        <Link destination={first.rehearseUrl}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(brand)]}>{props.rehearseLabel}</Text>
        </Link>
      ) : null}
      <Spacer />
    </VStack>
  );
};

export default createWidget(SCHEDULE_WIDGET_NAME, ScheduleWidget);
