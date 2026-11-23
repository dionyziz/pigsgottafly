import XCTest

/// Brief on the fixtures, iPhone and iPad: "Ready to fly" with what is left to do, a warning's Fix
/// leading to Take-off & landing, the No-go gone once the runway is automatic again, the METAR box
/// 70 minutes before take-off, a unit added to the ATC list, and a NOTAM shown on the map.
final class BriefUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testBriefChecksAndFixes() throws {
        let app = XCUIApplication()
        // the brief fixture: the destination's runway 17 forced, with a 12 kt tailwind
        app.launchArguments = [
            "-fixtures", "-noNetwork", "-openFlight", "fixture-brief", "-tab", "brief", "-today", "2026-11-22",
            "-now", "2026-11-22T07:30:00Z",
        ]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        defer { XCUIDevice.shared.orientation = .portrait }

        XCTAssertTrue(app.element("stage-body-brief").waitForExistence(timeout: 20))
        let go = app.buttons["ready-go"]
        XCTAssertTrue(go.waitForExistence(timeout: 20))
        XCTAssertTrue(go.label.contains("to do"), go.label)
        XCTAssertTrue(app.element("ready-stage-plan").exists)
        XCTAssertTrue(app.element("ready-stage-file").exists)

        // the NOTAMs row: marked read from the readiness
        let markRead = app.buttons["notams-mark-read"]
        app.reveal(markRead)
        markRead.tap()
        XCTAssertTrue(waitGone(markRead))

        // the take-off and landing row's Fix: the section, with the No-go
        let perfRow = app.element("ready-row-performance")
        app.reveal(perfRow)
        let fix = app.buttons.matching(NSPredicate(format: "identifier == 'warning-fix' AND label BEGINSWITH 'Fix'"))
            .firstMatch
        XCTAssertTrue(fix.waitForExistence(timeout: 10))
        fix.tap()
        XCTAssertTrue(app.element("performance-section").waitForExistence(timeout: 10))
        let noGo = app.element("perf-no-go")
        XCTAssertTrue(noGo.waitForExistence(timeout: 10))
        let reason = app.staticTexts["perf-reason-landing"]
        app.reveal(reason)
        XCTAssertEqual(reason.label, "Outside the AFM table: distances extrapolated.")

        // the runway back to automatic: it fits
        let runway = app.buttons["perf-runway-landing"]
        app.reveal(runway)
        runway.tap()
        let auto = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Auto (wind)'")).firstMatch
        XCTAssertTrue(auto.waitForExistence(timeout: 5))
        auto.tap()
        XCTAssertTrue(waitGone(noGo, timeout: 15), "no No-go with the wind's runway")
        backTo(app, "Take-off & landing")

        // METAR and TAF, 70 minutes before take-off
        app.tapRow("section-weather")
        XCTAssertTrue(app.staticTexts["LGSY 220820Z 01012KT CAVOK 15/07 Q1020"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("wx-LGTT").exists)
        backTo(app, "METAR and TAF")

        // ATC: a unit added by hand
        app.tapRow("section-atc")
        XCTAssertTrue(app.element("atc-list").waitForExistence(timeout: 10))
        XCTAssertTrue(atcRow(app, "TATOI TOWER").waitForExistence(timeout: 10))
        app.buttons["atc-add"].tap()
        let callsign = app.textFields["atc-callsign"]
        XCTAssertTrue(callsign.waitForExistence(timeout: 5))
        callsign.tap()
        callsign.typeText("club")
        let primary = app.textFields["atc-primary"]
        primary.tap()
        primary.typeText("1235")
        XCTAssertTrue(app.staticTexts["atc-freq-format"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["atc-save"].isEnabled)
        primary.typeText(XCUIKeyboardKey.delete.rawValue + ".5")
        XCTAssertTrue(app.buttons["atc-save"].isEnabled)
        app.buttons["atc-save"].tap()
        let club = atcRow(app, "CLUB")
        app.reveal(club, swipes: 8)
        XCTAssertTrue(club.waitForExistence(timeout: 10))
        let edited = app.element("atc-edited")
        XCTAssertTrue(edited.waitForExistence(timeout: 10))
        // the fixture's list predates the generator's for this route (no en-route units), so it is outdated
        XCTAssertEqual(edited.label, "Outdated")
        backTo(app, "ATC")

        // a NOTAM shown on the map
        app.tapRow("section-notams")
        let notam = app.buttons.matching(NSPredicate(format: "label CONTAINS 'RWY 14/32 CLSD'")).firstMatch
        app.reveal(notam)
        XCTAssertTrue(notam.waitForExistence(timeout: 10))
        notam.press(forDuration: 1.2)
        let showOnMap = app.buttons["Show on map"].firstMatch
        XCTAssertTrue(showOnMap.waitForExistence(timeout: 5), "the NOTAM's menu")
        showOnMap.tap()
        XCTAssertTrue(app.element("map-tab").waitForExistence(timeout: 10))
        if app.isPad { XCTAssertFalse(app.element("stage-body-brief").exists, "the inspector closed on the map") }
    }

    private func atcRow(_ app: XCUIApplication, _ callsign: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier == 'atc-row' AND label BEGINSWITH %@", callsign))
            .firstMatch
    }

    private func backTo(_ app: XCUIApplication, _ title: String) {
        app.navigationBars[title].buttons.element(boundBy: 0).tap()
    }

    private func waitGone(_ e: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
