import XCTest

@testable import PigsGottaFly

/// Plan's edits (route, when, aircraft, fuel, flight plan options): each one PUTs the flight the website's
/// section would send. Where the website's section calls a function, the expected doc is that function's
/// answer through the core (the website's own module); a plain field is checked as written.
@MainActor
final class PlanEditsTests: XCTestCase {
    /// The fixture server, recording the PUT bodies.
    final class Recording: HTTPTransport, @unchecked Sendable {
        let inner = FixtureTransport.bundled()!
        private let lock = NSLock()
        private var bodies: [JSON] = []
        var puts: [JSON] {
            lock.lock()
            defer { lock.unlock() }
            return bodies
        }

        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            if request.httpMethod == "PUT", let b = request.httpBody, let j = try? JSON.parse(b) {
                lock.lock()
                bodies.append(j)
                lock.unlock()
            }
            return try await inner.send(request)
        }
    }

    private var transport: Recording!
    private var model: FlightModel!
    private var core: Core!

    override func setUp() async throws {
        transport = Recording()
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        core = try XCTUnwrap(app.core)
        XCTAssertNil(model.error)
    }

    /// The flight the last PUT carried (its doc without the lobby summary).
    private func lastDoc(file: StaticString = #filePath, line: UInt = #line) throws -> JSON {
        let body = try XCTUnwrap(transport.puts.last, "no PUT", file: file, line: line)
        XCTAssertEqual(body["version"]?.int, model.version - 1, file: file, line: line)
        var doc = try XCTUnwrap(body["flight"], file: file, line: line)
        doc["summary"] = nil
        return doc
    }

    /// The editable part of the flight as it is now (the expected doc's starting point).
    private func docNow() -> JSON {
        var d = FlightModel.docOf(model.flight!)
        d["summary"] = nil
        return d
    }

    private func names(_ doc: JSON) -> [String] {
        (doc["route"]?.array ?? []).compactMap { $0["name"]?.string }
    }

    // MARK: when

    func testTaxiTimesAreClampedOrCleared() async throws {
        var expected = docNow()
        await model.setTaxiOut(20)
        expected["taxiOutMin"] = 20
        XCTAssertEqual(try lastDoc(), expected)
        await model.setTaxiIn(nil)
        expected["taxiInMin"] = .null
        XCTAssertEqual(try lastDoc(), expected, "an empty field is null (not set), not dropped")
        await model.setTaxiOut(500)
        expected["taxiOutMin"] = 180
        XCTAssertEqual(try lastDoc(), expected, "clamped to the field's 180 min")
        await model.setDate("2026-12-01")
        await model.setBlockOff("07:45")
        expected["date"] = "2026-12-01"
        expected["blockOff"] = "07:45"
        XCTAssertEqual(try lastDoc(), expected)
        // the lobby row follows the date and the time
        XCTAssertEqual(transport.puts.last?["flight"]?["summary"]?["date"], "2026-12-01")
        XCTAssertEqual(transport.puts.last?["flight"]?["summary"]?["blockOff"], "07:45")
    }

    // MARK: route

    func testReorderKeepsUidsAndDropsTheOverridesOfGoneLegs() async throws {
        let before = docNow()
        // KIMI (index 2) before KALAMO (index 1)
        await model.movePoints(from: IndexSet(integer: 2), to: 1)
        let doc = try lastDoc()
        XCTAssertEqual(names(doc), ["LGTT", "KIMI", "KALAMO", "LGSY"])
        XCTAssertEqual(doc["route"]?.array?.compactMap { $0["uid"]?.string }, ["p1", "p3", "p2", "p4"])
        // the website's remove then insert of the same point: p2>p3 is no longer a leg
        let removed = try core.routeEdit(
            route: before["route"]!.text, legOverrides: before["legOverrides"]?.text, .remove(uid: "p3"))
        let web = try core.routeEdit(
            route: removed.route.text, legOverrides: removed.legOverrides.text,
            .insert(index: 1, point: before["route"]![2]!))
        var expected = before
        expected["route"] = web.route
        expected["legOverrides"] = web.legOverrides
        XCTAssertEqual(doc, expected)
        XCTAssertEqual(doc["legOverrides"], [:])

        // the last point to the front: the origin changes
        await model.movePoints(from: IndexSet(integer: 3), to: 0)
        XCTAssertEqual(names(try lastDoc()), ["LGSY", "LGTT", "KIMI", "KALAMO"])
    }

    func testEndsLocalFlightRenameInsertAndRemove() async throws {
        let places = await model.app.places(aerodromesOnly: true)
        let lgtg = try XCTUnwrap(places.first { $0.code == "LGTG" })

        // the destination replaced: a new point, as the website's setRouteEnd
        var before = docNow()
        await model.setEnd(from: false, lgtg)
        var doc = try lastDoc()
        let last = try XCTUnwrap(doc["route"]?.array?.last)
        XCTAssertEqual(last["kind"], "aerodrome")
        XCTAssertEqual(last["refId"], "LGTG")
        XCTAssertEqual(last["name"], "LGTG")
        XCTAssertNotEqual(last["uid"], "p4")
        var expected = before
        expected["route"] = .array(Array(before["route"]!.array!.dropLast()) + [last])
        XCTAssertEqual(doc, expected)

        // rename, as the map's point menu
        before = docNow()
        await model.renamePoint(uid: "p2", name: "KALAMOS")
        doc = try lastDoc()
        XCTAssertEqual(names(doc), ["LGTT", "KALAMOS", "KIMI", "LGTG"])
        XCTAssertEqual(doc["legOverrides"], before["legOverrides"], "renaming keeps the legs")

        // a typed position, inserted on the second leg
        let pos = try XCTUnwrap(model.parsePosition("38.5 24.0"))
        let name = try XCTUnwrap(model.routeInfo()?.autoWaypointName)
        XCTAssertEqual(name, "WP1")
        await model.insert(FlightModel.customPoint(name: name, lat: pos.lat, lon: pos.lon), at: 2)
        doc = try lastDoc()
        XCTAssertEqual(names(doc), ["LGTT", "KALAMOS", "WP1", "KIMI", "LGTG"])
        let wp = doc["route"]![2]!
        XCTAssertEqual(wp["kind"], "custom")
        XCTAssertEqual(wp["refId"], .null)
        XCTAssertEqual(wp["lat"]?.double, 38.5)
        XCTAssertEqual(doc["legOverrides"], [:], "p2>p3 was split")

        // removed
        await model.removePoint(uid: wp["uid"]!.string!)
        XCTAssertEqual(names(try lastDoc()), ["LGTT", "KALAMOS", "KIMI", "LGTG"])
    }

    func testLocalFlightAndFlySomewhereInstead() async throws {
        // down to two points, then local from the origin
        for uid in ["p2", "p3"] { await model.removePoint(uid: uid) }
        XCTAssertEqual(names(try lastDoc()), ["LGTT", "LGSY"])
        await model.makeLocal()
        var doc = try lastDoc()
        XCTAssertEqual(names(doc), ["LGTT", "LGTT"])
        XCTAssertEqual(doc["route"]?[0]?["uid"], "p1")
        XCTAssertEqual(model.localFlight()?.local, true)
        await model.setLocalDuration(90)
        doc = try lastDoc()
        XCTAssertEqual(doc["options"]?["localDurationMin"], 90)

        let places = await model.app.places(aerodromesOnly: true)
        let lgsk = try XCTUnwrap(places.first { $0.code == "LGSK" })
        await model.setEnd(from: false, lgsk)
        XCTAssertEqual(names(try lastDoc()), ["LGTT", "LGSK"])
        XCTAssertEqual(model.localFlight()?.local, false)
    }

    func testARouteEditIsUndone() async throws {
        let undo = UndoManager()
        undo.groupsByEvent = false
        model.undoManager = undo
        let before = model.route
        undo.beginUndoGrouping()
        await model.movePoints(from: IndexSet(integer: 1), to: 3)
        undo.endUndoGrouping()
        XCTAssertNotEqual(model.route, before)
        undo.undo()
        let end = Date().addingTimeInterval(5)
        while (model.route != before || model.saving) && Date() < end { try? await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(model.route, before)
        XCTAssertEqual(try lastDoc()["route"], .array(before))
    }

    // MARK: aircraft

    func testChoosingTheAircraftAsTheAircraftSection() async throws {
        let aircraft = try XCTUnwrap(model.aircraft)
        var before = docNow()
        await model.chooseAircraft(nil)
        var web = try core.setAircraft(doc: before.text, aircraft: nil)
        var expected = before
        expected["aircraftId"] = .null
        expected["crew"] = web.crew
        expected["baggageKg"] = web.baggageKg
        expected["options"] = web.options
        XCTAssertEqual(try lastDoc(), expected)

        before = docNow()
        await model.chooseAircraft(aircraft)
        web = try core.setAircraft(doc: before.text, aircraft: aircraft.text)
        expected = before
        expected["aircraftId"] = aircraft["id"]
        expected["crew"] = web.crew
        expected["baggageKg"] = web.baggageKg
        expected["options"] = web.options
        XCTAssertEqual(try lastDoc(), expected)

        await model.setCompassCard("Magnetic compass")
        await model.setWindModel("gfs_seamless")
        let doc = try lastDoc()
        XCTAssertEqual(doc["options"]?["compassCard"], "Magnetic compass")
        XCTAssertEqual(doc["options"]?["windModel"], "gfs_seamless")
    }

    func testOnASharedFlightTheAircraftIsTheOwners() async throws {
        let store = temporaryStore()
        var shared = try JSON.parse(try Fixtures.data("flight.json"))
        shared["access"] = ["role": "edit", "owner": ["name": "Alice", "email": "alice@example.com"]]
        try store.write(try shared.data(), .flight("fixture-lgtt-lgsy"))
        try store.write(try Fixtures.data("ref.json"), .ref)
        let fake = FakeTransport { _ in throw URLError(.notConnectedToInternet) }
        let app = AppModel(arguments: ["-noNetwork"], api: API(transport: fake), store: store)
        let m = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await m.open()
        XCTAssertTrue(m.aircraftIsOwnersChoice)
        await m.chooseAircraft(nil)
        XCTAssertEqual(m.flight?["aircraftId"], "fixture-sx-asv")
        XCTAssertFalse(store.exists(.pendingEdit("fixture-lgtt-lgsy")), "nothing to send")
    }

    // MARK: fuel

    func testFuelOnBoardPerTypeAndTheTaxiAllowance() async throws {
        var expected = docNow()
        // MOGAS typed on an AVGAS-first aircraft: the split is kept, the FOB is its sum
        await model.setFuel("MOGAS", litres: 20)
        var web = try core.fuelEdit(
            doc: expected.text, .type(fuel: model.aircraft!["fuel"]!.text, type: "MOGAS", litres: 20))
        expected["fobL"] = web.fobL.map(JSON.number) ?? .null
        expected["options"] = web.options
        XCTAssertEqual(try lastDoc(), expected)
        XCTAssertEqual(expected["fobL"], 20)
        XCTAssertEqual(expected["options"]?["fuelL"], ["MOGAS": 20])

        await model.setFuel("AVGAS", litres: 100)
        XCTAssertEqual(try lastDoc()["fobL"], 120)
        XCTAssertEqual(try lastDoc()["options"]?["fuelL"], ["MOGAS": 20, "AVGAS": 100])
        XCTAssertEqual(model.fuelLoad()?.load.mixed, true)

        await model.setFuel("MOGAS", litres: nil)
        XCTAssertEqual(try lastDoc()["fobL"], 100)
        XCTAssertEqual(try lastDoc()["options"]?["fuelL"], .null, "only the first fuel: a plain total")

        expected = docNow()
        await model.fuelEdit(.requiredPlusReserve)
        web = try core.fuelEdit(doc: expected.text, .requiredPlusReserve)
        expected["fobL"] = .null
        expected["options"] = web.options
        XCTAssertEqual(try lastDoc(), expected)

        await model.setTaxiAllowance(6)
        XCTAssertEqual(try lastDoc()["options"]?["taxiAllowanceL"], 6)
        XCTAssertEqual(model.fuelLoad()?.taxiAllowanceL, 6)
        await model.setTaxiAllowance(nil)
        XCTAssertEqual(try lastDoc()["options"]?["taxiAllowanceL"], .null)
    }

    // MARK: flight plan options

    func testAlternatesRemarksAndRequests() async throws {
        await model.setAlternates(fields: ["lgav", "Megara"])
        var doc = try lastDoc()
        XCTAssertEqual(
            doc["options"]?["alternates"],
            .array(try core.fplAlternates(["lgav", "Megara"], ref: nil).map(JSON.string)))
        XCTAssertEqual(doc["options"]?["alternates"]?[0], "LGAV")
        let count = transport.puts.count
        await model.setAlternates(fields: ["LGAV", "megara"])
        XCTAssertEqual(transport.puts.count, count, "the same codes: nothing to save")

        await model.setRemarks("PHOTO FLIGHT")
        XCTAssertEqual(try lastDoc()["options"]?["remarks"], "PHOTO FLIGHT")

        let before = docNow()
        await model.setRequest(pointUid: "p4", .set(kind: "stop", stopMin: 30))
        doc = try lastDoc()
        let web = try core.setRequest(
            before["options"]?["aerodromeRequests"]?.text, pointUid: "p4", .set(kind: "stop", stopMin: 30))
        var expected = before
        expected["options"]?["aerodromeRequests"] = web
        XCTAssertEqual(doc, expected)
        XCTAssertEqual(web, [["pointUid": "p4", "kind": "stop", "stopMin": 30]])
        XCTAssertEqual(model.requestsInfo()?["active"]?.array?.count, 1)

        await model.setRequest(pointUid: "p1", .set(kind: "touch-and-go", stopMin: nil))
        await model.setRequest(pointUid: "p4", .remove(kind: "stop"))
        doc = try lastDoc()
        XCTAssertEqual(doc["options"]?["aerodromeRequests"], [["pointUid": "p1", "kind": "touch-and-go"]])
    }
}
