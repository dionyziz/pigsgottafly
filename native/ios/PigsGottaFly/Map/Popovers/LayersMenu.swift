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

    private struct Item {
        var key: WritableKeyPath<MapLayers, Bool>
        var label: String
        var id: String
        var count: String?
    }

    private static let groups: [(String, [Item])] = [
        (
            "Airspace",
            [
                Item(key: \.fir, label: "FIR boundary", id: "map-fir"),
                Item(key: \.tma, label: "TMA / MTMA", id: "map-tma"),
                Item(key: \.zones, label: "CTR / ATZ", id: "map-zones"),
            ]
        ),
        (
            "Points and routes",
            [
                Item(key: \.aerodromes, label: "Aerodromes", id: "map-aerodromes"),
                Item(key: \.vfrPoints, label: "VFR reporting points", id: "map-vfr-points"),
                Item(key: \.vfrRoutes, label: "VFR routes", id: "map-vfr-routes"),
                Item(key: \.navaids, label: "Radio navaids", id: "map-navaids"),
                Item(key: \.waypoints, label: "My waypoints", id: "map-waypoints"),
            ]
        ),
        (
            "Areas",
            [
                Item(key: \.prd, label: "Prohibited, restricted, danger", id: "map-areas-prd", count: "prd"),
                Item(key: \.mil, label: "Military training", id: "map-areas-mil", count: "mil"),
                Item(key: \.act, label: "Local flying", id: "map-areas-act", count: "act"),
                Item(key: \.notams, label: "NOTAM areas", id: "map-notams", count: "notams"),
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
                                HStack {
                                    Text(it.label)
                                    if let k = it.count, let n = counts[k], n > 0 {
                                        Text("\(n)").foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .accessibilityIdentifier(it.id)
                        }
                    }
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
