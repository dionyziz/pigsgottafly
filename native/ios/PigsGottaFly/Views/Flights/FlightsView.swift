import SwiftUI

/// The flights (src/features/lobby/LobbyPage.tsx): searchable; upcoming, past and shared with me,
/// newest first; Fly again, Rename, Make a copy, Move to trash and Leave by swipe and context menu;
/// the trash with Restore.
struct FlightsView: View {
    @EnvironmentObject private var app: AppModel
    @Binding var selection: String?

    /// `-newFlight [ICAO]` opens New flight's route form at launch, with that destination (screenshots).
    @State private var newFlight: NewFlightView.Mode? =
        ProcessInfo.processInfo.arguments.contains("-newFlight") ? .ask : nil
    @State private var query = ""
    @State private var trashView = false
    @State private var trash: [FlightListItem]?
    @State private var trashError: String?
    @State private var creating = false
    @State private var createError: String?
    @State private var renaming: FlightListItem?
    @State private var renameText = ""
    @State private var toast: Toast?

    private var today: String { app.localToday }

    var body: some View {
        Group {
            if trashView { trashList } else { flightList }
        }
        .searchable(
            text: $query, placement: .navigationBarDrawer(displayMode: .always),
            prompt: trashView ? "Search the trash" : "Search by name, date, aircraft or aerodrome"
        )
        .navigationTitle(trashView ? "Trash" : "Flights")
        .toolbar { toolbar }
        .sheet(item: $newFlight) { mode in
            NewFlightView(mode: mode, destination: LaunchArgs.value("-newFlight")) { open($0) }
        }
        .overlay {
            if creating {
                ProgressView("Creating flight…")
                    .padding(24)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .alert("Could not create the flight", isPresented: present($createError)) {
            Button("Back to flights", role: .cancel) {}
            Button("Try again") { startFlight() }
        } message: {
            Text(createError ?? "")
        }
        .alert("Rename flight", isPresented: present($renaming)) {
            TextField(renaming.map { Lobby.autoTitle(date: Lobby.date($0)) } ?? "", text: $renameText)
                .accessibilityIdentifier("rename-title")
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let r = renaming { rename(r) } }.accessibilityIdentifier("rename-confirm")
        }
        .toast($toast)
        .accessibilityIdentifier(trashView ? "trash-list" : "flight-list")
        .task { await app.loadFlights() }
    }

    // MARK: the flights

    private var flightList: some View {
        let rows = app.flights.filter { Lobby.matches(Lobby.searchText($0), query) }
        let own = rows.filter { $0.sharedBy == nil }
        // flight dates are UTC dates (the flight plan's DOF): before 02:00/03:00 local, the local date is a day ahead
        let (upcoming, past) = Lobby.split(own, today: app.today)
        let shared = rows.filter { $0.sharedBy != nil }
        return List(selection: $selection) {
            section("Upcoming", upcoming)
            section("Past", past)
            section("Shared with me", shared)
        }
        // the list's own menu: on iPad a row's .contextMenu gives way to the selection's
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let r = app.flights.first(where: { ids.contains($0.id) }) { menuItems(r) }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if app.flights.isEmpty {
                if app.loadingFlights {
                    ProgressView()
                } else if let e = app.flightsError {
                    ContentUnavailableView {
                        Label("Could not load your flights", systemImage: "wifi.slash")
                    } description: {
                        Text(e)
                    } actions: {
                        Button("Try again") { Task { await app.loadFlights() } }
                    }
                } else {
                    ContentUnavailableView {
                        Label("No flights yet", systemImage: "airplane")
                    } actions: {
                        Button("New flight") { startFlight() }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("new-flight-empty")
                    }
                }
            } else if rows.isEmpty {
                ContentUnavailableView("No matching flights", systemImage: "magnifyingglass")
            }
        }
        .refreshable { await app.loadFlights() }
    }

    @ViewBuilder
    private func section(_ label: String, _ list: [FlightListItem]) -> some View {
        if !list.isEmpty {
            Section {
                ForEach(list) { row($0) }
            } header: {
                HStack(spacing: 6) {
                    Text(label)
                    Text("\(list.count)").foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func row(_ r: FlightListItem) -> some View {
        FlightRow(item: r, today: today)
            .tag(r.id)
            .listRowBackground(Lobby.date(r) == today ? Color.accentColor.opacity(0.08) : nil)
            .accessibilityIdentifier("flight-\(r.id)")
            .swipeActions(edge: .leading) {
                Button("Fly again", systemImage: "arrow.clockwise") { flyAgain(r) }.tint(.blue)
            }
            .swipeActions(edge: .trailing) {
                if r.sharedBy == nil {
                    Button("Move to trash", systemImage: "trash", role: .destructive) { moveToTrash(r) }
                    Button("Rename", systemImage: "pencil") { startRename(r) }.tint(.orange)
                } else {
                    Button("Leave", systemImage: "person.crop.circle.badge.xmark", role: .destructive) { leave(r) }
                }
            }
    }

    /// The website's row menu (LobbyPage items).
    @ViewBuilder
    private func menuItems(_ r: FlightListItem) -> some View {
        Button("Fly again", systemImage: "arrow.clockwise") { afterMenu { flyAgain(r) } }
        if r.sharedBy == nil {
            Divider()
            Button("Rename", systemImage: "pencil") { startRename(r) }
            Button("Make a copy", systemImage: "plus.square.on.square") { afterMenu { copy(r) } }
            Divider()
            Button("Move to trash", systemImage: "trash", role: .destructive) { afterMenu { moveToTrash(r) } }
        } else {
            Divider()
            Button("Leave", systemImage: "person.crop.circle.badge.xmark", role: .destructive) {
                afterMenu { leave(r) }
            }
        }
    }

    // MARK: the trash

    private var trashList: some View {
        let rows = (trash ?? []).filter { Lobby.matches(Lobby.searchText($0), query) }
        return List {
            if !rows.isEmpty {
                Section {
                    ForEach(rows) { r in
                        FlightRow(item: r, today: today)
                            .accessibilityIdentifier("trashed-\(r.id)")
                            .swipeActions(edge: .trailing) {
                                Button("Restore", systemImage: "arrow.uturn.backward") { restore(r) }.tint(.blue)
                            }
                            .contextMenu {
                                Button("Restore", systemImage: "arrow.uturn.backward") { afterMenu { restore(r) } }
                            }
                    }
                } header: {
                    HStack(spacing: 6) {
                        Text("In the trash")
                        Text("\(rows.count)").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if trash == nil {
                if let e = trashError {
                    ContentUnavailableView {
                        Label("Could not load your flights", systemImage: "wifi.slash")
                    } description: {
                        Text(e)
                    } actions: {
                        Button("Try again") { Task { await loadTrash() } }
                    }
                } else {
                    ProgressView()
                }
            } else if trash?.isEmpty == true {
                ContentUnavailableView("The trash is empty", systemImage: "trash")
            } else if rows.isEmpty {
                ContentUnavailableView("No matching flights", systemImage: "magnifyingglass")
            }
        }
        .refreshable { await loadTrash() }
        .task { await loadTrash() }
    }

    private func loadTrash() async {
        do {
            trash = try await app.trashedFlights()
            trashError = nil
        } catch {
            if !isCancellation(error) { trashError = error.localizedDescription }
        }
    }

    // MARK: toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                query = ""
                trashView.toggle()
            } label: {
                Label(trashView ? "All flights" : "Trash", systemImage: trashView ? "airplane" : "trash")
            }
            .accessibilityIdentifier("trash-view")
        }
        if !trashView {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("New flight", systemImage: "plus") { startFlight() }
                    Button(
                        "Choose origin and destination",
                        systemImage: "point.topleft.down.to.point.bottomright.curvepath"
                    ) {
                        newFlight = .ask
                    }
                    .accessibilityIdentifier("new-flight-ask")
                } label: {
                    Image(systemName: "plus").imageScale(.large)
                } primaryAction: {
                    startFlight()
                }
                .accessibilityLabel("New flight")
                .accessibilityIdentifier("new-flight")
                .disabled(creating)
            }
        }
    }

    // MARK: actions

    private func open(_ id: String) {
        trashView = false
        selection = id
    }

    /// UICollectionView throws (invalid number of items) when the list changes while a context menu's
    /// preview is still animating back into its row.
    private func afterMenu(_ action: @escaping () -> Void) {
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            action()
        }
    }

    private func fail(_ what: String, _ error: Error) {
        if !isCancellation(error) { toast = Toast(message: "\(what): \(error.localizedDescription)") }
    }

    /// The website's New flight: at once with the profile's defaults; the first flight asks for the
    /// home aerodrome first (sign-up asks nothing).
    private func startFlight() {
        Task {
            if app.pilot == nil { await app.loadPilot() }
            if let p = app.pilot, (p.homeAerodrome ?? "").isEmpty {
                newFlight = .home
                return
            }
            creating = true
            defer { creating = false }
            do {
                open(try await app.createFlight(NewFlight.defaults()))
            } catch {
                if !isCancellation(error) { createError = error.localizedDescription }
            }
        }
    }

    private func flyAgain(_ r: FlightListItem) {
        Task {
            do { open(try await app.flyAgain(r)) } catch { fail("Could not copy", error) }
        }
    }

    private func copy(_ r: FlightListItem) {
        Task {
            do {
                let c = try await app.copyFlight(r)
                toast = Toast(message: "Made “\(c.title)”", actionLabel: "Open") { open(c.id) }
            } catch {
                fail("Could not copy", error)
            }
        }
    }

    private func moveToTrash(_ r: FlightListItem) {
        if selection == r.id { selection = nil }
        Task {
            do {
                try await app.trashFlight(r)
                toast = Toast(message: "“\(Lobby.title(r))” moved to trash", actionLabel: "Undo") {
                    Task {
                        do { try await app.restoreFlight(r.id) } catch { fail("Could not restore", error) }
                    }
                }
            } catch {
                fail("Could not move to trash", error)
            }
        }
    }

    private func restore(_ r: FlightListItem) {
        trash?.removeAll { $0.id == r.id }
        Task {
            do {
                try await app.restoreFlight(r.id)
                toast = Toast(message: "“\(Lobby.title(r))” restored", actionLabel: "Open") { open(r.id) }
            } catch {
                fail("Could not restore", error)
            }
            await loadTrash()
        }
    }

    private func leave(_ r: FlightListItem) {
        if selection == r.id { selection = nil }
        Task {
            do {
                try await app.leaveFlight(r)
                toast = Toast(message: "You left “\(Lobby.title(r))”")
            } catch {
                fail("Could not leave the flight", error)
            }
        }
    }

    /// The automatic name (the date) is the placeholder: an automatic title starts empty.
    private func startRename(_ r: FlightListItem) {
        let auto = Lobby.autoTitle(date: Lobby.date(r))
        renameText = r.summary.title == auto ? "" : r.summary.title
        renaming = r
    }

    private func rename(_ r: FlightListItem) {
        let title = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do { try await app.renameFlight(r.id, to: title) } catch { fail("Could not rename", error) }
        }
    }
}

/// An alert shown while `value` is set, which clears it when dismissed.
private func present<T>(_ value: Binding<T?>) -> Binding<Bool> {
    Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
}
