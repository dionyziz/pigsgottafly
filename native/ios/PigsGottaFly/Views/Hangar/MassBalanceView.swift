import SwiftUI

/// Stations, seats, limits and the envelope (phase 1F). Until then, the aircraft's page on the website.
struct MassBalanceView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(
            title: "Mass & balance", systemImage: "scalemass", path: "hangar/\(aircraftId)", id: "hangar-mass-balance")
    }
}
