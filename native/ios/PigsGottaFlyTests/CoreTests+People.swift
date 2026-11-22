import XCTest

@testable import PigsGottaFly

/// PGF's people and typed-input functions through JavaScriptCore (the parity with the website is
/// tests/unit/native/people.test.ts).
final class CorePeopleTests: XCTestCase {
    private var core: Core!

    override func setUpWithError() throws {
        core = try Core.bundled()
    }

    func testThePassengerForm() throws {
        let form: JSON = [
            "fullName": "Robin", "phone": "", "dateOfBirth": "2030-01-01", "weightKg": 70, "idType": "",
            "idNumber": "", "nationality": "", "relation": "", "email": "", "notes": "",
        ]
        let bad = try core.personIssues(form: form.text, today: "2026-11-15")
        XCTAssertEqual(bad.issues.map(\.field), ["email", "dateOfBirth"])
        XCTAssertNil(bad.input)
        var good = form
        good["email"] = "robin@example.com"
        good["dateOfBirth"] = ""
        good["nationality"] = "gr"
        let ok = try core.personIssues(form: good.text, today: "2026-11-15")
        XCTAssertEqual(ok.issues, [])
        XCTAssertEqual(ok.input?["nationality"]?.string, "GR")
        XCTAssertEqual(
            try core.personIssues(pilot: true, today: "2026-11-15").issues.map(\.field), ["fullName", "phone"])
    }

    func testCoordsAndTypedValues() throws {
        let c = try core.parseCoords("375430N 0234334E", name: "  my   field ")
        XCTAssertEqual(c.latLon?.lat ?? 0, 37.908333, accuracy: 1e-5)
        XCTAssertEqual(c.icao, "375430N0234334E")
        XCTAssertEqual(c.name, "MY FIELD")
        XCTAssertNil(try core.parseCoords("nowhere").latLon)
        XCTAssertEqual(try core.parseTime("930"), "09:30")
        XCTAssertNil(try core.parseTime("25:00"))
        XCTAssertEqual(try core.parseDuration("1:30"), 90)
        let d = try core.parseDate("20261116", min: "2026-11-20")
        XCTAssertEqual(d.value, "2026-11-16")
        XCTAssertEqual(d.problem, "Earliest 2026-11-20")
        XCTAssertEqual(d.masked, "2026-11-16")
        XCTAssertEqual(try core.nearestSlot("09:38"), "09:45")
        XCTAssertEqual(try core.routePointName(" my  pt "), "MY PT")
    }
}
