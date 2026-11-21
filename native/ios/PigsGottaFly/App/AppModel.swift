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
    private(set) lazy var symbolNames: [String] = (try? core?.symbolNames()) ?? Symbols.known

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
