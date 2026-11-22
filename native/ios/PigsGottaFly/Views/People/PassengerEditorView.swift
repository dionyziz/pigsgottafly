import SwiftUI

/// A passenger's details for the manifest and the forms, checked by the core (phase 1G).
struct PassengerEditorView: View {
    /// nil: a new passenger.
    var passengerId: String?

    var body: some View {
        SectionStub(
            title: passengerId == nil ? "New passenger" : "Passenger", systemImage: "person", path: "passengers",
            id: "passenger-editor")
    }
}
