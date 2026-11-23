import XCTest

/// Share an aircraft from the hangar row's context menu and from the aircraft's page, and Invite
/// pilots from the hangar's toolbar, against the fixture server (nothing is sent).
final class SharingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func openHangar() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-shellTab", "hangar"]
        app.launch()
        if app.isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(app.element("sidebar-hangar").waitForExistence(timeout: 15))
            app.element("sidebar-hangar").tap()
        }
        XCTAssertTrue(app.element("aircraft-fixture-sx-asv").waitForExistence(timeout: 15))
        return app
    }

    func testShareAnAircraftFromTheRowAndThePage() throws {
        let app = openHangar()
        app.element("aircraft-fixture-sx-asv").press(forDuration: 1.2)
        app.buttons["aircraft-share-fixture-sx-asv"].tap()
        XCTAssertTrue(app.element("share-dialog").waitForExistence(timeout: 10))

        // an address with no account: invited, pending
        let email = app.textFields["share-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("new@example.com")
        app.buttons["share-add"].tap()
        XCTAssertTrue(app.element("share-person-new@example.com").waitForExistence(timeout: 10))
        // an account: shared at once, as an editor
        email.tap()
        email.typeText("copilot@example.com")
        app.segmentedControls["share-role"].buttons["Editor"].tap()
        app.buttons["share-add"].tap()
        XCTAssertTrue(app.element("share-person-fixture-copilot").waitForExistence(timeout: 10))
        // the same address again: the server's reason
        email.tap()
        email.typeText("copilot@example.com")
        app.buttons["share-add"].tap()
        XCTAssertTrue(app.element("share-error").waitForExistence(timeout: 10))
        app.buttons["share-done"].tap()

        // the page's Share shows the same people
        if app.isPad {
            app.element("aircraft-fixture-sx-asv").tap()
        } else {
            app.tapRow("aircraft-fixture-sx-asv")
        }
        XCTAssertTrue(app.element("aircraft-page").waitForExistence(timeout: 10))
        app.buttons["share-aircraft"].tap()
        XCTAssertTrue(app.element("share-person-fixture-copilot").waitForExistence(timeout: 10))
        app.buttons["share-done"].tap()
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }

    func testInvitePilots() throws {
        let app = openHangar()
        app.buttons["invite-pilots"].tap()
        XCTAssertTrue(app.element("invite-dialog").waitForExistence(timeout: 10))
        let email = app.textFields["invite-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("bob@example.com")
        app.switches["invite-aircraft-fixture-sx-asv"].tap()
        app.buttons["invite-send"].tap()
        XCTAssertTrue(app.element("invite-done").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("invitation-aircraft").waitForExistence(timeout: 5))
        app.buttons["invitation-cancel"].firstMatch.tap()
        let gone = expectation(
            for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["invitation-cancel"].firstMatch)
        wait(for: [gone], timeout: 10)
        app.buttons["invite-done-button"].tap()
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }
}
