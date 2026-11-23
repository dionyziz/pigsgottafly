import SwiftUI

/// Navlog: the legs with the website's navlog figures (src/features/editor/panels/NavlogStrip.tsx: TAS,
/// TC, MC, wind, temperature, WCA, MH, deviation, CH, GS, distance, ETE, ETA, fuel), each leg's own
/// warnings under it and the totals. Quick edits of the date, the block-off time, and a leg's altitude,
/// TAS, wind and temperature typed over the computed ones (reset goes back to them), saved at once with
/// the flight's version. Winds and METAR can be fetched again by hand. A local flight has no legs: its
/// duration stands in their place.
struct NavlogView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.focusRouter) private var focusRouter
    @State private var editing: Edit?
    @State private var addingPoint = false
    @State private var refreshing = false

    enum Edit: Identifiable {
        case date, blockOff
        case duration(Double)
        case leg(NavRow, LegFigures?)
        var id: String {
            switch self {
            case .date: "date"
            case .blockOff: "blockOff"
            case .duration: "duration"
            case .leg(let r, _): "leg-\(r.index)"
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
            if let local = model.computed?.local {
                Section {
                    Text(local.title).font(.headline).accessibilityIdentifier("local-flight")
                    editRow("Duration", Fmt.hoursMinutes(local.durationMin), id: "edit-duration") {
                        editing = .duration(local.durationMin)
                    }
                } header: {
                    Text("Local flight")
                } footer: {
                    Text("Add a point to plan a route with legs instead.")
                }
            } else {
                legs
            }
            route
            if let c = model.computed {
                Section("Totals") {
                    if c.local == nil {
                        ValueRow(label: "Distance", value: Fmt.distance(c.totalDistNm))
                        ValueRow(label: "Time en route", value: Fmt.duration(c.totalEteMin))
                    } else {
                        ValueRow(label: "Duration", value: Fmt.duration(c.totalEteMin))
                    }
                    ValueRow(label: "Trip fuel", value: Fmt.litres(c.tripFuelL))
                    ValueRow(label: "Fuel with the allowance", value: Fmt.litres(c.totalFuelL))
                    ValueRow(label: "Fuel on board", value: Fmt.litres(c.fobL))
                    ValueRow(label: "Fuel at landing", value: Fmt.litres(c.landingFuelL))
                    ValueRow(label: "Take-off", value: c.takeoff.map { "\($0)Z" } ?? Fmt.dash)
                    ValueRow(label: "Landing", value: c.landing.map { "\($0)Z" } ?? Fmt.dash)
                }
                let general = LegWarning.general(c.raw)
                if !general.isEmpty {
                    Section("Warnings") {
                        ForEach(general) { w in LegWarningRow(warning: w, text: w.text) }
                    }
                    .accessibilityIdentifier("navlog-warnings")
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(FlightSection.navlog.screenID)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await refreshWeather() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(refreshing || (model.computed?.rows.isEmpty ?? true))
                .accessibilityLabel("Refresh winds and METAR")
                .accessibilityIdentifier("refresh-weather")
                Button {
                    focusRouter.openSection(.navlogExport, nil)
                } label: {
                    Image(systemName: "printer")
                }
                .accessibilityLabel("Print the navlog")
                .accessibilityIdentifier("print-navlog")
            }
        }
        .sheet(item: $editing) { edit in
            EditSheet(edit: edit, model: model)
                .presentationDetents(edit.isLeg ? [.large] : [.medium, .large])
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

    private var legs: some View {
        Section {
            if let c = model.computed, !c.rows.isEmpty {
                let figures = LegFigures.all(c.raw)
                let byLeg = LegWarning.byLeg(c.raw)
                ForEach(c.rows) { row in
                    let f = figures.indices.contains(row.index) ? figures[row.index] : nil
                    Button {
                        editing = .leg(row, f)
                    } label: {
                        LegRow(row: row, figures: f, overrides: overrides(row.key)).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.readOnly)
                    .accessibilityIdentifier("leg-\(row.index)")
                    .accessibilityHint(model.readOnly ? "" : "Changes the leg's altitude, TAS, wind and temperature")
                    ForEach(byLeg[row.index] ?? []) { w in
                        LegWarningRow(warning: w, text: w.detail ?? w.text)
                            .accessibilityIdentifier("navlog-leg-warnings")
                    }
                }
            } else {
                Text(model.computed == nil ? "Preparing…" : "No legs: the route has one point.")
                    .foregroundStyle(.secondary)
            }
        } header: {
            HStack {
                Text("Legs")
                Spacer()
                if let w = windsStatus {
                    Text(w.text).foregroundStyle(w.warn ? .orange : .secondary).textCase(nil)
                        .accessibilityIdentifier("winds-status")
                }
            }
        } footer: {
            if let c = model.computed, !c.hasNavlog, !c.rows.isEmpty {
                Text("Headings, times and fuel need the flight's aircraft.")
            } else if let c = model.computed, c.hasNavlog, c.raw["times"]?["blockOffSet"]?.bool == false,
                !model.readOnly
            {
                Button("Block start not set: 12:00Z assumed") { editing = .blockOff }
                    .font(.footnote)
                    .accessibilityIdentifier("navlog-blockoff-fix")
            }
        }
    }

    /// The winds aloft when they are not simply there (NavlogStrip windsStatusText).
    private var windsStatus: (text: String, warn: Bool)? {
        if refreshing { return ("Fetching winds…", false) }
        guard let c = model.computed, !c.rows.isEmpty else { return nil }
        guard let winds = c.raw["weather"]?["winds"] else { return ("No winds", false) }
        return winds["status"]?.string == "ok" ? nil : ("No winds", true)
    }

    private func overrides(_ key: String) -> JSON? { model.flight?["legOverrides"]?[key] }

    private func refreshWeather() async {
        refreshing = true
        defer { refreshing = false }
        await model.fetchWeather()
        await model.recompute()
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

extension NavlogView.Edit {
    var isLeg: Bool {
        if case .leg = self { return true }
        return false
    }
}

/// A navlog row's figures beyond NavRow's (computeFlight's navlog.legs[i], src/calc NavlogLeg).
struct LegFigures: Equatable {
    var tasKt: Double?
    var tc: Double?
    var mc: Double?
    var windDirDeg: Double?
    var windKt: Double?
    /// 'forecast' | 'override' | 'none'
    var windSource: String
    var windMissing: Bool
    var tempC: Double?
    var wca: Double?
    var dev: Double?
    var ch: Double?
    var gs: Double?
    /// The leg's altitude without the pilot's (the pattern, the hemispheric rule…).
    var defaultAltFt: Double?

    static func all(_ computed: JSON) -> [LegFigures] {
        let legs = computed["legs"]?.array ?? []
        return (computed["navlog"]?["legs"]?.array ?? []).enumerated().map { n, l in
            let i = l["index"]?.int ?? n
            let leg: JSON? = legs.indices.contains(i) ? legs[i] : nil
            return LegFigures(
                tasKt: l["tasKt"]?.double, tc: l["tc"]?.double, mc: l["mc"]?.double,
                windDirDeg: l["windDirDeg"]?.double, windKt: l["windKt"]?.double,
                windSource: l["windSource"]?.string ?? "none", windMissing: l["windMissing"]?.bool ?? false,
                tempC: l["tempC"]?.double, wca: l["wca"]?.double, dev: l["dev"]?.double,
                ch: l["ch"]?.double ?? l["mh"]?.double, gs: l["gs"]?.double,
                defaultAltFt: leg?["altSource"]?.string == "override" ? nil : leg?["altFt"]?.double)
        }
    }

    /// '240/12'; '—' without a forecast (calm assumed); '*' when typed by hand.
    var wind: String {
        guard !windMissing, let d = windDirDeg, let k = windKt else { return "—" }
        return "\(Fmt.degrees(d).dropLast())/\(Int(k.rounded()))" + (windSource == "override" ? "*" : "")
    }

    /// '+2', '−5', '0' as the website's navlog writes WCA and deviation.
    static func signed(_ x: Double?) -> String {
        guard let x, x.isFinite else { return Fmt.dash }
        let v = Int(x.rounded())
        return v > 0 ? "+\(v)" : v < 0 ? "−\(-v)" : "0"
    }
}

/// A warning of the flight's (computeFlight's warnings: CalcWarning), by leg when it is about one.
struct LegWarning: Identifiable, Equatable {
    var id: String { "\(leg ?? -1)|\(text)" }
    var level: String
    var text: String
    var leg: Int?
    /// The text without the leg's 'A → B: ', shown under its row.
    var detail: String?

    /// Danger first, then warn, then info (NavlogStrip byLevel).
    static func all(_ computed: JSON) -> [LegWarning] {
        let order = ["danger": 0, "warn": 1, "info": 2]
        let list = (computed["warnings"]?.array ?? []).compactMap { w -> LegWarning? in
            guard let text = w["text"]?.string else { return nil }
            return LegWarning(
                level: w["level"]?.string ?? "warn", text: text, leg: w["leg"]?["index"]?.int,
                detail: w["leg"]?["detail"]?.string)
        }
        return list.enumerated().sorted { a, b in
            let x = order[a.element.level] ?? 3
            let y = order[b.element.level] ?? 3
            return x != y ? x < y : a.offset < b.offset
        }
        .map(\.element)
    }

    private static func ofLeg(_ w: LegWarning, legs: Int) -> Bool {
        guard let i = w.leg else { return false }
        return i >= 0 && i < legs
    }

    static func general(_ computed: JSON) -> [LegWarning] {
        let legs = computed["legs"]?.array?.count ?? 0
        return all(computed).filter { !ofLeg($0, legs: legs) }
    }

    static func byLeg(_ computed: JSON) -> [Int: [LegWarning]] {
        let legs = computed["legs"]?.array?.count ?? 0
        return Dictionary(grouping: all(computed).filter { ofLeg($0, legs: legs) }) { $0.leg ?? 0 }
    }
}

struct LegWarningRow: View {
    var warning: LegWarning
    var text: String

    var body: some View {
        Label(text, systemImage: warning.level == "info" ? "info.circle" : "exclamationmark.triangle.fill")
            .font(.footnote)
            .foregroundStyle(warning.level == "danger" ? .red : warning.level == "warn" ? .orange : .secondary)
    }
}

struct LegRow: View {
    var row: NavRow
    var figures: LegFigures?
    var overrides: JSON?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(row.from) → \(row.to)").font(.headline).foregroundStyle(.primary)
                Spacer()
                Text(Fmt.altitude(row.altFt)).font(.headline.monospacedDigit())
                    .foregroundStyle(overrides?["altFt"] != nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
            }
            HStack(spacing: 0) {
                figure("MH", Fmt.degrees(row.heading))
                figure("DIST", Fmt.distance(row.distNm))
                figure("ETE", Fmt.duration(row.eteMin))
                figure("ETA", row.endMin.map { "\(Fmt.clock(minutes: $0))Z" } ?? Fmt.dash)
                figure("FUEL", Fmt.litres(row.fuelL))
            }
            if let f = figures {
                HStack(spacing: 0) {
                    figure(
                        "TAS", f.tasKt.map { "\(Int($0.rounded())) kt" } ?? Fmt.dash, set: overrides?["tasKt"] != nil)
                    figure("WIND", f.wind, set: f.windSource == "override", warn: f.windMissing)
                    figure(
                        "TEMP", f.tempC.map { "\(Int($0.rounded()))°C" } ?? Fmt.dash, set: overrides?["tempC"] != nil)
                    figure("GS", f.gs.map { "\(Int($0.rounded())) kt" } ?? Fmt.dash)
                    figure("CH", Fmt.degrees(f.ch), bold: true)
                }
                HStack(spacing: 0) {
                    figure("TC", Fmt.degrees(f.tc))
                    figure("MC", Fmt.degrees(f.mc))
                    figure("WCA", LegFigures.signed(f.wca))
                    figure("DEV", LegFigures.signed(f.dev))
                    Spacer().frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func figure(_ label: String, _ value: String, set: Bool = false, warn: Bool = false, bold: Bool = false)
        -> some View
    {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.subheadline.monospacedDigit().weight(bold ? .bold : .regular))
                .foregroundStyle(warn ? AnyShapeStyle(.orange) : set ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                .lineLimit(1)
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
    @State private var minutes = 60
    @State private var leg = LegOverride()

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
                case .duration:
                    Section("Take-off to landing") {
                        Stepper(value: $minutes, in: 5...600, step: 5) {
                            Text(Fmt.hoursMinutes(Double(minutes))).font(.title2.monospacedDigit().bold())
                        }
                        .accessibilityIdentifier("duration-stepper")
                    }
                case .leg(let row, let figures):
                    LegOverrideForm(row: row, figures: figures, value: $leg)
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
                    .disabled(edit.isLeg && !leg.valid)
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
        case .duration: "Duration"
        case .leg(let row, _): "\(row.from) → \(row.to)"
        }
    }

    private func load() {
        switch edit {
        case .date, .blockOff:
            date = Fmt.date(day: model.date, clock: model.blockOff.isEmpty ? "12:00" : model.blockOff)
        case .duration(let m):
            minutes = Int(m.rounded())
        case .leg(let row, _):
            leg = LegOverride(model.flight?["legOverrides"]?[row.key])
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
        case .duration:
            let m = minutes
            Task { await model.setLocalDuration(m) }
        case .leg(let row, _):
            let o = leg
            Task { await model.setLegOverride(legKey: row.key, o) }
        }
    }
}

/// A leg's values typed over the computed ones (src/shared/types.ts LegOverride); nil: computed. The
/// wind counts only with both its direction and its speed (src/calc/navlog.ts).
struct LegOverride: Equatable, Sendable {
    var altFt: Int?
    var tasKt: Int?
    var windDirDeg: Int?
    var windKt: Int?
    var tempC: Int?

    /// The website's field limits (NavlogStrip's NumberFields, the wind and temperature as the
    /// calculation takes them).
    static let altRange = 0...20000
    static let tasRange = 20...300
    static let dirRange = 1...360
    static let windRange = 0...200
    static let tempRange = -60...60

    init(altFt: Int? = nil, tasKt: Int? = nil, windDirDeg: Int? = nil, windKt: Int? = nil, tempC: Int? = nil) {
        self.altFt = altFt
        self.tasKt = tasKt
        self.windDirDeg = windDirDeg
        self.windKt = windKt
        self.tempC = tempC
    }

    init(_ j: JSON?) {
        self.init(
            altFt: j?["altFt"]?.int, tasKt: j?["tasKt"]?.int, windDirDeg: j?["windDirDeg"]?.int,
            windKt: j?["windKt"]?.int, tempC: j?["tempC"]?.int)
    }

    var valid: Bool {
        func ok(_ v: Int?, _ r: ClosedRange<Int>) -> Bool { v.map(r.contains) ?? true }
        return ok(altFt, Self.altRange) && ok(tasKt, Self.tasRange) && ok(windDirDeg, Self.dirRange)
            && ok(windKt, Self.windRange) && ok(tempC, Self.tempRange) && (windDirDeg == nil) == (windKt == nil)
    }

    /// The legOverrides entry; nil when nothing is typed (the key is dropped, as on the website).
    var json: JSON? {
        var o: [String: JSON] = [:]
        if let altFt { o["altFt"] = .number(Double(altFt)) }
        if let tasKt { o["tasKt"] = .number(Double(tasKt)) }
        if let windDirDeg, let windKt {
            o["windDirDeg"] = .number(Double(windDirDeg))
            o["windKt"] = .number(Double(windKt))
        }
        if let tempC { o["tempC"] = .number(Double(tempC)) }
        return o.isEmpty ? nil : .object(o)
    }
}

/// The fields of a leg's sheet: each shows the computed value until one is typed, and resets to it.
struct LegOverrideForm: View {
    var row: NavRow
    var figures: LegFigures?
    @Binding var value: LegOverride
    /// The fields' text as typed (a lone '-' on the way to a negative temperature has no value yet).
    @State private var typed: [String: String] = [:]

    var body: some View {
        Section {
            Stepper(value: stepped(\.altFt, from: computedAlt), in: LegOverride.altRange, step: 500) {
                Text("\(value.altFt ?? computedAlt) ft").font(.title2.monospacedDigit().bold())
                    .foregroundStyle(value.altFt == nil ? .secondary : .primary)
            }
            .accessibilityIdentifier("altitude-stepper")
            field("Feet", \.altFt, placeholder: computedAlt, id: "navlog-alt")
            reset(\.altFt, field: "navlog-alt", id: "reset-alt")
        } header: {
            Text("Altitude")
        } footer: {
            if let d = figures?.defaultAltFt { Text("Computed: \(Int(d)) ft") }
        }
        Section("True airspeed") {
            field("Knots", \.tasKt, placeholder: figures?.tasKt.map { Int($0.rounded()) }, id: "navlog-tas")
            reset(\.tasKt, field: "navlog-tas", id: "reset-tas")
        }
        Section {
            field("Direction from (true)", \.windDirDeg, placeholder: forecastDir, id: "navlog-wind-dir")
            field("Speed, knots", \.windKt, placeholder: forecastKt, id: "navlog-wind-kt")
            if value.windDirDeg != nil || value.windKt != nil {
                Button("Use the forecast", role: .destructive) {
                    value.windDirDeg = nil
                    value.windKt = nil
                    typed["navlog-wind-dir"] = nil
                    typed["navlog-wind-kt"] = nil
                }
                .accessibilityIdentifier("reset-wind")
            }
        } header: {
            Text("Wind")
        } footer: {
            if (value.windDirDeg == nil) != (value.windKt == nil) {
                Text("Type both the direction and the speed.").foregroundStyle(.orange)
            } else if figures?.windMissing ?? false, value.windDirDeg == nil {
                Text("No forecast: calm assumed.")
            }
        }
        Section("Temperature, °C") {
            field("°C", \.tempC, placeholder: figures?.tempC.map { Int($0.rounded()) }, id: "navlog-temp")
            reset(\.tempC, field: "navlog-temp", id: "reset-temp")
        }
        if value != LegOverride() {
            Section {
                Button("Reset all to the computed values", role: .destructive) {
                    value = LegOverride()
                    typed = [:]
                }
                .accessibilityIdentifier("reset-leg")
            }
        }
    }

    private var computedAlt: Int { Int((figures?.defaultAltFt ?? row.altFt ?? 3500).rounded()) }
    private var forecastDir: Int? {
        figures.flatMap { $0.windSource == "forecast" ? $0.windDirDeg.map { Int($0.rounded()) } : nil }
    }
    private var forecastKt: Int? {
        figures.flatMap { $0.windSource == "forecast" ? $0.windKt.map { Int($0.rounded()) } : nil }
    }

    /// A stepper starts from the value shown (the computed one) and makes it typed.
    private func stepped(_ key: WritableKeyPath<LegOverride, Int?>, from computed: Int) -> Binding<Int> {
        Binding(
            get: { value[keyPath: key] ?? computed },
            set: {
                value[keyPath: key] = $0
                typed["navlog-alt"] = nil
            })
    }

    private func field(_ label: String, _ key: WritableKeyPath<LegOverride, Int?>, placeholder: Int?, id: String)
        -> some View
    {
        HStack {
            Text(label)
            Spacer()
            // text, not a number format: a formatted field commits only on return, which Save would miss
            TextField(
                placeholder.map(String.init) ?? "?",
                text: Binding(
                    get: { typed[id] ?? value[keyPath: key].map(String.init) ?? "" },
                    set: {
                        typed[id] = $0
                        value[keyPath: key] = Int(
                            $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "−", with: "-"))
                    })
            )
            .keyboardType(.numbersAndPunctuation)
            .multilineTextAlignment(.trailing)
            .font(.body.monospacedDigit())
            .frame(maxWidth: 120)
            .accessibilityIdentifier(id)
        }
    }

    @ViewBuilder
    private func reset(_ key: WritableKeyPath<LegOverride, Int?>, field: String, id: String) -> some View {
        if value[keyPath: key] != nil {
            Button("Use the computed value", role: .destructive) {
                value[keyPath: key] = nil
                typed[field] = nil
            }
            .accessibilityIdentifier(id)
        }
    }
}

extension FlightModel {
    /// A leg's typed values replace what was typed for it before; none drops the leg's entry.
    func setLegOverride(legKey: String, _ o: LegOverride) async {
        await edit { f in
            var all = f["legOverrides"]?.object ?? [:]
            all[legKey] = o.json
            f["legOverrides"] = .object(all)
        }
    }
}
