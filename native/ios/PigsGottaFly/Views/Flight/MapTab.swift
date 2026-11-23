import SwiftUI

/// The planning chart: the route over the flight's layers, edited as on the website's map (draw, snap,
/// drag, insert, custom points, a point's menu), the details of what is tapped, the layers menu and
/// zoom to the route. On iPad it is the workspace's main view: pointer hover shows what is under it
/// and a secondary click opens a point's menu.
struct MapTab: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @State private var editor: RouteEditor?

    var body: some View {
        Group {
            if let editor {
                RouteMapScreen(model: model, editor: editor, app: app)
            } else {
                Color(.systemBackground)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(FlightTab.map.bodyID)
        .task {
            if editor == nil { editor = RouteEditor(model: model, app: app) }
        }
    }
}

private struct RouteMapScreen: View {
    @ObservedObject var model: FlightModel
    @ObservedObject var editor: RouteEditor
    let app: AppModel
    @Environment(\.focusRouter) private var router
    @State private var layerGroups: [String: [String]] = [:]
    @State private var layersOpen = false
    @State private var link: WebPage?
    @State private var nameText = ""
    @State private var stopText = ""

    var body: some View {
        EditableChartMap(
            styleURL: model.styleURL, chartData: model.chartData, routeData: editor.routeData,
            drawData: editor.drawData, symbols: app.symbols, layers: editor.layers, layerGroups: layerGroups,
            home: editor.home, fitRequest: editor.fitRequest, editor: editor
        )
        .ignoresSafeArea(.container, edges: .horizontal)
        .overlay { anchors }
        .overlay(alignment: .topLeading) {
            // VoiceOver (and the tests) read the route the map shows, point by point
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel("Route")
                .accessibilityValue(editor.route.compactMap { $0["name"]?.string }.joined(separator: " "))
                .accessibilityIdentifier("map-route")
        }
        .overlay(alignment: .topLeading) { tipView }
        .overlay(alignment: .topTrailing) { tools.padding(12) }
        .overlay(alignment: .bottom) { hintView }
        .task {
            layerGroups = (try? app.core?.layerGroups()) ?? [:]
            await editor.start()
        }
        .onChange(of: model.flight) { _, _ in editor.flightChanged() }
        .onChange(of: model.chartData) { _, _ in editor.refreshLayers() }
        .onChange(of: editor.namePrompt?.id) { _, _ in nameText = editor.namePrompt?.value ?? "" }
        .onChange(of: editor.stopPrompt?.id) { _, _ in stopText = editor.stopPrompt?.value ?? "" }
        .alert(
            editor.namePrompt?.title ?? "", isPresented: Binding(get: { editor.namePrompt != nil }, set: { _ in })
        ) {
            TextField("Name", text: $nameText)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .accessibilityIdentifier("name-prompt")
            Button("OK") { editor.confirmName(nameText) }.accessibilityIdentifier("name-prompt-ok")
            Button("Cancel", role: .cancel) { editor.cancelName() }
        } message: {
            if editor.namePrompt?.invalid == true { Text("Letters, digits, spaces and . / _ -") }
        }
        .alert(
            editor.stopPrompt?.title ?? "", isPresented: Binding(get: { editor.stopPrompt != nil }, set: { _ in })
        ) {
            TextField("Minutes", text: $stopText).keyboardType(.numberPad).accessibilityIdentifier("stop-minutes")
            Button("OK") { Task { await editor.confirmStop(stopText) } }
            Button("Cancel", role: .cancel) { editor.stopPrompt = nil }
        }
        .alert(
            "Pig's Gotta Fly",
            isPresented: Binding(get: { editor.message != nil }, set: { if !$0 { editor.message = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(editor.message ?? "")
        }
        .sheet(item: $link) { SafariView(url: $0.url).ignoresSafeArea() }
    }

    // MARK: the menus beside a point

    /// The point menu and the details open beside the place they are about (a popover on iPad).
    private var anchors: some View {
        ZStack {
            Color.clear
                .frame(width: 1, height: 1)
                .confirmationDialog(
                    editor.menu.map { "\($0.value.name) · \($0.value.kindLabel)" } ?? "",
                    isPresented: Binding(get: { editor.menu != nil }, set: { if !$0 { editor.menu = nil } }),
                    titleVisibility: .visible, presenting: editor.menu?.value
                ) { m in
                    PointMenuActions(m: m, editor: editor) { link = WebPage(url: $0) }
                }
                .position(editor.menu?.at ?? .zero)
            Color.clear
                .frame(width: 1, height: 1)
                .popover(item: $editor.info) { a in
                    MapInfoView(info: a.value, open: { link = WebPage(url: $0) }) {
                        editor.info = nil
                        router.openSection(.notams, nil)
                    }
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationCompactAdaptation(.sheet)
                }
                .position(editor.info?.at ?? .zero)
        }
        .allowsHitTesting(false)
    }

    // MARK: the toolbar (MapToolbar, LayersControl)

    private var tools: some View {
        VStack(spacing: 0) {
            if !model.readOnly {
                tool(
                    model.route.isEmpty ? "Draw" : "Extend", "point.topleft.down.to.point.bottomright.curvepath",
                    id: "map-draw", active: editor.mode == .draw, help: "Draw the route"
                ) { editor.setMode(editor.mode == .draw ? .idle : .draw) }
                .disabled(editor.local)
                Divider().frame(width: 44)
                tool(
                    "Custom point", "mappin.and.ellipse", id: "map-custom", active: editor.mode == .custom,
                    help: "Place a custom named point"
                ) { editor.setMode(editor.mode == .custom ? .idle : .custom) }
                .disabled(editor.local)
                Divider().frame(width: 44)
            }
            tool("Zoom to the route", "arrow.up.left.and.arrow.down.right", id: "map-fit", help: "Zoom to the route") {
                editor.fit()
            }
            .disabled(editor.route.isEmpty)
            Divider().frame(width: 44)
            tool("Map layers", "square.3.layers.3d", id: "map-layers", active: layersOpen, help: "Map layers") {
                layersOpen.toggle()
            }
            .popover(isPresented: $layersOpen) {
                LayersMenu(
                    layers: editor.layers, counts: editor.counts, airac: editor.airac,
                    onChange: { l in Task { await editor.setLayers(l) } }, tips: $editor.tips,
                    editable: !model.readOnly
                )
                .presentationDetents([.medium, .large])
                .presentationCompactAdaptation(.sheet)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
    }

    private func tool(
        _ label: String, _ image: String, id: String, active: Bool = false, help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: image)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 44, height: 44)
                .foregroundStyle(active ? Color.white : Color.accentColor)
                .background(active ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 8))
                .padding(2)
        }
        .buttonStyle(.plain)
        .hoverEffect()
        .help(help)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    // MARK: the hint and the hover box

    @ViewBuilder private var hintView: some View {
        let text = editor.hint
        if editor.tips && !text.isEmpty {
            HStack(spacing: 8) {
                Text(text).font(.footnote).accessibilityIdentifier("map-hint")
                Button {
                    editor.tips = false
                } label: {
                    Image(systemName: "xmark").font(.caption.weight(.bold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide tips")
                .accessibilityIdentifier("map-hint-close")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
            .padding(.bottom, 16)
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder private var tipView: some View {
        if let t = editor.tip, editor.menu == nil, editor.namePrompt == nil {
            VStack(alignment: .leading, spacing: 2) {
                if let title = t.title { Text(title).font(.footnote.bold()) }
                ForEach(t.lines, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
            }
            .padding(8)
            .frame(maxWidth: 300, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            .offset(x: t.at.x + 16, y: t.at.y + 14)
            .allowsHitTesting(false)
            .accessibilityIdentifier("map-tip")
        }
    }
}
