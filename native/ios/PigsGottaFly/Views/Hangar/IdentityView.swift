import SwiftUI

/// Registration, type, colours, operator (phase 1F). Until then, the aircraft's page on the website.
struct IdentityView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Identity", systemImage: "number", path: "hangar/\(aircraftId)", id: "hangar-identity")
    }
}
