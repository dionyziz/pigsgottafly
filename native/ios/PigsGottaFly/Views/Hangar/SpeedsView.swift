import SwiftUI

/// Cruise, pattern and climb speeds (phase 1F). Until then, the aircraft's page on the website.
struct SpeedsView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Speeds", systemImage: "speedometer", path: "hangar/\(aircraftId)", id: "hangar-speeds")
    }
}
