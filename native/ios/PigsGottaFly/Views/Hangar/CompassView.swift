import SwiftUI

/// Compass cards, deviations and swing reports (phase 2C). Until then, the aircraft's page on the website.
struct CompassView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Compass cards", systemImage: "safari", path: "hangar/\(aircraftId)", id: "hangar-compass")
    }
}
