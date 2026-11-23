import SwiftUI

/// Fuel (the website's FuelSection): the taxi allowance, trip, reserves and required fuel; the fuel on
/// board at block start (one field per approved fuel: their sum is the FOB, the W&B weighs each type);
/// the gauge against capacity; endurance, fuel at landing and the check.
struct FuelView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.flightFocus) private var focus

    var body: some View {
        Group {
            if let a = model.aircraft, let fuel = model.computed?.raw["fuel"], !fuel.isNull {
                form(a, fuel)
            } else {
                List {
                    Text(model.computed == nil ? "Preparing…" : "No aircraft.").foregroundStyle(.secondary)
                }
                .listStyle(.insetGrouped)
            }
        }
        .accessibilityIdentifier(FlightSection.fuel.screenID)
    }

    private func form(_ a: JSON, _ fuel: JSON) -> some View {
        let spec = a["fuel"]
        let burn = spec?["burnLph"]?.double ?? 0
        let usable = spec?["usableL"]?.double ?? 0
        let options = model.flight?["options"]
        let allowanceSet = options?["taxiAllowanceL"]?.double
        let takeoffs = fuel["takeoffs"]?.int ?? 1
        /// Litres as flight time at the planning burn.
        func time(_ l: Double?) -> String? {
            guard burn > 0, let l, l.isFinite else { return nil }
            return Fmt.duration(l / burn * 60)
        }
        return Form {
            Section {
                NumberEntry(
                    label: "Start-up, taxi, TO & landing", unit: "L", value: allowanceSet,
                    placeholder: AircraftView.num(spec?["taxiAllowanceL"]), id: "taxi-allowance",
                    disabled: model.readOnly
                ) { v in
                    await model.setTaxiAllowance(v)
                }
                if takeoffs > 1 {
                    LabeledContent("\(takeoffs) take-offs", value: Fmt.litres(fuel["taxiL"]?.double))
                        .accessibilityIdentifier("taxi-total")
                }
                row(
                    "Trip", fuel["tripL"],
                    sub: model.computed?.raw["navlog"]?["flightMin"]?.double.map(Fmt.duration)
                        ?? time(fuel["tripL"]?.double))
                if let fr = fuel["finalReserveL"]?.double, fr > 0 {
                    row("Final reserve", fuel["finalReserveL"], sub: time(fr))
                }
                row(
                    "Required", fuel["requiredL"], sub: time(fuel["requiredL"]?.double), bold: true, id: "fuel-required"
                )
                if fuel["reserveUnset"]?.bool == true {
                    LabeledContent("Reserve") {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(Fmt.litres(fuel["reserveL"]?.double))
                            Text("Set in your profile").font(.footnote)
                        }
                        .foregroundStyle(.orange)
                    }
                } else {
                    row("Reserve", fuel["reserveL"], sub: time(fuel["reserveL"]?.double))
                }
                row(
                    "Required + reserve", fuel["defaultFobL"], sub: time(fuel["defaultFobL"]?.double),
                    tone: fuel["defaultOverCapacity"]?.bool == true ? .orange : nil)
            }
            .monospacedDigit()
            fob(a, fuel, usable: usable)
            Section {
                row("Endurance at block start", nil, text: Fmt.duration(fuel["enduranceMin"]?.double))
                row(
                    "Fuel at landing", fuel["landingFuelL"],
                    sub: Fmt.duration(fuel["landingEnduranceMin"]?.double),
                    tone: fuel["landingReserveShort"]?.bool == true ? .red : nil, id: "fuel-landing")
            }
            .monospacedDigit()
            let issues = (fuel["issues"]?.array ?? []).filter {
                !($0["text"]?.string ?? "").localizedCaseInsensitiveContains("reserve not set")
            }
            if !issues.isEmpty {
                Section {
                    ForEach(issues, id: \.issueText) { w in
                        Label(w.issueText, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(w["level"]?.string == "danger" ? .red : .orange)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func fob(_ a: JSON, _ fuel: JSON, usable: Double) -> some View {
        let spec = a["fuel"]
        let types = (spec?["types"]?.array ?? []).compactMap { $0["type"]?.string }
        let primary = types.first ?? "AVGAS"
        let fobSet = model.flight?["fobL"]?.double
        let split = model.flight?["options"]?["fuelL"]?.object?.compactMapValues(\.double)
        let fobL = fuel["fobL"]?.double ?? 0
        let defaultFob = fuel["defaultFobL"]?.double
        Section {
            if types.count > 1 {
                ForEach(types, id: \.self) { t in
                    let typed = split.map { $0[t] } ?? (t == primary ? fobSet : nil)
                    NumberEntry(
                        label: t, unit: "L", value: typed,
                        placeholder: t == primary && fobSet == nil && split == nil
                            ? AircraftView.num(defaultFob.map(JSON.number)) : "0",
                        id: t == primary ? "fob" : "fob-\(t)", disabled: model.readOnly, focused: focus == "fob"
                    ) { v in
                        await model.setFuel(t, litres: v)
                    }
                }
                LabeledContent("Total") {
                    Text("\(Fmt.litres(fobL)) · \(kg) kg").monospacedDigit()
                }
                .accessibilityIdentifier("fob-total")
            } else {
                NumberEntry(
                    label: "On board", unit: "L", value: fobSet,
                    placeholder: AircraftView.num(defaultFob.map(JSON.number)), id: "fob",
                    disabled: model.readOnly, focused: focus == "fob"
                ) { v in
                    await model.setFob(v)
                }
            }
            if !model.readOnly {
                if fobSet != nil {
                    Button("Use required + reserve") { Task { await model.fuelEdit(.requiredPlusReserve) } }
                        .accessibilityIdentifier("fob-default")
                } else if usable > 0 && fuel["defaultOverCapacity"]?.bool == true {
                    Button("Full tanks") { Task { await model.setFob(usable) } }
                        .accessibilityIdentifier("fob-full")
                }
            }
            if let load = model.fuelLoad(), !load.load.unapproved.isEmpty {
                let u = load.load.unapproved
                Text(
                    "\(u.joined(separator: " and ")) \(u.count > 1 ? "are" : "is") not an approved fuel of \(a["registration"]?.string ?? "the aircraft")."
                )
                .foregroundStyle(.red)
            }
            if usable > 0 {
                FuelGauge(
                    fob: fobL, required: fuel["requiredL"]?.double ?? 0, usable: usable,
                    over: fuel["overCapacity"]?.bool == true, low: fuel["belowRequired"]?.bool == true)
            }
        } header: {
            Text("Fuel on board at block start")
        }
    }

    private var kg: String {
        guard let k = model.fuelLoad()?.load.kg else { return Fmt.dash }
        return String(format: "%.1f", (k * 10).rounded() / 10)
    }

    private func row(
        _ label: String, _ litres: JSON?, text: String? = nil, sub: String? = nil, bold: Bool = false,
        tone: Color? = nil, id: String? = nil
    ) -> some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 0) {
                Text(text ?? Fmt.litres(litres?.double)).fontWeight(bold ? .semibold : .regular)
                if let sub { Text(sub).font(.footnote).foregroundStyle(.secondary) }
            }
            .foregroundStyle(tone ?? .primary)
        } label: {
            Text(label).fontWeight(bold ? .semibold : .regular)
        }
        .accessibilityIdentifier(id ?? "")
    }
}

/// Fuel on board against usable capacity, with the required fuel marked.
struct FuelGauge: View {
    var fob: Double
    var required: Double
    var usable: Double
    var over: Bool
    var low: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GeometryReader { g in
                let w = g.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemFill))
                    Capsule()
                        .fill(over ? Color.red : low ? Color.orange : Color.accentColor)
                        .frame(width: w * min(1, max(0, fob / usable)))
                    Rectangle()
                        .fill(Color.primary)
                        .frame(width: 2)
                        .offset(x: w * min(1, max(0, required / usable)) - 1)
                }
            }
            .frame(height: 10)
            HStack {
                Text("0")
                Spacer()
                Text("Capacity \(Fmt.litres(usable))")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Fmt.litres(fob)) of \(Fmt.litres(usable)), required \(Fmt.litres(required))")
        .accessibilityIdentifier("fuel-gauge")
    }
}

extension JSON {
    fileprivate var issueText: String { self["text"]?.string ?? "" }
}
