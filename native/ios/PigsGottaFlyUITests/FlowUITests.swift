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
        XCTAssertTrue(top.label.contains("planned altitude 5500 feet, planned heading 017 degrees"), top.label)
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
        // the website's navlog with the fixture's winds: the pattern altitude, MH 010, 12 NM, 8 min
        for figure in ["1900 ft", "010°", "12 NM", "8 min"] { XCTAssertTrue(leg.label.contains(figure), leg.label) }
        leg.tap()
        let stepper = app.steppers["altitude-stepper"]
        XCTAssertTrue(stepper.waitForExistence(timeout: 5))
        stepper.buttons.element(boundBy: 1).tap()  // 1900 ft (the pattern altitude) + 500
        app.buttons["save-edit"].tap()
        let changed = NSPredicate(format: "label CONTAINS '2400 ft'")
        expectation(for: changed, evaluatedWith: app.buttons["leg-0"])
        waitForExpectations(timeout: 10)
    }

    /// What App Review does with a brand-new account: the profile first, a new flight from the
    /// fixture aerodromes with a first aircraft from the template, a point added and removed, then the
    /// account deleted.
    func testNewAccountNewFlightAndDeleteAccount() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-emptyAccount"]
        app.launch()

        // the profile is asked for first
        let name = app.textFields["profile-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        name.typeText("Test Pilot")
        let phone = app.textFields["profile-phone"]
        phone.tap()
        phone.typeText("+302101234567")
        app.buttons["profile-home"].tap()
        pick(app, search: "LGTT", place: "place-aerodrome:LGTT")
        XCTAssertTrue(app.staticTexts["LGTT · Dekelia / Tatoi"].waitForExistence(timeout: 5))
        app.buttons["save-profile"].tap()

        // no flights: New flight, from home to Skyros, with a first aircraft from the template
        XCTAssertTrue(app.navigationBars["Flights"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["No flights yet"].waitForExistence(timeout: 10))
        app.buttons["new-flight"].tap()
        XCTAssertTrue(app.staticTexts["LGTT · Dekelia / Tatoi"].waitForExistence(timeout: 10), "from home")
        app.buttons["new-to"].tap()
        pick(app, search: "skiros", place: "place-aerodrome:LGSY")
        let reg = app.textFields["new-registration"]
        XCTAssertTrue(reg.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["create-flight"].isEnabled, "an aircraft is needed")
        reg.tap()
        reg.typeText("SX-ABC")
        app.buttons["create-flight"].tap()

        // it opens in Fly; the Navlog has the leg, then a point is added and removed
        XCTAssertTrue(app.buttons["fly-navlog"].waitForExistence(timeout: 15))
        app.buttons["fly-navlog"].tap()
        XCTAssertTrue(app.navigationBars["LGTT → LGSY"].waitForExistence(timeout: 10))
        let leg = app.buttons["leg-0"]
        XCTAssertTrue(leg.waitForExistence(timeout: 15))
        XCTAssertTrue(leg.label.contains("LGTT → LGSY"), leg.label)
        let add = app.buttons["add-point"]
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        add.tap()
        pick(app, search: "kalamo", place: "place-vfr:LGTG/KALAMO")
        XCTAssertTrue(app.buttons["leg-1"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["leg-0"].label.contains("LGTT → KALAMO"), app.buttons["leg-0"].label)
        let point = app.descendants(matching: .any)["route-point-1"].firstMatch
        for _ in 0..<4 where !point.isHittable { app.swipeUp() }
        point.swipeLeft()
        app.buttons["Delete"].tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.buttons["leg-1"])
        waitForExpectations(timeout: 15)

        // the flight is in the list
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["LGTT → LGSY"].waitForExistence(timeout: 10))

        // Account → Delete account: the e-mail typed, then back to the sign-in screen
        app.buttons["account"].tap()
        app.buttons["delete-account"].tap()
        let confirm = app.buttons["confirm-delete"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertFalse(confirm.isEnabled)
        let email = app.textFields["delete-confirm-email"]
        email.tap()
        email.typeText("pilot@example.com")
        XCTAssertTrue(confirm.isEnabled)
        confirm.tap()
        XCTAssertTrue(app.buttons["sign-in"].waitForExistence(timeout: 10))
    }

    /// In a place search: types `search` and taps the result `place`.
    private func pick(_ app: XCUIApplication, search: String, place: String) {
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(search)
        let result = app.buttons[place]
        XCTAssertTrue(result.waitForExistence(timeout: 10), place)
        result.tap()
    }
}
