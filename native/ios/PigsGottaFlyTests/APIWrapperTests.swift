import XCTest

@testable import PigsGottaFly

/// The typed wrappers send what the website's src/data/api.ts sends: method, path and JSON body.
final class APIWrapperTests: XCTestCase {
    private func recording(_ answer: String = "{}", status: Int = 200) -> (API, FakeTransport) {
        let fake = FakeTransport { _ in (status, Data(answer.utf8), [:]) }
        return (API(transport: fake), fake)
    }

    private func sent(_ fake: FakeTransport) throws -> (String, String, JSON?) {
        let r = try XCTUnwrap(fake.requests.last)
        let path = r.url!.absoluteString.replacingOccurrences(of: "https://pigsgottafly.com/api/", with: "")
        return (r.httpMethod ?? "", path, try r.httpBody.map { try JSON.parse($0) })
    }

    func testFlights() async throws {
        let (api, fake) = recording(status: 204)
        try await api.trashFlight("a b")
        var (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "DELETE")
        XCTAssertEqual(p, "flights/a%20b")
        XCTAssertEqual(b, [:], "a JSON body, which the API wants on anything but GET")
        _ = try await api.copyFlight("f1")
        (m, p, b) = try sent(fake)
        XCTAssertEqual(p, "flights/f1/copy")
        XCTAssertEqual(b, ["title": ""])
        _ = try await api.copyFlight("f1", title: nil, date: "2026-12-01")
        (_, _, b) = try sent(fake)
        XCTAssertEqual(b, ["date": "2026-12-01"])
        _ = try await api.flights(trash: true)
        (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "GET")
        XCTAssertEqual(p, "flights?trash=1")
        XCTAssertNil(b)
    }

    func testSharing() async throws {
        let (api, fake) = recording()
        _ = try await api.shareFlight("f1", email: "a@b.c", role: .edit)
        var (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "POST")
        XCTAssertEqual(p, "flights/f1/shares")
        XCTAssertEqual(b, ["email": "a@b.c", "role": "edit"])
        _ = try await api.setAircraftShareRole("ac", pilotId: "p2", role: .view)
        (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "PUT")
        XCTAssertEqual(p, "aircraft/ac/shares/p2")
        XCTAssertEqual(b, ["role": "view"])
        _ = try await api.invite(.init(email: "x@y.z", message: nil, aircraft: [.init(aircraftId: "ac", role: .view)]))
        (_, p, b) = try sent(fake)
        XCTAssertEqual(p, "invitations")
        XCTAssertEqual(b, ["email": "x@y.z", "aircraft": [["aircraftId": "ac", "role": "view"]]])
    }

    func testFilingAndForms() async throws {
        let (api, fake) = recording(try Fixtures.text("filing.json"))
        _ = try await api.fileFlightPlan(
            "f1", .init(fpl: "(FPL-SXABC-VG)", addresses: ["LGGGZQZX"], eobt: nil, copyTo: nil, via: .autorouter))
        var (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "POST")
        XCTAssertEqual(p, "flights/f1/filing")
        XCTAssertEqual(b, ["fpl": "(FPL-SXABC-VG)", "addresses": ["LGGGZQZX"], "via": "autorouter"])
        _ = try await api.delayFlightPlan("f1", eobt: 1000)
        (_, p, b) = try sent(fake)
        XCTAssertEqual(p, "flights/f1/filing/delay")
        XCTAssertEqual(b, ["eobt": 1000])
        _ = try await api.setGenDecHandled("f1", handled: nil)
        (_, p, b) = try sent(fake)
        XCTAssertEqual(p, "flights/f1/forms/gendec/handled")
        XCTAssertEqual(b, ["handled": nil])
        _ = try await api.sendDeclarations("f1", content: ["x": 1] as JSON, resend: true)
        (_, p, b) = try sent(fake)
        XCTAssertEqual(p, "flights/f1/declarations/send")
        XCTAssertEqual(b, ["content": ["x": 1], "resend": true])
    }

    func testFiles() async throws {
        let (api, fake) = recording(#"{"data":"aGk="}"#)
        let chunk = try await api.fileChunk(.operators("op 1"), fileId: "f", seq: 2)
        XCTAssertEqual(String(decoding: chunk, as: UTF8.self), "hi")
        var (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "GET")
        XCTAssertEqual(p, "operators/op%201/files/f/chunks/2")
        try await api.putFileChunk(.pilot("me"), fileId: "f", seq: 0, base64: "aGk=")
        (m, p, b) = try sent(fake)
        XCTAssertEqual(m, "PUT")
        XCTAssertEqual(p, "pilots/me/files/f/chunks/0")
        XCTAssertEqual(b, ["data": "aGk="])
    }

    func testFixturesAnswerThePeopleLists() async throws {
        let api = API(transport: FixtureTransport.bundled()!)
        // the manifest fixtures (FixtureRoutes+Manifest) give the passenger list its people
        let passengers = try await api.passengers(as: [JSON].self)
        XCTAssertFalse(passengers.isEmpty)
        // the operator fixtures (FixtureRoutes+Operators): one the pilot owns, one shared with them
        let operators = try await api.operators()
        XCTAssertEqual(operators.array?.compactMap { $0["id"]?.string }, ["op-mesogeion", "op-aegean-flyers"])
    }
}
