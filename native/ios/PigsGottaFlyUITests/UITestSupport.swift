import XCTest

extension XCUIApplication {
    /// Any element by its accessibility identifier.
    func element(_ id: String) -> XCUIElement { descendants(matching: .any)[id].firstMatch }

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// The search field of the screen on top: on iPad the flight list's own search stays on screen
    /// beside it.
    var searchField: XCUIElement {
        searchFields.matching(NSPredicate(format: "NOT (label BEGINSWITH 'Search by name')")).firstMatch
    }

    /// The back button of the navigation bar titled `title` (several bars show at once on iPad).
    func back(from title: String? = nil) {
        let bar = title.map { navigationBars[$0] } ?? navigationBars.firstMatch
        bar.buttons.element(boundBy: 0).tap()
    }

    /// Taps a tab bar button by its identifier, else by its label: SwiftUI drops a tab item's identifier
    /// when the tab bar comes back after a pushed view hid it.
    func tapTab(_ id: String, label: String? = nil) {
        let byID = tabBars.buttons[id]
        if byID.waitForExistence(timeout: label == nil ? 10 : 3) {
            byID.tap()
            return
        }
        let byLabel = tabBars.buttons[label ?? id]
        XCTAssertTrue(byLabel.waitForExistence(timeout: 10), id)
        byLabel.tap()
    }

    /// Scrolls to the button `id` and taps it.
    func tapRow(_ id: String) {
        let b = buttons[id].firstMatch
        _ = b.waitForExistence(timeout: 5)
        // lists build their rows lazily: a row below the screen exists only once scrolled to
        for _ in 0..<8 where !(b.exists && b.isHittable) { swipeUp() }
        XCTAssertTrue(b.exists, id)
        b.tap()
    }

    /// Scrolls until `e` can be tapped.
    func reveal(_ e: XCUIElement, swipes: Int = 6) {
        for _ in 0..<swipes where !e.isHittable { swipeUp() }
    }
}

/// The rows and screens of the flight workspace (FlightSection: rowID, screenID, title).
enum Sections {
    static let plan: [(String, String, String)] = [
        ("section-route", "route-section", "Route"),
        ("section-when", "when-section", "When"),
        ("section-aircraft", "aircraft-section", "Aircraft"),
        ("section-manifest", "manifest", "Manifest & loading"),
        ("section-fuel", "fuel-plan", "Fuel"),
        ("section-fplOptions", "fpl-options", "Flight plan options"),
        ("section-navlog", "navlog-table", "Navlog"),
    ]
    static let brief: [(String, String, String)] = [
        ("section-weather", "metar-list", "METAR and TAF"),
        ("section-notams", "notams", "NOTAMs"),
        ("section-aerodromes", "aerodrome-hours", "Aerodromes"),
        ("section-performance", "performance-section", "Take-off & landing"),
        ("section-atc", "atc-list", "ATC"),
        ("section-warnings", "warnings-section", "Warnings"),
    ]
    static let file: [(String, String, String)] = [
        ("section-flightPlan", "fpl-export", "Flight plan"),
        ("section-form731", "form731", "Form 731"),
        ("section-genDec", "gendec", "General Declaration"),
        ("section-wbPerf", "wbperf-export", "W&B & performance"),
        ("section-navlogExport", "navlog-export", "Navigation log"),
        ("section-briefing", "briefing-export", "NOTAM briefing"),
    ]
    static let aircraft: [(String, String, String)] = [
        ("aircraft-section-identity", "hangar-identity", "Identity"),
        ("aircraft-section-fplItems", "hangar-fpl-items", "Flight plan items"),
        ("aircraft-section-speeds", "hangar-speeds", "Speeds"),
        ("aircraft-section-fuel", "hangar-fuel", "Fuel"),
        ("aircraft-section-massBalance", "hangar-mass-balance", "Mass & balance"),
        ("aircraft-section-performance", "hangar-performance", "Performance"),
        ("aircraft-section-compass", "hangar-compass", "Compass cards"),
        ("aircraft-section-documents", "hangar-documents", "Documents"),
        ("aircraft-section-photo", "aircraft-photo", "Photo"),
        ("aircraft-section-history", "hangar-history", "History"),
    ]
    static let me: [(String, String)] = [
        ("profile", "profile-name"),
        ("planning-defaults", "planning-defaults-section"),
        ("profile-map-layers", "map-layers-section"),
        ("pilot-documents", "pilot-documents-section"),
        ("account-section", "account-settings"),
        ("legal", "legal-section"),
    ]
}
