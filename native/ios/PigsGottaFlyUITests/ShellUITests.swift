import XCTest

/// Every tab, sidebar area and section stub of the shell is reachable by its identifier: on iPhone
/// through the tab bars, on iPad through the sidebar, the inspector and the Fly button.
final class ShellUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-fixtures", "-noNetwork"] + extra
        app.launch()
        return app
    }

    private func visit(_ app: XCUIApplication, row: String, screen: String, back title: String? = nil) {
        app.tapRow(row)
        XCTAssertTrue(app.element(screen).waitForExistence(timeout: 10), screen)
        app.back(from: title)
    }

    func testEveryStubIsReachableOnIPhone() throws {
        let app = launch(["-today", "2026-12-31"])
        try XCTSkipIf(app.isPad, "iPhone layout")

        // a flight of another day opens on Plan; every tab and section of the workspace
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsy").tap()
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        XCTAssertFalse(app.tabBars.buttons["tab-flights"].isHittable, "the shell's tab bar gives way to the flight's")
        for (tab, rows) in [
            ("stage-plan", Sections.plan), ("stage-brief", Sections.brief), ("stage-file", Sections.file),
        ] {
            app.tapTab(tab)
            XCTAssertTrue(
                app.element(tab.replacingOccurrences(of: "stage-", with: "stage-body-")).waitForExistence(timeout: 5))
            for (row, screen, title) in rows { visit(app, row: row, screen: screen, back: title) }
            if tab == "stage-file" { XCTAssertFalse(app.element("section-form731").exists, "no Form 731 flying alone") }
        }
        app.tapTab("flight-tab-map")
        XCTAssertTrue(app.element("map-tab").waitForExistence(timeout: 5))
        app.tapTab("flight-tab-fly")
        XCTAssertTrue(app.element("fly-bottom-strip").waitForExistence(timeout: 10))
        app.buttons["fly-back"].tap()

        // Hangar: the aircraft and its sections
        app.tapTab("tab-hangar", label: "Hangar")
        XCTAssertTrue(app.element("hangar-list").waitForExistence(timeout: 10))
        app.tapRow("aircraft-fixture-sx-asv")
        XCTAssertTrue(app.element("aircraft-page").waitForExistence(timeout: 10))
        for (row, screen, title) in Sections.aircraft { visit(app, row: row, screen: screen, back: title) }

        // People: passengers, waypoints, operators and their editors
        app.tapTab("tab-people", label: "People")
        XCTAssertTrue(app.element("people").waitForExistence(timeout: 10))
        for (kind, list, add, editor) in [
            ("people-passengers", "passenger-list", "add-passenger", "passenger-editor"),
            ("people-waypoints", "waypoint-list", "add-waypoint", "waypoint-map"),
            ("people-operators", "operator-list", "add-operator", "operator-page"),
        ] {
            app.tapRow(kind)
            XCTAssertTrue(app.element(list).waitForExistence(timeout: 10), list)
            visit(app, row: add, screen: editor)
            app.back()
        }

        // Me
        app.tapTab("tab-me", label: "Me")
        XCTAssertTrue(app.element("me").waitForExistence(timeout: 10))
        for (row, screen) in Sections.me { visit(app, row: row, screen: screen) }
        app.tapTab("tab-flights", label: "Flights")
        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 10))
    }

    /// The split view may hide the sidebar after a rotation or after Fly: its own button brings it back.
    private func showSidebar(_ app: XCUIApplication) {
        let flights = app.element("sidebar-flights")
        let show = app.navigationBars.buttons["Show Sidebar"].firstMatch
        if !flights.isHittable && show.exists { show.tap() }
        let hittable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: flights)
        wait(for: [hittable], timeout: 10)
    }

    func testEveryStubIsReachableOnIPad() throws {
        let app = launch(["-today", "2026-12-31"])
        try XCTSkipUnless(app.isPad, "iPad layout")
        // all three columns show in landscape
        XCUIDevice.shared.orientation = .landscapeLeft

        XCTAssertTrue(app.element("flight-list").waitForExistence(timeout: 15))
        app.element("flight-fixture-lgtt-lgsy").tap()
        // the map beside the inspector, on Plan (the flight is not today's)
        XCTAssertTrue(app.element("map-tab").waitForExistence(timeout: 15))
        XCTAssertTrue(app.element("stage-body-plan").waitForExistence(timeout: 15))
        for (tab, rows) in [
            ("stage-plan", Sections.plan), ("stage-brief", Sections.brief), ("stage-file", Sections.file),
        ] {
            app.buttons[tab].tap()
            XCTAssertTrue(
                app.element(tab.replacingOccurrences(of: "stage-", with: "stage-body-")).waitForExistence(timeout: 5))
            for (row, screen, title) in rows { visit(app, row: row, screen: screen, back: title) }
        }

        // Fly takes the whole screen, and gives it back
        app.buttons["flight-tab-fly"].tap()
        XCTAssertTrue(app.element("fly-bottom-strip").waitForExistence(timeout: 10))
        XCTAssertFalse(app.element("sidebar-flights").isHittable, "the sidebar is hidden while flying")
        app.buttons["fly-back"].tap()
        XCTAssertTrue(app.element("map-tab").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("stage-body-file").waitForExistence(timeout: 10), "back on the stage Fly left")
        showSidebar(app)

        // Hangar: the list beside the aircraft's sections
        app.element("sidebar-hangar").tap()
        XCTAssertTrue(app.element("hangar-list").waitForExistence(timeout: 10))
        app.element("aircraft-fixture-sx-asv").tap()
        XCTAssertTrue(app.element("aircraft-page").waitForExistence(timeout: 10))
        for (row, screen, title) in Sections.aircraft { visit(app, row: row, screen: screen, back: title) }

        for (area, list, add, editor) in [
            ("sidebar-passengers", "passenger-list", "add-passenger", "passenger-editor"),
            ("sidebar-waypoints", "waypoint-list", "add-waypoint", "waypoint-map"),
            ("sidebar-operators", "operator-list", "add-operator", "operator-page"),
        ] {
            app.element(area).tap()
            XCTAssertTrue(app.element(list).waitForExistence(timeout: 10), list)
            app.buttons[add].tap()
            XCTAssertTrue(app.element(editor).waitForExistence(timeout: 10), editor)
        }

        app.element("sidebar-profile").tap()
        XCTAssertTrue(app.element("me").waitForExistence(timeout: 10))
        for (row, screen) in Sections.me {
            app.tapRow(row)
            XCTAssertTrue(app.element(screen).waitForExistence(timeout: 10), screen)
        }
        XCUIDevice.shared.orientation = .portrait
    }
}
