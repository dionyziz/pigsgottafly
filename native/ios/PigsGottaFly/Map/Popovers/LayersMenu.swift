import SwiftUI

/// The map's layers and base map (the website's MapLayerToggles in its layers popover), kept with the
/// flight; and the editing tips.
struct LayersMenu: View {
    var layers: MapLayers
    var counts: [String: Int]
    var airac: String
    var onChange: (MapLayers) -> Void
    @Binding var tips: Bool
    var editable: Bool
    /// PGF.lineStyles(): the legend samples' lines and areas.
    var lineStyles: [String: LineStyle] = [:]

    private struct Item {
        var key: WritableKeyPath<MapLayers, Bool>
        var label: String
        var id: String
        var count: String?
        /// What the layer draws, in the order the label names it.
        var legend: [LegendSample] = []
    }

    /// What the map draws that has no toggle of its own.
    private static let otherLegend: [LegendSample] = [.line("zoneG", "Class G zone"), .line("route", "Your route")]

    private static let groups: [(String, [Item])] = [
        (
            "Airspace",
            [
                Item(key: \.fir, label: "FIR boundary", id: "map-fir", legend: [.line("fir", "FIR boundary")]),
                Item(
                    key: \.tma, label: "TMA / MTMA", id: "map-tma",
                    legend: [.line("tma", "TMA"), .line("mtma", "MTMA")]),
                Item(
                    key: \.zones, label: "CTR / ATZ", id: "map-zones",
                    legend: [.line("ctr", "CTR"), .line("atz", "ATZ")]),
            ]
        ),
        (
            "Points and routes",
            [
                Item(
                    key: \.aerodromes, label: "Aerodromes", id: "map-aerodromes",
                    legend: [.symbol("pgf-ad-minor", "Aerodrome")]),
                Item(
                    key: \.vfrPoints, label: "VFR reporting points", id: "map-vfr-points",
                    legend: [
                        .symbol("pgf-vfr", "VFR reporting point (AIP)"),
                        .symbol("pgf-vfr-ofm", "VFR reporting point (openflightmaps)"),
                    ]),
                Item(
                    key: \.vfrRoutes, label: "VFR routes", id: "map-vfr-routes",
                    legend: [.line("vfrRoute", "VFR route")]),
                Item(
                    key: \.helRoutes, label: "Helicopter routes", id: "map-hel-routes",
                    legend: [.line("helRoute", "HEL ONLY VFR route")]),
                Item(
                    key: \.milRoutes, label: "Military routes", id: "map-mil-routes",
                    legend: [.line("milRoute", "MIL / JET ONLY VFR route")]),
                Item(
                    key: \.navaids, label: "Radio navaids", id: "map-navaids",
                    legend: [.symbol("pgf-nav-vordme", "VOR/DME"), .symbol("pgf-nav-ndb", "NDB")]),
                Item(
                    key: \.waypoints, label: "My waypoints", id: "map-waypoints",
                    legend: [.symbol("pgf-wpt", "My waypoint")]),
            ]
        ),
        (
            "Areas",
            [
                Item(
                    key: \.prd, label: "Prohibited, restricted, danger", id: "map-areas-prd", count: "prd",
                    legend: [
                        .area("prohibited", "Prohibited"), .area("restricted", "Restricted"),
                        .area("danger", "Danger"),
                    ]),
                Item(
                    key: \.mil, label: "Military training", id: "map-areas-mil", count: "mil",
                    legend: [.area("mil", "Military training")]),
                Item(
                    key: \.act, label: "Local flying", id: "map-areas-act", count: "act",
                    legend: [.area("act", "Local flying")]),
                Item(
                    key: \.notams, label: "NOTAM areas", id: "map-notams", count: "notams",
                    legend: [.area("notam", "NOTAM area")]),
            ]
        ),
        ("Overlay", [Item(key: \.ofm, label: "openflightmaps", id: "map-ofm")]),
    ]

    private static let bases = [("light", "Light"), ("terrain", "Terrain"), ("street", "Street")]

    var body: some View {
        NavigationStack {
            Form {
                Section("Base map") {
                    Picker("Base map", selection: binding(\.base)) {
                        ForEach(Self.bases, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("map-base")
                }
                ForEach(Self.groups, id: \.0) { title, items in
                    Section(title) {
                        ForEach(items, id: \.id) { it in
                            Toggle(isOn: binding(it.key)) {
                                HStack(spacing: 8) {
                                    Text(it.label)
                                    Spacer(minLength: 4)
                                    samples(it.legend)
                                    if let k = it.count, let n = counts[k], n > 0 {
                                        Text("\(n)").monospacedDigit().foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .accessibilityIdentifier(it.id)
                        }
                    }
                }
                Section {
                    HStack(spacing: 16) {
                        ForEach(Self.otherLegend, id: \.self) { s in
                            HStack(spacing: 6) {
                                samples([s])
                                Text(s.title).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityIdentifier("map-legend")
                }
                if editable {
                    Section {
                        Toggle("Editing tips", isOn: $tips).accessibilityIdentifier("map-tips")
                    } footer: {
                        Text("AIRAC \(airac)")
                    }
                }
            }
            .navigationTitle("Map layers")
            .navigationBarTitleDisplayMode(.inline)
        }
        .frame(minWidth: 320, idealWidth: 360, minHeight: 420, idealHeight: 640)
        .accessibilityIdentifier("map-layer-toggles")
    }

    private func samples(_ legend: [LegendSample]) -> some View {
        HStack(spacing: 2) {
            ForEach(legend, id: \.self) { s in
                if let img = Symbols.legendImage(s, styles: lineStyles) {
                    Image(uiImage: img)
                        .accessibilityLabel(s.title)
                        .accessibilityIdentifier("legend-\(s.id)")
                }
            }
        }
    }

    private func binding<T>(_ key: WritableKeyPath<MapLayers, T>) -> Binding<T> {
        Binding(
            get: { layers[keyPath: key] },
            set: {
                var l = layers
                l[keyPath: key] = $0
                onChange(l)
            })
    }
}
