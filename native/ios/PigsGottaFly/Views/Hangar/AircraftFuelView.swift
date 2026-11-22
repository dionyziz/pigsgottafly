import SwiftUI

/// Tanks, fuel types and burn (phase 1F). Until then, the aircraft's page on the website.
struct AircraftFuelView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Fuel", systemImage: "fuelpump", path: "hangar/\(aircraftId)", id: "hangar-fuel")
    }
}
