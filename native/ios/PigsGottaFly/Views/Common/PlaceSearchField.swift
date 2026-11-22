import SwiftUI

/// A form row holding a place (an aerodrome, a VFR point, a saved waypoint); a tap searches for another.
struct PlaceSearchField: View {
    var label: String
    @Binding var place: Place?
    var aerodromesOnly = true
    var id: String
    @State private var searching = false

    var body: some View {
        Button {
            searching = true
        } label: {
            LabeledContent(label) {
                Text(place.map { "\($0.name) · \($0.detail)" } ?? "Choose")
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
        .sheet(isPresented: $searching) {
            NavigationStack {
                PlaceSearchView(title: label, aerodromesOnly: aerodromesOnly) { place = $0 }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { searching = false } }
                    }
            }
        }
    }
}
