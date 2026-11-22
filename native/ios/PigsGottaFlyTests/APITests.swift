import XCTest

@testable import PigsGottaFly

final class APITests: XCTestCase {
    func testDecodesTheFlightList() throws {
        let list = try JSONDecoder().decode([FlightListItem].self, from: try Fixtures.data("flights.json"))
        XCTAssertEqual(list.count, 3)
        XCTAssertEqual(list[0].id, "fixture-lgtt-lgsy")
        XCTAssertEqual(list[0].title, "LGTT → LGSY")
        XCTAssertEqual(list[0].filingStatus, "filed")
        XCTAssertNil(list[0].sharedBy)
        XCTAssertEqual(list[1].title, "LGTT → LGSK")
        XCTAssertEqual(list[2].sharedBy?.name, "Another Pilot")
        XCTAssertEqual(list[2].role, "view")
        XCTAssertNil(list[2].filingStatus)
    }

    func testDecodesSessionMetarNotamsAndFiling() throws {
        let s = try JSONDecoder().decode(SessionResponse.self, from: try Fixtures.data("session.json"))
        XCTAssertTrue(s.authed)
        let m = try JSONDecoder().decode(MetarTafResponse.self, from: try Fixtures.data("metar.json"))
        XCTAssertEqual(m.stations["LGSY"]?.metar, "LGSY 220820Z 01012KT CAVOK 15/07 Q1020")
        XCTAssertNil(m.stations["LGTT"]?.taf)
        let f = try JSONDecoder().decode(FilingState.self, from: try Fixtures.data("filing.json"))
        XCTAssertEqual(f.filing?.status, "filed")
        XCTAssertEqual(FilingStatusLabel.label(f.filing?.status), "Filed")
        XCTAssertEqual(FilingStatusLabel.label(nil), "Not filed")
        XCTAssertEqual(FilingStatusLabel.label("delivered"), "Delivered by fax")
    }

    func testGroupsNotamsLikeTheWebsite() throws {
        let b = try JSONDecoder().decode(NotamBriefing.self, from: try Fixtures.data("notams.json"))
        XCTAssertEqual(b.relevantCount, 2)
        let groups = b.groups(always: ["LGTT", "LGSY"])
        XCTAssertEqual(groups.map(\.id), ["LGTT", "LGSY", "airspace"])
        XCTAssertEqual(groups[0].notams.count, 0, "the departure has its group even with no NOTAM")
        XCTAssertEqual(groups[1].notams.map(\.key), ["A2741/26"])
        XCTAssertEqual(groups[2].notams.map(\.key), ["A2790/26"])
    }

    func testPathsAreUnderTheApi() {
        let api = API(transport: FakeTransport { _ in (200, Data(), [:]) })
        XCTAssertEqual(api.url("flights").absoluteString, "https://pigsgottafly.com/api/flights")
        XCTAssertEqual(api.url("/api/flights/x").absoluteString, "https://pigsgottafly.com/api/flights/x")
        XCTAssertEqual(
            api.url("weather/metar?ids=LGTT,LGSY").absoluteString,
            "https://pigsgottafly.com/api/weather/metar?ids=LGTT,LGSY")
    }

    func testPutSendsFlightAndVersionAndReportsConflicts() async throws {
        let current = try Fixtures.data("flight.json")
        let fake = FakeTransport { req in
            let body = try JSON.parse(req.httpBody ?? Data())
            if body["version"]?.int == 7 { return (409, current, [:]) }
            return (200, Data(#"{"version":9,"updated":1}"#.utf8), [:])
        }
        let api = API(transport: fake)
        do {
            _ = try await api.updateFlight("f1", doc: ["date": "2026-11-23"], version: 7)
            XCTFail("expected a conflict")
        } catch APIError.conflict(let body) {
            XCTAssertEqual(try JSON.parse(body)["version"]?.int, 7)
        }
        let r = try await api.updateFlight("f1", doc: ["date": "2026-11-23"], version: 8)
        XCTAssertEqual(r.version, 9)
        let sent = try JSON.parse(fake.requests[1].httpBody!)
        XCTAssertEqual(sent["flight"]?["date"]?.string, "2026-11-23")
        XCTAssertEqual(fake.requests[1].httpMethod, "PUT")
        XCTAssertEqual(fake.requests[1].url?.path, "/api/flights/f1")
    }

    func testAutorouterLinkStatusConnectAndDisconnect() async throws {
        let fake = FakeTransport { req in
            switch (req.httpMethod ?? "", req.url!.path) {
            case ("GET", "/api/autorouter"):
                return (
                    200, Data(#"{"enabled":true,"connected":false,"broken":true,"account":null,"linkedAt":1}"#.utf8),
                    [:]
                )
            case ("POST", "/api/autorouter/app-connect"):
                return (
                    200, Data(#"{"url":"https://pigsgottafly.com/api/autorouter/app-connect?ticket=t.s"}"#.utf8), [:]
                )
            default:
                return (
                    200,
                    Data(#"{"enabled":true,"connected":false,"broken":false,"account":null,"linkedAt":null}"#.utf8),
                    [:]
                )
            }
        }
        let api = API(transport: fake)
        let s = try await api.autorouter()
        XCTAssertEqual(s, AutorouterLink(enabled: true, connected: false, broken: true, account: nil))
        let url = try await api.autorouterConnectURL()
        XCTAssertEqual(url.absoluteString, "https://pigsgottafly.com/api/autorouter/app-connect?ticket=t.s")
        XCTAssertEqual(fake.requests[1].value(forHTTPHeaderField: "Content-Type"), "application/json")
        let d = try await api.autorouterDisconnect()
        XCTAssertFalse(d.broken)
        XCTAssertEqual(fake.requests[2].url?.path, "/api/autorouter/disconnect")
    }

    func testStatusCodesBecomeErrors() async {
        let api = API(
            transport: FakeTransport { req in
                req.url!.path.hasSuffix("gone") ? (404, Data(), [:]) : (401, Data(#"{"error":"Sign in"}"#.utf8), [:])
            })
        do {
            _ = try await api.get("gone")
            XCTFail()
        } catch { XCTAssertEqual(error as? APIError, .notFound) }
        do {
            _ = try await api.flights()
            XCTFail()
        } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
    }

    func testOfflineIsReportedAsOffline() async {
        let api = API(transport: FakeTransport { _ in throw URLError(.notConnectedToInternet) })
        do {
            _ = try await api.flights()
            XCTFail()
        } catch { XCTAssertEqual(error as? APIError, .offline) }
    }

    func testTheSessionCookieOfTheRedirectIsStored() throws {
        let url = URL(string: "https://pigsgottafly.com/api/app-session?code=abc")!
        let response = HTTPURLResponse(
            url: url, statusCode: 302, httpVersion: "HTTP/1.1",
            headerFields: [
                "Location": "/", "Set-Cookie": "pgf_test_session=tok123; Path=/; HttpOnly; Secure; SameSite=Lax",
            ])!
        Session.storeCookies(from: response, url: url)
        let cookies = HTTPCookieStorage.shared.cookies(for: URL(string: "https://pigsgottafly.com/api/flights")!) ?? []
        let c = cookies.first { $0.name == "pgf_test_session" }
        XCTAssertEqual(c?.value, "tok123")
        if let c { HTTPCookieStorage.shared.deleteCookie(c) }
    }

    func testDocOfDropsTheRecordFields() throws {
        let f = try JSON.parse(try Fixtures.data("flight.json"))
        let doc = FlightModel.docOf(f)
        for k in ["id", "version", "created", "updated", "opened", "deleted", "access"] { XCTAssertNil(doc[k], k) }
        XCTAssertEqual(doc["date"]?.string, "2026-11-22")
        XCTAssertEqual(doc["route"]?.array?.count, 4)
    }

    func testJsonRoundTrips() throws {
        let text = #"{"a":[1,2.5,"x",true,null],"b":{"c":-3}}"#
        let j = try JSON.parse(text)
        XCTAssertEqual(j["a"]?[1]?.double, 2.5)
        XCTAssertEqual(j["a"]?[3]?.bool, true)
        XCTAssertEqual(j["a"]?[4], .null)
        XCTAssertEqual(try JSON.parse(j.text), j)
    }

    func testFixtureTransportAnswersLikeTheServer() async throws {
        let api = API(transport: FixtureTransport.bundled()!)
        let list = try api.decode([FlightListItem].self, try await api.flights())
        XCTAssertEqual(list.count, 3)
        let f = try JSON.parse(try await api.flight("fixture-lgtt-lgsy"))
        XCTAssertEqual(f["version"]?.int, 7)
        let r = try await api.updateFlight("fixture-lgtt-lgsy", doc: FlightModel.docOf(f), version: 7)
        XCTAssertEqual(r.version, 8)
        do {
            _ = try await api.updateFlight("fixture-lgtt-lgsy", doc: FlightModel.docOf(f), version: 7)
            XCTFail()
        } catch APIError.conflict(let body) {
            XCTAssertEqual(try JSON.parse(body)["version"]?.int, 8)
        }
    }
}
