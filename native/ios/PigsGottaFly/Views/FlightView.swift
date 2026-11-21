import SwiftUI

/// A flight: Fly, Brief, Navlog. Fly is full screen (no navigation bar, no tab bar): its own control
/// goes back to the flights and to the other tabs.
struct FlightView: View {
    enum Tab: String, Hashable {
        case fly, brief, navlog
    }

    @StateObject private var model: FlightModel
    /// Back to the flights (Fly's control; the navigation bar's back button on the other tabs).
    private let close: (() -> Void)?
    /// `-tab brief` opens on that tab (screenshots).
    @State private var tab: Tab = LaunchArgs.value("-tab").flatMap(Tab.init(rawValue:)) ?? .fly

    init(id: String, app: AppModel, close: (() -> Void)? = nil) {
        _model = StateObject(wrappedValue: FlightModel(id: id, app: app))
        self.close = close
    }

    var body: some View {
        TabView(selection: $tab) {
            FlyView(model: model, tab: $tab, close: close)
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
        .toolbar(tab == .fly ? .hidden : .visible, for: .navigationBar)
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
