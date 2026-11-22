import SwiftUI

/// New flight: departure and destination, date and block-off time (UTC), and the aircraft; POST
/// /api/flights, then the flight opens. Only the route is required. A pilot with no aircraft may name
/// one, and it is made from the hangar's type template, as the website's Add aircraft does. A pilot's
/// first flight asks for their home aerodrome (sign-up asks nothing), saved to the profile; it departs there.
struct NewFlightView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// An aerodrome code to start the destination with.
    var destination: String?
    var onCreated: (String) -> Void

    @State private var from: Place?
    @State private var to: Place?
    @State private var date = NewFlightView.defaultDate()
    @State private var aircraft: [AircraftItem]?
    @State private var aircraftId: String?
    @State private var registration = ""
    @State private var busy = false
    @State private var error: String?

    private static let utc = TimeZone(identifier: "UTC")!

    /// The next full hour (UTC), at least half an hour away.
    static func defaultDate(now: Date = Date()) -> Date {
        let hour = 3600.0
        return Date(timeIntervalSince1970: ((now.timeIntervalSince1970 + 1800) / hour).rounded(.up) * hour)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Route") {
                    placeRow(noHome ? "Your home aerodrome" : "From", place: $from, id: "new-from")
                    placeRow("To", place: $to, id: "new-to")
                }
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                        .accessibilityIdentifier("new-date")
                    DatePicker("Block off (UTC)", selection: $date, displayedComponents: .hourAndMinute)
                        .accessibilityIdentifier("new-blockoff")
                } header: {
                    Text("When")
                }
                .environment(\.timeZone, Self.utc)
                aircraftSection
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New flight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Create") { Task { await create() } }
                            .disabled(!ready)
                            .accessibilityIdentifier("create-flight")
                    }
                }
            }
            .task { await load() }
        }
        .interactiveDismissDisabled(busy)
    }

    @ViewBuilder
    private var aircraftSection: some View {
        if let list = aircraft {
            if list.isEmpty, let t = app.aircraftTemplates.first {
                Section {
                    TextField("Registration (optional), e.g., SX-ABC", text: $registration)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("new-registration")
                } header: {
                    Text("Aircraft")
                } footer: {
                    Text(
                        "Your hangar is empty: a new \(t.label) (\(t.description)) is added with this registration. "
                            + "Its empty mass and the rest are in the hangar on pigsgottafly.com.")
                }
            } else {
                Section("Aircraft") {
                    Picker("Aircraft", selection: $aircraftId) {
                        if list.isEmpty { Text("None").tag(String?.none) }
                        ForEach(list) { Text($0.label).tag(String?.some($0.id)) }
                    }
                    .accessibilityIdentifier("new-aircraft")
                }
            }
        } else {
            Section("Aircraft") { ProgressView() }
        }
    }

    private func placeRow(_ label: String, place: Binding<Place?>, id: String) -> some View {
        NavigationLink {
            PlaceSearchView(title: label, aerodromesOnly: true) { place.wrappedValue = $0 }
        } label: {
            HStack {
                Text(label)
                Spacer()
                Text(place.wrappedValue.map { "\($0.name) · \($0.detail)" } ?? "Choose")
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityIdentifier(id)
    }

    private var ready: Bool { from != nil && to != nil && !busy }

    /// Offered only once the pilot has loaded without one.
    private var noHome: Bool { app.pilot.map { ($0.homeAerodrome ?? "").isEmpty } ?? false }

    private func load() async {
        if from == nil, let home = app.pilot?.homeAerodrome {
            from = await app.places(aerodromesOnly: true).first { $0.code == home || $0.refId == home }
        }
        if to == nil, let code = destination?.uppercased() {
            to = await app.places(aerodromesOnly: true).first { $0.code == code || $0.refId == code }
        }
        guard aircraft == nil else { return }
        do {
            let list = try await app.aircraftList()
            aircraft = list
            let preferred = app.pilot?.defaultAircraftId
            aircraftId = list.first { $0.id == preferred }?.id ?? list.first?.id
        } catch {
            aircraft = []
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func create() async {
        guard let from, let to else { return }
        busy = true
        error = nil
        defer { busy = false }
        let choice: AppModel.AircraftChoice?
        if let id = aircraftId {
            choice = .existing(id)
        } else if aircraft?.isEmpty == true, let t = app.aircraftTemplates.first,
            case let reg = registration.trimmingCharacters(in: .whitespaces), !reg.isEmpty
        {
            choice = .template(id: t.id, registration: reg)
        } else {
            choice = nil
        }
        // a failed save does not stop the flight: the home aerodrome can be set in Account
        if noHome { try? await app.saveHome(from) }
        do {
            let id = try await app.createFlight(
                from: from, to: to, date: Fmt.isoDay(from: date), blockOff: Fmt.clock(date), aircraft: choice)
            dismiss()
            onCreated(id)
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}

/// Searches aerodromes (and VFR points and saved waypoints) by code or name; a tap chooses one.
struct PlaceSearchView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var title: String
    var aerodromesOnly: Bool
    var onPick: (Place) -> Void

    @State private var places: [Place] = []
    @State private var query = ""
    @State private var loaded = false

    var body: some View {
        List {
            let found = Places.search(query, in: places)
            ForEach(found) { p in
                Button {
                    onPick(p)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name).font(.headline).foregroundStyle(.primary)
                        Text(p.detail).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("place-\(p.id)")
            }
            if loaded && found.isEmpty {
                Text(places.isEmpty ? "The reference data has not loaded: try again with a connection." : "No match.")
                    .foregroundStyle(.secondary)
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .searchable(
            text: $query, placement: .navigationBarDrawer(displayMode: .always),
            prompt: aerodromesOnly ? "ICAO code or name" : "Aerodrome, VFR point or waypoint"
        )
        .autocorrectionDisabled()
        .textInputAutocapitalization(.characters)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            places = await app.places(aerodromesOnly: aerodromesOnly)
            loaded = true
        }
    }
}
