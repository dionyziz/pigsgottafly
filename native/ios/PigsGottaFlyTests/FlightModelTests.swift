import XCTest

@testable import PigsGottaFly

/// Opening a flight (cache, server, core) and the quick edits with the 409 handling.
@MainActor
final class FlightModelTests: XCTestCase {
    func testOpensComputesAndCaches() async throws {
        let store = temporaryStore()
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: FixtureTransport.bundled()!), store: store)
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        XCTAssertNil(model.error)
        XCTAssertEqual(model.title, "LGTT → LGSY")
        XCTAssertEqual(model.computed?.rows.count, 3)
        XCTAssertEqual(model.notams?.notams.count, 2)
        XCTAssertEqual(model.filing?.filing?.status, "filed")
        XCTAssertNotNil(model.metar?.stations["LGSY"])
        XCTAssertFalse(model.paperwork.isEmpty)
        XCTAssertNotNil(model.styleURL)
        XCTAssertNotNil(model.chartData?["route-line"])
        XCTAssertEqual(model.endAerodromes, ["LGTT", "LGSY"])
        for key: Store.Key in [
            .flight(model.id), .aircraft("fixture-sx-asv"), .pilot, .ref, .weather(model.id), .notams(model.id),
            .filing(model.id), .forms(model.id), .declarations(model.id),
        ] {
            XCTAssertTrue(store.exists(key), key.path)
        }

        // offline: the cached copy opens
        let offline = AppModel(
            arguments: ["-noNetwork"],
            api: API(transport: FakeTransport { _ in throw URLError(.notConnectedToInternet) }), store: store)
        let again = FlightModel(id: "fixture-lgtt-lgsy", app: offline)
        await again.open()
        XCTAssertTrue(again.offline)
        XCTAssertEqual(again.computed?.rows.count, 3)
        XCTAssertEqual(again.notams?.notams.count, 2)
    }

    func testAnEditIsAppliedAgainOnTopOfANewerServerCopy() async throws {
        let base = try JSON.parse(try Fixtures.data("flight.json"))
        var server = base
        server["version"] = 9
        server["title"] = "Renamed elsewhere"
        let serverCopy = try server.data()
        let baseCopy = try base.data()
        let aircraft = try Fixtures.data("aircraft.json")
        let fake = FakeTransport { req in
            if req.httpMethod == "PUT" {
                let body = try JSON.parse(req.httpBody!)
                if body["version"]?.int == 9 { return (200, Data(#"{"version":10,"updated":5}"#.utf8), [:]) }
                return (409, serverCopy, [:])
            }
            if req.url!.path == "/api/flights/fixture-lgtt-lgsy" { return (200, baseCopy, [:]) }
            if req.url!.path.hasPrefix("/api/aircraft/") { return (200, aircraft, [:]) }
            return (404, Data(), [:])
        }
        let store = temporaryStore()
        try store.write(try base.data(), .flight("fixture-lgtt-lgsy"))
        try store.write(try Fixtures.data("ref.json"), .ref)
        let app = AppModel(arguments: ["-noNetwork"], api: API(transport: fake), store: store)
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        await model.setAltitude(legKey: "p1>p2", feet: 2500)
        XCTAssertNil(model.error)
        XCTAssertEqual(model.version, 10)
        XCTAssertEqual(model.flight?["title"]?.string, "Renamed elsewhere", "the server's change is kept")
        XCTAssertEqual(model.flight?["legOverrides"]?["p1>p2"]?["altFt"]?.double, 2500, "ours is applied on top")
        XCTAssertEqual(model.flight?["legOverrides"]?["p2>p3"]?["altFt"]?.double, 5500)
        XCTAssertEqual(model.computed?.rows.first?.altFt, 2500)
        let puts = fake.requests.filter { $0.httpMethod == "PUT" }
        XCTAssertEqual(puts.count, 2)
        let second = try JSON.parse(puts[1].httpBody!)
        XCTAssertEqual(second["version"]?.int, 9)
        XCTAssertNil(second["flight"]?["version"], "the doc, not the record")
        XCTAssertEqual(second["flight"]?["legOverrides"]?["p1>p2"]?["altFt"]?.double, 2500)
        // the cache holds the saved flight
        let cached = try JSON.parse(try XCTUnwrap(store.read(.flight("fixture-lgtt-lgsy"))))
        XCTAssertEqual(cached["version"]?.int, 10)
    }

    func testAnEditOfflineIsKeptAndSentLater() async throws {
        let store = temporaryStore()
        try store.write(try Fixtures.data("flight.json"), .flight("fixture-lgtt-lgsy"))
        let offline = AppModel(
            arguments: ["-noNetwork"],
            api: API(transport: FakeTransport { _ in throw URLError(.notConnectedToInternet) }),
            store: store)
        let model = FlightModel(id: "fixture-lgtt-lgsy", app: offline)
        await model.open()
        await model.setBlockOff("09:15")
        XCTAssertTrue(model.offline)
        XCTAssertEqual(model.blockOff, "09:15")
        XCTAssertTrue(store.exists(.pendingEdit("fixture-lgtt-lgsy")))

        let fixtures = FixtureTransport.bundled()!
        let online = AppModel(arguments: ["-noNetwork"], api: API(transport: fixtures), store: store)
        let later = FlightModel(id: "fixture-lgtt-lgsy", app: online)
        await later.open()
        XCTAssertFalse(store.exists(.pendingEdit("fixture-lgtt-lgsy")))
    }
}
