import SwiftUI

/// Navlog: the legs as a list and the totals; quick edits of the date, the block-off time and a leg's
/// altitude (saved at once with the flight's version).
struct NavlogView: View {
    @ObservedObject var model: FlightModel
    @State private var editing: Edit?
    @State private var addingPoint = false

    enum Edit: Identifiable {
        case date, blockOff
        case altitude(NavRow)
        var id: String {
            switch self {
            case .date: "date"
            case .blockOff: "blockOff"
            case .altitude(let r): "alt-\(r.index)"
            }
        }
    }

    var body: some View {
        List {
            Section("Flight") {
                editRow("Date", Fmt.day(model.date), id: "edit-date") { editing = .date }
                editRow("Block off", model.blockOff.isEmpty ? "Not set" : "\(model.blockOff)Z", id: "edit-blockoff") {
                    editing = .blockOff
                }
            }
            Section {
                if let rows = model.computed?.rows, !rows.isEmpty {
                    ForEach(rows) { row in
                        Button {
                            editing = .altitude(row)
                        } label: {
                            LegRow(row: row).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(model.readOnly)
                        .accessibilityIdentifier("leg-\(row.index)")
                        .accessibilityHint(model.readOnly ? "" : "Changes the leg's altitude")
                    }
                } else {
                    Text(model.computed == nil ? "Preparing…" : "No legs: the route has one point.")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Legs")
            }
            route
            if let c = model.computed {
                Section("Totals") {
                    ValueRow(label: "Distance", value: Fmt.distance(c.totalDistNm))
                    ValueRow(label: "Time en route", value: Fmt.duration(c.totalEteMin))
                    ValueRow(label: "Trip fuel", value: Fmt.litres(c.tripFuelL))
                    ValueRow(label: "Fuel with the allowance", value: Fmt.litres(c.totalFuelL))
                    ValueRow(label: "Take-off", value: c.takeoff.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Landing", value: c.landing.map { "\($0)Z" } ?? Fmt.dash)
                }
                if !c.warnings.isEmpty {
                    Section("Warnings") {
                        ForEach(c.warnings, id: \.self) { w in
                            Label(w, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier("navlog")
        .sheet(item: $editing) { edit in
            EditSheet(edit: edit, model: model)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $addingPoint) {
            NavigationStack {
                PlaceSearchView(title: "Add a point", aerodromesOnly: false) { place in
                    Task { await model.addPoint(place) }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { addingPoint = false } }
                }
            }
        }
    }

    /// The route's points: one is added where it lengthens the route least; any point can be removed
    /// (swipe) while two are left. Drawing the route is the website's.
    @ViewBuilder
    private var route: some View {
        let points = model.route
        if !points.isEmpty {
            Section {
                ForEach(Array(points.enumerated()), id: \.offset) { i, p in
                    HStack {
                        Text(p["name"]?.string ?? "Point").font(.body.weight(.medium))
                        Spacer()
                        Text(kindLabel(p["kind"]?.string)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 36)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("route-point-\(i)")
                    .deleteDisabled(model.readOnly || points.count <= 2)
                }
                .onDelete { offsets in
                    guard let i = offsets.first, let uid = points[i]["uid"]?.string else { return }
                    Task { await model.removePoint(uid: uid) }
                }
                if !model.readOnly {
                    Button {
                        addingPoint = true
                    } label: {
                        Label("Add a point", systemImage: "plus.circle").frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("add-point")
                }
            } header: {
                Text("Route")
            } footer: {
                if !model.readOnly && points.count > 2 { Text("Swipe a point to remove it.") }
            }
        }
    }

    private func kindLabel(_ kind: String?) -> String {
        switch kind {
        case "aerodrome": "Aerodrome"
        case "vfr": "VFR point"
        case "waypoint": "My waypoint"
        default: "Point"
        }
    }

    private func editRow(_ label: String, _ value: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(.primary)
                Spacer()
                Text(value).monospacedDigit().foregroundStyle(.secondary)
                if !model.readOnly { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.readOnly)
        .accessibilityIdentifier(id)
    }
}

struct LegRow: View {
    var row: NavRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(row.from) → \(row.to)").font(.headline).foregroundStyle(.primary)
                Spacer()
                Text(Fmt.altitude(row.altFt)).font(.headline.monospacedDigit()).foregroundStyle(.tint)
            }
            HStack(spacing: 0) {
                figure("HDG", Fmt.degrees(row.heading))
                figure("DIST", Fmt.distance(row.distNm))
                figure("ETE", Fmt.duration(row.eteMin))
                figure("ETA", row.endMin.map { "\(Fmt.clock(minutes: $0))Z" } ?? Fmt.dash)
                figure("FUEL", Fmt.litres(row.fuelL))
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func figure(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.subheadline.monospacedDigit()).foregroundStyle(.primary).lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One quick edit, saved with "Save".
struct EditSheet: View {
    var edit: NavlogView.Edit
    @ObservedObject var model: FlightModel
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var feet = 3500

    private static let utc = TimeZone(identifier: "UTC")!

    var body: some View {
        NavigationStack {
            Form {
                switch edit {
                case .date:
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                case .blockOff:
                    DatePicker("Block off (UTC)", selection: $date, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.wheel)
                case .altitude(let row):
                    Section("\(row.from) → \(row.to)") {
                        Stepper(value: $feet, in: 500...18000, step: 500) {
                            Text("\(feet) ft").font(.title2.monospacedDigit().bold())
                        }
                        .accessibilityIdentifier("altitude-stepper")
                        TextField("Feet", value: $feet, format: .number.grouping(.never))
                            .keyboardType(.numberPad)
                            .font(.title3.monospacedDigit())
                    }
                }
            }
            .environment(\.timeZone, Self.utc)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        dismiss()
                    }
                    .accessibilityIdentifier("save-edit")
                }
            }
        }
        .onAppear(perform: load)
    }

    private var title: String {
        switch edit {
        case .date: "Date"
        case .blockOff: "Block off"
        case .altitude: "Altitude"
        }
    }

    private func load() {
        switch edit {
        case .date, .blockOff:
            date = Fmt.date(day: model.date, clock: model.blockOff.isEmpty ? "12:00" : model.blockOff)
        case .altitude(let row):
            feet = Int(row.altFt ?? 3500)
        }
    }

    private func save() {
        switch edit {
        case .date:
            let day = Fmt.isoDay(from: date)
            Task { await model.setDate(day) }
        case .blockOff:
            let clock = Fmt.clock(date)
            Task { await model.setBlockOff(clock) }
        case .altitude(let row):
            let f = feet
            Task { await model.setAltitude(legKey: row.key, feet: f) }
        }
    }
}
