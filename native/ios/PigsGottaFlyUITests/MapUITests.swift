import XCTest

/// The Map tab on the fixture flight LGTT → KALAMO → KIMI → LGSY: drawing adds the VFR point a tap
/// lands on (the map opens centred on ALIVERI), undo takes it back, the layers menu opens. iPhone and
/// iPad.
final class MapUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testTapAddsAPointAndUndoRemovesIt() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-fixtures", "-noNetwork", "-today", "2026-12-31", "-tab", "map", "-mapCamera", "38.4075,24.04194,10",
        ]
        app.launch()

        let row = app.element("flight-fixture-lgtt-lgsy")
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let map = app.element("map")
        XCTAssertTrue(map.waitForExistence(timeout: 15))
        let route = app.element("map-route")
        let before = NSPredicate(format: "value == %@", "LGTT KALAMO KIMI LGSY")
        wait(for: [expectation(for: before, evaluatedWith: route)], timeout: 10)

        // iPad: the first tap in the detail after choosing the flight in the sidebar can go to the split view
        let draw = app.buttons["map-draw"]
        for _ in 0..<3 where !draw.isSelected {
            draw.tap()
            _ = draw.waitForSelection()
        }
        XCTAssertTrue(draw.isSelected)
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let added = NSPredicate(format: "value == %@", "LGTT KALAMO KIMI LGSY ALIVERI")
        wait(for: [expectation(for: added, evaluatedWith: route)], timeout: 10)

        // the point drawn last ends the drawing; undo takes the point back
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.buttons["undo"].firstMatch.tap()
        wait(for: [expectation(for: before, evaluatedWith: route)], timeout: 10)

        app.element("map-layers").tap()
        XCTAssertTrue(app.element("map-tma").waitForExistence(timeout: 5))
    }
}

extension XCUIElement {
    fileprivate func waitForSelection(timeout: TimeInterval = 2) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while !isSelected && Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
        return isSelected
    }
}
