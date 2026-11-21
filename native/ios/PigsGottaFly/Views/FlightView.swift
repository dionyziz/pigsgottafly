import SwiftUI

/// A flight: Fly, Brief, Navlog.
struct FlightView: View {
    enum Tab: String, Hashable {
        case fly, brief, navlog
    }

    @StateObject private var model: FlightModel
    /// `-tab brief` opens on that tab (screenshots).
    @State private var tab: Tab = LaunchArgs.value("-tab").flatMap(Tab.init(rawValue:)) ?? .fly

    init(id: String, app: AppModel) {
        _model = StateObject(wrappedValue: FlightModel(id: id, app: app))
    }

    var body: some View {
        TabView(selection: $tab) {
            FlyView(model: model)
                .tabItem { Label("Fly", systemImage: "airplane") }
                .tag(Tab.fly)
            BriefView(model: model)
                .tabItem { Label("Brief", systemImage: "checklist") }
                .tag(Tab.brief)
            NavlogView(model: model)
                .tabItem { Label("Navlog", systemImage: "list.number") }
                .tag(Tab.navlog)
        }
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if model.loading || model.saving {
                    ProgressView().accessibilityLabel(model.saving ? "Saving" : "Loading")
                } else if model.offline {
                    Image(systemName: "wifi.slash").accessibilityLabel("Offline: showing the saved copy")
                }
            }
        }
        .task { await model.open() }
        .alert(
            "Pig's Gotta Fly",
            isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.error ?? "")
        }
    }
}
