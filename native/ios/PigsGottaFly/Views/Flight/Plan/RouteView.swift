import SwiftUI

/// Route (the website's RouteSection and the map's point edits): the origin and destination picked as
/// aerodromes, a local flight and its airborne time, and the points in order, reordered, inserted (a
/// place or a typed position), renamed and removed. Every change is one core route edit.
struct RouteView: View {
    @ObservedObject var model: FlightModel
    @State private var picking: EndPick?
    @State private var inserting: Insertion?
    @State private var renaming: Renaming?

    enum EndPick: String, Identifiable {
        case origin, destination
        var id: String { rawValue }
    }

    /// Where a new point goes: nil = where it lengthens the route least (a place), or where drawing
    /// adds one (a position).
    struct Insertion: Identifiable {
        var index: Int?
        var id: String { index.map(String.init) ?? "best" }
    }

    struct Renaming: Identifiable {
        var uid: String
        var name: String
        var id: String { uid }
    }

    private var route: [JSON] { model.route }
    private var from: JSON? { route.first }
    private var to: JSON? { route.count > 1 ? route.last : nil }

    var body: some View {
        let local = model.localFlight()
        let isLocal = local?.local ?? false
        List {
            if isLocal, let from {
                Section {
                    Text("Local flight · \(from["name"]?.string ?? "")")
                        .font(.headline)
                        .accessibilityIdentifier("route-local")
                    endRow("Origin", from, pick: .origin, id: "route-origin")
                    if let local { LocalDurationRow(model: model, minutes: local.durationOf, max: local.maxMin) }
                }
                if !model.readOnly {
                    Section {
                        Button {
                            picking = .destination
                        } label: {
                            Label("Fly somewhere instead", systemImage: "arrow.triangle.turn.up.right.diamond")
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("route-destination")
                    }
                }
            } else {
                Section {
                    endRow("Origin", from, pick: .origin, id: "route-origin")
                    if from == nil {
                        LabeledContent("Destination", value: "Set the origin first")
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("route-destination")
                    } else {
                        endRow("Destination", to, pick: .destination, id: "route-destination")
                    }
                    if canGoLocal, let name = from?["name"]?.string {
                        Button("Local flight from \(name)") { Task { await model.makeLocal() } }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("route-make-local")
                    }
                }
            }
            points
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(FlightSection.route.screenID)
        .sheet(item: $picking) { end in
            NavigationStack {
                PlaceSearchView(title: end == .origin ? "Origin" : "Destination", aerodromesOnly: true) { place in
                    Task { await model.setEnd(from: end == .origin, place) }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { picking = nil } }
                }
            }
        }
        .sheet(item: $inserting) { ins in
            InsertPointSheet(model: model, index: ins.index)
                .presentationDetents([.medium, .large])
        }
        .alert(
            "Rename",
            isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }),
            presenting: renaming
        ) { r in
            TextField("Name", text: Binding(get: { renaming?.name ?? r.name }, set: { renaming?.name = $0 }))
                .textInputAutocapitalization(.characters)
                .accessibilityIdentifier("route-rename-field")
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let name = model.cleanPointName(renaming?.name ?? r.name)
                guard !name.isEmpty else { return }
                Task { await model.renamePoint(uid: r.uid, name: name) }
            }
            .accessibilityIdentifier("route-rename-save")
        }
    }

    /// The website shows "Local flight from …" for a one- or two-point route from an aerodrome.
    private var canGoLocal: Bool {
        !model.readOnly && from?["kind"]?.string == "aerodrome" && route.count <= 2
    }

    private func endRow(_ label: String, _ point: JSON?, pick: EndPick, id: String) -> some View {
        Button {
            picking = pick
        } label: {
            LabeledContent(label) {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(point?["name"]?.string ?? "ICAO or name")
                        .foregroundStyle(point == nil ? .tertiary : .secondary)
                    if let point, point["kind"]?.string != "aerodrome" {
                        Text("Map point, not an aerodrome").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.readOnly)
        .accessibilityIdentifier(id)
    }

    @ViewBuilder
    private var points: some View {
        Section {
            ForEach(Array(route.enumerated()), id: \.element.uidKey) { i, p in
                pointRow(i, p)
            }
            .onMove { source, destination in
                Task { await model.movePoints(from: source, to: destination) }
            }
            .onDelete { offsets in
                guard let i = offsets.first, let uid = route[i]["uid"]?.string else { return }
                Task { await model.removePoint(uid: uid) }
            }
            .moveDisabled(model.readOnly)
            .deleteDisabled(model.readOnly || route.count <= 2)
            if !model.readOnly && !route.isEmpty {
                Button {
                    inserting = Insertion(index: nil)
                } label: {
                    Label("Add a point", systemImage: "plus.circle").frame(minHeight: 44)
                }
                .accessibilityIdentifier("route-add-point")
            }
        } header: {
            // here rather than in the navigation bar, whose first button must stay Back in iPad's inspector
            HStack {
                Text("Points")
                Spacer()
                if !model.readOnly && route.count > 1 {
                    EditButton().font(.subheadline).textCase(nil).accessibilityIdentifier("route-reorder")
                }
            }
        }
    }

    private func pointRow(_ i: Int, _ p: JSON) -> some View {
        let uid = p["uid"]?.string ?? ""
        return HStack {
            Text(p["name"]?.string ?? "Point").font(.body.weight(.medium))
            Spacer()
            Text(Self.kindLabel(p["kind"]?.string)).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(minHeight: 36)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("route-point-\(i)")
        .contextMenu {
            if !model.readOnly {
                Button {
                    renaming = Renaming(uid: uid, name: p["name"]?.string ?? "")
                } label: {
                    Label("Rename", systemImage: "pencil")
                }
                Button {
                    inserting = Insertion(index: i)
                } label: {
                    Label("Insert before", systemImage: "arrow.up.to.line")
                }
                Button {
                    inserting = Insertion(index: i + 1)
                } label: {
                    Label("Insert after", systemImage: "arrow.down.to.line")
                }
                if route.count > 2 {
                    Button(role: .destructive) {
                        Task { await model.removePoint(uid: uid) }
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
            }
        }
        .swipeActions(edge: .leading) {
            if !model.readOnly {
                Button {
                    renaming = Renaming(uid: uid, name: p["name"]?.string ?? "")
                } label: {
                    Label("Rename", systemImage: "pencil")
                }
                .tint(.indigo)
            }
        }
    }

    static func kindLabel(_ kind: String?) -> String {
        switch kind {
        case "aerodrome": "Aerodrome"
        case "vfr": "VFR point"
        case "waypoint": "My waypoint"
        case "navaid": "Navaid"
        default: "Position"
        }
    }
}

extension JSON {
    /// A route point's identity in a list (its uid).
    fileprivate var uidKey: String { self["uid"]?.string ?? text }
}

/// A point inserted: a place (aerodrome, VFR point, saved waypoint) or a typed position named as the
/// map names one (WP1, WP2, …).
struct InsertPointSheet: View {
    @ObservedObject var model: FlightModel
    /// nil: a place where it lengthens the route least, a position where drawing adds one.
    var index: Int?
    @Environment(\.dismiss) private var dismiss
    @State private var mode = Mode.place
    @State private var position = ""
    @State private var name = ""

    enum Mode: String, CaseIterable {
        case place = "Place"
        case position = "Position"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Kind", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .accessibilityIdentifier("insert-kind")
                switch mode {
                case .place:
                    PlaceSearchView(title: "Add a point", aerodromesOnly: false) { place in
                        Task {
                            if let index {
                                await model.insert(place.routePoint(), at: index)
                            } else {
                                await model.addPoint(place)
                            }
                        }
                    }
                case .position:
                    positionForm
                }
            }
            .navigationTitle("Add a point")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if mode == .position {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add", action: addPosition)
                            .disabled(parsed == nil || model.cleanPointName(name).isEmpty)
                            .accessibilityIdentifier("route-custom-add")
                    }
                }
            }
        }
        .onAppear { name = model.routeInfo()?.autoWaypointName ?? "WP1" }
    }

    private var parsed: CoreCoords.LatLon? { model.parsePosition(position) }

    private var positionForm: some View {
        Form {
            Section {
                TextField("37.9 23.75 or 3754N02345E", text: $position)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .accessibilityIdentifier("route-custom-position")
                TextField("Name", text: $name)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .accessibilityIdentifier("route-custom-name")
            } footer: {
                if let p = parsed {
                    Text(String(format: "%.5f, %.5f", p.lat, p.lon)).monospacedDigit()
                } else if !position.isEmpty {
                    Text("Not a position.").foregroundStyle(.orange)
                }
            }
        }
    }

    private func addPosition() {
        guard let p = parsed else { return }
        let n = model.cleanPointName(name)
        guard !n.isEmpty else { return }
        let point = FlightModel.customPoint(name: n, lat: p.lat, lon: p.lon)
        let at = index ?? model.routeInfo()?.drawIndex ?? model.route.count
        Task { await model.insert(point, at: at) }
        dismiss()
    }
}
