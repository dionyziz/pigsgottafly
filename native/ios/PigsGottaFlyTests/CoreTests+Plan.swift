import XCTest

@testable import PigsGottaFly

/// PGF's planning functions through JavaScriptCore with the fixtures (the parity with the website is
/// tests/unit/native/plan.test.ts).
final class CorePlanTests: XCTestCase {
    private var core: Core!
    private var flight: JSON!
    private var ref: String!

    override func setUpWithError() throws {
        core = try Core.bundled()
        flight = try JSON.parse(try Fixtures.text("flight.json"))
        ref = try Fixtures.text("ref.json")
    }

    private var route: String { flight["route"]!.text }

    func testRouteEditsKeepTheOverridesOfLegsThatStay() throws {
        let overrides = flight["legOverrides"]!.text
        let removed = try core.routeEdit(route: route, legOverrides: overrides, .remove(uid: "p3"))
        XCTAssertEqual(removed.route.array?.compactMap { $0["name"]?.string }, ["LGTT", "KALAMO", "LGSY"])
        XCTAssertEqual(removed.legOverrides, .object([:]), "the leg p2>p3 is gone")
        let renamed = try core.routeEdit(route: route, legOverrides: overrides, .rename(uid: "p3", name: "KIMI2"))
        XCTAssertEqual(renamed.route[2]?["name"]?.string, "KIMI2")
        XCTAssertEqual(renamed.legOverrides["p2>p3"]?["altFt"]?.int, 5500)
        let point: JSON = ["kind": "custom", "refId": nil, "name": "WP1", "lat": 38.0, "lon": 23.9]
        let added = try core.routeEdit(route: route, legOverrides: nil, .add(point: point))
        XCTAssertEqual(added.route.array?.count, 5)
        XCTAssertEqual(added.route[4]?["uid"]?.string?.count, 8, "a new point gets a uid without Web Crypto")
        let alt = try core.routeEdit(route: route, legOverrides: overrides, .setAltitude(legKey: "p2>p3", altFt: nil))
        XCTAssertEqual(alt.legOverrides, .object([:]))
    }

    func testSetEndAndLocal() throws {
        let to = try core.routeEdit(route: route, legOverrides: nil, .setEnd(from: false, aerodrome: "LGMG"), ref: ref)
        XCTAssertEqual(to.route.array?.last?["name"]?.string, "LGMG")
        let two = JSON.array([flight["route"]![0]!, flight["route"]![3]!]).text
        let local = try core.routeEdit(route: two, legOverrides: nil, .makeLocal)
        XCTAssertTrue(try core.localFlight(route: local.route.text, options: nil).local)
        XCTAssertEqual(try core.routeInfo(route: route).autoWaypointName, "WP1")
    }

    func testSnapToAnAerodrome() throws {
        let tt = flight["route"]![0]!
        let s = try core.snap(
            ref: ref, route: "[]", waypoints: nil, layers: nil, lat: tt["lat"]!.double!, lon: tt["lon"]!.double!,
            zoom: 10, newUid: "n1")
        XCTAssertEqual(s.hit?.cand.name, "LGTT")
        XCTAssertEqual(s.point?["uid"]?.string, "n1")
        let none = try core.snap(ref: nil, route: "[]", waypoints: nil, layers: nil, lat: 36.2, lon: 26.9, zoom: 12)
        XCTAssertNil(none.hit)
    }

    func testRequestsAlternatesAndFuel() throws {
        let list = try core.setRequest(nil, pointUid: "p4", .set(kind: "stop", stopMin: 30))
        XCTAssertEqual(list[0]?["stopMin"]?.int, 30)
        let removed = try core.setRequest(list.text, pointUid: "p4", .remove(kind: nil))
        XCTAssertEqual(removed, .array([]))
        let r = try core.requests(route: route, options: JSON.object(["aerodromeRequests": list]).text, ref: ref)
        XCTAssertEqual(r["remarks"]?[0]?.string, "REQUEST FULL STOP AT LGSY FOR 30 MIN THEN CIRCUIT")
        XCTAssertEqual(try core.fplAlternates([" lgav ", "lgav", "EDDF"], ref: ref), ["LGAV", "EDDF"])
        let aircraft = try JSON.parse(try Fixtures.text("aircraft.json"))
        let fuel = try core.fuelLoad(fuel: aircraft["fuel"]!.text, totalL: 100)
        XCTAssertEqual(fuel.load.totalL, 100)
        XCTAssertEqual(fuel.load.parts.first?.type, "AVGAS")
    }

    func testReadinessStagesAndFocus() throws {
        let rows = try core.paperwork(filing: nil, forms: nil, declarations: nil)
        let stages = try core.readinessStages(items: rows.text)
        XCTAssertEqual(stages.map(\.stage), ["plan", "brief", "file"])
        XCTAssertEqual(stages.last?.state, "todo")
        let t = try core.focusTarget(text: "Block start time not set.")
        XCTAssertEqual(t.focus, "blockOff")
        XCTAssertEqual(t.section, "when")
        XCTAssertEqual(t.stage, "plan")
        XCTAssertEqual(
            try core.focusTarget(text: "W&B: empty mass is not set", aircraftId: "a1").link?.to,
            "/hangar/a1?focus=emptyMassKg")
        XCTAssertEqual(try core.focusSections().fields["fob"], "fuel")
    }

    func testRegenerateAtc() throws {
        let r = try core.regenerateAtc(
            flight: flight.text, altitudesFt: [1900, 5500, 1000], pilot: try Fixtures.text("pilot.json"), ref: ref)
        XCTAssertGreaterThan(r.generated.array?.count ?? 0, 0)
        XCTAssertEqual(r.list, flight["atc"], "the flight's own list is shown")
        XCTAssertTrue(r.stale, "the fixture's list is three rows of an older generation")
        XCTAssertEqual(r.atc, .null, "nothing added by hand: follow the generator")
        var fresh = flight!
        fresh["atc"] = .null
        let r2 = try core.regenerateAtc(flight: fresh.text, altitudesFt: [1900, 5500, 1000], pilot: nil, ref: nil)
        XCTAssertFalse(r2.stale)
        XCTAssertEqual(r2.list, r2.generated)
    }
}
