import SwiftUI

/// The pilot's aircraft and those shared with them (GET /api/aircraft). On iPad the list selects into
/// the detail column (`selection`); on iPhone a row pushes the aircraft.
struct HangarListView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?
    @State private var aircraft: [AircraftItem]?
    @State private var error: String?

    var body: some View {
        Group {
            if let selection {
                List(selection: selection) { rows(link: false) }
            } else {
                List { rows(link: true) }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if aircraft == nil && error == nil {
                ProgressView()
            } else if let error, aircraft?.isEmpty ?? true {
                ContentUnavailableView("No aircraft", systemImage: "wifi.slash", description: Text(error))
            } else if aircraft?.isEmpty == true {
                ContentUnavailableView("No aircraft yet", systemImage: "airplane")
            }
        }
        .navigationTitle("Hangar")
        .refreshable { await load() }
        .task { await load() }
        .accessibilityIdentifier("hangar-list")
    }

    @ViewBuilder
    private func rows(link: Bool) -> some View {
        ForEach(aircraft ?? []) { a in
            Group {
                if link {
                    NavigationLink {
                        AircraftEditorView(aircraftId: a.id, title: a.registration)
                    } label: {
                        row(a)
                    }
                } else {
                    row(a).tag(a.id)
                }
            }
            .accessibilityIdentifier("aircraft-\(a.id)")
        }
    }

    private func row(_ a: AircraftItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(a.registration).font(.headline)
            if let m = a.makeModel, !m.isEmpty { Text(m).font(.subheadline).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            aircraft = try await app.aircraftList()
            error = nil
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
