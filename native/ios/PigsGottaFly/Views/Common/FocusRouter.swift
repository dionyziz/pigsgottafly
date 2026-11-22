import SwiftUI

/// Where a warning's Fix leads, as on the website (?focus=…): the core names the field, its editor
/// section and stage (PGF.focusTarget); the workspace switches to the tab and opens the section with
/// that field focused, or opens the website's page for what lives outside the flight (the profile).
struct FocusRouter {
    /// Opens a section; the String is the field to focus (the website's data-focus key), if any.
    var openSection: @MainActor (FlightSection, String?) -> Void = { _, _ in }
    var openTab: @MainActor (FlightTab) -> Void = { _ in }
    var openLink: @MainActor (URL) -> Void = { _ in }
    var resolve: @MainActor (String) async -> CoreFocusTarget? = { _ in nil }

    @MainActor
    func fix(text: String) {
        Task { @MainActor in
            if let t = await resolve(text) { route(t) }
        }
    }

    @MainActor
    func route(_ t: CoreFocusTarget) {
        if let s = t.section.flatMap(FlightSection.init(webSection:)) {
            openSection(s, t.focus)
        } else if let stage = t.stage, let tab = FlightTab(rawValue: stage) {
            openTab(tab)
        } else if let link = t.link {
            var path = link.to
            while path.hasPrefix("/") { path.removeFirst() }
            openLink(API.site.appendingPathComponent(path))
        }
    }
}

private struct FocusRouterKey: EnvironmentKey {
    static let defaultValue = FocusRouter()
}

private struct FlightFocusKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var focusRouter: FocusRouter {
        get { self[FocusRouterKey.self] }
        set { self[FocusRouterKey.self] = newValue }
    }

    /// The field a Fix asked for (the website's data-focus key): a section focuses it when it shows.
    var flightFocus: String? {
        get { self[FlightFocusKey.self] }
        set { self[FlightFocusKey.self] = newValue }
    }
}
