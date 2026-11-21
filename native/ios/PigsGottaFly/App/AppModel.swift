import Foundation
import SwiftUI

/// What every screen shares: the API, the core, the cache and the session. Fixture mode (launch
/// argument `-fixtures`) answers the API from the bundled fixtures, skips the sign-in and keeps its
/// cache in a temporary folder.
@MainActor
final class AppModel: ObservableObject {
    let api: API
    let store: Store
    let core: Core?
    let coreError: String?
    let session: Session
    let fixtures: Bool
    let simulatedPosition: Position?
    /// `-noNetwork` (tests): not even the base map's style is fetched.
    let noNetwork: Bool

    /// The symbol images the chart style uses (PGF.symbolNames()).
    private(set) lazy var symbols: [SymbolInfo] = (try? core?.symbolNames()) ?? Symbols.known

    /// The terrain grid was handed to the core (once per JSContext: NATIVE.md "setTerrain").
    private var terrainSet = false

    /// Gives the core the terrain grid (https://pigsgottafly.com/terrain/greece.bin): the saved copy, else
    /// fetched and saved, else the copy built into the app (public/terrain/greece.bin, for a first
    /// launch offline). The default altitude of uncharted legs and the low-leg warnings use it, as on
    /// the website.
    func ensureTerrain() async {
        guard let core, !terrainSet else { return }
        var grid = store.read(.terrain)
        if grid == nil, let d = try? await api.site(Self.terrainPath), d.count == Self.terrainBytes {
            try? store.write(d, .terrain)
            grid = d
        }
        if grid == nil { grid = Self.bundledTerrain() }
        guard let grid, !terrainSet else { return }
        if (try? await core.run({ try $0.setTerrain(grid) })) == true { terrainSet = true }
    }

    nonisolated static let terrainPath = "terrain/greece.bin"
    /// src/calc/terrain.ts TERRAIN_GRID rows × cols.
    nonisolated static let terrainBytes = 880_000

    nonisolated static func bundledTerrain(_ bundle: Bundle = .main) -> Data? {
        bundle.url(forResource: "greece", withExtension: "bin").flatMap { try? Data(contentsOf: $0) }
    }

    @Published var flights: [FlightListItem] = []
    @Published var flightsError: String?
    @Published var loadingFlights = false

    /// `api` and `store` stand in for the live ones (tests).
    init(
        arguments: [String] = ProcessInfo.processInfo.arguments, api testAPI: API? = nil, store testStore: Store? = nil
    ) {
        fixtures = arguments.contains("-fixtures")
        simulatedPosition = LocationFeed.simulated(from: arguments)
        noNetwork = arguments.contains("-noNetwork")
        if let testAPI, let testStore {
            api = testAPI
            store = testStore
        } else if fixtures, let t = FixtureTransport.bundled(emptyAccount: arguments.contains("-emptyAccount")) {
            api = API(transport: t)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pgf-fixtures-\(UUID().uuidString)")
            store = Store(root: dir)
        } else {
            api = API.live()
            store = Store.standard()
        }
        do {
            core = try Core.bundled()
            coreError = nil
        } catch {
            core = nil
            coreError = error.localizedDescription
        }
        session = Session(api: api, store: store, fixtures: fixtures)
        flights = Self.sorted(store.decode([FlightListItem].self, .flights) ?? [])
    }

    static func sorted(_ list: [FlightListItem]) -> [FlightListItem] {
        list.filter { !$0.deleted }
    }

    var mine: [FlightListItem] { flights.filter { $0.sharedBy == nil } }
    var shared: [FlightListItem] { flights.filter { $0.sharedBy != nil } }

    func loadFlights() async {
        loadingFlights = true
        defer { loadingFlights = false }
        do {
            let data = try await api.flights()
            flights = Self.sorted(try api.decode([FlightListItem].self, data))
            try? store.write(data, .flights)
            flightsError = nil
        } catch APIError.unauthorized {
            session.lost()
        } catch APIError.offline {
            flightsError = flights.isEmpty ? "No connection." : nil
        } catch {
            flightsError = error.localizedDescription
        }
    }

    // MARK: the pilot

    /// GET /api/me (the cached copy until it answers).
    @Published private(set) var pilot: PilotProfile?

    /// A new pilot is asked for name, phone and home aerodrome first, as on the website.
    var needsProfile: Bool { !(pilot?.missing.isEmpty ?? true) }

    func loadPilot() async {
        if pilot == nil { pilot = store.decode(PilotProfile.self, .pilot) }
        do {
            let data = try await api.me()
            pilot = try api.decode(PilotProfile.self, data)
            try? store.write(data, .pilot)
        } catch APIError.unauthorized {
            session.lost()
        } catch {}
    }

    func saveProfile(fullName: String, phone: String, home: Place?) async throws {
        guard let current = pilot else { throw APIError.http(0, "The profile has not loaded yet.") }
        let data = try await api.updateMe(current.update(fullName: fullName, phone: phone, home: home))
        pilot = try api.decode(PilotProfile.self, data)
        try? store.write(data, .pilot)
    }

    func deleteAccount(confirm: String) async throws {
        try await session.deleteAccount(confirm: confirm)
        pilot = nil
        flights = []
        refJSON = nil
    }

    // MARK: places and aircraft (New flight, route edits)

    private var refJSON: JSON?

    /// GET /api/ref/bundle: the cached copy, fetched when missing or older than 6 hours.
    func ref() async -> JSON? {
        let age = store.modified(.ref).map { -$0.timeIntervalSinceNow } ?? .infinity
        if age > 6 * 3600, let data = try? await api.refBundle() {
            try? store.write(data, .ref)
            refJSON = nil
        }
        if refJSON == nil, let d = store.read(.ref) { refJSON = try? JSON.parse(d) }
        return refJSON
    }

    /// GET /api/waypoints (the cached copy offline).
    func waypoints() async -> JSON? {
        if let data = try? await api.waypoints() { try? store.write(data, .waypoints) }
        return store.read(.waypoints).flatMap { try? JSON.parse($0) }
    }

    /// Every place a route point can be: aerodromes, VFR points, saved waypoints.
    func places(aerodromesOnly: Bool) async -> [Place] {
        let ref = await ref() ?? .null
        if aerodromesOnly { return Places.aerodromes(ref: ref) }
        return Places.aerodromes(ref: ref) + Places.vfrPoints(ref: ref) + Places.waypoints(await waypoints())
    }

    func aircraftList() async throws -> [AircraftItem] {
        try api.decode([AircraftItem].self, try await api.aircraftList())
    }

    var aircraftTemplates: [AircraftTemplate] { (try? core?.aircraftTemplates()) ?? [] }

    /// What a new flight flies: an aircraft of the hangar, or a new one from a type template.
    enum AircraftChoice: Equatable {
        case existing(String)
        case template(id: String, registration: String)
    }

    /// POST /api/flights (after POST /api/aircraft for a template); returns the new flight's id.
    func createFlight(from: Place, to: Place, date: String, blockOff: String, aircraft: AircraftChoice?)
        async throws -> String
    {
        var aircraftId: String?
        switch aircraft {
        case .existing(let id): aircraftId = id
        case .template(let tid, let registration):
            guard let core else { throw APIError.http(0, coreError ?? "The core did not load.") }
            let body = try core.aircraftFromTemplate(id: tid, registration: registration)
            let created = try JSON.parse(try await api.createAircraft(Data(body.utf8)))
            aircraftId = created["id"]?.string
        case nil: aircraftId = nil
        }
        let request = NewFlight.request(from: from, to: to, date: date, blockOff: blockOff, aircraftId: aircraftId)
        let data = try await api.createFlight(request)
        guard let id = try JSON.parse(data)["id"]?.string else { throw APIError.http(0, "The server sent no flight.") }
        try? store.write(data, .flight(id))
        await loadFlights()
        return id
    }

    /// "Fly again": a copy of the flight for today; returns its id.
    func flyAgain(_ item: FlightListItem) async -> String? {
        do {
            let data = try await api.copyFlight(item.id, date: Fmt.isoDay(from: Date()))
            let id = (try JSON.parse(data))["id"]?.string
            await loadFlights()
            return id
        } catch {
            flightsError = error.localizedDescription
            return nil
        }
    }
}
