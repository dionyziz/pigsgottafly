import SwiftUI

/// New flight (src/features/lobby/NewFlightPage.tsx). The list's New flight creates the flight at once
/// with the profile's defaults; this sheet is for the two cases that ask first. `.home`: a pilot's first
/// flight asks for their home aerodrome (sign-up asks nothing), saved to the profile before the server
/// starts the flight there. `.ask`: origin and destination, or (Local flight on) the estimated total time
/// of a flight back to the origin; or an empty map. With an empty hangar the pilot
/// may type a registration, and the aircraft is made from the hangar's type template.
struct NewFlightView: View {
    enum Mode: String, Identifiable {
        case home, ask
        var id: String { rawValue }
    }

    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var mode: Mode
    /// An aerodrome code to start the destination with.
    var destination: String?
    var onCreated: (String) -> Void

    @State private var home: Place?
    @State private var from: Place?
    @State private var to: Place?
    @State private var localChosen = false
    @State private var durationMin = NewFlight.defaultLocalDurationMin
    @State private var aircraft: [AircraftItem]?
    @State private var registration = ""
    /// Made once: a failed flight retried does not add a second aircraft.
    @State private var madeAircraftId: String?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if mode == .home {
                    Section {
                        placeRow("Your home aerodrome", place: $home, id: "new-home")
                    }
                } else {
                    routeSection
                }
                registrationSection
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                if mode == .ask {
                    Section {
                        Button("Start with an empty map") {
                            Task { await create { NewFlight.emptyMap(aircraftId: $0) } }
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("new-flight-empty-map")
                    }
                }
            }
            .accessibilityIdentifier(mode == .home ? "home-form" : "new-flight-form")
            .navigationTitle("New flight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Create flight") { Task { await submit() } }
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
    private var routeSection: some View {
        Section {
            placeRow("Origin", place: $from, id: "new-from")
            if localChosen {
                LabeledContent("Destination", value: from?.code ?? "")
                    .accessibilityIdentifier("new-flight-local-to")
            } else {
                HStack {
                    placeRow("Destination", place: $to, id: "new-to", placeholder: "ICAO or name")
                    if to != nil {
                        Button {
                            to = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Clear the destination")
                        .accessibilityIdentifier("new-to-clear")
                    }
                }
            }
            Toggle("Local flight", isOn: $localChosen).accessibilityIdentifier("new-flight-local")
            if localChosen {
                Stepper(value: $durationMin, in: 5...NewFlight.maxLocalDurationMin, step: 5) {
                    LabeledContent("Estimated total time", value: Fmt.hoursMinutes(Double(durationMin)))
                        .monospacedDigit()
                }
                .accessibilityIdentifier("new-flight-duration")
            }
        }
    }

    @ViewBuilder
    private var registrationSection: some View {
        if aircraft?.isEmpty == true, let t = app.aircraftTemplates.first {
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
                        + "Its empty mass and the rest are in the Hangar.")
            }
        }
    }

    private func placeRow(_ label: String, place: Binding<Place?>, id: String, placeholder: String = "Choose")
        -> some View
    {
        NavigationLink {
            PlaceSearchView(title: label, aerodromesOnly: true) { place.wrappedValue = $0 }
        } label: {
            LabeledContent(label) {
                Text(place.wrappedValue.map { "\($0.name) · \($0.detail)" } ?? placeholder).lineLimit(1)
            }
        }
        .accessibilityIdentifier(id)
    }

    private var dest: Place? { localChosen ? from : to }
    private var ready: Bool { !busy && (mode == .home ? home != nil : from != nil && dest != nil) }

    private func load() async {
        if to == nil, mode == .ask, let code = destination?.uppercased() {
            to = await app.places(aerodromesOnly: true).first { $0.code == code || $0.refId == code }
        }
        guard aircraft == nil else { return }
        aircraft = (try? await app.aircraftList()) ?? []
    }

    private func submit() async {
        if mode == .home {
            guard let home else { return }
            await create(saveHome: home) { NewFlight.defaults(aircraftId: $0) }
        } else {
            guard let from, let dest else { return }
            let minutes = durationMin
            await create { NewFlight.route(from: from, to: dest, localDurationMin: minutes, aircraftId: $0) }
        }
    }

    /// The aircraft first (when a registration was typed), then the home aerodrome (the home route needs
    /// it saved before the server builds the flight), then the flight.
    private func create(saveHome: Place? = nil, _ request: (String?) -> JSON) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let reg = registration.trimmingCharacters(in: .whitespaces)
            if madeAircraftId == nil, aircraft?.isEmpty == true, !reg.isEmpty {
                madeAircraftId = try await app.makeAircraft(registration: reg)
            }
            if let saveHome { try await app.saveHome(saveHome) }
            let id = try await app.createFlight(request(madeAircraftId))
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
