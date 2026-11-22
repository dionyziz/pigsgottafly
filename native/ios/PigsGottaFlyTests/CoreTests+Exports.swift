import XCTest

@testable import PigsGottaFly

/// PGF's File & forms documents through JavaScriptCore with the fixtures (the parity with the website
/// is tests/unit/native/exports.test.ts).
final class CoreExportsTests: XCTestCase {
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
        weather = Core.object(["/api/weather/metar?ids=LGSY,LGTT": try Fixtures.text("metar.json")])
    }

    func testTheFplMessage() throws {
        let m = try core.fplMessage(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        XCTAssertTrue(m.fpl.message.hasPrefix("(FPL-SXASV-VG"), m.fpl.message)
        XCTAssertTrue(m.fpl.message.contains("LGTT"))
        XCTAssertEqual(m.fpl.lines.joined(separator: "\n"), m.fpl.message)
        XCTAssertFalse(m.oneLine.contains("\n"))
    }

    func testTheNavlogSheets() throws {
        let n = try core.navlogContent(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        XCTAssertEqual(n.content["sheets"]?.array?.count, 1)
        XCTAssertEqual(n.content["sheets"]?[0]?["header"]?["aircraft"]?.string, "SX-ASV")
        XCTAssertEqual(n.document["sheets"]?[0]?["topName"]?.string, "LGTT")
    }

    func testTheWbAndPerformanceSheets() throws {
        let w = try core.wbPerfContent(flight: flight, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
        XCTAssertEqual(w.content["registration"]?.string, "SX-ASV")
        XCTAssertNotNil(w.wb["verdict"]?.string)
        XCTAssertEqual(w.hash.count, 43, "SHA-256 in base64url without padding")
        XCTAssertFalse(w.hash.contains("="))
    }

    func testTheFormsAndTheBriefing() throws {
        let f731 = try core.formModel(
            .form731, flight: flight, aircraft: aircraft, pilot: pilot, passengers: nil, ref: ref)
        XCTAssertEqual(f731["registration"]?.string, "SX-ASV")
        XCTAssertEqual(f731["route"]?.string, "LGTT – LGSY")
        let gendec = try core.formModel(
            .gendec, flight: flight, aircraft: aircraft, pilot: pilot, passengers: "[]", ref: nil)
        XCTAssertNotNil(gendec["warnings"]?.array)
        let b = try core.briefingModel(flight: flight, briefing: try Fixtures.text("notams.json"))
        XCTAssertEqual(b["status"]?.string, "ok")
    }
}
