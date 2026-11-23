import XCTest

/// Manifest & loading on the fixtures: a passenger from the list, a new one, removing one the flight
/// is shared with, baggage over its limit, the W&B chart.
final class ManifestUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testManifestAndLoading() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-12-31"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        defer { XCUIDevice.shared.orientation = .portrait }

        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsy").tap()
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        app.tapRow("section-manifest")
        XCTAssertTrue(app.element("manifest").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("crew-pic").waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["manifest-pob"].label, "1 POB")

        // a passenger from the list
        app.buttons["pax-search"].tap()
        XCTAssertTrue(app.element("pax-picker").waitForExistence(timeout: 10))
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("ann")
        let anna = app.buttons["pax-option-pax-anna"]
        XCTAssertTrue(anna.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pax-option-pax-maria"].exists, "only the names that match")
        anna.tap()
        XCTAssertTrue(app.element("crew-pax").waitForExistence(timeout: 10))
        XCTAssertTrue(waitForLabel(app.staticTexts["manifest-pob"], "2 POB"))

        // removed: the flight is shared with her, so the offer to stop sharing
        let row = app.element("crew-pax")
        row.swipeLeft()
        app.buttons["crew-remove"].firstMatch.tap()
        let unshare = app.buttons["unshare-confirm"].firstMatch
        XCTAssertTrue(unshare.waitForExistence(timeout: 10))
        unshare.tap()
        XCTAssertTrue(waitForLabel(app.staticTexts["manifest-pob"], "1 POB"))

        // a new passenger, named in the search
        app.buttons["pax-search"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Eleni Dimou")
        app.buttons["pax-create"].tap()
        XCTAssertTrue(app.element("person-form").waitForExistence(timeout: 10))
        app.buttons["person-save"].tap()
        XCTAssertTrue(app.element("person-email-issue").waitForExistence(timeout: 5), "a passenger needs an e-mail")
        let email = app.textFields["person-email"]
        email.tap()
        email.typeText("eleni@example.com")
        app.buttons["person-save"].tap()
        XCTAssertTrue(waitForLabel(app.staticTexts["manifest-pob"], "2 POB"))
        XCTAssertTrue(app.staticTexts["Eleni Dimou"].exists)

        // baggage over the placard: the W&B says so
        let bag = app.textFields["bag-bag1"]
        app.reveal(bag)
        bag.tap()
        bag.press(forDuration: 1.0)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) { app.menuItems["Select All"].tap() }
        bag.typeText(XCUIKeyboardKey.delete.rawValue + "60")
        app.buttons["Done"].firstMatch.tap()
        let breach = app.element("wb-load-breach")
        XCTAssertTrue(breach.waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("manifest-chip").exists)

        let chart = app.element("wb-chart")
        app.reveal(chart)
        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        XCTAssertTrue(chart.value as? String ?? "" != "", "the take-off and landing points")
    }

    private func waitForLabel(_ e: XCUIElement, _ label: String) -> Bool {
        let p = NSPredicate(format: "label == %@", label)
        return XCTWaiter().wait(for: [expectation(for: p, evaluatedWith: e)], timeout: 10) == .completed
    }
}
