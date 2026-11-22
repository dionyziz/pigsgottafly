import SwiftUI

/// A list of the pilot's records (passengers, waypoints, operators) as the API answers them. On iPad
/// it selects into the detail column (`selection`); on iPhone a row pushes `destination`.
struct RecordList<Destination: View>: View {
    var title: String
    /// The website's data-testid of the list (`passenger-list`, `waypoint-list`, `operator-list`).
    var id: String
    /// The row identifiers: `<rowPrefix>-<record id>`.
    var rowPrefix: String
    var empty: String
    var load: () async throws -> [JSON]
    var label: (JSON) -> (String, String?)
    var selection: Binding<String?>?
    @ViewBuilder var destination: (JSON) -> Destination

    @State private var records: [JSON]?
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
            if records == nil && error == nil {
                ProgressView()
            } else if let error, records?.isEmpty ?? true {
                ContentUnavailableView(title, systemImage: "wifi.slash", description: Text(error))
            } else if records?.isEmpty == true {
                ContentUnavailableView(empty, systemImage: "tray")
            }
        }
        .navigationTitle(title)
        .refreshable { await reload() }
        .task { await reload() }
        .accessibilityIdentifier(id)
    }

    @ViewBuilder
    private func rows(link: Bool) -> some View {
        let all = records ?? []
        ForEach(all.indices, id: \.self) { i in
            let r = all[i]
            let rid = r["id"]?.string ?? ""
            Group {
                if link {
                    NavigationLink {
                        destination(r)
                    } label: {
                        row(r)
                    }
                } else {
                    row(r).tag(rid)
                }
            }
            .accessibilityIdentifier("\(rowPrefix)-\(rid)")
        }
    }

    private func row(_ r: JSON) -> some View {
        let (main, detail) = label(r)
        return VStack(alignment: .leading, spacing: 2) {
            Text(main).font(.headline)
            if let detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 4)
    }

    private func reload() async {
        do {
            records = try await load()
            error = nil
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
