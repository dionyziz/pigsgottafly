import XCTest

@testable import PigsGottaFly

/// PGF's hangar functions through JavaScriptCore with the fixtures (the parity with the website is
/// tests/unit/native/hangar.test.ts).
final class CoreHangarTests: XCTestCase {
    private var core: Core!
    private var aircraft: JSON!

    override func setUpWithError() throws {
        core = try Core.bundled()
        aircraft = try JSON.parse(try Fixtures.text("aircraft.json"))
    }

    func testValidation() throws {
        let ok = try core.validateAircraft(aircraft.text, today: "2026-11-15")
        XCTAssertEqual(ok.errors, 0)
        var bad = aircraft!
        bad["registration"] = ""
        let v = try core.validateAircraft(bad.text, today: "2026-11-15", path: "registration")
        XCTAssertGreaterThan(v.errors, 0)
        XCTAssertEqual(v.at?.first?.level, .error)
        XCTAssertEqual(v.at?.first?.message, "Registration is required.")
    }

    func testTheEditorsHelpers() throws {
        XCTAssertEqual(try core.split10a("SE1J1"), ["S", "E1", "J1"])
        XCTAssertEqual(try core.join10a(["Y", "S", "G"]), "SGY")
        XCTAssertEqual(try core.split10b("SB2").ads, ["B2"])
        XCTAssertEqual(try core.badPbn("B2Z9"), ["Z9"])
        XCTAssertEqual(try core.deviation(forDeg: 350, steerDeg: 5), 15)
        let card = aircraft["compassCards"]![0]!.text
        XCTAssertEqual(try core.cardStatus(card, today: "2026-11-15").state, "valid")
        XCTAssertEqual(try core.cardStatus(card, today: "2028-03-01").state, "expired")
        let s = try core.aircraftHelper(
            "addStation", ["massBalance": aircraft["massBalance"]!.text, "kind": JSON.string("baggage").text])
        XCTAssertEqual(
            s["massBalance"]?["stations"]?.array?.count, (aircraft["massBalance"]?["stations"]?.array?.count ?? 0) + 1)
    }

    func testHistoryInWords() throws {
        let entries: JSON = [
            [
                "id": 1, "at": 0, "kind": "edit", "by": ["pilotId": "me", "name": "Me"],
                "changes": [["path": "cruiseTasKt", "from": 90, "to": 92]],
            ]
        ]
        let h = try core.historyText(entries: entries.text, myId: "me")
        XCTAssertEqual(h.entries.first?.title, "You changed 1 field")
        XCTAssertEqual(h.entries.first?.changes.count, 1)
    }

    func testNewAircraftOffersTheWebsitesChoices() throws {
        var mine = aircraft!
        mine["access"] = ["role": "owner"]
        let hangar = JSON.array([mine]).text
        let reg = mine["registration"]?.string ?? ""

        let first = try core.newAircraft(hangar: hangar, registration: " sx-new ")
        XCTAssertEqual(
            first.options.map(\.title), ["Reims/Cessna F172M type template", "Same type as \(reg)", "Blank"])
        XCTAssertEqual(first.source, .init(kind: "template", id: "reims-f172m"))
        XCTAssertEqual(first.registration, "SX-NEW")
        XCTAssertNil(first.error)
        XCTAssertEqual(first.input?["registration"]?.string, "SX-NEW")
        XCTAssertEqual(first.input?["icaoType"]?.string, "C172")
        XCTAssertEqual([first.added, first.addedDefault], ["Added SX-NEW", "Added SX-NEW as your default aircraft"])

        let copy = try core.newAircraft(hangar: hangar, registration: "SX-CPY", copyOf: mine["id"]?.string)
        XCTAssertEqual(copy.source, .init(kind: "copy", id: mine["id"]?.string))
        XCTAssertEqual(copy.input?["makeModel"], mine["makeModel"])
        XCTAssertEqual(copy.input?["compassCards"], [], "the airframe's own cards stay behind")
        XCTAssertEqual(copy.input?["serial"]?.string, "")
        XCTAssertNil(copy.input?["id"], "the body is an AircraftInput")

        let blank = try core.newAircraft(hangar: hangar, registration: "SX-BLK", source: .init(kind: "blank"))
        XCTAssertEqual(blank.input?["icaoType"]?.string, "")

        let taken = try core.newAircraft(hangar: hangar, registration: reg.lowercased())
        XCTAssertTrue(taken.taken)
        XCTAssertNil(taken.input)
        XCTAssertEqual(taken.error, "\(reg) is already in your hangar.")
        XCTAssertEqual(try core.newAircraft(hangar: hangar, registration: "").error, "Enter the registration.")
    }

    func testACopyKeepsTheOperatorOnlyWhenThePilotMayAssignIt() throws {
        var mine = aircraft!
        mine["access"] = ["role": "owner"]
        mine["operatorId"] = "op1"
        let hangar = JSON.array([mine]).text
        let id = mine["id"]?.string
        func operatorId(_ op: JSON?) throws -> JSON? {
            try core.newAircraft(hangar: hangar, registration: "SX-CPY", copyOf: id, operator: op).input?["operatorId"]
        }
        XCTAssertEqual(try operatorId(nil), "op1", "not settled yet")
        XCTAssertEqual(try operatorId(["access": ["role": "edit"]]), "op1")
        XCTAssertEqual(try operatorId(["access": ["role": "view"]]), .null)
        XCTAssertEqual(try operatorId(.null), .null, "an operator that could not be read")
    }
}
