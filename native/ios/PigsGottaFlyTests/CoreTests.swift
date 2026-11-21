import XCTest

@testable import PigsGottaFly

/// The bundled core.js (stub or real) called with the fixtures, function by function (NATIVE.md).
final class CoreTests: XCTestCase {
    private var core: Core!
    private var flight: String!
    private var aircraft: String!
    private var pilot: String!
    private var ref: String!
    private var weather: String!

    override func setUpWithError() throws {
        core = try Core.bundled()
        flight = try Fixtures.text("flight.json")
        aircraft = try Fixtures.text("aircraft.json")
        pilot = try Fixtures.text("pilot.json")
        ref = try Fixtures.text("ref.json")
        weather = Core.object(["weather/metar?ids=LGTT,LGSY,LGTG": try Fixtures.text("metar.json")])
    }

    func testVersionAndSymbols() throws {
        XCTAssertFalse(core.version.isEmpty)
        XCTAssertNotEqual(core.version, "unknown")
        let names = try core.symbolNames()
        XCTAssertFalse(names.isEmpty)
        XCTAssertTrue(names.allSatisfy { !$0.isEmpty })
        for n in names { XCTAssertGreaterThan(Symbols.image(n).size.width, 0, n) }
    }

    func testChartStyleWithAndWithoutTheVectorBase() throws {
        for vector in [nil, #"{"version":8,"sources":{},"layers":[{"id":"bg","type":"background"}]}"#] {
            let style = try JSON.parse(try core.chartStyle(base: "light", vector: vector))
            XCTAssertEqual(style["version"]?.int, 8)
            XCTAssertNotNil(style["sources"]?["route-line"], "the route's source")
            XCTAssertGreaterThan(style["layers"]?.array?.count ?? 0, 1)
        }
    }

    func testChartDataFillsTheSources() throws {
        let data = try core.chartData(ref: ref, flight: flight, notams: try Fixtures.text("notams.json"), layers: nil)
        let route = data["route-line"]?["features"]?.array ?? []
        XCTAssertEqual(route.count, 1)
        XCTAssertEqual(data["route-line"]?["type"]?.string, "FeatureCollection")
        XCTAssertGreaterThan(data["aerodromes"]?["features"]?.array?.count ?? 0, 0)
    }

    func testChartDataDrawsTheSavedWaypoints() throws {
        let data = try core.chartData(
            ref: ref, flight: flight, notams: nil, layers: nil, waypoints: try Fixtures.text("waypoints.json"))
        XCTAssertEqual(data["waypoints"]?["features"]?.array?.count, 1)
    }

    func testTheHangarsTemplateBuildsTheFirstAircraft() throws {
        let templates = try core.aircraftTemplates()
        XCTAssertEqual(templates.first?.id, "reims-f172m")
        XCTAssertEqual(templates.first?.label, "Reims/Cessna F172M")
        let a = try JSON.parse(try core.aircraftFromTemplate(id: "reims-f172m", registration: " sx-abc "))
        XCTAssertEqual(a["registration"]?.string, "SX-ABC")
        XCTAssertEqual(a["icaoType"]?.string, "C172")
        XCTAssertGreaterThan(a["massBalance"]?["stations"]?.array?.count ?? 0, 2)
    }

    func testWeatherRequests() throws {
        let paths = try core.weatherRequests(flight: flight, ref: ref)
        XCTAssertTrue(paths.contains { $0.contains("weather/metar") && $0.contains("LGSY") })
    }

    func testComputeFlight() throws {
        let j = try core.computeFlight(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        let c = ComputedFlight(j, flight: try JSON.parse(flight))
        XCTAssertEqual(c.rows.count, 3)
        XCTAssertEqual(c.rows.map(\.from), ["LGTT", "KALAMO", "KIMI"])
        XCTAssertEqual(c.rows[1].key, "p2>p3")
        XCTAssertEqual(c.rows[1].altFt, 5500, "the leg override")
        XCTAssertGreaterThan(c.totalDistNm ?? 0, 50)
        XCTAssertLessThan(c.totalDistNm ?? 0, 80)
        XCTAssertFalse(c.readiness.isEmpty)
        XCTAssertNotNil(c.takeoff)
        XCTAssertNotNil(c.sunset)
        for k in ["legs", "navlog", "fuel", "wb", "warnings", "readiness", "times"] { XCTAssertNotNil(j[k], k) }
    }

    func testPaperwork() throws {
        let rows = ReadyItem.list(
            try core.paperwork(filing: try Fixtures.text("filing.json"), forms: nil, declarations: nil))
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.contains { $0.state == .ok }, "the plan is filed")
    }

    func testProgressAlongTheSecondLeg() throws {
        let computed = try core.computeFlight(
            flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        // between KALAMO and KIMI, a little right of the course
        let fix = Position(
            lat: 38.45, lon: 24.0, altFt: 5400, trackDeg: 32, gsKt: 105,
            time: Date(timeIntervalSince1970: 1_795_337_400))
        let j = try core.progress(flight: flight, computed: computed.text, position: fix)
        let p = try XCTUnwrap(Progress(j))
        XCTAssertEqual(p.legIndex, 1)
        XCTAssertEqual(p.toWaypoint, "KIMI")
        XCTAssertEqual(p.distNm ?? 0, 13, accuracy: 3)
        XCTAssertEqual(p.bearingDeg ?? 0, 30, accuracy: 10)
        XCTAssertFalse(p.offRoute)
        XCTAssertNotNil(p.eta)
        XCTAssertEqual(p.plannedAltFt, 5500)
    }

    func testExceptionsBecomeErrors() throws {
        XCTAssertThrowsError(try Core(script: "throw new Error('boom')")) { e in
            guard case CoreError.load(let m) = e else { return XCTFail("\(e)") }
            XCTAssertTrue(m.contains("boom"))
        }
        XCTAssertThrowsError(try Core(script: "var x = 1;"))
        let c = try Core(
            script:
                "var PGF = { bad: function (a) { throw new Error('bad ' + a.n); }, echo: function (a) { return a; } };")
        XCTAssertThrowsError(try c.call("bad", json: #"{"n":3}"#)) { e in
            guard case CoreError.js(let m) = e else { return XCTFail("\(e)") }
            XCTAssertTrue(m.contains("bad 3"), m)
        }
        XCTAssertThrowsError(try c.call("missing", json: nil))
        XCTAssertEqual(try c.call("echo", fields: ["a": "[1,2]"]), #"{"a":[1,2]}"#)
    }

    func testCallsFromManyThreads() async throws {
        let core = self.core!
        let flight = self.flight!
        let ref = self.ref!
        try await withThrowingTaskGroup(of: Int.self) { group in
            for _ in 0..<8 {
                group.addTask { try core.weatherRequests(flight: flight, ref: ref).count }
            }
            for try await n in group { XCTAssertGreaterThan(n, 0) }
        }
    }
}
