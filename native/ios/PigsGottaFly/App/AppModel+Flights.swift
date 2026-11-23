import Foundation

/// POST /api/flights as the website's New flight sends it (src/features/lobby/NewFlightPage.tsx).
/// The server fills in the rest from the profile: the home route, the default aircraft, taxi times,
/// wind model, PIC on the manifest.
enum NewFlight {
    /// shared/local.ts DEFAULT_LOCAL_DURATION_MIN and MAX_LOCAL_DURATION_MIN.
    static let defaultLocalDurationMin = 60
    static let maxLocalDurationMin = 24 * 60

    /// Nothing but the profile's defaults: the flight starts at the home aerodrome.
    static func defaults(aircraftId: String? = nil) -> JSON { withAircraft([:], aircraftId) }

    /// "Start with an empty map".
    static func emptyMap(aircraftId: String? = nil) -> JSON { withAircraft(["route": []], aircraftId) }

    /// Origin and destination as aerodrome points; a local flight (the same aerodrome at both ends)
    /// carries its airborne time, which the server puts over the profile's options.
    static func route(from: Place, to: Place, localDurationMin: Int, aircraftId: String? = nil) -> JSON {
        var o: [String: JSON] = ["route": [from.routePoint(), to.routePoint()]]
        if isLocal(from: from, to: to) {
            o["options"] = ["localDurationMin": .number(Double(localDurationMin))]
        }
        return withAircraft(.object(o), aircraftId)
    }

    static func isLocal(from: Place, to: Place) -> Bool { from.kind == to.kind && from.refId == to.refId }

    /// Only an aircraft just made from a type template is named: otherwise the server's default stands.
    private static func withAircraft(_ body: JSON, _ id: String?) -> JSON {
        guard let id else { return body }
        var b = body
        b["aircraftId"] = .string(id)
        return b
    }
}

/// The flight list's actions, as the website's lobby does them (src/features/lobby/LobbyPage.tsx).
extension AppModel {
    var mine: [FlightListItem] { flights.filter { $0.sharedBy == nil } }
    var shared: [FlightListItem] { flights.filter { $0.sharedBy != nil } }

    /// Today in Greece: the relative days and "Fly again" count from it, as on the website.
    var localToday: String { todayOverride ?? Lobby.localToday() }

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
            if !isCancellation(error) { flightsError = error.localizedDescription }
        }
    }

    /// GET /flights?trash=1.
    func trashedFlights() async throws -> [FlightListItem] {
        try api.decode([FlightListItem].self, try await api.flights(trash: true))
    }

    /// POST /api/aircraft from the first type template (an empty hangar's first aircraft); its id.
    func makeAircraft(registration: String) async throws -> String {
        guard let core else { throw APIError.http(0, coreError ?? "The core did not load.") }
        guard let t = aircraftTemplates.first else { throw APIError.http(0, "No aircraft template.") }
        let body = try core.aircraftFromTemplate(id: t.id, registration: registration)
        let created = try JSON.parse(try await api.createAircraft(Data(body.utf8)))
        guard let id = created["id"]?.string else { throw APIError.http(0, "The server sent no aircraft.") }
        return id
    }

    /// POST /api/flights; the new flight's id. It opens on Plan: a flight just created has nothing to
    /// brief yet, even when it is for today (NewFlightPage rememberStage).
    func createFlight(_ request: JSON) async throws -> String {
        let data = try await api.createFlight(request)
        guard let id = try JSON.parse(data)["id"]?.string else { throw APIError.http(0, "The server sent no flight.") }
        try? store.write(data, .flight(id))
        createdHere.insert(id)
        await loadFlights()
        return id
    }

    /// "Fly again": the same trip today (named after its route, nothing filed or signed); its id.
    func flyAgain(_ item: FlightListItem) async throws -> String {
        let data = try await api.copyFlight(item.id, title: "", date: localToday)
        guard let id = try JSON.parse(data)["id"]?.string else { throw APIError.http(0, "The server sent no flight.") }
        await loadFlights()
        return id
    }

    /// "Make a copy": "Copy of …" on the same day; its id and title.
    func copyFlight(_ item: FlightListItem) async throws -> (id: String, title: String) {
        let c = try JSON.parse(try await api.copyFlight(item.id, title: nil, date: nil))
        guard let id = c["id"]?.string else { throw APIError.http(0, "The server sent no flight.") }
        await loadFlights()
        let title = c["title"]?.string ?? ""
        return (id, title.isEmpty ? c["summary"]?["title"]?.string ?? "" : title)
    }

    /// DELETE /flights/:id. The row goes at once; the list is reloaded either way.
    func trashFlight(_ item: FlightListItem) async throws {
        flights.removeAll { $0.id == item.id }
        do {
            try await api.trashFlight(item.id)
        } catch {
            await loadFlights()
            throw error
        }
        await loadFlights()
    }

    func restoreFlight(_ id: String) async throws {
        do {
            _ = try await api.restoreFlight(id)
        } catch {
            await loadFlights()
            throw error
        }
        await loadFlights()
    }

    /// "Leave" a flight shared with this pilot: their own access ends (the owner can share it again).
    func leaveFlight(_ item: FlightListItem) async throws {
        if pilot == nil { await loadPilot() }
        guard let me = pilot?.id else { throw APIError.http(0, "The profile has not loaded yet.") }
        flights.removeAll { $0.id == item.id }
        do {
            try await api.removeFlightShare(item.id, key: me)
        } catch {
            await loadFlights()
            throw error
        }
        await loadFlights()
    }

    /// The PUT the website's Rename sends: typing back exactly the automatic name (the date) keeps the
    /// title automatic, so it follows later edits. A version conflict is retried once on the fresh copy.
    func renameFlight(_ id: String, to title: String) async throws {
        for attempt in 0..<2 {
            let f = try JSON.parse(try await api.flight(id))
            let body = Self.renamed(f, to: title)
            do {
                _ = try await api.updateFlight(id, doc: body, version: f["version"]?.int ?? 0)
                break
            } catch APIError.conflict where attempt == 0 {
                continue
            }
        }
        await loadFlights()
    }

    nonisolated static func renamed(_ flight: JSON, to title: String) -> JSON {
        var doc = FlightModel.docOf(flight)
        let auto = Lobby.autoTitle(date: doc["date"]?.string ?? "")
        let stored = title == auto ? "" : title
        doc["title"] = .string(stored)
        var summary = doc["summary"]?.object ?? [:]
        summary["title"] = .string(stored.isEmpty ? auto : stored)
        doc["summary"] = .object(summary)
        return doc
    }
}
