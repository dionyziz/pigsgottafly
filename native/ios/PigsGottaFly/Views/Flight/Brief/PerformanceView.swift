import SwiftUI

/// Take-off and landing at the departure, at each full stop and touch-and-go, and at the destination,
/// with the verdict, the conditions, the runway and surface (saved to the flight) and the distances,
/// as the website's PerformanceSection.
struct PerformanceView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.flightFocus) private var focus
    @State private var perf: CoreBrief.Performance?

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if let perf {
                    if !perf.has {
                        Section { Text("No aerodrome at either end.").foregroundStyle(.secondary) }
                    }
                    ForEach(perf.endpoints) { e in
                        EndpointSection(endpoint: e, readOnly: model.readOnly) { choice, value in
                            Task { await model.setPerformance(e, choice, value) }
                        }
                        .id(e.id)
                    }
                } else {
                    Section { Text(model.computed == nil ? "Preparing…" : "Loading…").foregroundStyle(.secondary) }
                }
            }
            .listStyle(.insetGrouped)
            .onChange(of: perf) { _, p in
                // a Fix of a performance warning: the first card that does not fit
                guard focus == "performance", let e = p?.endpoints.first(where: { $0.verdict == "fail" }) else {
                    return
                }
                withAnimation { proxy.scrollTo(e.id, anchor: .top) }
            }
        }
        .toolbar {
            if perf?.noGo == true {
                ToolbarItem(placement: .topBarTrailing) {
                    ChipView(text: "No-go", tone: .danger).accessibilityIdentifier("perf-no-go")
                }
            }
        }
        .task(id: Key(computed: model.computed, options: model.flight?["options"])) {
            perf = await model.brief()?.performance
        }
        .accessibilityIdentifier(FlightSection.performance.screenID)
    }

    private struct Key: Equatable {
        var computed: ComputedFlight?
        var options: JSON?
    }
}

/// One take-off or landing.
struct EndpointSection: View {
    var endpoint: CoreBrief.Performance.Endpoint
    var readOnly: Bool
    var set: (FlightModel.PerformanceChoice, String?) -> Void

    private var e: CoreBrief.Performance.Endpoint { endpoint }
    private var takeoff: Bool { e.phase == "takeoff" }

    var body: some View {
        Section {
            if !e.summary.isEmpty {
                Text(e.summary).font(.subheadline.monospacedDigit()).accessibilityIdentifier("perf-summary-\(e.tid)")
            }
            if let reason = e.reason {
                Text(reason)
                    .font(.subheadline)
                    .foregroundStyle(e.verdict == "fail" ? Color.red : .orange)
                    .accessibilityIdentifier("perf-reason-\(e.tid)")
            }
            FigureRow(label: takeoff ? "Take-off" : "Landing", text: e.time ?? "–", sub: e.conditions)
            FigureRow(label: "Weather", text: e.weather).accessibilityIdentifier("perf-weather-\(e.tid)")
            if let m = e.metar { Code(text: m).foregroundStyle(.secondary) }
            Picker("Runway", selection: choice(\.runway, .runway)) {
                Text("Auto (wind)\(e.runwayAuto.map { ": \($0)" } ?? "")").tag(String?.none)
                ForEach(e.runways, id: \.value) { r in Text(r.label).tag(String?.some(r.value)) }
            }
            .disabled(readOnly)
            .accessibilityIdentifier("perf-runway-\(e.tid)")
            Picker("Surface", selection: choice(\.surface, .surface)) {
                Text("Paved, dry").tag(String?.none)
                ForEach(e.surfaces, id: \.self) { s in Text(s).tag(String?.some(s)) }
            }
            .disabled(readOnly)
            .accessibilityIdentifier("perf-surface-\(e.tid)")
            if let c = e.components { FigureRow(label: "Components", text: c.text, sub: c.sub, tone: c.tone) }
            if let p = e.paDa { FigureRow(label: "PA / DA", text: p.text, sub: p.sub) }
            if let m = e.mass {
                FigureRow(label: "Mass", text: m.text, sub: m.sub, tone: m.tone)
                    .accessibilityIdentifier("perf-mass-\(e.tid)")
            }
            ForEach(e.distances) { d in FigureRow(label: d.label, text: d.text, sub: d.sub, tone: d.tone) }
            if e.noAircraft { Text("No aircraft.").foregroundStyle(.secondary) }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("\(e.title) \(e.icao)")
                Text(e.name).lineLimit(1)
                Spacer()
                if let label = e.verdictLabel {
                    ChipView(text: label == "Check" ? "?" : label, tone: tone)
                        .accessibilityLabel(e.verdictText)
                        .accessibilityIdentifier("perf-verdict-\(e.tid)")
                }
            }
            .textCase(nil)
        }
        .accessibilityIdentifier("perf-\(e.tid)")
    }

    private var tone: BriefTone {
        switch e.verdict {
        case "pass": .ok
        case "fail": .danger
        default: .warn
        }
    }

    private func choice(
        _ key: KeyPath<CoreBrief.Performance.Endpoint, String?>, _ kind: FlightModel.PerformanceChoice
    ) -> Binding<String?> {
        Binding(get: { e[keyPath: key] }, set: { set(kind, $0) })
    }
}
