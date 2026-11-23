import SwiftUI

/// One flight. iPhone: its own tab bar (Fly · Map · Plan · Brief · File); Fly is full screen, with no
/// tab bar and no navigation bar. iPad: the map fills the detail, Plan / Brief / File in an inspector
/// beside it, and Fly a toolbar button that takes the whole screen. Sections push from their stage.
struct FlightWorkspace: View {
    @StateObject private var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var navigator: Navigator
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @Environment(\.undoManager) private var undoManager
    /// Back to the flights (Fly's own control on iPhone; the navigation bar's back button elsewhere).
    private let close: (() -> Void)?

    /// nil until the flight is known: the first tab depends on its date and plan (FlightTab.initial).
    @State private var tab: FlightTab?
    @State private var path: [FlightSection] = []
    /// The field a Fix asked for (the website's ?focus=).
    @State private var focusField: String?
    /// A Fix that leads to a page of the website (the profile).
    @State private var link: WebPage?
    /// iPad: where leaving Fly goes back to.
    @State private var beforeFly: FlightTab = .plan
    @State private var sharing: ShareTarget?

    init(id: String, app: AppModel, close: (() -> Void)? = nil) {
        _model = StateObject(wrappedValue: FlightModel(id: id, app: app))
        self.close = close
    }

    private var regular: Bool { horizontalSize == .regular }

    var body: some View {
        Group {
            if regular { padLayout } else { phoneLayout }
        }
        .environment(\.focusRouter, router)
        .environment(\.flightFocus, focusField)
        .sheet(item: $link) { FixLinkView(url: $0.url) }
        .sheet(item: $sharing) { t in
            // leaving the flight: the website goes back to the flights
            ShareSheet(target: t) { close?() }
        }
        .onAppear { model.undoManager = undoManager }
        .onChange(of: undoManager) { _, u in model.undoManager = u }
        .task {
            chooseTab()
            await model.open()
            chooseTab()
        }
        .onChange(of: model.flight == nil) { _, _ in chooseTab() }
        .onChange(of: tab) { _, t in
            if let t { app.rememberTab(t, for: model.id) }
            guard regular else { return }
            if t == .fly {
                navigator.columns = .detailOnly
            } else {
                // a change in the same update as the split view's own layout pass is lost
                Task { @MainActor in navigator.columns = .all }
            }
        }
        .onDisappear { if navigator.columns == .detailOnly { navigator.columns = .all } }
        .alert(
            "Pig's Gotta Fly",
            isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.error ?? "")
        }
    }

    // MARK: tabs

    private var current: Binding<FlightTab> {
        Binding(get: { tab ?? .plan }, set: { tab = $0 })
    }

    /// `-tab <tab>` and `-section <section>` open there at launch (screenshots, tests).
    private func chooseTab() {
        guard tab == nil else { return }
        if let t = LaunchArgs.value("-tab").flatMap(FlightTab.init(rawValue:)) {
            tab = t
        } else if let t = app.rememberedTab(for: model.id) {
            tab = t
        } else if model.flight != nil {
            tab = FlightTab.initial(
                date: model.date, planned: model.planned, isNew: app.isNew(model.id), today: app.today)
        }
        if tab != nil, let s = LaunchArgs.value("-section").flatMap(FlightSection.init(rawValue:)) { open(s) }
    }

    private func open(_ section: FlightSection, focus: String? = nil) {
        focusField = focus
        tab = section.tab
        path = [section]
    }

    private var router: FocusRouter {
        FocusRouter(
            openSection: { s, f in open(s, focus: f) },
            openTab: { t in
                tab = t
                path = []
            },
            openLink: { link = WebPage(url: $0) },
            resolve: { [model] text in await model.focusTarget(text: text) })
    }

    /// A pushed section. The workspace's environment does not reach navigationDestination content (a
    /// NOTAM's "Show on map" and every Fix in a section did nothing), so it is handed on here.
    private func section(_ s: FlightSection) -> some View {
        FlightSectionView(section: s, model: model)
            .environment(\.focusRouter, router)
            .environment(\.flightFocus, focusField)
    }

    // MARK: iPhone

    private var phoneLayout: some View {
        NavigationStack(path: $path) {
            Group {
                if tab == nil {
                    ProgressView()
                } else {
                    phoneTabs
                }
            }
            .navigationTitle(model.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(tab == .fly ? .hidden : .visible, for: .navigationBar)
            .toolbar { flightToolbar }
            .navigationDestination(for: FlightSection.self) {
                section($0)
            }
        }
    }

    private var phoneTabs: some View {
        TabView(selection: current) {
            FlyView(model: model, tab: current, close: close) { open(.navlog) }
                .tabItem { tabLabel(.fly) }
                .tag(FlightTab.fly)
            MapTab(model: model)
                .tabItem { tabLabel(.map) }
                .tag(FlightTab.map)
            ForEach([FlightTab.plan, .brief, .file], id: \.self) { t in
                StageView(tab: t, model: model)
                    .tabItem { tabLabel(t) }
                    .tag(t)
            }
        }
    }

    private func tabLabel(_ t: FlightTab) -> some View {
        Label(t.title, systemImage: t.systemImage).accessibilityIdentifier(t.accessibilityID)
    }

    // MARK: iPad

    private var padLayout: some View {
        NavigationStack {
            Group {
                if tab == .fly {
                    FlyView(model: model, tab: current, close: { tab = beforeFly }, closeLabel: "Leave Fly") {
                        open(.navlog)
                    }
                } else {
                    MapTab(model: model)
                        .inspector(isPresented: inspectorShown) {
                            inspector.inspectorColumnWidth(min: 320, ideal: 400, max: 520)
                        }
                }
            }
            .navigationTitle(model.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(tab == .fly ? .hidden : .visible, for: .navigationBar)
            .toolbar {
                if tab != .fly {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            beforeFly = tab ?? .plan
                            tab = .fly
                        } label: {
                            Label("Fly", systemImage: "airplane")
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier(FlightTab.fly.accessibilityID)
                    }
                    flightToolbar
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            inspectorShown.wrappedValue.toggle()
                        } label: {
                            Image(systemName: "sidebar.trailing")
                        }
                        .accessibilityLabel("Plan, Brief and File")
                        .accessibilityIdentifier("toggle-inspector")
                    }
                }
            }
        }
    }

    /// The inspector is the stages: closing it leaves the map alone (the Map tab).
    private var inspectorShown: Binding<Bool> {
        Binding(
            get: { tab != nil && tab != .map && tab != .fly },
            set: { shown in
                if !shown {
                    tab = .map
                } else if tab == .map {
                    tab = .plan
                }
            })
    }

    private var inspector: some View {
        NavigationStack(path: $path) {
            StageView(tab: tab?.stage == nil ? .plan : current.wrappedValue, model: model)
                .safeAreaInset(edge: .top) { stagePicker }
                .navigationDestination(for: FlightSection.self) {
                    section($0)
                }
        }
    }

    private var stagePicker: some View {
        HStack(spacing: 6) {
            ForEach([FlightTab.plan, .brief, .file], id: \.self) { t in
                Button {
                    tab = t
                    path = []
                } label: {
                    Text(t.title).frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.bordered)
                .tint(tab == t ? .accentColor : .secondary)
                .accessibilityAddTraits(tab == t ? .isSelected : [])
                .accessibilityIdentifier(t.accessibilityID)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(.bar)
    }

    // MARK: toolbar

    /// The flight's share sheet, with the manifest's passengers that have an e-mail (the website's
    /// manifestContacts) offered as viewers.
    private func share() async {
        let passengers: JSON? = try? await app.api.passengers()
        let contacts = try? app.core?.shareSuggestions(
            crew: JSON.array(model.crew).text, passengers: (passengers ?? []).text, people: nil
        ).contacts
        sharing = ShareTarget(
            kind: .flight, id: model.id, name: model.title, passengers: contacts.map { Core.text($0) })
    }

    @ToolbarContentBuilder
    private var flightToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if model.flight != nil {
                Button {
                    Task { await share() }
                } label: {
                    Image(systemName: "person.2")
                }
                .accessibilityLabel("Share")
                .accessibilityIdentifier("share-flight")
            }
            if !model.readOnly {
                Button {
                    if undoManager?.canUndo == true { undoManager?.undo() }
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                }
                .accessibilityLabel("Undo")
                .accessibilityIdentifier("undo")
                Button {
                    if undoManager?.canRedo == true { undoManager?.redo() }
                } label: {
                    Image(systemName: "arrow.uturn.forward")
                }
                .accessibilityLabel("Redo")
                .accessibilityIdentifier("redo")
            }
            if model.loading || model.saving {
                ProgressView().accessibilityLabel(model.saving ? "Saving" : "Loading")
            } else if model.offline {
                Image(systemName: "wifi.slash").accessibilityLabel("Offline: showing the saved copy")
            }
        }
    }
}

/// A page of the website a Fix opens.
struct WebPage: Identifiable {
    var url: URL
    var id: String { url.absoluteString }
}

/// A stage of the flight: its readiness, then its sections.
struct StageView: View {
    var tab: FlightTab
    @ObservedObject var model: FlightModel

    /// The website's exportKinds: Form 731 declares passengers, so a PIC alone has none to file.
    private func shown(_ s: FlightSection) -> Bool {
        s != .form731 || model.crew.contains { $0["role"]?.string != "PIC" }
    }

    /// "View only · shared by Alice" on a flight shared with the pilot (the website's SharedFlightChip).
    private var sharedChip: String? {
        guard let access = model.flight?["access"], !access.isNull else { return nil }
        return try? model.app.core?.sharedChip(access: access.text, kind: "flight")
    }

    var body: some View {
        List {
            if let chip = sharedChip {
                Label(chip, systemImage: "person.2.fill")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityIdentifier("view-only-chip")
            }
            if let stage = tab.stage {
                ReadinessHeader(stage: stage, model: model)
            }
            Section {
                ForEach(FlightSection.of(tab).filter(shown)) { s in
                    NavigationLink(value: s) {
                        Label(s.title, systemImage: s.systemImage).frame(minHeight: 36)
                    }
                    .accessibilityIdentifier(s.rowID)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier(tab.bodyID)
    }
}
