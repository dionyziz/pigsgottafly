import XCTest

/// The hangar's Add aircraft: from the type template, then the new aircraft's page opens (iPhone:
/// pushed; iPad: in the detail column), and the list holds it.
final class HangarUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testAddAnAircraftFromTheTypeTemplateAndOpenIt() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork", "-shellTab", "hangar"]
        app.launch()
        if app.isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(app.element("sidebar-hangar").waitForExistence(timeout: 15))
            app.element("sidebar-hangar").tap()
        }
        XCTAssertTrue(app.element("hangar-list").waitForExistence(timeout: 15))
        XCTAssertTrue(app.element("aircraft-fixture-sx-asv").waitForExistence(timeout: 10))

        app.buttons["add-aircraft"].tap()
        XCTAssertTrue(app.element("add-aircraft-dialog").waitForExistence(timeout: 10))
        let template = app.buttons["add-aircraft-source-template-reims-f172m"]
        XCTAssertTrue(template.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["add-aircraft-source-copy-fixture-sx-asv"].exists, "same type as SX-ASV")
        XCTAssertTrue(app.buttons["add-aircraft-source-blank-"].exists)

        let registration = app.textFields["add-aircraft-registration"]
        XCTAssertTrue(registration.waitForExistence(timeout: 5))
        // the registration already in the hangar is refused before it is sent
        registration.tap()
        registration.typeText("sx-asv")
        app.buttons["add-aircraft-submit"].tap()
        XCTAssertTrue(app.element("add-aircraft-error").waitForExistence(timeout: 5))
        registration.clearAndType("sx-new")
        template.tap()
        app.buttons["add-aircraft-submit"].tap()

        XCTAssertTrue(app.element("aircraft-page").waitForExistence(timeout: 15))
        XCTAssertFalse(app.element("add-aircraft-dialog").exists)
        XCTAssertTrue(app.element("toast").waitForExistence(timeout: 5))
        if !app.isPad {
            XCTAssertTrue(app.navigationBars["SX-NEW"].exists, "the new aircraft's page")
            app.back(from: "SX-NEW")
        }
        XCTAssertTrue(app.element("aircraft-fixture-ac-2").waitForExistence(timeout: 10), "the list holds it")
        if app.isPad { XCUIDevice.shared.orientation = .portrait }
    }
}

extension XCUIElement {
    /// Deletes the field's text and types `text` in its place.
    func clearAndType(_ text: String) {
        tap()
        let current = (value as? String) ?? ""
        typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + text)
    }
}
