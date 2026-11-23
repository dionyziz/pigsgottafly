import SwiftUI

/// The pilot's aircraft and those shared with them (GET /api/aircraft), with the website's hangar
/// actions: Add aircraft (+), and per aircraft Make default aircraft, Add another of this type, and
/// Delete (the owner) or Remove from my hangar (a shared one). On iPad the list selects into the
/// detail column (`selection`); on iPhone a row pushes the aircraft.
struct HangarListView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?
    @State private var aircraft: [AircraftItem]?
    /// The same list as JSON text: the core builds the new aircraft from it.
    @State private var hangarJSON = "[]"
    @State private var error: String?
    @State private var adding: Adding?
    @State private var removing: AircraftItem?
    /// iPhone: the aircraft just added, pushed.
    @State private var opened: Opened?
    @State private var toast: Toast?

    struct Adding: Identifiable {
        let id = UUID()
        var copyOf: String?
    }

    struct Opened: Identifiable, Hashable {
        var id: String
        var registration: String
    }

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
                ContentUnavailableView {
                    Label("No aircraft yet", systemImage: "airplane")
                } actions: {
                    Button("Add aircraft") { adding = Adding() }.buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Hangar")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    adding = Adding()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add aircraft")
                .accessibilityIdentifier("add-aircraft")
            }
        }
        .sheet(item: $adding) { a in
            AddAircraftView(hangar: hangarJSON, copyOf: a.copyOf) { id, message in
                adding = nil
                toast = Toast(message: message)
                Task {
                    await load()
                    open(id)
                }
            }
        }
        .navigationDestination(item: $opened) { o in
            AircraftEditorView(aircraftId: o.id, title: o.registration)
        }
        .confirmDestructive(
            removing.map { $0.isOwner ? "Delete \($0.registration)?" : "Remove \($0.registration) from your hangar?" }
                ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            action: removing?.isOwner == false ? "Remove" : "Delete"
        ) { [removing] in
            if let removing { Task { await remove(removing) } }
        }
        .toast($toast)
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
            .contextMenu { actions(a) }
            .swipeActions(edge: .trailing) {
                Button {
                    removing = a
                } label: {
                    if a.isOwner {
                        Label("Delete", systemImage: "trash")
                    } else {
                        Label("Remove", systemImage: "minus.circle")
                    }
                }
                .tint(.red)
                .accessibilityIdentifier("aircraft-remove-\(a.id)")
            }
            .swipeActions(edge: .leading) {
                Button {
                    adding = Adding(copyOf: a.id)
                } label: {
                    Label("Add another of this type", systemImage: "plus.square.on.square")
                }
                .tint(.accentColor)
            }
            .accessibilityIdentifier("aircraft-\(a.id)")
        }
    }

    @ViewBuilder
    private func actions(_ a: AircraftItem) -> some View {
        if app.pilot?.defaultAircraftId != a.id {
            Button {
                Task { await makeDefault(a) }
            } label: {
                Label("Make default aircraft", systemImage: "star")
            }
        }
        Button {
            adding = Adding(copyOf: a.id)
        } label: {
            Label("Add another of this type", systemImage: "plus.square.on.square")
        }
        .accessibilityIdentifier("aircraft-copy-\(a.id)")
        Divider()
        Button(role: .destructive) {
            removing = a
        } label: {
            if a.isOwner {
                Label("Delete", systemImage: "trash")
            } else {
                Label("Remove from my hangar", systemImage: "minus.circle")
            }
        }
    }

    private func row(_ a: AircraftItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(a.registration).font(.headline)
                if app.pilot?.defaultAircraftId == a.id {
                    Text("Default")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .foregroundStyle(.green)
                        .background(.green.opacity(0.15), in: Capsule())
                        .accessibilityIdentifier("aircraft-default")
                }
            }
            if let m = a.makeModel, !m.isEmpty { Text(m).font(.subheadline).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            let h = try await app.hangar()
            aircraft = h.items
            hangarJSON = h.json
            error = nil
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func open(_ id: String) {
        if let selection {
            selection.wrappedValue = id
        } else {
            opened = Opened(id: id, registration: aircraft?.first { $0.id == id }?.registration ?? "Aircraft")
        }
    }

    private func makeDefault(_ a: AircraftItem) async {
        do {
            try await app.setDefaultAircraft(a.id)
            toast = Toast(message: "\(a.registration) is now your default aircraft")
        } catch {
            if !isCancellation(error) { toast = Toast(message: error.localizedDescription) }
        }
    }

    private func remove(_ a: AircraftItem) async {
        do {
            if a.isOwner {
                try await app.deleteAircraft(a)
            } else {
                try await app.leaveAircraft(a)
            }
            if selection?.wrappedValue == a.id { selection?.wrappedValue = nil }
            await load()
            toast = Toast(
                message: a.isOwner ? "Deleted \(a.registration)" : "Removed \(a.registration) from your hangar")
        } catch {
            if !isCancellation(error) { toast = Toast(message: error.localizedDescription) }
        }
    }
}
