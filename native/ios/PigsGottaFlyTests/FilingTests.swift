import XCTest

@testable import PigsGottaFly

/// Filing the flight plan: the website's Filing panel through the core, and the screen's model against
/// the fixture server (which simulates filing: nothing leaves the device).
@MainActor
final class FilingTests: XCTestCase {
    private let lgsk = "fixture-lgtt-lgsk"

    private func open(_ id: String, transport: HTTPTransport? = nil) async throws -> (FilingModel, FlightModel) {
        let api = API(transport: transport ?? FixtureTransport.bundled()!)
        let app = AppModel(arguments: ["-fixtures", "-noNetwork"], api: api, store: temporaryStore())
        let flight = FlightModel(id: id, app: app)
        await flight.open()
        let filing = FilingModel(flight: flight)
        await filing.load()
        return (filing, flight)
    }

    // MARK: the core

    func testTheCoreViewOfAPlanNotFiled() throws {
        let core = try Core.bundled()
        let state = try Fixtures.text("filing-\(lgsk).json")
        let v = try core.filingView(
            state: state, choices: .init(excluded: ["LGAVZPZX"], extra: ["LGSKZTZX", "LGMGZTZX"], via: "fax"),
            message: "(FPL-SXASV-VG\n-C172/L-S/C\n-LGTT0745\n-N0092VFR KALAMO\n-LGSK0049\n-DOF/261128)")
        XCTAssertEqual(v.status.label, "Not filed")
        XCTAssertTrue(v.file.enabled)
        XCTAssertEqual(v.file.label, "File")
        XCTAssertEqual(v.addresses, ["LGGGZFZX", "LGSKZTZX", "LGMGZTZX"])
        XCTAssertEqual(v.addressees.last?.reasons, "added by hand")
        XCTAssertEqual(v.sendsVia, "Fax to Athens Central AIS")
        XCTAssertEqual(v.viaChoice?.first?.label, "autorouter, then Fax to Athens Central AIS")
        XCTAssertEqual(v.request?["via"], "fax")
        XCTAssertEqual(v.request?["copyTo"], ["ops@example.com"])
        XCTAssertEqual(v.head?.adep, "LGTT")
        XCTAssertEqual(v.head?.eobt, "0745")
        XCTAssertEqual(v.head?.dof, "261128")
        XCTAssertNotEqual(v.delay.shown, true)
    }

    func testTheCoreViewOfAFiledPlanAndItsDelay() throws {
        let core = try Core.bundled()
        let state = try Fixtures.text("filing.json")
        let v = try core.filingView(state: state)
        XCTAssertEqual(v.status.label, "Filed")
        XCTAssertEqual(v.status.tone, "ok")
        XCTAssertFalse(v.file.enabled)
        XCTAssertEqual(v.delay.shown, true)
        XCTAssertEqual(v.cancel.shown, true)
        XCTAssertTrue(v.refresh.enabled)
        XCTAssertEqual(v.record?.via, "Filed via autorouter")
        // the fixture's EOBT is 2026-11-22 08:30Z
        let now = Date(timeIntervalSince1970: 1_795_320_000)
        let later = Date(timeIntervalSince1970: 1_795_336_200 + 1800)
        XCTAssertNil(try core.filingDelay(state: state, eobt: later, now: now).problem)
        XCTAssertEqual(
            try core.filingDelay(state: state, eobt: Date(timeIntervalSince1970: 1_795_336_200), now: now).problem,
            "That is the EOBT already filed.")
        XCTAssertEqual(
            try core.filingDelay(state: state, eobt: now.addingTimeInterval(6 * 86400), now: now).problem,
            "The new EOBT must be between now and 5 days ahead.")
        let start = try core.filingDelay(state: state, eobt: nil, now: now)
        XCTAssertEqual(start.start, 1_795_336_200_000, "the delay starts from the filed EOBT")
        XCTAssertEqual(start.via, "Through autorouter, which delays the plan with ATC.")
        XCTAssertEqual(try core.filingError(offline: true, message: nil), "Offline: nothing was sent.")
        XCTAssertEqual(try core.filingError(offline: false, message: nil), "The request failed.")
    }

    // MARK: the screen's model on the fixture server

    func testFileDelayCancelAndTheReadinessRowFollows() async throws {
        let (filing, flight) = try await open(lgsk)
        XCTAssertEqual(filing.view?.status.label, "Not filed")
        XCTAssertEqual(filing.fpl?.fpl.complete, true)
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.text, "Not filed yet.")

        await filing.setAddress("LGAVZPZX", on: false)
        XCTAssertEqual(filing.view?.addresses, ["LGGGZFZX", "LGSKZTZX"])
        let filed = await filing.file()
        XCTAssertTrue(filed)
        XCTAssertNil(filing.error)
        XCTAssertEqual(filing.view?.status.label, "Filed")
        XCTAssertEqual(filing.view?.record?.via, "Filed via autorouter")
        XCTAssertEqual(flight.filing?.filing?.status, "filed")
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.text, "Filed.")
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.state, .ok)

        XCTAssertEqual(filing.view?.file.enabled, false, "an open plan is delayed or cancelled, not filed again")

        let eobt = try XCTUnwrap(filing.eobt)
        let delayed = await filing.delay(to: eobt.addingTimeInterval(30 * 60))
        XCTAssertTrue(delayed)
        XCTAssertEqual(filing.eobt, eobt.addingTimeInterval(30 * 60))

        let cancelled = await filing.cancel()
        XCTAssertTrue(cancelled)
        XCTAssertEqual(filing.view?.status.label, "Cancelled")
        XCTAssertEqual(filing.view?.file.label, "File again")
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.text, "Cancelled.")
        XCTAssertEqual(filing.view?.log.map(\.line).first, "cancel (autorouter) · ok: cancelled")
    }

    func testAFaxIsFollowedUntilDelivered() async throws {
        let (filing, flight) = try await open(lgsk)
        await filing.setVia("fax")
        let filed = await filing.file()
        XCTAssertTrue(filed)
        XCTAssertEqual(filing.view?.sending, true)
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.text, "Sending by fax.")
        XCTAssertTrue(filing.view?.record?.via.hasPrefix("Sending by fax to Athens Central AIS") ?? false)
        filing.pollInterval = .milliseconds(10)
        await filing.followDelivery()
        XCTAssertEqual(filing.view?.status.label, "Delivered by fax")
        XCTAssertEqual(flight.paperwork.first { $0.id == "filing" }?.text, "Delivered by fax.")
        XCTAssertEqual(
            filing.view?.cancelMessage, "(CNL-SXASV-LGTT0745-LGSK-DOF/261128)",
            "a faxed plan's CNL, as the server faxes it")
    }

    func testRefusalsReadAsOnTheWebsite() async throws {
        let transport = RefusingTransport(FixtureTransport.bundled()!)
        let (filing, _) = try await open(lgsk, transport: transport)
        let first = await filing.file()
        XCTAssertFalse(first)
        XCTAssertEqual(filing.error, "this flight already has a filed plan: delay or cancel it")
        transport.offline = true
        let second = await filing.file()
        XCTAssertFalse(second)
        XCTAssertEqual(filing.error, "Offline: nothing was sent.")
        XCTAssertEqual(filing.view?.status.label, "Not filed")
    }

    func testTypedAddresses() async throws {
        let (filing, _) = try await open(lgsk)
        let added = await filing.addAddress(" lgmgztzx")
        XCTAssertTrue(added)
        let refused = await filing.addAddress("LGMG")
        XCTAssertFalse(refused)
        XCTAssertEqual(filing.view?.addresses.last, "LGMGZTZX")
        await filing.setCopy("ops@example.com", on: false)
        XCTAssertEqual(filing.view?.copyTo, [])
    }
}

/// The fixture server, except that POST /filing is refused (409 with the server's words) or offline.
private final class RefusingTransport: HTTPTransport, @unchecked Sendable {
    let fixtures: FixtureTransport
    var offline = false

    init(_ fixtures: FixtureTransport) {
        self.fixtures = fixtures
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard request.httpMethod == "POST", request.url?.path.hasSuffix("/filing") == true else {
            return try await fixtures.send(request)
        }
        if offline { throw URLError(.notConnectedToInternet) }
        let body = Data(#"{"error":"this flight already has a filed plan: delay or cancel it"}"#.utf8)
        return (body, HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: "HTTP/1.1", headerFields: nil)!)
    }
}
