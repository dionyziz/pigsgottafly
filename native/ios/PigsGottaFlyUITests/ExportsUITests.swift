import XCTest

/// The navlog and the NOTAM briefing as PDFs made on the device (preview, share, print, e-mail), and
/// the navlog's per-leg values, on the fixtures; on iPhone and on iPad.
final class ExportsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func openFlight() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-12-31"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsy").tap()
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        return app
    }

    private func stage(_ app: XCUIApplication, _ id: String) {
        if app.isPad { app.buttons[id].tap() } else { app.tapTab(id) }
        XCTAssertTrue(
            app.element(id.replacingOccurrences(of: "stage-", with: "stage-body-")).waitForExistence(timeout: 5))
    }

    func testTheNavlogAndTheBriefingAsPDFs() throws {
        let app = openFlight()
        stage(app, "stage-file")

        app.tapRow("section-navlogExport")
        XCTAssertTrue(app.element("navlog-export").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pdf-print"].waitForExistence(timeout: 20), "the sheets rendered")
        XCTAssertTrue(app.element("pdf-share").exists)
        let mail = app.buttons["navlog-mail-button"]
        XCTAssertTrue(mail.waitForExistence(timeout: 10))
        let enabled = NSPredicate(format: "isEnabled == true")
        expectation(for: enabled, evaluatedWith: mail)
        waitForExpectations(timeout: 10)
        mail.tap()
        XCTAssertTrue(app.element("navlog-mail-sent").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("navlog-mail-sent").label.contains("pilot@example.com"))
        app.back(from: "Navigation log")

        app.tapRow("section-briefing")
        XCTAssertTrue(app.element("briefing-export").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pdf-print"].waitForExistence(timeout: 20))
        let status = app.element("briefing-status")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.label.contains("2 relevant"), status.label)
        XCTAssertTrue(app.buttons["briefing-reload"].exists)
    }

    func testALegsValuesAreTypedAndReset() throws {
        let app = openFlight()
        // on an 11-inch iPad the row is below the inspector's fold, and a swipe over the app's middle
        // moves the map: the inspector's own list is scrolled
        let row = app.buttons["section-navlog"].firstMatch
        let inspector = app.element("stage-body-plan")
        for _ in 0..<6 where !(row.exists && row.isHittable) { (app.isPad ? inspector : app).swipeUp() }
        row.tap()
        let leg = app.buttons["leg-0"]
        XCTAssertTrue(leg.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["refresh-weather"].exists)
        XCTAssertTrue(app.buttons["print-navlog"].exists)
        XCTAssertTrue(leg.label.contains("TAS"), leg.label)

        leg.tap()
        let tas = app.textFields["navlog-tas"]
        XCTAssertTrue(tas.waitForExistence(timeout: 5))
        tas.tap()
        tas.typeText("123")
        let temp = app.textFields["navlog-temp"]
        app.reveal(temp)
        temp.tap()
        temp.typeText("7")
        app.buttons["save-edit"].tap()
        expectation(for: NSPredicate(format: "label CONTAINS '123 kt' AND label CONTAINS '7°C'"), evaluatedWith: leg)
        waitForExpectations(timeout: 10)

        // reset all: back to the aircraft's TAS
        leg.tap()
        let reset = app.buttons["reset-leg"]
        XCTAssertTrue(reset.waitForExistence(timeout: 5))
        app.reveal(reset)
        reset.tap()
        app.buttons["save-edit"].tap()
        expectation(for: NSPredicate(format: "NOT (label CONTAINS '123 kt')"), evaluatedWith: leg)
        waitForExpectations(timeout: 10)
    }
}
