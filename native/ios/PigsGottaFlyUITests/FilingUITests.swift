import XCTest

/// Filing the flight plan on the fixture server (it simulates filing: nothing reaches ATC): File, the
/// confirmation of what is sent to whom, the filed status and the File stage's row, Delay with a new
/// EOBT, Cancel; on iPhone and on iPad.
final class FilingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func status(_ app: XCUIApplication, contains text: String) {
        let s = app.staticTexts["fpl-filing-status"]
        expectation(for: NSPredicate(format: "label CONTAINS %@", text), evaluatedWith: s)
        waitForExpectations(timeout: 10)
    }

    func testFileDelayAndCancel() throws {
        let app = XCUIApplication()
        // the clock a day before the fixture flight (2026-11-28 07:45Z), so its EOBT can be delayed
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-11-27", "-now", "2026-11-27T12:00:00Z"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsk").tap()
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        if app.isPad { app.buttons["stage-file"].tap() } else { app.tapTab("stage-file") }
        XCTAssertTrue(app.element("stage-body-file").waitForExistence(timeout: 5))
        let row = app.element("ready-row-filing")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Not filed yet."), row.label)

        app.tapRow("section-flightPlan")
        XCTAssertTrue(app.element("fpl-export").waitForExistence(timeout: 10))
        status(app, contains: "Not filed")
        XCTAssertTrue(app.element("fpl-message").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("fpl-message").label.contains("(FPL-SXASV"))
        XCTAssertTrue(app.switches["addressee-LGGGZFZX"].exists)

        // File: the confirmation shows the backends, the addressees and the message as sent
        let file = app.buttons["fpl-file"]
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: file)
        waitForExpectations(timeout: 15)
        file.tap()
        let confirm = app.buttons["confirm-file"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["confirm-via"].label.contains("autorouter, then Fax to Athens Central AIS"))
        XCTAssertTrue(app.staticTexts["LGSKZTZX"].exists)
        XCTAssertTrue(app.staticTexts["ops@example.com"].exists)
        XCTAssertTrue(app.element("confirm-message").label.contains("-LGTT0745"))
        confirm.tap()
        status(app, contains: "Filed")
        XCTAssertTrue(app.element("fpl-filing-via").label.contains("Filed via autorouter"))
        XCTAssertTrue(app.element("fpl-eobt").label.contains("2026-11-28 07:45Z"))

        // Delay by 30 minutes: the new EOBT is the record's
        app.reveal(app.buttons["fpl-delay"])
        app.buttons["fpl-delay"].tap()
        XCTAssertTrue(app.buttons["delay-plus-30"].waitForExistence(timeout: 5))
        app.buttons["delay-plus-30"].tap()
        XCTAssertTrue(app.element("delay-new").label.contains("08:15Z"))
        let send = app.buttons["confirm-delay"]
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: send)
        waitForExpectations(timeout: 5)
        send.tap()
        let eobt = app.element("fpl-eobt")
        expectation(for: NSPredicate(format: "label CONTAINS '08:15Z'"), evaluatedWith: eobt)
        waitForExpectations(timeout: 10)

        // Cancel, confirmed: the plan is cancelled and may be filed again
        app.reveal(app.buttons["fpl-cancel"])
        app.buttons["fpl-cancel"].tap()
        let cancel = app.buttons["confirm-cancel-fpl"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()
        status(app, contains: "Cancelled")
        XCTAssertTrue(app.buttons["fpl-file"].label.contains("File again"))

        // the File stage's row follows
        app.back(from: "Flight plan")
        let after = app.element("ready-row-filing")
        XCTAssertTrue(after.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label CONTAINS 'Cancelled.'"), evaluatedWith: after)
        waitForExpectations(timeout: 10)
    }
}
