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
    let subscriptions: Subscriptions
    let fixtures: Bool
    let simulatedPosition: Position?
    /// `-noNetwork` (tests): not even the base map's style is fetched.
    let noNetwork: Bool
    /// `-today YYYY-MM-DD` (tests, screenshots): the fixture flights' date counts as today.
    let todayOverride: String?

    /// Today in UTC, the flight dates' time zone.
    var today: String { todayOverride ?? Fmt.isoDay(from: Date()) }

    /// The tab each flight was left on in this session (the website keeps the stage in sessionStorage
    /// the same way: readiness.ts rememberStage).
    private var tabs: [String: FlightTab] = [:]

    func rememberTab(_ tab: FlightTab, for id: String) { tabs[id] = tab }
    func rememberedTab(for id: String) -> FlightTab? { tabs[id] }

    /// The flights made in New flight in this session.
    var createdHere: Set<String> = []
    func isNew(_ id: String) -> Bool { createdHere.contains(id) }

    /// The symbol images the chart style uses (PGF.symbolNames()).
    private(set) lazy var symbols: [SymbolInfo] = (try? core?.symbolNames()) ?? Symbols.known
    /// How the chart draws its lines and areas (PGF.lineStyles()), for the layer toggles' legend.
    private(set) lazy var lineStyles: [String: LineStyle] = (try? core?.lineStyles()) ?? [:]

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
        todayOverride = LaunchArgs.value("-today", arguments)
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
        subscriptions = Subscriptions(api: api, session: session, listen: !fixtures && testAPI == nil)
        flights = Self.sorted(store.decode([FlightListItem].self, .flights) ?? [])
    }

    static func sorted(_ list: [FlightListItem]) -> [FlightListItem] {
        list.filter { !$0.deleted }
    }

    // MARK: the pilot

    /// GET /api/me (the cached copy until it answers).
    @Published private(set) var pilot: PilotProfile?

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

    /// New flight's "Make it my home aerodrome": only the home aerodrome changes.
    func saveHome(_ home: Place) async throws {
        let data = try await api.updateMe(["homeAerodrome": .string(home.code)])
        pilot = try api.decode(PilotProfile.self, data)
        try? store.write(data, .pilot)
    }

    /// Bumped when an aircraft leaves the hangar from outside the list (the share sheet's "Remove my
    /// access" on the aircraft's page): the list reads itself again.
    @Published var hangarChanged = 0
    /// Bumped when an operator is created, renamed, deleted or left from its page: the list (beside it
    /// on iPad) reads itself again.
    @Published var operatorsChanged = 0
    /// A toast that outlives the screen that raised it: an operator's page closes after Delete or
    /// Leave, and a new aircraft's page covers the hangar list on iPhone, so the shell shows these.
    @Published var toast: Toast?

    /// The hangar's "Make default aircraft".
    func setDefaultAircraft(_ id: String) async throws {
        let data = try await api.updateMe(["defaultAircraftId": .string(id)])
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
}
