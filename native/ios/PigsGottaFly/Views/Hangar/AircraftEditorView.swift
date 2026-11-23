import SwiftUI

/// One aircraft's sections, as the website's aircraft page groups them.
struct AircraftEditorView: View {
    @Environment(\.dismiss) private var dismiss
    var aircraftId: String
    var title: String
    @State private var sharing = false

    enum Section: String, CaseIterable, Identifiable {
        case identity, fplItems, speeds, fuel, massBalance, performance, compass, documents, photo, history
        var id: String { rawValue }

        var label: String {
            switch self {
            case .identity: "Identity"
            case .fplItems: "Flight plan items"
            case .speeds: "Speeds"
            case .fuel: "Fuel"
            case .massBalance: "Mass & balance"
            case .performance: "Performance"
            case .compass: "Compass cards"
            case .documents: "Documents"
            case .photo: "Photo"
            case .history: "History"
            }
        }

        var systemImage: String {
            switch self {
            case .identity: "number"
            case .fplItems: "doc.text"
            case .speeds: "speedometer"
            case .fuel: "fuelpump"
            case .massBalance: "scalemass"
            case .performance: "road.lanes"
            case .compass: "safari"
            case .documents: "doc.on.doc"
            case .photo: "photo"
            case .history: "clock.arrow.circlepath"
            }
        }
    }

    var body: some View {
        List {
            ForEach(Section.allCases) { s in
                NavigationLink {
                    destination(s)
                } label: {
                    Label(s.label, systemImage: s.systemImage).frame(minHeight: 36)
                }
                .accessibilityIdentifier("aircraft-section-\(s.rawValue)")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    sharing = true
                } label: {
                    Image(systemName: "person.2")
                }
                .accessibilityLabel("Share")
                .accessibilityIdentifier("share-aircraft")
            }
        }
        .sheet(isPresented: $sharing) {
            // leaving: the hangar list reads itself again (AppModel.hangarChanged) and this page goes
            ShareAircraftView(aircraftId: aircraftId, registration: title) { dismiss() }
        }
        .accessibilityIdentifier("aircraft-page")
    }

    @ViewBuilder
    private func destination(_ s: Section) -> some View {
        switch s {
        case .identity: IdentityView(aircraftId: aircraftId)
        case .fplItems: FplItemsView(aircraftId: aircraftId)
        case .speeds: SpeedsView(aircraftId: aircraftId)
        case .fuel: AircraftFuelView(aircraftId: aircraftId)
        case .massBalance: MassBalanceView(aircraftId: aircraftId)
        case .performance: PerformanceTablesView(aircraftId: aircraftId)
        case .compass: CompassView(aircraftId: aircraftId)
        case .documents: DocumentsView(aircraftId: aircraftId)
        case .photo: PhotoView(aircraftId: aircraftId)
        case .history: HistoryView(aircraftId: aircraftId)
        }
    }
}
