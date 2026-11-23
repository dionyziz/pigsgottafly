import SwiftUI

/// Aircraft (the website's AircraftSection): the aircraft from the hangar (on a shared flight, the
/// owner's choice: shown, not changed), its figures, the compass card and the winds' model.
struct AircraftView: View {
    @ObservedObject var model: FlightModel
    @State private var hangar: [JSON] = []
    @State private var loaded = false

    var body: some View {
        let aircraft = model.aircraft
        Form {
            Section {
                if loaded && hangar.isEmpty && !model.aircraftIsOwnersChoice {
                    Text("Hangar empty.").foregroundStyle(.secondary)
                    WebLinkRow(title: "Add an aircraft", path: "hangar", id: "aircraft-add") {
                        Task { await load() }
                    }
                } else {
                    Picker("Aircraft", selection: selection) {
                        Text("Choose an aircraft…").tag(String?.none)
                        ForEach(choices(aircraft), id: \.idKey) { a in
                            Text(Self.label(a)).tag(a["id"]?.string)
                        }
                    }
                    .disabled(model.readOnly || model.aircraftIsOwnersChoice)
                    .accessibilityIdentifier("aircraft-select")
                }
                if model.flight?["aircraftId"]?.string != nil && aircraft == nil && loaded {
                    Text("Aircraft unavailable: deleted or no longer shared.")
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("aircraft-unavailable")
                }
            } footer: {
                if model.aircraftIsOwnersChoice { Text("The flight’s owner chooses its aircraft.") }
            }
            if let a = aircraft { details(a) }
            Section {
                Picker("Winds aloft", selection: windModel) {
                    ForEach(FlightModel.windModels, id: \.id) { m in Text(m.label).tag(m.id) }
                }
                .disabled(model.readOnly)
                .accessibilityIdentifier("wind-model")
            }
            if let a = aircraft, let id = a["id"]?.string {
                Section {
                    WebLinkRow(
                        title: "\(a["registration"]?.string ?? "") in the hangar", path: "hangar/\(id)",
                        id: "aircraft-hangar-link"
                    ) {
                        Task { await model.refresh() }
                    }
                }
            }
        }
        .accessibilityIdentifier(FlightSection.aircraft.screenID)
        .task { await load() }
    }

    private func load() async {
        hangar = await model.hangar()
        loaded = true
    }

    /// The hangar, with the flight's aircraft when it is not in it (a shared flight's: the owner's).
    private func choices(_ current: JSON?) -> [JSON] {
        guard let current, let id = current["id"]?.string, !hangar.contains(where: { $0["id"]?.string == id })
        else { return hangar }
        return [current] + hangar
    }

    private var selection: Binding<String?> {
        Binding(
            get: { model.flight?["aircraftId"]?.string },
            set: { id in
                guard id != model.flight?["aircraftId"]?.string else { return }
                let a = id.flatMap { id in choices(model.aircraft).first { $0["id"]?.string == id } }
                Task { await model.chooseAircraft(a) }
            })
    }

    private var windModel: Binding<String> {
        Binding(
            get: {
                model.flight?["options"]?["windModel"]?.string ?? FlightModel.windModels[0].id
            },
            set: { m in Task { await model.setWindModel(m) } })
    }

    /// "SX-ASV · Cessna F172M · shared by Alice"
    static func label(_ a: JSON) -> String {
        let reg = a["registration"]?.string ?? ""
        let make = a["makeModel"]?.string ?? ""
        var s = "\(reg) · \(make.isEmpty ? (a["icaoType"]?.string ?? "") : make)"
        if let access = a["access"], let role = access["role"]?.string, role != "owner" {
            let owner = access["owner"]
            let name = owner?["name"]?.string ?? ""
            s += " · shared by \(name.isEmpty ? owner?["email"]?.string ?? "" : name)"
        }
        return s
    }

    @ViewBuilder
    private func details(_ a: JSON) -> some View {
        let fuel = a["fuel"]
        Section {
            LabeledContent("Type") {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(a["icaoType"]?.string ?? "")/\(a["wake"]?.string ?? "")")
                    if let c = a["colours"]?.string, !c.isEmpty { Text(c).font(.footnote) }
                }
            }
            LabeledContent(
                "TAS cruise / pattern",
                value: "\(Self.num(a["cruiseTasKt"])) / \(Self.num(a["patternTasKt"])) kt")
            LabeledContent("Planning burn") {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(Self.num(fuel?["burnLph"])) L/h")
                    Text("+\(Self.num(fuel?["taxiAllowanceL"])) L taxi").font(.footnote)
                }
            }
            LabeledContent("Fuel capacity") {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(Self.num(fuel?["usableL"])) L")
                    Text(Self.fuelTypesLabel(fuel)).font(.footnote)
                }
            }
        }
        .monospacedDigit()
        compassCard(a)
    }

    @ViewBuilder
    private func compassCard(_ a: JSON) -> some View {
        let cards = a["compassCards"]?.array ?? []
        let chosen = model.flight?["options"]?["compassCard"]?.string
        let card = cards.first { $0["name"]?.string == chosen } ?? cards.first
        if cards.count > 1 {
            Section {
                Picker(
                    "Compass card",
                    selection: Binding(
                        get: { card?["name"]?.string ?? "" },
                        set: { name in Task { await model.setCompassCard(name.isEmpty ? nil : name) } })
                ) {
                    ForEach(cards, id: \.cardName) { c in
                        Text(cardLabel(c)).tag(c.cardName)
                    }
                }
                .disabled(model.readOnly)
                .accessibilityIdentifier("compass-card")
            }
        } else if let card, let expires = card["expires"]?.string, expired(expires) {
            Section {
                LabeledContent("Compass card") {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(card.cardName)
                        Text("expired \(expires)").font(.footnote)
                    }
                    .foregroundStyle(.red)
                }
                .accessibilityIdentifier("compass-card")
            }
        }
    }

    private func cardLabel(_ c: JSON) -> String {
        guard let e = c["expires"]?.string, expired(e) else { return c.cardName }
        return "\(c.cardName) (expired \(e))"
    }

    /// A compass card is only worth a line when it has expired by the day of the flight.
    private func expired(_ expires: String) -> Bool {
        guard !expires.isEmpty else { return false }
        let day = model.date.isEmpty ? Fmt.isoDay(from: Date()) : model.date
        return expires < day
    }

    static func num(_ j: JSON?) -> String {
        guard let d = j?.double else { return Fmt.dash }
        return d == d.rounded() ? String(Int(d)) : String(format: "%.1f", d)
    }

    /// "AVGAS", "MOGAS or AVGAS" (src/shared/fuel.ts fuelTypesLabel).
    static func fuelTypesLabel(_ fuel: JSON?) -> String {
        let ts = (fuel?["types"]?.array ?? []).compactMap { $0["type"]?.string }
        guard ts.count > 1 else { return ts.first ?? "" }
        return "\(ts.dropLast().joined(separator: ", ")) or \(ts.last!)"
    }
}

extension JSON {
    fileprivate var idKey: String { self["id"]?.string ?? text }
    fileprivate var cardName: String { self["name"]?.string ?? "" }
}
