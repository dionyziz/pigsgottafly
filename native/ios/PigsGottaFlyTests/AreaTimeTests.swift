import XCTest

@testable import PigsGottaFly

/// Areas an AIP SUP limits in time (SUP 39/26's exercise areas, SUP 07/26's LGD102): the app draws them on the
/// flight's day only, shows until when and their windows in the details, counts them in the layers menu and warns
/// about a leg only when it is flown in one of their windows, as the website does (tests/unit/native/map.test.ts,
/// chart.test.ts, computeFlight.test.ts).
final class AreaTimeTests: XCTestCase {
    private var core: Core!
    private var flight: JSON!
    private var ref: String!

    /// A square on the fixture flight's second leg (KALAMO → KIMI, 5500 ft, about 08:54–09:10Z on 22 NOV 2026),
    /// in force 20–27 NOV 2026, active 09:00–10:00Z on the 22nd and 08:00–10:00Z on the 27th.
    private static let area = """
        {"id":"LGDTEST-NOV","designator":"LGDTEST","kind":"D","name":"TEST EXERCISE","lower":"SFC","upper":"FL 100",
         "lateral":"","polygon":[[38.44,23.98],[38.5,23.98],[38.5,24.04],[38.44,24.04],[38.44,23.98]],
         "activity":"AMC Manageable areas (AMA)","remarks":"","source":"AIP SUP 39/26",
         "validFrom":"2026-11-20","validUntil":"2026-11-27",
         "windows":[{"from":"2026-11-22T09:00Z","to":"2026-11-22T10:00Z"},
                    {"from":"2026-11-27T08:00Z","to":"2026-11-27T10:00Z"}]}
        """

    override func setUpWithError() throws {
        core = try Core.bundled()
        flight = try JSON.parse(try Fixtures.text("flight.json"))
        ref = try Self.ref(with: try JSON.parse(Self.area))
    }

    private static func ref(with area: JSON) throws -> String {
        var r = try JSON.parse(try Fixtures.text("ref.json"))
        r["areas"] = .array((r["areas"]?.array ?? []) + [area])
        return r.text
    }

    private func flight(date: String) -> String {
        var f = flight!
        f["date"] = .string(date)
        return f.text
    }

    func testATapShowsTheAreaOnItsDaysWithUntilWhenAndItsWindows() throws {
        let info = { (date: String) in
            try self.core.mapInfo(
                ref: self.ref, lat: 38.47, lon: 24.01, zoom: 9, layers: nil, notams: nil, date: date, route: nil)
        }
        let card = try XCTUnwrap(try info("2026-11-22").airspaces.first { $0.id == "LGDTEST-NOV" })
        XCTAssertEqual(card.title, "LGDTEST TEST EXERCISE", "named by its designator")
        XCTAssertTrue(card.rows.contains(MapRow(label: "Valid", text: "until 27 NOV 2026")))
        XCTAssertTrue(
            card.rows.contains(MapRow(label: "Windows (UTC)", text: "22 NOV 0900–1000\n27 NOV 0800–1000")))
        let later = try XCTUnwrap(try info("2026-11-25").airspaces.first { $0.id == "LGDTEST-NOV" })
        XCTAssertTrue(later.rows.contains(MapRow(label: "Windows (UTC)", text: "27 NOV 0800–1000")))
        XCTAssertNil(try info("2026-11-28").airspaces.first { $0.id == "LGDTEST-NOV" }, "expired")
        XCTAssertNil(try info("2026-11-19").airspaces.first { $0.id == "LGDTEST-NOV" }, "not yet in force")
    }

    func testTheChartDrawsTheAreasInForceOnTheFlightsDay() throws {
        let ids = { (date: String) in
            try self.core.chartData(ref: self.ref, flight: self.flight(date: date), notams: nil, layers: nil)["areas"]?[
                "features"]?.array?.compactMap { $0["properties"]?["id"]?.string } ?? []
        }
        XCTAssertTrue(try ids("2026-11-22").contains("LGDTEST-NOV"))
        XCTAssertFalse(try ids("2026-11-28").contains("LGDTEST-NOV"))
        // a flight without a date: today's (the reference fixture's other areas have no dates)
        let undated = try ids("")
        XCTAssertEqual(undated.contains("LGDTEST-NOV"), Fmt.isoDay(from: Date()) <= "2026-11-27")
    }

    func testTheLayersMenuCountsTheAreasInForce() throws {
        let prd = { (date: String?) in
            try self.core.mapLayers(ref: self.ref, flight: nil, pilot: nil, notams: nil, date: date).counts["prd"]
        }
        XCTAssertEqual(try prd("2026-11-22"), (try prd("2026-11-28") ?? 0) + 1)
    }

    func testALegIsWarnedAboutOnlyInTheAreasWindow() throws {
        let warnings = { (ref: String) in
            ComputedFlight(
                try self.core.computeFlight(
                    flight: self.flight.text, aircraft: try Fixtures.text("aircraft.json"),
                    pilot: try Fixtures.text("pilot.json"), ref: ref, weather: "{}")
            ).warnings.filter { $0.contains("LGDTEST") }
        }
        XCTAssertEqual(
            try warnings(ref),
            [
                "KALAMO → KIMI: Enters danger area LGDTEST TEST EXERCISE (SFC – FL100), active 22 NOV 0900–1000Z"
                    + " (AIP SUP 39/26, valid until 27 NOV 2026)."
            ])
        // a window later that day: the leg is clear of it
        var later = try JSON.parse(Self.area)
        later["windows"] = .array([["from": "2026-11-22T12:00Z", "to": "2026-11-22T13:00Z"]])
        XCTAssertEqual(try warnings(try Self.ref(with: later)), [])
        // a flight-plan buffer zone is not airspace for a VFR flight
        var fbz = try JSON.parse(Self.area)
        fbz["remarks"] = "For IFR flight planning purposes only."
        XCTAssertEqual(try warnings(try Self.ref(with: fbz)), [])
    }
}
