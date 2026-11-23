import XCTest

/// Share a flight from the flight list's row menu and from the flight's toolbar, against the fixture
/// server (nothing is sent): an address with no account is invited and pending, and the shared
/// flight shows who shared it.
final class FlightSharingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-today", "2026-12-31"]
        app.launch()
        if app.isPad { XCUIDevice.shared.orientation = .landscapeLeft }
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        return app
    }

    func testShareAFlightFromTheListAndFromTheFlight() throws {
        let app = launch()
        app.element("flight-fixture-lgtt-lgsk").press(forDuration: 1.2)
        app.buttons["flight-share-fixture-lgtt-lgsk"].tap()
        XCTAssertTrue(app.element("share-dialog").waitForExistence(timeout: 10))
        let email = app.textFields["share-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("bob@example.com")
        app.buttons["share-add"].tap()
        XCTAssertTrue(app.element("share-person-bob@example.com").waitForExistence(timeout: 10), "pending invite")
        app.buttons["share-done"].tap()

        // the flight's own Share shows the same people
        app.element("flight-fixture-lgtt-lgsk").tap()
        let share = app.buttons["share-flight"]
        XCTAssertTrue(share.waitForExistence(timeout: 15))
        share.tap()
        XCTAssertTrue(app.element("share-person-bob@example.com").waitForExistence(timeout: 10))
        app.buttons["share-done"].tap()
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }

    func testAFlightSharedWithThePilotShowsWhoSharedIt() throws {
        let app = launch()
        app.element("flight-fixture-shared").tap()
        XCTAssertTrue(app.element("view-only-chip").waitForExistence(timeout: 15))
        app.buttons["share-flight"].tap()
        XCTAssertTrue(app.element("share-leave").waitForExistence(timeout: 10), "a viewer may leave")
        XCTAssertFalse(app.textFields["share-email"].exists, "a viewer cannot add people")
        app.buttons["share-done"].tap()
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }
}
