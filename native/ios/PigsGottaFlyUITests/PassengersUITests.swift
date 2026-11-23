import XCTest

/// The passenger editor on the fixtures, iPhone and iPad: a saved passenger's details save by
/// themselves, a problem shows under its field and stops the save, Delete with Undo, and a new
/// passenger added once it has what it needs.
final class PassengersUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func openPassengers() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork"]
        app.launch()
        if app.isPad {
            let area = app.element("sidebar-passengers")
            XCTAssertTrue(area.waitForExistence(timeout: 15))
            area.tap()
        } else {
            app.tapTab("tab-people", label: "People")
            app.tapRow("people-passengers")
        }
        XCTAssertTrue(app.element("passenger-list").waitForExistence(timeout: 10))
        return app
    }

    /// Replaces a text field's text.
    private func retype(_ field: XCUIElement, _ text: String) {
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2) + text)
    }

    private func waitFor(_ e: XCUIElement, _ format: String, timeout: TimeInterval = 10) {
        expectation(for: NSPredicate(format: format), evaluatedWith: e)
        waitForExpectations(timeout: timeout)
    }

    func testAPassengersDetailsSaveByThemselvesAndComeBackAfterDelete() throws {
        let app = openPassengers()
        app.tapRow("passenger-pax-anna")
        let name = app.textFields["passenger-fullName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        waitFor(name, "value == 'ANNA PAPADOPOULOU'")

        let weight = app.textFields["passenger-weightKg"]
        retype(weight, "64")
        let status = app.element("passenger-save-status")
        waitFor(status, "label == 'Saved'", timeout: 15)

        // an address that is not one: shown under the field, not saved
        let email = app.textFields["passenger-email"]
        retype(email, "anna-at-example")
        let issue = app.element("passenger-email-issue")
        XCTAssertTrue(issue.waitForExistence(timeout: 10))
        XCTAssertEqual(issue.label, "Not an e-mail address")
        retype(email, "anna@example.org")
        waitFor(issue, "exists == false")
        waitFor(status, "label == 'Saved'", timeout: 15)

        // Delete asks first; Undo brings the details back
        let delete = app.buttons["passenger-delete"]
        app.reveal(delete)
        delete.tap()
        app.buttons["confirm-destructive"].tap()
        XCTAssertTrue(app.element("passenger-deleted").waitForExistence(timeout: 10))
        app.buttons["passenger-restore"].tap()
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        waitFor(name, "value == 'ANNA PAPADOPOULOU'")
        XCTAssertEqual(app.textFields["passenger-email"].value as? String, "anna@example.org")
        XCTAssertEqual(app.textFields["passenger-weightKg"].value as? String, "64")
    }

    func testANewPassengerNeedsAnEmailAddress() throws {
        let app = openPassengers()
        app.buttons["add-passenger"].tap()
        let name = app.textFields["passenger-fullName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("ROBIN RIDER")
        let add = app.buttons["passenger-add"]
        add.tap()
        let issue = app.element("passenger-email-issue")
        XCTAssertTrue(issue.waitForExistence(timeout: 10))
        XCTAssertEqual(issue.label, "Enter the e-mail address")

        let email = app.textFields["passenger-email"]
        email.tap()
        email.typeText("robin@example.com")
        add.tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'ROBIN RIDER'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the list has the new passenger")
    }
}
