import XCTest

/// File & forms on the fixture server (it makes the links, signs for the passenger and "sends"
/// without e-mailing anyone): Form 731 from a passenger's missing signature to Send to HCAA, the
/// General Declaration sent and handed to a handler, and the W&B and performance sheets sent to the
/// operator; each time the File stage's row follows.
final class FormsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// The fixture flight with a passenger on board, on one File section.
    private func launch(_ section: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-fixtures", "-noNetwork", "-openFlight", "fixture-forms", "-tab", "file", "-section", section, "-today",
            "2026-11-22",
        ]
        app.launch()
        return app
    }

    private func waitFor(_ e: XCUIElement, _ format: String, timeout: TimeInterval = 15) {
        expectation(for: NSPredicate(format: format), evaluatedWith: e)
        waitForExpectations(timeout: timeout)
    }

    private func tapWhenEnabled(_ app: XCUIApplication, _ id: String) {
        let b = app.buttons[id]
        XCTAssertTrue(b.waitForExistence(timeout: 15), id)
        app.reveal(b)
        waitFor(b, "isEnabled == true")
        b.tap()
    }

    /// Back to the File stage, where its row says how the form stands.
    private func fileRow(_ app: XCUIApplication, from title: String, _ id: String) -> XCUIElement {
        app.back(from: title)
        XCTAssertTrue(app.element("stage-body-file").waitForExistence(timeout: 10))
        let row = app.buttons["ready-row-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), id)
        return row
    }

    func testForm731IsSignedThenSentToTheHCAA() throws {
        let app = launch("form731")
        XCTAssertTrue(app.element("form731").waitForExistence(timeout: 20))
        let summary = app.element("f731-summary")
        XCTAssertTrue(summary.waitForExistence(timeout: 15))
        waitFor(summary, "label CONTAINS '1 of 2 signed'")
        XCTAssertFalse(app.buttons["f731-send"].isEnabled, "everyone has to sign first")

        // a link for the passenger, to share from the device
        tapWhenEnabled(app, "f731-request")
        XCTAssertTrue(app.element("f731-link-pax-anna").waitForExistence(timeout: 10))
        let status = app.staticTexts["f731-status-pax-anna"]
        XCTAssertTrue(status.label.hasPrefix("link created"), status.label)

        // she signs on her phone; the screen opened again shows it
        app.back(from: "Form 731")
        app.tapRow("section-form731")
        XCTAssertTrue(summary.waitForExistence(timeout: 15))
        waitFor(summary, "label CONTAINS '2 of 2 signed'")

        tapWhenEnabled(app, "f731-send")
        let sent = app.element("f731-sent")
        XCTAssertTrue(sent.waitForExistence(timeout: 10))
        XCTAssertTrue(sent.label.contains("731@hcaa.gov.gr"), sent.label)
        XCTAssertFalse(app.buttons["f731-send"].isEnabled, "this version was sent")

        // the form with both signatures, as a PDF
        let preview = app.buttons["f731-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 30), "the form rendered")
        app.reveal(preview)
        preview.tap()
        XCTAssertTrue(app.buttons["pdf-print"].waitForExistence(timeout: 10))
        app.back(from: "Form 731")

        let row = fileRow(app, from: "Form 731", "form731")
        waitFor(row, "label CONTAINS 'Sent.'")
    }

    func testTheGeneralDeclarationIsSentAndHandedToAHandler() throws {
        let app = launch("genDec")
        XCTAssertTrue(app.element("gendec").waitForExistence(timeout: 20))
        let status = app.element("gendec-status")
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        XCTAssertTrue(status.label.contains("Not sent"), status.label)
        XCTAssertTrue(app.element("gendec-handling-departure").label.contains("LGTT: no handling"))
        XCTAssertTrue(app.element("gendec-handling-destination").exists)

        tapWhenEnabled(app, "gendec-send-button")
        XCTAssertTrue(app.element("gendec-sent").waitForExistence(timeout: 10))
        waitFor(status, "label CONTAINS 'Sent'")
        XCTAssertTrue(app.element("gendec-preview").waitForExistence(timeout: 30), "the declaration rendered")

        // a handler submits it after all: the flight keeps the choice, and can go back to automatic
        let handled = app.switches["gendec-handled"]
        app.reveal(handled)
        handled.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        waitFor(status, "label CONTAINS 'Handled'")
        let auto = app.buttons["gendec-handled-auto"]
        XCTAssertTrue(auto.waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("gendec-override").label.contains("you send it"))
        XCTAssertFalse(app.buttons["gendec-send-button"].exists, "a handler sends it")
        auto.tap()
        waitFor(status, "NOT (label CONTAINS 'Handled')")

        let row = fileRow(app, from: "General Declaration", "gendec")
        waitFor(row, "label CONTAINS 'Sent.'")
    }

    func testTheOperatorGetsTheWbAndPerformanceSheets() throws {
        let app = launch("wbPerf")
        XCTAssertTrue(app.element("wbperf-export").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("wb-status").waitForExistence(timeout: 20))
        let status = app.element("operator-send-status")
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        XCTAssertTrue(status.label.contains("Not sent"), status.label)

        tapWhenEnabled(app, "operator-send-button")
        let sent = app.element("operator-send-sent")
        XCTAssertTrue(sent.waitForExistence(timeout: 10))
        XCTAssertTrue(sent.label.contains("ops@example.com"), sent.label)
        waitFor(status, "label CONTAINS 'Sent' AND NOT (label CONTAINS 'Not sent')")
        XCTAssertFalse(app.buttons["operator-send-button"].isEnabled, "these sheets were sent")

        let row = fileRow(app, from: "W&B & performance", "operator")
        waitFor(row, "label CONTAINS 'Sent.'")
    }
}
