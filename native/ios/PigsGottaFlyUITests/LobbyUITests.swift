import XCTest

/// The flight list on fixtures: search, rename, copy, trash and restore; New flight's route form with
/// a local flight.
final class LobbyUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-11-22"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        return app
    }

    private func labelled(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func waitGone(_ e: XCUIElement) {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
        wait(for: [gone], timeout: 10)
    }

    private func menu(_ app: XCUIApplication, _ row: XCUIElement, _ item: String) {
        row.press(forDuration: 1.2)
        let b = app.buttons[item]
        XCTAssertTrue(b.waitForExistence(timeout: 5), item)
        b.tap()
    }

    func testSearchRenameCopyTrashAndRestore() throws {
        let app = launch()
        let lgsk = app.element("flight-fixture-lgtt-lgsk")
        XCTAssertTrue(lgsk.waitForExistence(timeout: 15))
        let lgsy = app.element("flight-fixture-lgtt-lgsy")
        XCTAssertTrue(lgsy.label.contains("today"), lgsy.label)
        XCTAssertTrue(lgsy.label.contains("08:30Z (10:30LT)"), lgsy.label)
        XCTAssertTrue(lgsk.label.contains("in 6 days"), lgsk.label)
        let shared = app.element("flight-fixture-shared")
        XCTAssertTrue(shared.label.contains("LGMG local"), shared.label)
        XCTAssertTrue(shared.label.contains("A. Passenger"), shared.label)

        // every term must match: an aerodrome and a VFR point of the route
        let search = app.searchFields.firstMatch
        search.tap()
        search.typeText("lgsk lgtt")
        waitGone(lgsy)
        XCTAssertTrue(lgsk.exists)
        search.typeText(" nowhere")
        XCTAssertTrue(app.staticTexts["No matching flights"].waitForExistence(timeout: 5))
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        // an active search hides the toolbar: its cancel button ends it (named Close since iOS 26)
        let end = app.buttons.matching(NSPredicate(format: "label IN {'Cancel', 'Close'}")).firstMatch
        if end.exists { end.tap() }
        XCTAssertTrue(app.buttons["trash-view"].waitForExistence(timeout: 5), "the toolbar is back")
        XCTAssertTrue(lgsy.waitForExistence(timeout: 5))

        // Rename
        menu(app, lgsk, "Rename")
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + "Skiathos weekend")
        app.alerts.buttons["Rename"].firstMatch.tap()
        let renamed = NSPredicate(format: "label CONTAINS 'Skiathos weekend'")
        wait(for: [expectation(for: renamed, evaluatedWith: lgsk)], timeout: 10)

        // Make a copy: "Copy of …"
        menu(app, lgsk, "Make a copy")
        XCTAssertTrue(labelled(app, "Made “Copy of Skiathos weekend”").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("flight-fixture-copy-1").waitForExistence(timeout: 10))

        // Move to trash by swipe; it is in the trash, and restored from there
        lgsk.swipeLeft()
        app.buttons["Move to trash"].firstMatch.tap()
        XCTAssertTrue(labelled(app, "“Skiathos weekend” moved to trash").waitForExistence(timeout: 10))
        waitGone(lgsk)
        app.buttons["trash-view"].tap()
        XCTAssertTrue(app.navigationBars["Trash"].waitForExistence(timeout: 5))
        let trashed = app.element("trashed-fixture-lgtt-lgsk")
        XCTAssertTrue(trashed.waitForExistence(timeout: 10))
        XCTAssertFalse(app.element("trashed-fixture-shared").exists, "a shared flight is never in the trash")
        menu(app, trashed, "Restore")
        XCTAssertTrue(app.staticTexts["The trash is empty"].waitForExistence(timeout: 10))
        XCTAssertTrue(labelled(app, "“Skiathos weekend” restored").exists)
        app.buttons["trash-view"].tap()
        XCTAssertTrue(lgsk.waitForExistence(timeout: 10))
    }

    func testTheRouteFormMakesALocalFlightThatOpensOnPlan() throws {
        let app = launch()
        XCTAssertTrue(app.element("flight-fixture-lgtt-lgsy").waitForExistence(timeout: 15))
        app.buttons["new-flight"].press(forDuration: 1.2)
        let ask = app.buttons["Choose origin and destination"]
        XCTAssertTrue(ask.waitForExistence(timeout: 5))
        ask.tap()

        let from = app.buttons["new-from"]
        XCTAssertTrue(from.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["create-flight"].isEnabled, "the origin is required")
        from.tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("LGTT")
        app.buttons["place-aerodrome:LGTT"].tap()
        // an empty destination is back to the origin: a local flight, with its duration
        XCTAssertTrue(labelled(app, "LGTT (back to the origin)").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("new-flight-duration").exists)
        app.switches["new-flight-local"].switches.firstMatch.tap()
        XCTAssertTrue(labelled(app, "Back to LGTT").waitForExistence(timeout: 5))
        let duration = app.steppers["new-flight-duration"]
        duration.buttons.element(boundBy: 1).tap()
        XCTAssertTrue(labelled(app, "1:05").exists)
        app.buttons["create-flight"].tap()

        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        XCTAssertFalse(app.element("fly-top-strip").exists)
    }
}
