import SwiftUI

/// iPhone's People tab: passengers, waypoints and operators (the iPad sidebar lists them apart).
struct PeopleView: View {
    enum Kind: String, CaseIterable, Identifiable {
        case passengers, waypoints, operators
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
        var systemImage: String {
            switch self {
            case .passengers: "person.2"
            case .waypoints: "mappin.and.ellipse"
            case .operators: "building.2"
            }
        }
    }

    var body: some View {
        List {
            ForEach(Kind.allCases) { k in
                NavigationLink {
                    switch k {
                    case .passengers: PassengersView()
                    case .waypoints: WaypointsView()
                    case .operators: OperatorsView()
                    }
                } label: {
                    Label(k.title, systemImage: k.systemImage).frame(minHeight: 36)
                }
                .accessibilityIdentifier("people-\(k.rawValue)")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("People")
        .accessibilityIdentifier("people")
    }
}
