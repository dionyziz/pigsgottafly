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
        } else if fixtures, let t = FixtureTransport.bundled() {
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
