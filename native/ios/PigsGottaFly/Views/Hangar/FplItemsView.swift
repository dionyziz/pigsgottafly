import SwiftUI

/// The ICAO items 10a, 10b and 18 (phase 1F). Until then, the aircraft's page on the website.
struct FplItemsView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(
            title: "Flight plan items", systemImage: "doc.text", path: "hangar/\(aircraftId)", id: "hangar-fpl-items")
    }
}
