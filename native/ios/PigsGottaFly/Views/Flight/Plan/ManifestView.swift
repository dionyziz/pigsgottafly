import SwiftUI

/// Manifest & loading (src/features/editor/panels/ManifestSection.tsx): the PIC and the passengers in
/// their seats with their weights, adding a passenger from the list or a new one, the baggage per
/// station, the category, and the W&B with its chart.
struct ManifestView: View {
    @ObservedObject var model: FlightModel
    @StateObject private var manifest: ManifestModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.flightFocus) private var focus
    @State private var adding = false
    @State private var detail: CrewDetail?

    init(model: FlightModel) {
        self.model = model
        _manifest = StateObject(wrappedValue: ManifestModel(flight: model))
    }

    struct CrewDetail: Identifiable, Equatable {
        var index: Int
        var id: Int { index }
    }

    var body: some View {
        let aircraft = manifest.aircraft
        let state = model.manifestState(aircraft: aircraft)
        let wb = model.wbSummary
        ScrollViewReader { proxy in
            Form {
                crewSection(state: state, aircraft: aircraft, wb: wb)
                if let aircraft { loadingSections(aircraft: aircraft, wb: wb) }
            }
            .accessibilityIdentifier(FlightSection.manifest.screenID)
            .onAppear {
                if focus == "baggage" { proxy.scrollTo("baggage", anchor: .top) }
            }
        }
        .task { await manifest.load() }
        .refreshable { await manifest.load() }
        .sheet(isPresented: $adding) {
            AddPassengerSheet(manifest: manifest, seats: state?.seats.count ?? 0)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $detail) { d in
            CrewDetailSheet(model: model, manifest: manifest, index: d.index)
        }
        .confirmationDialog(
            "Also stop sharing the flight with \(manifest.unshare?.name ?? "")?",
            isPresented: Binding(get: { manifest.unshare != nil }, set: { if !$0 { manifest.unshare = nil } }),
            titleVisibility: .visible, presenting: manifest.unshare
        ) { u in
            Button("Stop sharing", role: .destructive) { Task { await manifest.stopSharing(u) } }
                .accessibilityIdentifier("unshare-confirm")
            Button("Keep sharing", role: .cancel) {}
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(get: { manifest.error != nil }, set: { if !$0 { manifest.error = nil } })
        ) {
            Button("OK") {}
        } message: {
            Text(manifest.error ?? "")
        }
    }

    // MARK: crew

    @ViewBuilder
    private func crewSection(state: CoreManifest?, aircraft: JSON?, wb: WbSummary?) -> some View {
        let crew = model.crew
        let seats = state?.seats ?? []
        let hasPic = crew.contains { $0["role"]?.string == "PIC" }
        Section {
            ForEach(Array(crew.enumerated()), id: \.offset) { i, row in
                CrewRow(
                    row: row, seats: seats, used: Set(crew.compactMap { $0["seat"]?.string }),
                    linked: manifest.source(of: row) != nil, readOnly: model.readOnly,
                    onSeat: { s in Task { await manifest.changeSeat(i, to: s) } },
                    onWeight: { w in Task { await manifest.editField(i, .weightKg, w.map { .number($0) } ?? .null) } },
                    onDetails: { detail = CrewDetail(index: i) },
                    onReset: { Task { await manifest.reset(i) } },
                    onRemove: { Task { await manifest.remove(i) } })
            }
            if !hasPic {
                let fits =
                    manifest.pilot.flatMap { model.previewManifest(.addPic(pilot: $0), aircraft: aircraft) }?.ok
                    ?? false
                Button {
                    Task { await manifest.addPic() }
                } label: {
                    Label("Add me as PIC", systemImage: "plus")
                }
                .disabled(!fits || model.readOnly)
                .accessibilityIdentifier("add-pic")
                if !fits {
                    Text("Every seat is taken.").foregroundStyle(.secondary).accessibilityIdentifier("pic-full")
                }
            }
            if hasPic, let note = manifest.picNote {
                Text(note).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("pic-note")
            }
            let full = state?.full ?? false
            Button {
                adding = true
            } label: {
                Label(full ? "All \(seats.count) seats taken" : "Add passenger…", systemImage: "person.badge.plus")
            }
            .disabled(full || model.readOnly)
            .accessibilityIdentifier("pax-search")
            ForEach(state?.errors ?? [], id: \.self) { e in
                Label(e, systemImage: "xmark.octagon.fill")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("crew-error")
            }
        } header: {
            HStack(spacing: 6) {
                Text("People")
                Spacer()
                Text("\(crew.count) POB").accessibilityIdentifier("manifest-pob")
                if !(state?.errors.isEmpty ?? true) { Chip(text: "Check", color: .red) }
                if let status = wb?.status { Chip(wb: status) }
            }
        }
    }

    // MARK: loading

    @ViewBuilder
    private func loadingSections(aircraft: JSON, wb: WbSummary?) -> some View {
        let mb = aircraft["massBalance"]
        let bags = (mb?["stations"]?.array ?? []).filter { $0["kind"]?.string == "baggage" }
        let baggage = model.flight?["baggageKg"]?.object ?? [:]
        let category = model.flight?["options"]?["category"]?.string ?? "normal"
        if !bags.isEmpty || !(wb?.loadBreaches.isEmpty ?? true) {
            Section("Baggage") {
                ForEach(Array(bags.enumerated()), id: \.offset) { _, s in
                    let id = s["id"]?.string ?? ""
                    BaggageRow(
                        name: s["name"]?.string ?? id, id: id, kg: baggage[id]?.double, maxKg: s["maxKg"]?.double,
                        readOnly: model.readOnly
                    ) { v in Task { await model.setBaggage(station: id, kg: v) } }
                }
                ForEach(wb?.loadBreaches ?? [], id: \.self) { b in
                    Label(b, systemImage: "xmark.octagon.fill")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("wb-load-breach")
                }
            }
            .id("baggage")
        }
        if mb?["envelopes"]?["utility"].map({ $0 != .null }) ?? false {
            Section("Category") {
                Picker(
                    "Category",
                    selection: Binding(get: { category }, set: { c in Task { await model.setCategory(c) } })
                ) {
                    Text("Normal").tag("normal")
                    Text("Utility").tag("utility")
                }
                .pickerStyle(.segmented)
                .disabled(model.readOnly)
                .accessibilityIdentifier("wb-category")
            }
        }
        if let wb {
            Section("Weight & balance") {
                let values = WbValues(
                    wb: wb, peopleKg: model.crew.reduce(0) { $0 + ($1["snapshot"]?["weightKg"]?.double ?? 0) },
                    mtowKg: mb?["mtowKg"]?.double)
                let markers =
                    [WbChartView.Marker(id: "takeoff", label: "TO", point: wb.takeoff, ok: wb.takeoffOk)]
                    + wb.stops.map {
                        WbChartView.Marker(id: $0.id, label: $0.label, point: $0.point, ok: $0.ok != false)
                    }
                    + [WbChartView.Marker(id: "landing", label: "LDG", point: wb.landing, ok: wb.landingOk)]
                let chart = model.wbChart(aircraft: aircraft, points: markers.map(\.point))
                if sizeClass == .regular {
                    HStack(alignment: .top, spacing: 24) {
                        values.frame(maxWidth: 340)
                        if let chart { WbChartView(chart: chart, category: category, markers: markers) }
                    }
                    .padding(.vertical, 6)
                } else {
                    values
                    if let chart {
                        WbChartView(chart: chart, category: category, markers: markers).padding(.vertical, 6)
                    }
                }
            }
        }
    }
}

/// A tag in the section's header (the website's Chip).
private struct Chip: View {
    var text: String
    var color: Color

    init(text: String, color: Color) {
        self.text = text
        self.color = color
    }

    init(wb: WbSummary.Status) {
        switch wb {
        case .out: self.init(text: "W&B out", color: .red)
        case .incomplete: self.init(text: "W&B incomplete", color: .orange)
        case .ok: self.init(text: "W&B ok", color: .green)
        }
    }

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .textCase(nil)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.15), in: Capsule())
            .accessibilityIdentifier("manifest-chip")
    }
}

/// One person on the manifest: role, name, seat and weight; swipe or long-press for the rest.
private struct CrewRow: View {
    var row: JSON
    var seats: [CoreManifest.Seat]
    var used: Set<String>
    var linked: Bool
    var readOnly: Bool
    var onSeat: (String) -> Void
    var onWeight: (Double?) -> Void
    var onDetails: () -> Void
    var onReset: () -> Void
    var onRemove: () -> Void

    private var role: String { row["role"]?.string ?? "PAX" }
    private var name: String { row["snapshot"]?["fullName"]?.string ?? "" }
    private var seat: String { row["seat"]?.string ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(role)
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .foregroundStyle(role == "PIC" ? Color.white : Color.primary)
                    .background(role == "PIC" ? Color.accentColor : Color.secondary.opacity(0.2), in: Capsule())
                Button(action: onDetails) {
                    HStack {
                        if name.isEmpty {
                            Text(role == "PIC" ? "Your name is not set" : "No name").foregroundStyle(.orange)
                        } else {
                            Text(name).foregroundStyle(.primary).lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(role == "PIC" ? "pic-edit" : "pax-edit")
            }
            HStack {
                Picker("Seat", selection: Binding(get: { seat }, set: onSeat)) {
                    if !seats.contains(where: { $0.id == seat }) {
                        Text("\(seat) (not on this aircraft)").tag(seat)
                    }
                    ForEach(seats) { s in
                        Text(used.contains(s.id) && s.id != seat ? "\(s.label) (swap)" : s.label).tag(s.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .accessibilityLabel("Seat of \(name)")
                .accessibilityIdentifier("crew-seat")
                Spacer()
                WeightField(
                    value: row["snapshot"]?["weightKg"]?.double, range: 1...300, label: "Weight of \(name)",
                    id: "crew-weight", onCommit: onWeight)
            }
            .disabled(readOnly)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crew-\(role.lowercased())")
        .swipeActions(edge: .trailing) {
            if role == "PAX" && !readOnly {
                Button(role: .destructive, action: onRemove) { Label("Remove", systemImage: "trash") }
                    .accessibilityIdentifier("crew-remove")
            }
            if linked && !readOnly {
                Button(action: onReset) { Label("Reset", systemImage: "arrow.counterclockwise") }
                    .tint(.blue)
                    .accessibilityIdentifier("crew-reset")
            }
        }
        .contextMenu {
            Button(action: onDetails) { Label("Details", systemImage: "person.text.rectangle") }
            if linked && !readOnly {
                Button(action: onReset) {
                    Label(
                        role == "PIC" ? "Reset from my profile" : "Reset from the passenger list",
                        systemImage: "arrow.counterclockwise")
                }
            }
            if role == "PAX" && !readOnly {
                Button(role: .destructive, action: onRemove) {
                    Label("Remove from the manifest", systemImage: "trash")
                }
            }
        }
    }
}

/// A weight in kg, saved when typing ends; a value outside `range` goes back to the saved one (the
/// website's NumberField min/max).
struct WeightField: View {
    var value: Double?
    var range: ClosedRange<Double>
    var label: String
    var id: String
    var placeholder = "kg"
    var onCommit: (Double?) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 4) {
            TextField(placeholder, text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 64)
                .focused($focused)
                .onSubmit(commit)
                .accessibilityLabel(label)
                .accessibilityIdentifier(id)
            Text("kg").foregroundStyle(.secondary)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .overlay {
            if value == nil && range.lowerBound > 0 {
                RoundedRectangle(cornerRadius: 6).stroke(Color.orange, lineWidth: 1)
            }
        }
        .onAppear { text = Self.format(value) }
        .onChange(of: value) { _, v in if !focused { text = Self.format(v) } }
        .onChange(of: focused) { _, f in if !f { commit() } }
        .toolbar {
            if focused {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focused = false }
                }
            }
        }
    }

    private func commit() {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let v: Double? = t.isEmpty ? nil : Double(t)
        guard t.isEmpty || (v.map { range.contains($0) } ?? false) else {
            text = Self.format(value)
            return
        }
        if v != value { onCommit(v) }
    }

    static func format(_ v: Double?) -> String {
        guard let v else { return "" }
        return v == v.rounded() ? String(Int(v)) : String(v)
    }
}

/// A baggage station: the load, and its placard limit in red when over it. The limit is not the
/// field's maximum: an over-limit load is kept as typed and flagged by the W&B (500 kg is a typo guard).
private struct BaggageRow: View {
    var name: String
    var id: String
    var kg: Double?
    var maxKg: Double?
    var readOnly: Bool
    var onCommit: (Double?) -> Void

    var body: some View {
        LabeledContent {
            HStack(spacing: 6) {
                WeightField(
                    value: kg, range: 0...500, label: name, id: "bag-\(id)", placeholder: "0", onCommit: onCommit)
                if let maxKg, maxKg > 0 {
                    Text("max \(WeightField.format(maxKg))")
                        .font(.footnote)
                        .foregroundStyle((kg ?? 0) > maxKg ? Color.red : Color.secondary)
                        .accessibilityIdentifier("bag-\(id)-limit")
                }
            }
        } label: {
            Text(name)
        }
        .disabled(readOnly)
    }
}

/// People, fuel, take-off, the stops, landing and the MTOW margin (the website's W&B key values).
private struct WbValues: View {
    var wb: WbSummary
    var peopleKg: Double
    var mtowKg: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            value(
                "People", "\(Int(peopleKg.rounded())) kg", tone: wb.missingWeights.isEmpty ? nil : .orange,
                sub: wb.missingWeights.isEmpty ? nil : "weight missing: \(wb.missingWeights.joined(separator: ", "))",
                id: wb.missingWeights.isEmpty ? "wb-people" : "wb-missing")
            value("Fuel at take-off", wb.fobL.map { "\(WeightField.format($0)) L" } ?? Fmt.dash)
            value(
                "Take-off", Self.kg(wb.takeoff.massKg), tone: wb.takeoffOk ? nil : .red,
                sub: "CG \(Self.arm(wb.takeoff.armM))", id: "wb-takeoff")
            ForEach(wb.stops) { s in
                value(
                    s.title, Self.kg(s.point.massKg), tone: s.ok == false ? .red : nil,
                    sub: "CG \(Self.arm(s.point.armM))\(s.fuelL.map { " · \(WeightField.format($0)) L" } ?? "")",
                    id: "wb-stop")
            }
            value(
                "Landing", Self.kg(wb.landing.massKg), tone: wb.landingOk ? nil : .red,
                sub: "CG \(Self.arm(wb.landing.armM))", id: "wb-landing")
            if let mtowKg {
                let spare = mtowKg - wb.takeoff.massKg
                value(
                    "MTOW", "\(WeightField.format(mtowKg)) kg", sub: "\(String(format: "%.1f", spare)) kg spare",
                    subTone: spare < 0 ? .red : nil)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("wb-summary")
    }

    static func kg(_ v: Double) -> String { String(format: "%.1f kg", v) }
    static func arm(_ v: Double) -> String { String(format: "%.3f m", v) }

    private func value(
        _ label: String, _ v: String, tone: Color? = nil, sub: String? = nil, subTone: Color? = nil, id: String? = nil
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(tone ?? .primary)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(v).monospacedDigit().foregroundStyle(tone ?? .primary)
                if let sub {
                    Text(sub)
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(subTone ?? tone ?? .secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id ?? label)
    }
}
