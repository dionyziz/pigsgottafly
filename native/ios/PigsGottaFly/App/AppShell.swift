import SwiftUI

/// What the shell lets a flight change: Fly on iPad hides the sidebar and the list.
@MainActor
final class Navigator: ObservableObject {
    @Published var columns: NavigationSplitViewVisibility = .all
}

/// iPhone's tabs.
enum ShellTab: String, CaseIterable, Hashable {
    case flights, hangar, people, me

    var title: String { rawValue == "me" ? "Me" : rawValue.capitalized }
    var systemImage: String {
        switch self {
        case .flights: "airplane"
        case .hangar: "wrench.and.screwdriver"
        case .people: "person.2"
        case .me: "person.crop.circle"
        }
    }
    var accessibilityID: String { "tab-\(rawValue)" }
}

/// iPad's sidebar.
enum ShellArea: String, CaseIterable, Hashable, Identifiable {
    case flights, hangar, passengers, waypoints, operators, profile
    var id: String { rawValue }

    var title: String { rawValue.capitalized }
    var systemImage: String {
        switch self {
        case .flights: "airplane"
        case .hangar: "wrench.and.screwdriver"
        case .passengers: "person.2"
        case .waypoints: "mappin.and.ellipse"
        case .operators: "building.2"
        case .profile: "person.crop.circle"
        }
    }
    var accessibilityID: String { "sidebar-\(rawValue)" }
}

/// The signed-in app: a tab bar on iPhone (and in compact width), a three-column split view on iPad.
struct AppShell: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @StateObject private var navigator = Navigator()

    /// `-openFlight <id>` opens a flight at launch (screenshots, tests).
    @State private var flight: String? = LaunchArgs.value("-openFlight")
    @State private var tab: ShellTab = LaunchArgs.value("-shellTab").flatMap(ShellTab.init(rawValue:)) ?? .flights
    @State private var area: ShellArea? = .flights
    @State private var aircraft: String?
    @State private var passenger: String?
    @State private var waypoint: String?
    @State private var operatorId: String?

    var body: some View {
        Group {
            if horizontalSize == .regular { split } else { tabs }
        }
        .environmentObject(navigator)
        .toast($app.toast)
        .task { await app.loadPilot() }
    }

    // MARK: iPhone

    private var tabs: some View {
        TabView(selection: $tab) {
            flights
                .tabItem { tabLabel(.flights) }
                .tag(ShellTab.flights)
            NavigationStack { HangarListView() }
                .tabItem { tabLabel(.hangar) }
                .tag(ShellTab.hangar)
            NavigationStack { PeopleView() }
                .tabItem { tabLabel(.people) }
                .tag(ShellTab.people)
            NavigationStack { MeView() }
                .tabItem { tabLabel(.me) }
                .tag(ShellTab.me)
        }
    }

    private func tabLabel(_ t: ShellTab) -> some View {
        Label(t.title, systemImage: t.systemImage).accessibilityIdentifier(t.accessibilityID)
    }

    /// A split view even on iPhone, where it collapses to a stack: the workspace keeps a navigation
    /// stack of its own for its sections, which a stack around it would not allow.
    private var flights: some View {
        NavigationSplitView {
            FlightsView(selection: $flight)
        } detail: {
            if let id = flight {
                FlightWorkspace(id: id, app: app) { flight = nil }.id(id)
            }
        }
        // the workspace has its own tab bar
        .toolbar(flight == nil ? .visible : .hidden, for: .tabBar)
    }

    // MARK: iPad

    private var split: some View {
        NavigationSplitView(columnVisibility: $navigator.columns) {
            List(selection: $area) {
                ForEach(ShellArea.allCases) { a in
                    Label(a.title, systemImage: a.systemImage)
                        .tag(a)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier(a.accessibilityID)
                }
            }
            .navigationTitle("Pig's Gotta Fly")
        } content: {
            switch area ?? .flights {
            case .flights: FlightsView(selection: $flight)
            case .hangar: HangarListView(selection: $aircraft)
            case .passengers: PassengersView(selection: $passenger)
            case .waypoints: WaypointsView(selection: $waypoint)
            case .operators: OperatorsView(selection: $operatorId)
            case .profile: MeView()
            }
        } detail: {
            detail
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch area ?? .flights {
        case .flights:
            if let id = flight {
                FlightWorkspace(id: id, app: app) { flight = nil }.id(id)
            } else {
                ContentUnavailableView("Choose a flight", systemImage: "airplane")
            }
        case .hangar:
            if let id = aircraft {
                NavigationStack { AircraftEditorView(aircraftId: id, title: "Aircraft") }.id(id)
            } else {
                ContentUnavailableView("Choose an aircraft", systemImage: "airplane")
            }
        case .passengers:
            if let id = passenger {
                NavigationStack { PassengerEditorView(passengerId: id) }.id(id)
            } else {
                ContentUnavailableView("Choose a passenger", systemImage: "person.2")
            }
        case .waypoints:
            if waypoint != nil {
                NavigationStack { WaypointEditorView() }
            } else {
                ContentUnavailableView("Choose a waypoint", systemImage: "mappin.and.ellipse")
            }
        case .operators:
            if let id = operatorId {
                NavigationStack { OperatorEditorView(operatorId: id) }.id(id)
            } else {
                ContentUnavailableView("Choose an operator", systemImage: "building.2")
            }
        case .profile:
            NavigationStack { ProfileView() }
        }
    }
}
