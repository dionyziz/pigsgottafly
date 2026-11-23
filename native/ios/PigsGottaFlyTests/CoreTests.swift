import XCTest

@testable import PigsGottaFly

/// The bundled core.js (src/native/core/) called with the fixtures, function by function (NATIVE.md
/// "core.js API"): the numbers are the website's for the same flight.
final class CoreTests: XCTestCase {
    private var core: Core!
    private var flight: String!
    private var aircraft: String!
    private var pilot: String!
    private var ref: String!
    private var notams: String!
    private static let metarPath = "/api/weather/metar?ids=LGSY,LGTT"

    override func setUpWithError() throws {
        core = try Core.bundled()
        flight = try Fixtures.text("flight.json")
        aircraft = try Fixtures.text("aircraft.json")
        pilot = try Fixtures.text("pilot.json")
        ref = try Fixtures.text("ref.json")
        notams = try Fixtures.text("notams.json")
    }

    private func weather() throws -> String {
        Core.object([Self.metarPath: try Fixtures.text("metar.json")])
    }

    private func compute(notamsRead: Bool = false) throws -> JSON {
        try core.computeFlight(
            flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: try weather(), notams: notams,
            notamsRead: notamsRead)
    }

    func testVersion() {
        XCTAssertTrue(core.version.contains("+"), core.version)
    }

    func testLineStylesDrawTheLayerLegend() throws {
        let styles = try core.lineStyles()
        for name in [
            "fir", "tma", "mtma", "ctr", "atz", "zoneG", "prohibited", "restricted", "danger", "mil", "act",
            "vfrRoute", "helRoute", "milRoute", "notam", "route",
        ] {
            XCTAssertNotNil(styles[name], name)
        }
        XCTAssertEqual(styles["mtma"], LineStyle(color: 0x8a3b9c, width: 2, dash: [4, 2], opacity: 0.75, fill: 0.025))
        XCTAssertEqual(styles["restricted"]?.hatch, "pgf-hatch-r")
        XCTAssertEqual(styles["route"]?.casing, 7.5)
        XCTAssertEqual(Symbols.legendImage(.line("tma", "TMA"), styles: styles)?.size, CGSize(width: 28, height: 20))
        XCTAssertEqual(
            Symbols.legendImage(.area("danger", "Danger"), styles: styles)?.size, CGSize(width: 20, height: 20))
        XCTAssertEqual(
            Symbols.legendImage(.symbol("pgf-ad-minor", "Aerodrome"), styles: [:])?.size, CGSize(width: 20, height: 20))
        XCTAssertNil(Symbols.legendImage(.line("nothing", "?"), styles: styles))
    }

    func testSymbolNamesAreDrawnAtTheirSize() throws {
        let symbols = try core.symbolNames()
        XCTAssertEqual(Set(symbols.map(\.name)), Set(Symbols.known.map(\.name)), "the app draws each of them")
        for s in symbols {
            XCTAssertGreaterThan(s.size, 0, s.name)
            XCTAssertFalse(s.colors.isEmpty, s.name)
            XCTAssertNotNil(Symbols.Chart.byKey[s.colors[0]], "\(s.name): \(s.colors[0])")
            XCTAssertEqual(Symbols.image(s).size.width, s.size, s.name)
        }
        let ad = try XCTUnwrap(symbols.first { $0.name == "pgf-ad-major" })
        XCTAssertTrue(ad.rotates)
        XCTAssertTrue(symbols.first { $0.name == "pgf-hatch-r" }?.pattern ?? false)
    }

    func testLayerGroups() throws {
        let groups = try core.layerGroups()
        XCTAssertEqual(groups["aerodromes"], ["aerodrome-icon", "aerodrome-label"])
        XCTAssertEqual(groups["notams"], ["notam-fill", "notam-line"])
        XCTAssertNotNil(groups["vfrPoints"])
    }

    func testChartStyleWithAndWithoutTheVectorBase() throws {
        for vector in [nil, #"{"version":8,"sources":{},"layers":[{"id":"bg","type":"background"}]}"#] {
            let style = try JSON.parse(try core.chartStyle(base: "light", vector: vector))
            XCTAssertEqual(style["version"]?.int, 8)
            XCTAssertNotNil(style["sources"]?["route-line"], "the route's source")
            XCTAssertNotNil(style["sources"]?["notam-areas"], "the NOTAM areas")
            let ids = (style["layers"]?.array ?? []).compactMap { $0["id"]?.string }
            XCTAssertLessThan(ids.firstIndex(of: "notam-fill") ?? 99, ids.firstIndex(of: "route-casing") ?? 0)
            XCTAssertEqual(ids.last, "route-point-label")
        }
        // a layer toggled off by the flight's map layers is hidden
        let off = try JSON.parse(try core.chartStyle(base: "light", vector: nil, layers: #"{"navaids":false}"#))
        let navaid = (off["layers"]?.array ?? []).first { $0["id"]?.string == "navaid-icon" }
        XCTAssertEqual(navaid?["layout"]?["visibility"]?.string, "none")
    }

    func testChartDataFillsTheSources() throws {
        let data = try core.chartData(ref: ref, flight: flight, notams: notams, layers: nil)
        XCTAssertEqual(data["route-line"]?["type"]?.string, "FeatureCollection")
        XCTAssertEqual(data["route-line"]?["features"]?.array?.count, 1)
        let points = data["route-points"]?["features"]?.array ?? []
        XCTAssertEqual(points.compactMap { $0["properties"]?["name"]?.string }, ["LGTT", "KALAMO", "KIMI", "LGSY"])
        XCTAssertGreaterThan(data["aerodromes"]?["features"]?.array?.count ?? 0, 5)
        XCTAssertGreaterThan(data["navaids"]?["features"]?.array?.count ?? 0, 0, "the core brings the navaids")
        XCTAssertEqual(data["notam-areas"]?["features"]?.array?.count, 1, "the danger area NOTAM's circle")
        let airspaces = data["airspaces"]?["features"]?.array ?? []
        XCTAssertFalse(airspaces.isEmpty)
        XCTAssertTrue(airspaces.allSatisfy { $0["properties"]?["far"]?.bool != nil }, "far is set on each")
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
        let paths = try core.weatherRequests(flight: flight, ref: ref, now: Fmt.date(day: "2026-11-21", clock: "10:00"))
        XCTAssertTrue(paths.contains(Self.metarPath), "\(paths)")
        XCTAssertTrue(paths.contains { $0.hasPrefix("/api/weather/grid?kind=wind") }, "\(paths)")
        XCTAssertTrue(paths.contains { $0.hasPrefix("/api/weather/grid?kind=hazard") }, "\(paths)")
        XCTAssertTrue(paths.allSatisfy { $0.hasPrefix("/api/") })
    }

    func testRefIsGivenOnceAndKept() throws {
        // after the first call the core has the reference data: a call without it computes the same
        let first = try compute()
        let again = try core.computeFlight(
            flight: flight, aircraft: aircraft, pilot: pilot, ref: nil, weather: try weather(), notams: notams)
        XCTAssertEqual(first["navlog"], again["navlog"])
        XCTAssertThrowsError(
            try Core.bundled().computeFlight(
                flight: flight, aircraft: aircraft, pilot: pilot, ref: nil, weather: "{}"),
            "a fresh core has no ref")
    }

    func testComputeFlightIsTheWebsitesNavlog() throws {
        let j = try compute()
        let c = ComputedFlight(j)
        XCTAssertEqual(c.rows.count, 3, "one leg per route leg")
        XCTAssertEqual(c.rows.map(\.from), ["LGTT", "KALAMO", "KIMI"])
        XCTAssertEqual(c.rows.map(\.to), ["KALAMO", "KIMI", "LGSY"])
        XCTAssertEqual(c.rows.map(\.key), ["p1>p2", "p2>p3", "p3>p4"])
        XCTAssertTrue(c.rows.allSatisfy { ($0.distNm ?? 0) > 0 && ($0.eteMin ?? 0) > 0 && ($0.fuelL ?? 0) > 0 })
        // no winds aloft (not fetched): calm wind, the navlog's GS is the TAS (80 kt pattern, 92 kt cruise)
        XCTAssertEqual(c.rows.map(\.altFt), [1900, 5500, 1000], "pattern, the leg override, pattern")
        XCTAssertEqual(c.rows.map(\.heading), [14, 28, 34], "MH")
        XCTAssertEqual(c.rows.map(\.distNm), [12, 25, 25])
        XCTAssertEqual(c.rows.map(\.eteMin), [9, 16, 19])
        XCTAssertEqual(c.rows.map(\.gsKt), [80, 92, 80])
        XCTAssertEqual(c.totalDistNm, 62)
        XCTAssertEqual(c.totalEteMin, 44)
        XCTAssertEqual(c.tripFuelL, 24)
        XCTAssertEqual(c.totalFuelL, 28)
        XCTAssertEqual(c.blockOff, "08:30")
        XCTAssertEqual(c.takeoff, "08:45")
        XCTAssertEqual(c.landing, "09:29")
        XCTAssertEqual(c.blockOn, "09:39")
        XCTAssertEqual(c.sunset, "15:03")
        XCTAssertEqual(c.rows.first?.startMin, 525, "the first leg starts at take-off")
        XCTAssertEqual(c.windsMessage, "Winds unavailable: not fetched")
        XCTAssertTrue(c.warnings.contains("No winds aloft forecast: calm wind assumed."))
        // the aerodromes at the time the flight uses them
        XCTAssertEqual(c.aerodromes.map(\.icao), ["LGTT", "LGSY"])
        XCTAssertEqual(c.aerodromes.first?.aerodrome?.status, "open")
        XCTAssertEqual(c.aerodromes.first?.when, "block start 08:30Z – take-off 08:45Z")
        XCTAssertEqual(c.aerodromes.first?.handling?.text, "Closed (NIL)")
        // METAR/TAF decoded; the readiness rows of the Plan and Brief stages
        XCTAssertEqual(j["weather"]?["metar"]?["status"]?.string, "ok")
        XCTAssertEqual(j["weather"]?["metar"]?["stations"]?["LGSY"]?["metar"]?["qnhHpa"]?.int, 1020)
        XCTAssertEqual(
            c.readiness.map(\.id),
            ["route", "aircraft", "fuel", "wb", "time", "aerodromes", "weather", "performance", "notams"])
        XCTAssertEqual(c.readiness.first { $0.id == "weather" }?.state, .warn)
        XCTAssertEqual(j["atc"]?["entries"]?.array?.count, 3)
        XCTAssertEqual(c.maxAltFt, 5500)
    }

    func testNotamsReadMakesTheRowReady() throws {
        let unread = ComputedFlight(try compute()).readiness.first { $0.id == "notams" }
        XCTAssertEqual(unread?.state, .todo)
        XCTAssertEqual(unread?.text, "2 relevant to read.")
        let read = ComputedFlight(try compute(notamsRead: true)).readiness.first { $0.id == "notams" }
        XCTAssertEqual(read?.state, .ok)
    }

    func testTerrain() throws {
        let grid = try XCTUnwrap(AppModel.bundledTerrain())
        XCTAssertEqual(grid.count, AppModel.terrainBytes)
        XCTAssertTrue(try core.setTerrain(grid))
        XCTAssertEqual(ComputedFlight(try compute()).rows.count, 3)
        XCTAssertFalse(try core.setTerrain(Data([1, 2, 3])), "not a grid")
        XCTAssertFalse(try core.setTerrain(nil))
    }

    func testPaperwork() throws {
        let rows = ReadyItem.list(
            try core.paperwork(
                filing: try Fixtures.text("filing.json"), forms: try Fixtures.text("forms.json"),
                declarations: try Fixtures.text("declarations.json")))
        XCTAssertEqual(rows.map(\.id), ["filing", "form731"])
        XCTAssertEqual(rows.first?.state, .ok)
        XCTAssertEqual(rows.first?.text, "Filed.")
        XCTAssertTrue(rows.allSatisfy { $0.stage == "file" })
    }

    private func progress(_ lat: Double, _ lon: Double, track: Double?, gs: Double?, last: Int? = nil) throws
        -> PigsGottaFly.Progress
    {
        let computed = try compute()
        let fix = Position(
            lat: lat, lon: lon, altFt: nil, trackDeg: track, gsKt: gs, time: Date(timeIntervalSince1970: 1_795_337_400))
        return try XCTUnwrap(Progress(try core.progress(computed: computed.text, position: fix, lastLegIndex: last)))
    }

    func testProgressAlongTheSecondLeg() throws {
        // between KALAMO and KIMI
        let p = try progress(38.45, 24.0, track: 32, gs: 105)
        XCTAssertEqual(p.legIndex, 1)
        XCTAssertEqual(p.toWaypoint, "KIMI")
        XCTAssertEqual(p.distNm ?? 0, 13.8, accuracy: 0.1)
        XCTAssertEqual(p.bearingMagDeg ?? 0, 26.5, accuracy: 0.5)
        XCTAssertEqual((p.bearingDeg ?? 0) - (p.bearingMagDeg ?? 0), 5.2, accuracy: 0.3, "the variation, E")
        XCTAssertFalse(p.offRoute)
        XCTAssertFalse(p.arrived)
        XCTAssertEqual(p.gsKt, 105)
        XCTAssertEqual(p.gsSource, "gps")
        XCTAssertEqual(p.eteMin ?? 0, 13.8 / 105 * 60, accuracy: 0.2)
        XCTAssertEqual(p.eta?.timeIntervalSince1970 ?? 0, 1_795_337_400 + (p.eteMin ?? 0) * 60, accuracy: 1)
        XCTAssertEqual(p.remainingNm ?? 0, 38.6, accuracy: 0.2)
        XCTAssertNotNil(p.etaDest)
        XCTAssertEqual(p.plannedAltFt, 5500)
        XCTAssertEqual(p.plannedHdg, 28)
        XCTAssertEqual(
            p.freq,
            Frequency(callsign: "ATHINAI INFORMATION", service: "INFO", primary: "130.925", backups: ["130.700"]))
        XCTAssertEqual(p.nextFreq?.callsign, "SKIROS TOWER")
    }

    func testProgressNearTheDepartureAndAtTheDestination() throws {
        let first = try progress(38.2, 23.82, track: 19, gs: 90)
        XCTAssertEqual(first.legIndex, 0)
        XCTAssertEqual(first.toWaypoint, "KALAMO")
        XCTAssertEqual(first.freq?.callsign, "TATOI TOWER")
        XCTAssertEqual(first.nextFreq?.callsign, "ATHINAI INFORMATION")
        let there = try progress(38.98, 24.5, track: 40, gs: 60, last: 2)
        XCTAssertEqual(there.legIndex, 2)
        XCTAssertTrue(there.arrived)
        XCTAssertEqual(there.freq?.primary, "123.200")
        XCTAssertNil(there.nextFreq)
    }

    /// The fixture flight made local: LGTT → LGTT, nothing between, 1:30 airborne.
    private func computeLocal() throws -> JSON {
        var f = try JSON.parse(flight)
        let lgtt = try XCTUnwrap(f["route"]?[0])
        var back = lgtt
        back["uid"] = .string("p9")
        f["route"] = .array([lgtt, back])
        var o = f["options"]?.object ?? [:]
        o["localDurationMin"] = .number(90)
        f["options"] = .object(o)
        return try core.computeFlight(
            flight: f.text, aircraft: aircraft, pilot: pilot, ref: ref, weather: try weather(), notams: notams,
            notamsRead: false)
    }

    func testALocalFlightHasNoLegsAndTheDurationGivesItsTimes() throws {
        let c = ComputedFlight(try computeLocal())
        XCTAssertEqual(c.local, LocalFlight(aerodrome: "LGTT", durationMin: 90))
        XCTAssertEqual(c.local?.title, "Local flight · LGTT · 1:30")
        XCTAssertTrue(c.rows.isEmpty)
        XCTAssertEqual(c.totalEteMin, 90)
        XCTAssertEqual(c.takeoff, "08:45", "block off 08:30 and 15 min taxi out")
        XCTAssertEqual(c.landing, "10:15")
        XCTAssertGreaterThan(c.tripFuelL ?? 0, 0)
    }

    func testProgressOfALocalFlightIsBackToTheAerodrome() throws {
        let computed = try computeLocal()
        // 08:55Z, 10 min after take-off, 12 NM north of Tatoi
        let fix = Position(
            lat: 38.31, lon: 23.78, altFt: nil, trackDeg: 0, gsKt: 90, time: Date(timeIntervalSince1970: 1_795_337_700))
        let p = try XCTUnwrap(Progress(try core.progress(computed: computed.text, position: fix, lastLegIndex: nil)))
        XCTAssertNil(p.legIndex)
        XCTAssertEqual(p.toWaypoint, "LGTT")
        XCTAssertEqual(p.distNm ?? 0, 12.1, accuracy: 0.2)
        XCTAssertEqual(p.bearingDeg ?? 0, 180, accuracy: 1)
        XCTAssertNotNil(p.bearingMagDeg)
        XCTAssertEqual(p.eteDestMin ?? 0, 80, accuracy: 0.01, "to the planned landing at 10:15Z")
        XCTAssertFalse(p.offRoute)
    }

    func testProgressWithoutAPosition() throws {
        let computed = try compute()
        let fix = Position(lat: .nan, lon: 24, altFt: nil, trackDeg: nil, gsKt: nil, time: Date())
        XCTAssertNil(Progress(try core.progress(computed: computed.text, position: fix, lastLegIndex: nil)))
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
        XCTAssertThrowsError(try core.computeFlight(flight: "{", aircraft: nil, pilot: nil, ref: ref, weather: "{}"))
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
