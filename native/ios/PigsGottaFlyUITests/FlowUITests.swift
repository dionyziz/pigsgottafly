import XCTest

/// Flights → Fly → Brief → File → Navlog on iPhone in fixture mode (no network, no sign-in, the bundled
/// flight and core).
final class FlowUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipIf(XCUIApplication().isPad, "iPhone's tab bars (ShellUITests covers the iPad)")
    }

    func testFlightsFlyBriefNavlog() throws {
        let app = XCUIApplication()
        // the fixture flight's date as today: a planned flight of today opens in Fly
        app.launchArguments = [
            "-fixtures", "-noNetwork", "-fixturePosition", "38.45,24.0,32,105", "-today", "2026-11-22",
            "-now", "2026-11-22T07:30:00Z",
        ]
        app.launch()

        XCTAssertTrue(app.navigationBars["Flights"].waitForExistence(timeout: 15))
        let row = app.descendants(matching: .any)["flight-fixture-lgtt-lgsy"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let shared = app.element("flight-fixture-shared")
        XCTAssertTrue(shared.label.contains("Shared with you by Another Pilot"), shared.label)
        row.tap()

        // Fly: the strips from the simulated position (between KALAMO and KIMI)
        let top = app.descendants(matching: .any)["fly-top-strip"].firstMatch
        XCTAssertTrue(top.waitForExistence(timeout: 20))
        // the strip shows first from the flight as computed before the winds are fetched (MH 028 on a
        // fresh install, with nothing cached): the wind-corrected heading follows once they are in
        let corrected = NSPredicate(format: "label CONTAINS 'planned heading 017 degrees'")
        expectation(for: corrected, evaluatedWith: top)
        waitForExpectations(timeout: 20)
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

        app.buttons["fly-brief"].tap()
        XCTAssertTrue(app.element("stage-body-brief").waitForExistence(timeout: 5))
        app.tapRow("section-weather")
        let wx = app.staticTexts["LGSY 220820Z 01012KT CAVOK 15/07 Q1020"]
        XCTAssertTrue(wx.waitForExistence(timeout: 10), "the METAR")
        app.back()
        app.tapRow("section-notams")
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
        app.back()

        // File: the fixture flight's plan is filed already, so it is delayed or cancelled, not filed again
        app.tapTab("stage-file")
        app.tapRow("section-flightPlan")
        let filed = app.staticTexts["fpl-filing-status"]
        XCTAssertTrue(filed.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label == 'Filed'"), evaluatedWith: filed)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.buttons["fpl-delay"].exists)
        app.back()

        // back in Fly, its Navlog button opens Plan's Navlog: the legs, and a leg's altitude changed
        app.tapTab("flight-tab-fly")
        XCTAssertTrue(app.buttons["fly-navlog"].waitForExistence(timeout: 5))
        app.buttons["fly-navlog"].tap()
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

    /// What App Review does with a brand-new account: straight to the (empty) flights, a first flight
    /// that asks for the home aerodrome and starts there, with a first aircraft
    /// from the template, a point added and removed, the profile filled in Me, then the account
    /// deleted.
    func testNewAccountNewFlightAndDeleteAccount() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-emptyAccount"]
        app.launch()

        // nothing is asked at sign-up: the flights, empty
        XCTAssertTrue(app.navigationBars["Flights"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["No flights yet"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["profile-name"].exists)

        // the first flight asks for the home aerodrome only, and starts there; an empty hangar may name
        // its first aircraft
        app.buttons["new-flight"].tap()
        let home = app.buttons["new-home"]
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["create-flight"].isEnabled, "the home aerodrome is required")
        home.tap()
        pick(app, search: "LGTT", place: "place-aerodrome:LGTT")
        let chosen = NSPredicate(format: "label CONTAINS 'LGTT · Dekelia / Tatoi'")
        wait(for: [expectation(for: chosen, evaluatedWith: home)], timeout: 10)
        let reg = app.textFields["new-registration"]
        XCTAssertTrue(reg.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["create-flight"].isEnabled, "an aircraft is not needed")
        reg.tap()
        reg.typeText("SX-ABC")
        app.buttons["create-flight"].tap()

        // a new flight opens on Plan, even for today: at the home aerodrome with no destination; the
        // destination is added in the Navlog
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        XCTAssertFalse(app.element("fly-top-strip").exists)
        XCTAssertTrue(app.navigationBars["LGTT"].exists)
        app.tapRow("section-navlog")
        XCTAssertTrue(app.element("route-point-0").waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["leg-0"].exists, "one point is no leg")
        let add = app.buttons["add-point"]
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        add.tap()
        pick(app, search: "kalamo", place: "place-vfr:LGTG/KALAMO")
        let leg = app.buttons["leg-0"]
        XCTAssertTrue(leg.waitForExistence(timeout: 15))
        XCTAssertTrue(leg.label.contains("LGTT → KALAMO"), leg.label)

        // the flight is in the list with its route and aircraft
        app.back(from: "Navlog")
        app.back(from: "LGTT → KALAMO")
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'LGTT → KALAMO'"))
            .firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("SX-ABC"), row.label)

        // Me → Profile: the home aerodrome from New flight; name and phone added there
        app.tapTab("tab-me", label: "Me")
        app.buttons["profile"].tap()
        let name = app.textFields["profile-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["LGTT · Dekelia / Tatoi"].waitForExistence(timeout: 10), "the home aerodrome")
        name.tap()
        name.typeText("Test Pilot")
        app.buttons["save-profile"].tap()
        XCTAssertTrue(app.buttons["delete-account"].waitForExistence(timeout: 10))

        // Me → Delete account: the e-mail typed, then back to the sign-in screen
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
        let field = app.searchField
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(search)
        let result = app.buttons[place]
        XCTAssertTrue(result.waitForExistence(timeout: 10), place)
        result.tap()
    }
}
