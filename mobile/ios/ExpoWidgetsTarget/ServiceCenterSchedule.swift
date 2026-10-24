import WidgetKit
import SwiftUI
internal import ExpoWidgets

struct ServiceCenterSchedule: Widget {
  let name: String = "ServiceCenterSchedule"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: name, provider: WidgetsTimelineProvider(name: name)) { entry in
      WidgetsEntryView(entry: entry)
    }
    .configurationDisplayName("Next serving")
    .description("Your next services and a rehearsal shortcut.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}