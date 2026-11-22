import SwiftUI

/// The flight's times in UTC and the sunset. The date and the block-off time are edited in the Navlog
/// until phase 1B adds the taxi times here.
struct WhenView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        List {
            Section("Times (UTC)") {
                if let c = model.computed {
                    ValueRow(label: "Date", value: Fmt.day(model.date))
                    ValueRow(label: "Block off", value: c.blockOff.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Take-off", value: c.takeoff.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Landing", value: c.landing.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Block on", value: c.blockOn.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Sunset", value: c.sunset.map { "\($0)Z" } ?? Fmt.dash)
                } else {
                    Text("Preparing…").foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(FlightSection.when.screenID)
    }
}
