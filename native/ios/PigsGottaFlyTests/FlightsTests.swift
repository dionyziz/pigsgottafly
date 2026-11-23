import XCTest

@testable import PigsGottaFly

/// The flight list and New flight send what the website's LobbyPage and NewFlightPage send, and
/// write rows as src/features/lobby/format.ts does.
@MainActor
final class FlightsTests: XCTestCase {
    private var ref: JSON!

    override func setUpWithError() throws {
        ref = try JSON.parse(try Fixtures.data("ref.json"))
    }

    private func aerodrome(_ id: String) throws -> Place {
        try XCTUnwrap(Places.aerodromes(ref: ref).first { $0.refId == id })
    }

    // MARK: New flight

    func testNewFlightBodiesAreTheWebsites() throws {
        let lgtt = try aerodrome("LGTT")
        let lgsy = try aerodrome("LGSY")
        XCTAssertEqual(NewFlight.defaults(), [:], "the profile's defaults: the home route")
        XCTAssertEqual(NewFlight.emptyMap(), ["route": []])
        XCTAssertEqual(NewFlight.defaults(aircraftId: "ac9"), ["aircraftId": "ac9"])

        let r = NewFlight.route(from: lgtt, to: lgsy, localDurationMin: 90)
        let route = try XCTUnwrap(r["route"]?.array)
        XCTAssertEqual(route.map { $0["kind"]?.string }, ["aerodrome", "aerodrome"])
        XCTAssertEqual(route.map { $0["refId"]?.string }, ["LGTT", "LGSY"])
        XCTAssertEqual(route[1]["lat"]?.double, 38.9675)
        XCTAssertEqual(route[0]["uid"]?.string?.count, 8)
        XCTAssertNotEqual(route[0]["uid"], route[1]["uid"])
        XCTAssertNil(r["options"], "only a local flight carries a duration")
        XCTAssertNil(r["date"], "the server's date")
        XCTAssertNil(r["aircraftId"], "the server's default aircraft")
        XCTAssertEqual(r.object.map { Array($0.keys) }, ["route"])

        let local = NewFlight.route(from: lgtt, to: lgtt, localDurationMin: 90)
        XCTAssertEqual(local["route"]?.array?.map { $0["refId"]?.string }, ["LGTT", "LGTT"])
        XCTAssertEqual(local["options"], ["localDurationMin": 90])
    }

    func testTheFirstFlightSavesTheHomeAerodromeAndStartsThere() async throws {
        let t = try XCTUnwrap(FixtureTransport.bundled(emptyAccount: true))
        let app = AppModel(arguments: ["-fixtures"], api: API(transport: t), store: temporaryStore())
        try await app.saveHome(try aerodrome("LGTT"))
        let ac = try await app.makeAircraft(registration: "sx-abc")
        let id = try await app.createFlight(NewFlight.defaults(aircraftId: ac))
        XCTAssertTrue(app.isNew(id))
        let f = try JSON.parse(try await app.api.flight(id))
        XCTAssertEqual(f["route"]?.array?.map { $0["refId"]?.string }, ["LGTT"], "no destination yet")
        XCTAssertEqual(f["aircraftId"]?.string, ac)
        XCTAssertEqual(app.flights.first?.summary.aircraft, "SX-ABC")
        XCTAssertNil(app.flights.first?.summary.routeLine, "not a local flight until the pilot makes it one")
    }

    // MARK: rows

    private func item(
        _ id: String, date: String, blockOff: String = "", updated: Double = 0, title: String = "",
        sharedBy: Bool = false
    ) -> FlightListItem {
        try! JSONDecoder().decode(
            FlightListItem.self,
            from: JSON.object([
                "id": .string(id),
                "summary": [
                    "title": .string(title), "date": .string(date), "blockOff": .string(blockOff), "aircraft": "SX-ASV",
                    "from": "LGTT", "to": "LGSY", "route": [[38.1, 23.8], [38.9, 24.5]],
                ],
                "points": ["LGTT", "KALAMO", "LGSY"], "passengers": ["Maria Pappa"], "date": .string(date),
                "version": 1, "updated": .number(updated), "deleted": false,
                "sharedBy": sharedBy ? ["pilotId": "p2", "name": "", "email": "o@x.gr"] : nil,
            ]).data())
    }

    func testSearchMatchesEveryTermAnywhereInTheRow() {
        let r = item("a", date: "2026-11-22", blockOff: "08:30", title: "Skyros trip")
        let text = Lobby.searchText(r)
        XCTAssertTrue(Lobby.matches(text, "skyros kalamo"))
        XCTAssertTrue(Lobby.matches(text, "SXASV"), "the registration without its dash")
        XCTAssertTrue(Lobby.matches(text, "maria 2026-11-22"))
        XCTAssertTrue(Lobby.matches(text, "08:30"))
        XCTAssertTrue(Lobby.matches(text, "  "))
        XCTAssertFalse(Lobby.matches(text, "skyros lgav"))
    }

    func testUpcomingAndPastAreNewestFirst() {
        let rows = [
            item("past-old", date: "2026-10-01"), item("today-early", date: "2026-11-22", blockOff: "07:00"),
            item("draft", date: ""), item("later", date: "2026-12-01"), item("past-new", date: "2026-11-21"),
            item("today-late", date: "2026-11-22", blockOff: "15:00"),
        ]
        let (upcoming, past) = Lobby.split(rows, today: "2026-11-22")
        XCTAssertEqual(upcoming.map(\.id), ["draft", "later", "today-late", "today-early"])
        XCTAssertEqual(past.map(\.id), ["past-new", "past-old"])
    }

    func testDaysAndLocalTimes() {
        XCTAssertEqual(Lobby.relativeDay("2026-11-22", today: "2026-11-22"), "today")
        XCTAssertEqual(Lobby.relativeDay("2026-11-23", today: "2026-11-22"), "tomorrow")
        XCTAssertEqual(Lobby.relativeDay("2026-11-21", today: "2026-11-22"), "yesterday")
        XCTAssertEqual(Lobby.relativeDay("2026-11-27", today: "2026-11-22"), "in 5 days")
        XCTAssertEqual(Lobby.relativeDay("2026-11-19", today: "2026-11-22"), "3 days ago")
        XCTAssertEqual(Lobby.relativeDay("2026-12-07", today: "2026-11-22"), "")
        XCTAssertEqual(Lobby.relativeDay("2026-02-30", today: "2026-02-28"), "", "not a date")
        // Greece is UTC+2 in winter, UTC+3 in summer
        XCTAssertEqual(Lobby.utcToLocalMarked("2026-11-22", "08:30"), "10:30")
        XCTAssertEqual(Lobby.utcToLocalMarked("2026-07-01", "22:30"), "01:30+1")
        XCTAssertEqual(Lobby.utcToLocalMarked("2026-07-01", ""), "")
        XCTAssertEqual(Lobby.localDepartureDay("2026-07-01", "22:30"), "2026-07-02")
        XCTAssertEqual(Lobby.localDepartureDay("2026-07-01", ""), "2026-07-01")
        XCTAssertEqual(Lobby.localToday(now: Date(timeIntervalSince1970: 1_782_946_800)), "2026-07-02")  // 23:00Z
        XCTAssertEqual(Lobby.duration(44), "0h44")
        XCTAssertEqual(Lobby.duration(65), "1h05")
    }

    func testTitles() {
        XCTAssertEqual(Lobby.title(item("a", date: "2026-11-22", title: "2026-11-22")), "2026-11-22")
        XCTAssertEqual(Lobby.title(item("a", date: "")), "Untitled flight")
        XCTAssertEqual(Lobby.autoTitle(date: ""), "Untitled flight")
    }

    // MARK: actions

    private func recordingApp(conflictFirst: Bool = false) throws -> (AppModel, FakeTransport) {
        let flight = try Fixtures.data("flight.json")
        var puts = 0
        let fake = FakeTransport { req in
            switch (req.httpMethod ?? "", req.url!.path) {
            case ("GET", "/api/flights"): return (200, try Fixtures.data("flights.json"), [:])
            case ("GET", "/api/me"): return (200, try Fixtures.data("pilot.json"), [:])
            case ("GET", let p) where p.hasPrefix("/api/flights/"): return (200, flight, [:])
            case ("PUT", _):
                puts += 1
                if conflictFirst && puts == 1 { return (409, flight, [:]) }
                return (200, Data(#"{"version":8,"updated":1}"#.utf8), [:])
            case ("POST", let p) where p.hasSuffix("/copy"):
                var c = try JSON.parse(flight)
                c["id"] = "copy1"
                c["title"] = "Copy of LGTT → LGSY"
                return (201, try c.data(), [:])
            case ("POST", let p) where p.hasSuffix("/restore"): return (200, flight, [:])
            case ("DELETE", _): return (204, Data(), [:])
            default: return (404, Data(), [:])
            }
        }
        let app = AppModel(arguments: ["-today", "2026-11-22"], api: API(transport: fake), store: temporaryStore())
        return (app, fake)
    }

    private func body(_ r: URLRequest) throws -> JSON { try JSON.parse(r.httpBody ?? Data("{}".utf8)) }

    func testRenameSendsTheTitleAndKeepsTheAutomaticNameAutomatic() async throws {
        let (app, fake) = try recordingApp()
        try await app.renameFlight("fixture-lgtt-lgsy", to: "Skyros trip")
        let put = try XCTUnwrap(fake.requests.first { $0.httpMethod == "PUT" })
        XCTAssertEqual(put.url?.path, "/api/flights/fixture-lgtt-lgsy")
        let sent = try body(put)
        XCTAssertEqual(sent["version"]?.int, 7)
        XCTAssertEqual(sent["flight"]?["title"], "Skyros trip")
        XCTAssertEqual(sent["flight"]?["summary"]?["title"], "Skyros trip")
        XCTAssertNil(sent["flight"]?["id"], "the flight's own fields are not sent back")
        XCTAssertNil(sent["flight"]?["version"])

        // typed back as the date (or cleared): the automatic title
        let auto = AppModel.renamed(try JSON.parse(try Fixtures.data("flight.json")), to: "2026-11-22")
        XCTAssertEqual(auto["title"], "")
        XCTAssertEqual(auto["summary"]?["title"], "2026-11-22")
        let cleared = AppModel.renamed(try JSON.parse(try Fixtures.data("flight.json")), to: "")
        XCTAssertEqual(cleared["title"], "")
        XCTAssertEqual(cleared["summary"]?["title"], "2026-11-22")
    }

    func testRenameRetriesOnceOnAVersionConflict() async throws {
        let (app, fake) = try recordingApp(conflictFirst: true)
        try await app.renameFlight("fixture-lgtt-lgsy", to: "Skyros trip")
        XCTAssertEqual(fake.requests.filter { $0.httpMethod == "PUT" }.count, 2)
        XCTAssertEqual(
            fake.requests.filter { $0.httpMethod == "GET" && $0.url?.path == "/api/flights/fixture-lgtt-lgsy" }.count,
            2,
            "the fresh copy is fetched again")
    }

    func testCopyFlyAgainTrashRestoreAndLeave() async throws {
        let (app, fake) = try recordingApp()
        await app.loadFlights()
        let own = try XCTUnwrap(app.flights.first { $0.id == "fixture-lgtt-lgsy" })
        let shared = try XCTUnwrap(app.flights.first { $0.sharedBy != nil })

        let c = try await app.copyFlight(own)
        XCTAssertEqual(c.id, "copy1")
        XCTAssertEqual(c.title, "Copy of LGTT → LGSY")
        _ = try await app.flyAgain(shared)
        try await app.trashFlight(own)
        try await app.restoreFlight(own.id)
        try await app.leaveFlight(shared)

        let sent = fake.requests.filter { $0.httpMethod != "GET" }
        XCTAssertEqual(
            sent.map { "\($0.httpMethod!) \($0.url!.path)" },
            [
                "POST /api/flights/fixture-lgtt-lgsy/copy", "POST /api/flights/fixture-shared/copy",
                "DELETE /api/flights/fixture-lgtt-lgsy", "POST /api/flights/fixture-lgtt-lgsy/restore",
                "DELETE /api/flights/fixture-shared/shares/fixture-pilot",
            ])
        XCTAssertEqual(try body(sent[0]), [:], "Make a copy: the server names it")
        XCTAssertEqual(
            try body(sent[1]), ["title": "", "date": "2026-11-22"], "Fly again: today, named after the route")
    }

    // MARK: fixtures

    func testTheFixtureServerKeepsTheTrashCopiesAndTitles() async throws {
        let app = AppModel(
            arguments: ["-fixtures"], api: API(transport: FixtureTransport.bundled()!), store: temporaryStore())
        await app.loadFlights()
        let own = try XCTUnwrap(app.flights.first { $0.id == "fixture-lgtt-lgsk" })
        try await app.trashFlight(own)
        XCTAssertFalse(app.flights.contains { $0.id == own.id })
        let trash = try await app.trashedFlights()
        XCTAssertEqual(trash.map(\.id), [own.id])
        XCTAssertTrue(trash[0].deleted)
        try await app.restoreFlight(own.id)
        XCTAssertTrue(app.flights.contains { $0.id == own.id })
        let noTrash = try await app.trashedFlights()
        XCTAssertTrue(noTrash.isEmpty)

        let c = try await app.copyFlight(own)
        XCTAssertEqual(app.flights.first { $0.id == c.id }?.summary.title, "Copy of LGTT → LGSK")
        try await app.renameFlight(own.id, to: "Skiathos")
        XCTAssertEqual(app.flights.first { $0.id == own.id }?.summary.title, "Skiathos")

        let shared = try XCTUnwrap(app.flights.first { $0.sharedBy != nil })
        try await app.leaveFlight(shared)
        XCTAssertFalse(app.flights.contains { $0.id == shared.id })
    }
}
