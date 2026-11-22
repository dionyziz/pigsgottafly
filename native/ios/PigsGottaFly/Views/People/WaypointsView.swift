import SwiftUI

/// The pilot's saved waypoints (GET /api/waypoints). Phase 1G adds the map, typed coordinates, notes.
struct WaypointsView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?

    var body: some View {
        RecordList(
            title: "Waypoints", id: "waypoint-list", rowPrefix: "waypoint", empty: "No waypoints yet",
            load: { try app.api.decode([JSON].self, try await app.api.waypoints()) },
            label: { w in
                let coords = [w["lat"]?.double, w["lon"]?.double].compactMap { $0 }.map { String(format: "%.4f", $0) }
                return (w["name"]?.string ?? "Waypoint", coords.joined(separator: ", "))
            },
            selection: selection
        ) { _ in WaypointEditorView() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    WaypointEditorView()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add a waypoint")
                .accessibilityIdentifier("add-waypoint")
            }
        }
    }
}

/// A waypoint on the map with its name and notes (phase 1G).
struct WaypointEditorView: View {
    var body: some View {
        SectionStub(title: "Waypoint", systemImage: "mappin", path: "waypoints", id: "waypoint-map")
    }
}
