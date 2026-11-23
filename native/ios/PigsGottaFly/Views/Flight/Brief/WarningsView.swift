import SwiftUI

/// The flight's warnings as the website's navlog strip lists them: the general ones by level, then
/// each leg's own; each with its Fix (a field of the flight, or the page that fixes it).
struct WarningsView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.focusRouter) private var focus
    @State private var fixes: [String: CoreFocusTarget] = [:]

    /// A computeFlight warning (src/features/editor/panels/flightCalc.ts CalcWarning).
    struct Warning: Hashable {
        var level: String
        var text: String
        var leg: Int?
    }

    private static let order = ["danger": 0, "warn": 1, "info": 2]

    /// The general ones by level, then the legs' own in leg order (NavlogStrip splitWarnings).
    private var warnings: (general: [Warning], legs: [Warning]) {
        let all = (model.computed?.raw["warnings"]?.array ?? []).compactMap { w -> Warning? in
            guard let text = w["text"]?.string else { return nil }
            return Warning(level: w["level"]?.string ?? "warn", text: text, leg: w["leg"]?["index"]?.int)
        }
        let legCount = model.computed?.rows.count ?? 0
        let ofLeg = { (w: Warning) in w.leg.map { $0 >= 0 && $0 < legCount } ?? false }
        let general = all.filter { !ofLeg($0) }.enumerated()
            .sorted { (Self.order[$0.element.level] ?? 1, $0.offset) < (Self.order[$1.element.level] ?? 1, $1.offset) }
            .map(\.element)
        return (general, all.filter(ofLeg).sorted { ($0.leg ?? 0) < ($1.leg ?? 0) })
    }

    var body: some View {
        let w = warnings
        List {
            if model.computed == nil {
                Section { Text("Preparing…").foregroundStyle(.secondary) }
            } else if w.general.isEmpty && w.legs.isEmpty {
                Section { Text("No warnings.").foregroundStyle(.secondary) }
            }
            if !w.general.isEmpty {
                Section { ForEach(w.general, id: \.self) { row($0) } }
            }
            if !w.legs.isEmpty {
                Section("Legs") { ForEach(w.legs, id: \.self) { row($0) } }
            }
        }
        .listStyle(.insetGrouped)
        .task(id: model.computed) { await resolveFixes(w.general + w.legs) }
        .accessibilityIdentifier(FlightSection.warnings.screenID)
    }

    private func row(_ w: Warning) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Label {
                Text(w.text).foregroundStyle(.primary)
            } icon: {
                Image(systemName: w.level == "info" ? "info.circle" : "exclamationmark.triangle.fill")
                    .foregroundStyle(w.level == "danger" ? Color.red : w.level == "info" ? .secondary : .orange)
            }
            Spacer()
            if let t = fixes[w.text] {
                Button("\(t.focus != nil ? "Fix" : (t.link?.label ?? "Fix")) →") { focus.route(t) }
                    .buttonStyle(.borderless)
                    .font(.subheadline)
                    .accessibilityIdentifier("warning-fix")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("warning")
    }

    private func resolveFixes(_ list: [Warning]) async {
        var out: [String: CoreFocusTarget] = [:]
        for w in list where out[w.text] == nil {
            if let t = await model.focusTarget(text: w.text), t.fix != nil, t.focus != nil || t.link != nil {
                out[w.text] = t
            }
        }
        fixes = out
    }
}
