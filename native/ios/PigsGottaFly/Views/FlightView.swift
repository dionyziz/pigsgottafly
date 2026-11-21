import SwiftUI

/// A flight: Fly, Brief, Navlog.
struct FlightView: View {
    enum Tab: String, Hashable {
        case fly, brief, navlog
    }

    @StateObject private var model: FlightModel
    /// `-tab brief` opens on that tab (screenshots).
    @State private var tab: Tab = LaunchArgs.value("-tab").flatMap(Tab.init(rawValue:)) ?? .fly
    @State private var showWebsite = false

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
                Button {
                    showWebsite = true
                } label: {
                    Image(systemName: "safari")
                }
                .accessibilityLabel("Open in the website's editor")
                .accessibilityIdentifier("open-website")
            }
            ToolbarItem(placement: .topBarTrailing) {
                if model.loading || model.saving {
                    ProgressView().accessibilityLabel(model.saving ? "Saving" : "Loading")
                } else if model.offline {
                    Image(systemName: "wifi.slash").accessibilityLabel("Offline: showing the saved copy")
                }
            }
        }
        .sheet(isPresented: $showWebsite, onDismiss: { Task { await model.refresh() } }) {
            // the full editor (route drawing, manifest, W&B, filing and forms) on pigsgottafly.com
            SafariView(url: API.site.appendingPathComponent("flights/\(model.id)")).ignoresSafeArea()
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
