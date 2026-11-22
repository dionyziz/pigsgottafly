import SwiftUI

/// The flight workspace's tabs: Fly, then the website editor's map and its three stages.
enum FlightTab: String, CaseIterable, Hashable, Sendable {
    case fly, map, plan, brief, file

    var title: String {
        switch self {
        case .fly: "Fly"
        case .map: "Map"
        case .plan: "Plan"
        case .brief: "Brief"
        case .file: "File"
        }
    }

    var systemImage: String {
        switch self {
        case .fly: "airplane"
        case .map: "map"
        case .plan: "list.bullet.rectangle"
        case .brief: "checklist"
        case .file: "doc.text"
        }
    }

    /// The tab button's identifier: the website's stage tabs are `stage-<stage>`.
    var accessibilityID: String {
        switch self {
        case .plan, .brief, .file: "stage-\(rawValue)"
        case .fly, .map: "flight-tab-\(rawValue)"
        }
    }

    /// The tab's content (the website's `stage-body-<stage>`).
    var bodyID: String {
        switch self {
        case .plan, .brief, .file: "stage-body-\(rawValue)"
        case .fly: "fly"
        case .map: "map-tab"
        }
    }

    /// The readiness stage of a stage tab (PGF.readinessStages `stage`).
    var stage: String? { [.plan, .brief, .file].contains(self) ? rawValue : nil }

    /// The tab a flight opens on when nothing was chosen for it in this session. A flight just made
    /// in New flight has nothing to fly or brief yet, whatever its date (the website's NewFlightPage
    /// remembers Plan for it); a planned flight of today opens in Fly; any other on Plan.
    static func initial(date: String, planned: Bool, isNew: Bool, today: String) -> FlightTab {
        if isNew { return .plan }
        return date == today && planned ? .fly : .plan
    }
}

/// One screen of a stage: the website editor's sections (src/features/editor/panels) and the File &
/// forms exports (src/shared/constants.ts EXPORT_KINDS).
enum FlightSection: String, CaseIterable, Hashable, Identifiable, Sendable {
    case route, when, aircraft, manifest, fuel, fplOptions, navlog
    case weather, notams, aerodromes, performance, atc, warnings
    case flightPlan, form731, genDec, wbPerf, navlogExport, briefing

    var id: String { rawValue }

    var tab: FlightTab {
        switch self {
        case .route, .when, .aircraft, .manifest, .fuel, .fplOptions, .navlog: .plan
        case .weather, .notams, .aerodromes, .performance, .atc, .warnings: .brief
        case .flightPlan, .form731, .genDec, .wbPerf, .navlogExport, .briefing: .file
        }
    }

    static func of(_ tab: FlightTab) -> [FlightSection] { allCases.filter { $0.tab == tab } }

    var title: String {
        switch self {
        case .route: "Route"
        case .when: "When"
        case .aircraft: "Aircraft"
        case .manifest: "Manifest & loading"
        case .fuel: "Fuel"
        case .fplOptions: "Flight plan options"
        case .navlog: "Navlog"
        case .weather: "METAR and TAF"
        case .notams: "NOTAMs"
        case .aerodromes: "Aerodromes"
        case .performance: "Take-off & landing"
        case .atc: "ATC"
        case .warnings: "Warnings"
        case .flightPlan: "Flight plan"
        case .form731: "Form 731"
        case .genDec: "General Declaration"
        case .wbPerf: "W&B & performance"
        case .navlogExport: "Navigation log"
        case .briefing: "NOTAM briefing"
        }
    }

    var systemImage: String {
        switch self {
        case .route: "point.topleft.down.to.point.bottomright.curvepath"
        case .when: "clock"
        case .aircraft: "airplane"
        case .manifest: "person.2"
        case .fuel: "fuelpump"
        case .fplOptions: "slider.horizontal.3"
        case .navlog: "list.number"
        case .weather: "cloud.sun"
        case .notams: "exclamationmark.bubble"
        case .aerodromes: "building.2"
        case .performance: "road.lanes"
        case .atc: "antenna.radiowaves.left.and.right"
        case .warnings: "exclamationmark.triangle"
        case .flightPlan: "paperplane"
        case .form731: "signature"
        case .genDec: "person.text.rectangle"
        case .wbPerf: "scalemass"
        case .navlogExport: "doc.plaintext"
        case .briefing: "doc.text.magnifyingglass"
        }
    }

    /// The row in its stage's list.
    var rowID: String { "section-\(rawValue)" }

    /// The section screen: the website's data-testid of the same section where it has one.
    var screenID: String {
        switch self {
        case .route: "route-section"
        case .when: "when-section"
        case .aircraft: "aircraft-section"
        case .manifest: "manifest"
        case .fuel: "fuel-plan"
        case .fplOptions: "fpl-options"
        case .navlog: "navlog-table"
        case .weather: "metar-list"
        case .notams: "notams"
        case .aerodromes: "aerodrome-hours"
        case .performance: "performance-section"
        case .atc: "atc-list"
        case .warnings: "warnings-section"
        case .flightPlan: "fpl-export"
        case .form731: "form731"
        case .genDec: "gendec"
        case .wbPerf: "wbperf-export"
        case .navlogExport: "navlog-export"
        case .briefing: "briefing-export"
        }
    }

    /// The website's editor section key (src/features/editor/focus.ts; PGF.focusTarget `section`).
    var webSection: String? {
        switch self {
        case .route, .when, .aircraft, .manifest, .fuel, .notams, .aerodromes, .performance, .atc: rawValue
        case .fplOptions: "fpl"
        case .weather: "metar"
        default: nil
        }
    }

    init?(webSection: String) {
        guard let s = FlightSection.allCases.first(where: { $0.webSection == webSection }) else { return nil }
        self = s
    }

    /// The website's export page of a File section (/flights/:id/export/<kind>).
    var exportKind: String? {
        switch self {
        case .flightPlan: "fpl"
        case .form731: "form731"
        case .genDec: "gendec"
        case .wbPerf: "wbperf"
        case .navlogExport: "navlog"
        case .briefing: "briefing"
        default: nil
        }
    }
}

/// The screen of a section.
struct FlightSectionView: View {
    var section: FlightSection
    @ObservedObject var model: FlightModel

    var body: some View {
        content
            .navigationTitle(section.title)
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .route: RouteView(model: model)
        case .when: WhenView(model: model)
        case .aircraft: AircraftView(model: model)
        case .manifest: ManifestView(model: model)
        case .fuel: FuelView(model: model)
        case .fplOptions: FplOptionsView(model: model)
        case .navlog: NavlogView(model: model)
        case .weather: WeatherView(model: model)
        case .notams: NotamsView(model: model)
        case .aerodromes: AerodromesView(model: model)
        case .performance: PerformanceView(model: model)
        case .atc: AtcView(model: model)
        case .warnings: WarningsView(model: model)
        case .flightPlan: FlightPlanView(model: model)
        case .form731: Form731View(model: model)
        case .genDec: GenDecView(model: model)
        case .wbPerf: WbPerfView(model: model)
        case .navlogExport: NavlogExportView(model: model)
        case .briefing: BriefingView(model: model)
        }
    }
}

extension FlightModel {
    /// A section not built in the app yet: the website's editor, or its export page.
    func stub(_ section: FlightSection) -> SectionStub {
        let path = section.exportKind.map { "flights/\(id)/export/\($0)" } ?? "flights/\(id)"
        return SectionStub(title: section.title, systemImage: section.systemImage, path: path, id: section.screenID) {
            [weak self] in Task { await self?.refresh() }
        }
    }
}
