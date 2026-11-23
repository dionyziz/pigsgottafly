import SwiftUI

/// Where a warning's Fix leads, as on the website (?focus=…): the core names the field, its editor
/// section and stage (PGF.focusTarget); the workspace switches to the tab and opens the section with
/// that field focused, or opens the page for what lives outside the flight (the hangar, the profile).
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
            open(link: link)
        }
    }

    /// A page of the website by its path ('/hangar/x?focus=performance'): FixLinkView shows it.
    @MainActor
    func open(link: CoreFocusTarget.Link) {
        var path = link.to
        while path.hasPrefix("/") { path.removeFirst() }
        // relative to the site, so that a query stays a query
        if let url = URL(string: path, relativeTo: API.site)?.absoluteURL { openLink(url) }
    }

    /// The whole section, as the website's focusSection does for a "Ready to fly" row.
    @MainActor
    func open(section: FlightSection) {
        openSection(section, nil)
    }

    /// The Map tab with the NOTAM picked (the website selects it on the map); the map takes the
    /// request through MapFocus.
    @MainActor
    func showOnMap(notam key: String, flightId: String) {
        MapFocus.request(notam: key, flightId: flightId)
        openTab(.map)
    }
}

/// What the Map tab is asked to show: a NOTAM picked in the Brief. The map reads the request when it
/// appears (`take`), and while shown hears `.pgfMapFocus` (object: the flight id, userInfo "notam").
@MainActor
enum MapFocus {
    private static var pending: [String: String] = [:]

    static func request(notam key: String, flightId: String) {
        pending[flightId] = key
        NotificationCenter.default.post(name: .pgfMapFocus, object: flightId, userInfo: ["notam": key])
    }

    /// The NOTAM key the flight's map should select, once.
    static func take(flightId: String) -> String? {
        pending.removeValue(forKey: flightId)
    }
}

extension Notification.Name {
    static let pgfMapFocus = Notification.Name("PGFMapFocus")
}

/// A page a Fix opens outside the flight: the aircraft in the hangar and the pilot's own details in
/// the app, anything else on the website.
struct FixLinkView: View {
    var url: URL
    @Environment(\.dismiss) private var dismiss

    enum Destination: Equatable {
        case aircraft(String)
        case profile
        case web
    }

    /// '/hangar/<id>?focus=…' → the aircraft; '/profile', '/passengers?edit=me' → the profile.
    static func destination(_ url: URL) -> Destination {
        let parts = url.path.split(separator: "/").map(String.init)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems ?? []
        if parts.count == 2, parts[0] == "hangar" { return .aircraft(parts[1]) }
        if parts == ["profile"] { return .profile }
        if parts == ["passengers"], query.first(where: { $0.name == "edit" })?.value == "me" { return .profile }
        return .web
    }

    var body: some View {
        switch Self.destination(url) {
        case .aircraft(let id):
            NavigationStack { AircraftEditorView(aircraftId: id, title: "Aircraft").toolbar { done } }
        case .profile:
            NavigationStack { ProfileView().toolbar { done } }
        case .web:
            SafariView(url: url).ignoresSafeArea()
        }
    }

    private var done: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.accessibilityIdentifier("fix-link-done")
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
