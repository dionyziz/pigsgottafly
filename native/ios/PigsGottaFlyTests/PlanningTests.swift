import XCTest

@testable import PigsGottaFly

/// New flight, the profile, the places a route point can be, the route edits and the account calls.
final class PlanningTests: XCTestCase {
    private var ref: JSON!

    override func setUpWithError() throws {
        ref = try JSON.parse(try Fixtures.data("ref.json"))
    }

    // MARK: places

    func testAerodromesAreNamedAsTheWebsiteNamesThem() {
        let ads = Places.aerodromes(ref: ref)
        let lgtt = ads.first { $0.refId == "LGTT" }
        XCTAssertEqual(lgtt?.name, "LGTT")
        XCTAssertEqual(lgtt?.code, "LGTT")
        XCTAssertEqual(lgtt?.detail, "Dekelia / Tatoi")
        // no ICAO code: the last part of the name, and the id as the code
        let kopaida = ads.first { $0.refId == "KOPAIDA-DIMITRA" }
        XCTAssertEqual(kopaida?.name, "DIMITRA")
        XCTAssertEqual(kopaida?.code, "KOPAIDA-DIMITRA")
    }

    func testSearchFindsByCodeAndNameBestFirst() {
        let ads = Places.aerodromes(ref: ref)
        XCTAssertEqual(Places.search("lgsy", in: ads).first?.refId, "LGSY")
        XCTAssertEqual(Places.search("skiros", in: ads).first?.refId, "LGSY")
        XCTAssertEqual(Places.search("tatoi", in: ads).map(\.refId), ["LGTT"])
        XCTAssertEqual(Places.search("LG", in: ads).count, 8)
        XCTAssertTrue(Places.search("zzzz", in: ads).isEmpty)
        let all = ads + Places.vfrPoints(ref: ref)
        XCTAssertEqual(Places.search("kalamo", in: all).first?.refId, "LGTG/KALAMO")
        XCTAssertEqual(Places.search("kalamo", in: all).first?.kind, .vfr)
    }

    func testOpenFlightmapsPointsNextToChartedOnesAreLeftOut() {
        let j: JSON = [
            "vfrPoints": [
                ["id": "LGAV/X", "name": "X", "lat": 38.0, "lon": 23.0, "chart": "LGAV", "src": "chart"],
                ["id": "OFM/X", "name": "X", "lat": 38.001, "lon": 23.0, "chart": "", "src": "ofm"],
                ["id": "OFM/Y", "name": "Y", "lat": 38.5, "lon": 23.0, "chart": "", "src": "ofm"],
            ]
        ]
        XCTAssertEqual(Places.vfrPoints(ref: j).map(\.refId), ["LGAV/X", "OFM/Y"])
    }

    func testSavedWaypoints() throws {
        let w = Places.waypoints(try JSON.parse(try Fixtures.data("waypoints.json")))
        XCTAssertEqual(w.map(\.name), ["MARATHON DAM"])
        XCTAssertEqual(w.first?.routePoint(uid: "u1")["kind"]?.string, "waypoint")
    }

    // MARK: new flight

    func testTheNewFlightRequestIsTheWebsitesShape() throws {
        let ads = Places.aerodromes(ref: ref)
        let from = try XCTUnwrap(ads.first { $0.refId == "LGTT" })
        let to = try XCTUnwrap(ads.first { $0.refId == "LGSY" })
        let r = NewFlight.request(from: from, to: to, date: "2026-11-22", blockOff: "08:30", aircraftId: "ac1")
        let route = try XCTUnwrap(r["route"]?.array)
        XCTAssertEqual(route.count, 2)
        XCTAssertEqual(route[0]["kind"]?.string, "aerodrome")
        XCTAssertEqual(route[0]["refId"]?.string, "LGTT")
        XCTAssertEqual(route[0]["name"]?.string, "LGTT")
        XCTAssertEqual(route[1]["lat"]?.double, 38.9675)
        XCTAssertEqual(route[0]["uid"]?.string?.count, 8)
        XCTAssertNotEqual(route[0]["uid"], route[1]["uid"])
        XCTAssertEqual(r["date"]?.string, "2026-11-22")
        XCTAssertEqual(r["blockOff"]?.string, "08:30")
        XCTAssertEqual(r["aircraftId"]?.string, "ac1")
        XCTAssertNil(r["legOverrides"], "the altitudes are the core's defaults")
        let none = NewFlight.request(from: from, to: to, date: "2026-11-22", blockOff: "", aircraftId: nil)
        XCTAssertNil(none["aircraftId"], "no aircraft: the server's default")
    }

    func testTheDefaultBlockOffIsTheNextFullHour() {
        let at = Date(timeIntervalSince1970: 1_763_712_000 + 20 * 60)  // 08:00Z + 20 min
        XCTAssertEqual(Fmt.clock(NewFlightView.defaultDate(now: at)), "09:00")
        XCTAssertEqual(Fmt.clock(NewFlightView.defaultDate(now: at.addingTimeInterval(20 * 60))), "10:00")
    }

    // MARK: route edits

    func testAPointGoesWhereItLengthensTheRouteLeast() throws {
        var f = try JSON.parse(try Fixtures.data("flight.json"))
        let kalamo = try XCTUnwrap(Places.vfrPoints(ref: ref).first { $0.refId == "LGTG/KALAMO" })
        RouteEdit.remove(uid: "p2", from: &f)
        XCTAssertEqual(f["route"]?.array?.map { $0["name"]?.string ?? "" }, ["LGTT", "KIMI", "LGSY"])
        XCTAssertNil(f["legOverrides"]?["p2>p3"], "the removed leg's altitude goes")
        RouteEdit.add(kalamo, to: &f)
        XCTAssertEqual(f["route"]?.array?.map { $0["name"]?.string ?? "" }, ["LGTT", "KALAMO", "KIMI", "LGSY"])
        let lgsk = try XCTUnwrap(Places.aerodromes(ref: ref).first { $0.refId == "LGSK" })
        XCTAssertEqual(RouteEdit.bestIndex(for: lgsk, in: f["route"]?.array ?? []), 3)
    }

    func testOverridesOfLegsThatStayAreKept() throws {
        var f = try JSON.parse(try Fixtures.data("flight.json"))
        RouteEdit.pruneOverrides(&f)
        XCTAssertEqual(f["legOverrides"]?["p2>p3"]?["altFt"]?.int, 5500)
    }

    // MARK: profile

    func testTheProfileUpdateIsTheWebsites() throws {
        var p = try JSONDecoder().decode(PilotProfile.self, from: try Fixtures.data("pilot.json"))
        let home = Places.aerodromes(ref: ref).first { $0.refId == "LGTT" }
        let u = p.update(fullName: "  Jane   Pilot ", phone: " +30 210 1 ", home: home)
        XCTAssertEqual(u["fullName"]?.string, "Jane Pilot")
        XCTAssertEqual(u["phone"]?.string, "+30 210 1")
        XCTAssertEqual(u["homeAerodrome"]?.string, "LGTT")
        XCTAssertNil(u["settings"])
        // nothing is required, and taxi times are not made up
        p.settings = ["taxiOutMin": nil, "taxiInMin": 5]
        let empty = p.update(fullName: " ", phone: "", home: nil)
        XCTAssertEqual(empty["fullName"]?.string, "")
        XCTAssertEqual(empty["homeAerodrome"], .null)
        XCTAssertNil(empty["settings"])
    }

    func testAnUntitledFlightIsShownByItsRoute() throws {
        var list = try JSONDecoder().decode([FlightListItem].self, from: try Fixtures.data("flights.json"))
        list[0].summary.title = list[0].summary.date
        XCTAssertEqual(list[0].title, "LGTT → LGSY")
    }

    // MARK: the API calls

    func testTheNewCallsSendWhatTheServerTakes() async throws {
        let fake = FakeTransport { req in
            switch (req.httpMethod, req.url!.path) {
            case ("POST", "/api/flights"): return (201, Data(#"{"id":"f9"}"#.utf8), [:])
            case ("POST", "/api/aircraft"): return (201, Data(#"{"id":"ac9","registration":"SX-ABC"}"#.utf8), [:])
            case ("GET", "/api/aircraft"):
                return (
                    200, Data(#"[{"id":"ac9","registration":"SX-ABC","makeModel":"Reims/Cessna F172M"}]"#.utf8), [:]
                )
            case ("GET", "/api/waypoints"): return (200, Data("[]".utf8), [:])
            case ("PUT", "/api/me"): return (200, try Fixtures.data("pilot.json"), [:])
            case ("DELETE", "/api/me"): return (200, Data(#"{"ok":true}"#.utf8), [:])
            default: return (404, Data(), [:])
            }
        }
        let api = API(transport: fake)
        _ = try await api.createFlight(["route": [], "date": "2026-11-22"])
        _ = try await api.createAircraft(Data(#"{"registration":"SX-ABC"}"#.utf8))
        let list = try api.decode([AircraftItem].self, try await api.aircraftList())
        XCTAssertEqual(list.first?.label, "SX-ABC · Reims/Cessna F172M")
        _ = try await api.waypoints()
        _ = try await api.updateMe(["phone": "1"])
        try await api.deleteAccount(confirm: "pilot@example.com")
        let r = fake.requests
        XCTAssertEqual(r.map { $0.httpMethod ?? "" }, ["POST", "POST", "GET", "GET", "PUT", "DELETE"])
        XCTAssertEqual(try JSON.parse(r[0].httpBody!)["date"]?.string, "2026-11-22")
        XCTAssertEqual(r[0].value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(try JSON.parse(r[4].httpBody!)["phone"]?.string, "1")
        XCTAssertEqual(try JSON.parse(r[5].httpBody!), ["confirm": "pilot@example.com"])
    }

    func testFixturesStartAnEmptyAccountAndKeepWhatIsCreated() async throws {
        let t = try XCTUnwrap(FixtureTransport.bundled(emptyAccount: true))
        let api = API(transport: t)
        let noFlights = try api.decode([FlightListItem].self, try await api.flights())
        XCTAssertTrue(noFlights.isEmpty)
        let noAircraft = try api.decode([AircraftItem].self, try await api.aircraftList())
        XCTAssertTrue(noAircraft.isEmpty)
        let me = try api.decode(PilotProfile.self, try await api.me())
        XCTAssertEqual([me.fullName, me.phone, me.homeAerodrome ?? ""], ["", "", ""], "only the e-mail")

        let core = try Core.bundled()
        let template = try XCTUnwrap(try core.aircraftTemplates().first)
        let ac = try JSON.parse(
            try await api.createAircraft(
                Data(try core.aircraftFromTemplate(id: template.id, registration: "sx-abc").utf8)))
        XCTAssertEqual(ac["registration"]?.string, "SX-ABC")
        let ads = Places.aerodromes(ref: ref)
        let req = NewFlight.request(
            from: ads.first { $0.refId == "LGTT" }!, to: ads.first { $0.refId == "LGSY" }!, date: "2026-11-23",
            blockOff: "09:00", aircraftId: ac["id"]?.string)
        let f = try JSON.parse(try await api.createFlight(req))
        let id = try XCTUnwrap(f["id"]?.string)
        let list = try api.decode([FlightListItem].self, try await api.flights())
        XCTAssertEqual(list.map(\.id), [id])
        XCTAssertEqual(list[0].title, "LGTT → LGSY")
        XCTAssertEqual(list[0].summary.aircraft, "SX-ABC")
        let got = try JSON.parse(try await api.flight(id))
        XCTAssertEqual(got["route"]?.array?.count, 2)
        XCTAssertEqual(got["atc"], .null, "the ATC list is generated by the core")

        var doc = FlightModel.docOf(got)
        doc["blockOff"] = "10:00"
        _ = try await api.updateFlight(id, doc: doc, version: 1)
        let saved = try JSON.parse(try await api.flight(id))
        XCTAssertEqual(saved["blockOff"]?.string, "10:00")

        let updated = try api.decode(
            PilotProfile.self, try await api.updateMe(me.update(fullName: "J P", phone: "1", home: ads.first)))
        XCTAssertEqual([updated.fullName, updated.phone], ["J P", "1"])
        XCTAssertNotNil(updated.homeAerodrome)
        do {
            try await api.deleteAccount(confirm: "someone@else")
            XCTFail("a wrong e-mail is refused")
        } catch APIError.http(let code, _) { XCTAssertEqual(code, 400) }
        try await api.deleteAccount(confirm: "PILOT@example.com")
    }
}
