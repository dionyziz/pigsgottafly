import SwiftUI

/// The pilot's passengers (GET /api/passengers), sorted by name as the server sends them.
struct PassengersView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?

    var body: some View {
        RecordList(
            title: "Passengers", id: "passenger-list", rowPrefix: "passenger", empty: "No passengers yet",
            load: { try await app.api.passengers(as: [JSON].self) },
            label: { ($0["fullName"]?.string ?? "Passenger", $0["email"]?.string) },
            selection: selection
        ) { PassengerEditorView(passengerId: $0["id"]?.string) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    PassengerEditorView(passengerId: nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add a passenger")
                .accessibilityIdentifier("add-passenger")
            }
        }
    }
}
