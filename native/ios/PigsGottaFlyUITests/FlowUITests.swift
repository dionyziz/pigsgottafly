import XCTest

/// Flights → Fly → Brief → Navlog in fixture mode (no network, no sign-in, the bundled flight and core).
final class FlowUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testFlightsFlyBriefNavlog() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-fixturePosition", "38.45,24.0,32,105"]
        app.launch()

        // Flights
        XCTAssertTrue(app.navigationBars["Flights"].waitForExistence(timeout: 15))
        let row = app.descendants(matching: .any)["flight-fixture-lgtt-lgsy"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Shared by Another Pilot"].exists)
        row.tap()

        // Fly: the strips from the simulated position (between KALAMO and KIMI)
        let top = app.descendants(matching: .any)["fly-top-strip"].firstMatch
        XCTAssertTrue(top.waitForExistence(timeout: 20))
        XCTAssertTrue(top.label.contains("Next waypoint KIMI"), top.label)
        XCTAssertTrue(top.label.contains("distance 14 nautical miles"), top.label)
        XCTAssertTrue(top.label.contains("magnetic bearing 026 degrees"), top.label)
        XCTAssertTrue(top.label.contains("planned altitude 5500 feet, planned heading 028 degrees"), top.label)
        let bottom = app.descendants(matching: .any)["fly-bottom-strip"].firstMatch
        XCTAssertEqual(
            bottom.label, "Frequency ATHINAI INFORMATION 130.925. Next frequency SKIROS TOWER 123.200.")
        let destination = app.descendants(matching: .any)["fly-destination"].firstMatch
        XCTAssertTrue(destination.label.hasPrefix("To LGSY: 39 nautical miles"), destination.label)
        // full screen: no tab bar, no navigation bar; Fly's own control reaches the rest
        XCTAssertFalse(app.tabBars.firstMatch.isHittable)
        XCTAssertFalse(app.navigationBars.firstMatch.exists)
        XCTAssertTrue(app.buttons["orientation"].exists)
        app.buttons["night"].tap()
        app.buttons["night"].tap()

        // Brief
        app.buttons["fly-brief"].tap()
        XCTAssertTrue(app.tabBars.buttons["Brief"].waitForExistence(timeout: 5))
        let wx = app.staticTexts["LGSY 220820Z 01012KT CAVOK 15/07 Q1020"]
        for _ in 0..<6 where !wx.exists { app.swipeUp() }
        XCTAssertTrue(wx.exists, "the METAR")
        let noNotams = app.staticTexts["No relevant NOTAMs."]
        for _ in 0..<4 where !noNotams.exists { app.swipeUp() }
        XCTAssertTrue(noNotams.exists, "the departure's group shows with no NOTAM")
        let rwy = app.buttons.matching(NSPredicate(format: "label CONTAINS 'RWY 14/32 CLSD'")).firstMatch
        for _ in 0..<3 where !rwy.exists { app.swipeUp() }
        XCTAssertTrue(rwy.exists, "the destination's NOTAM")
        let markRead = app.buttons["mark-notams-read"]
        for _ in 0..<4 where !markRead.exists { app.swipeUp() }
        markRead.tap()
        XCTAssertTrue(app.descendants(matching: .any)["notams-read"].waitForExistence(timeout: 10))
        for _ in 0..<4 where !app.buttons["File & forms"].exists { app.swipeUp() }
        XCTAssertTrue(app.buttons["File & forms"].exists)

        // Navlog: the legs, and a leg's altitude changed and saved
        app.tabBars.buttons["Navlog"].tap()
        let leg = app.buttons["leg-0"]
        XCTAssertTrue(leg.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["leg-2"].exists)
        XCTAssertTrue(leg.label.contains("LGTT → KALAMO"), leg.label)
        // the website's navlog: the pattern altitude, MH 014, 12 NM, 9 min
        for figure in ["1900 ft", "014°", "12 NM", "9 min"] { XCTAssertTrue(leg.label.contains(figure), leg.label) }
        leg.tap()
        let stepper = app.steppers["altitude-stepper"]
        XCTAssertTrue(stepper.waitForExistence(timeout: 5))
        stepper.buttons.element(boundBy: 1).tap()  // 1900 ft (the pattern altitude) + 500
        app.buttons["save-edit"].tap()
        let changed = NSPredicate(format: "label CONTAINS '2400 ft'")
        expectation(for: changed, evaluatedWith: app.buttons["leg-0"])
        waitForExpectations(timeout: 10)
    }
}
