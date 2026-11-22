import SwiftUI

/// The revisions, previewed and restored (phase 2C). Until then, the aircraft's page on the website.
struct HistoryView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(
            title: "History", systemImage: "clock.arrow.circlepath", path: "hangar/\(aircraftId)", id: "hangar-history")
    }
}
