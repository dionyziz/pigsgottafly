import SwiftUI

/// Take-off and landing tables and factors (phase 2C). Until then, the aircraft's page on the website.
struct PerformanceTablesView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(
            title: "Performance", systemImage: "road.lanes", path: "hangar/\(aircraftId)", id: "hangar-performance")
    }
}
