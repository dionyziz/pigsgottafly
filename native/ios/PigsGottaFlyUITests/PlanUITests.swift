import XCTest

/// Plan's sections on the fixtures: the route (rename, a typed position added), the taxi time, the
/// aircraft, the fuel on board and a stop request, on iPhone and on iPad.
final class PlanUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func openPlan() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-12-31"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsy").tap()
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        return app
    }

    private func open(_ app: XCUIApplication, _ section: String, screen: String) {
        app.tapRow("section-\(section)")
        XCTAssertTrue(app.element(screen).waitForExistence(timeout: 10), screen)
    }

    private func type(_ app: XCUIApplication, into field: XCUIElement, _ text: String) {
        app.reveal(field)
        // the end of the text, so that the deletes clear it (the fields are right-aligned)
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        // an empty field reads as its placeholder: deleting that many anyway is harmless
        if let old = field.value as? String, !old.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2))
        }
        field.typeText(text)
        XCTAssertEqual(field.value as? String, text, "typed over the old value")
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.waitForExistence(timeout: 2) { done.tap() } else { field.typeText("\n") }
    }

    private func toggle(_ app: XCUIApplication, _ id: String) {
        let sw = app.switches[id].firstMatch
        app.reveal(sw)
        XCTAssertTrue(sw.waitForExistence(timeout: 5), id)
        let before = sw.value as? String
        sw.tap()
        if (sw.value as? String) == before { sw.switches.firstMatch.tap() }
    }

    private func run(_ app: XCUIApplication) {
        // Route: rename a point from its menu, then add a typed position where drawing adds one
        open(app, "route", screen: "route-section")
        let kalamo = app.element("route-point-1")
        XCTAssertTrue(kalamo.waitForExistence(timeout: 10))
        kalamo.press(forDuration: 1.2)
        let menuItem = app.buttons["Rename"].firstMatch
        XCTAssertTrue(menuItem.waitForExistence(timeout: 5), "the point's menu")
        menuItem.tap()
        let alert = app.alerts["Rename"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "the rename alert")
        let name = alert.textFields.firstMatch
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 10) + "KALAMOS")
        alert.buttons["Save"].firstMatch.tap()
        let renamed = NSPredicate(format: "label BEGINSWITH 'KALAMOS'")
        let row = app.element("route-point-1")
        if XCTWaiter.wait(for: [expectation(for: renamed, evaluatedWith: row)], timeout: 10) != .completed {
            XCTFail("not renamed: \(app.debugDescription)")
        }

        app.tapRow("route-add-point")
        app.buttons["Position"].firstMatch.tap()
        let position = app.textFields["route-custom-position"].firstMatch
        XCTAssertTrue(position.waitForExistence(timeout: 5))
        position.tap()
        position.typeText("38.5 24.0")
        app.buttons["route-custom-add"].firstMatch.tap()
        XCTAssertTrue(app.element("route-point-4").waitForExistence(timeout: 10), "a fifth point")
        XCTAssertTrue(app.staticTexts["WP1"].exists)
        app.back(from: "Route")

        // When: the taxi out typed
        open(app, "when", screen: "when-section")
        let taxi = app.textFields["taxi-out"].firstMatch
        XCTAssertTrue(taxi.waitForExistence(timeout: 5))
        type(app, into: taxi, "20")
        let saved = NSPredicate(format: "value == '20'")
        wait(for: [expectation(for: saved, evaluatedWith: taxi)], timeout: 10)
        app.back(from: "When")

        // Aircraft: the picker and the winds' model
        open(app, "aircraft", screen: "aircraft-section")
        XCTAssertTrue(app.element("aircraft-select").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("wind-model").exists)
        app.back(from: "Aircraft")

        // Fuel: AVGAS on board typed, the total follows
        open(app, "fuel", screen: "fuel-plan")
        XCTAssertTrue(app.element("fuel-required").waitForExistence(timeout: 10))
        type(app, into: app.textFields["fob"].firstMatch, "100")
        let total = app.element("fob-total")
        app.reveal(total)
        wait(
            for: [expectation(for: NSPredicate(format: "label CONTAINS '100 L'"), evaluatedWith: total)],
            timeout: 10)
        app.back(from: "Fuel")

        // Flight plan options: a stop at the destination
        open(app, "fplOptions", screen: "fpl-options")
        toggle(app, "fpl-stop-3")
        let on = NSPredicate(format: "value == '1'")
        wait(for: [expectation(for: on, evaluatedWith: app.switches["fpl-stop-3"].firstMatch)], timeout: 10)
        XCTAssertTrue(app.element("fpl-alternate-1").exists)
        app.back(from: "Flight plan options")
    }

    func testPlanSectionsOnIPhone() throws {
        let app = openPlan()
        try XCTSkipIf(app.isPad, "iPhone layout")
        run(app)
    }

    func testPlanSectionsOnIPad() throws {
        let app = openPlan()
        try XCTSkipUnless(app.isPad, "iPad layout")
        run(app)
        XCUIDevice.shared.orientation = .portrait
    }
}
