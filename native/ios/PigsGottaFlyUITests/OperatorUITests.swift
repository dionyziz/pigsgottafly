import XCTest

/// The native operator editor against the fixture operators: the list, the fields and what holds the
/// save back, the aircraft and the people, a view-only operator, and New operator.
final class OperatorUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func openOperators() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-shellTab", "people"]
        app.launch()
        if app.isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(app.element("sidebar-operators").waitForExistence(timeout: 15))
            app.element("sidebar-operators").tap()
        } else {
            XCTAssertTrue(app.element("people").waitForExistence(timeout: 15))
            app.tapRow("people-operators")
        }
        XCTAssertTrue(app.element("operator-op-mesogeion").waitForExistence(timeout: 15))
        return app
    }

    func testEditAnOperator() throws {
        let app = openOperators()
        app.element("operator-op-mesogeion").tap()
        XCTAssertTrue(app.element("operator-page").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("operator-subtitle").waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["operator-name"].exists)

        // a flight plan copy needs an address: the issue shows under the field until it is typed
        app.switches["operator-requires-fpl"].tap()
        XCTAssertTrue(app.element("operator-fpl-copy-email-issue").waitForExistence(timeout: 5))
        let email = app.textFields["operator-fpl-copy-email"]
        email.tap()
        email.typeText("fpl@mesogeion.example")
        XCTAssertFalse(app.element("operator-fpl-copy-email-issue").waitForExistence(timeout: 2))

        app.reveal(app.element("operator-aircraft-fixture-sx-asv"), swipes: 8)
        XCTAssertTrue(app.element("operator-aircraft-fixture-sx-asv").exists)
        app.reveal(app.element("operator-person-fixture-pilot"), swipes: 4)
        XCTAssertTrue(app.element("operator-person-fixture-pilot").exists)
        XCTAssertTrue(app.buttons["operator-actions"].exists, "the owner may delete it")

        app.buttons["share-operator"].tap()
        XCTAssertTrue(app.element("share-dialog").waitForExistence(timeout: 10))
        app.buttons["share-done"].tap()
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }

    func testAViewOnlyOperatorAndANewOne() throws {
        let app = openOperators()
        app.element("operator-op-aegean-flyers").tap()
        XCTAssertTrue(app.element("operator-view-only").waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["operator-name"].isEnabled, "a viewer cannot change it")
        XCTAssertFalse(app.buttons["operator-actions"].exists)
        if !app.isPad { app.back() }

        app.buttons["add-operator"].tap()
        XCTAssertTrue(app.element("new-operator-dialog").waitForExistence(timeout: 10))
        app.buttons["new-operator-create"].tap()
        XCTAssertTrue(app.element("new-operator-error").waitForExistence(timeout: 5), "a name is needed")
        let name = app.textFields["new-operator-name"]
        name.tap()
        name.typeText("Island Air")
        app.buttons["new-operator-create"].tap()
        XCTAssertTrue(app.element("operator-page").waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["operator-name"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["operator-name"].value as? String, "Island Air")
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }

    func testDeletingAnOperatorSaysSo() throws {
        let app = openOperators()
        app.element("operator-op-mesogeion").tap()
        XCTAssertTrue(app.buttons["operator-actions"].waitForExistence(timeout: 10))
        app.buttons["operator-actions"].tap()
        app.buttons["Delete operator"].tap()
        let confirm = app.buttons["confirm-destructive"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        let toast = app.element("toast")
        XCTAssertTrue(toast.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Deleted AEROCLUB MESOGEION"].exists, "the website's toast")
        XCTAssertFalse(app.element("operator-op-mesogeion").waitForExistence(timeout: 2))
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }
}
