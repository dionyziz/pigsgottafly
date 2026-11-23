import SwiftUI

/// "Ready to fly" (the website's ReadinessBar): what is left to do over the whole flight, taking the
/// pilot to the first of it; each stage's state and count; and this stage's rows, each opening its
/// section, with its warning's Fix, its link, or "Mark read" for the NOTAMs.
struct ReadinessHeader: View {
    var stage: String
    @ObservedObject var model: FlightModel
    @Environment(\.focusRouter) private var focus
    /// The Fix of each row's warning, by warning text (nil: nothing the pilot can change).
    @State private var fixes: [String: CoreFocusTarget] = [:]

    private var items: [ReadyItem] { model.readiness(stage: stage) }

    var body: some View {
        Section {
            if items.isEmpty {
                Text(model.stages.isEmpty ? "Preparing…" : "Nothing to check.").foregroundStyle(.secondary)
            }
            ForEach(items) { item in row(item) }
        } header: {
            header
        }
        .task(id: warnings) { await resolveFixes() }
    }

    // MARK: summary

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            summary
            HStack(spacing: 6) {
                ForEach(model.stages, id: \.stage) { s in stageChip(s) }
            }
        }
        .textCase(nil)
        .padding(.bottom, 4)
    }

    /// 'Ready to fly', or '3 to do: Fuel, Weather, NOTAMs →' (the names when three or fewer).
    @ViewBuilder
    private var summary: some View {
        let open = model.openItems
        if model.stages.isEmpty {
            EmptyView()
        } else if open.isEmpty {
            Label("Ready to fly", systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.green)
                .accessibilityIdentifier("ready-summary")
        } else {
            let danger = model.stages.contains { $0.state == "danger" }
            let names = open.count <= 3 ? ": " + open.map(\.label).joined(separator: ", ") : ""
            Button {
                goToFirst(open[0])
            } label: {
                Label("\(open.count) to do\(names) →", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(danger ? .red : .orange)
            .accessibilityIdentifier("ready-go")
        }
    }

    private func stageChip(_ s: CoreStageSummary) -> some View {
        let state = ReadyItem.State(rawValue: s.state) ?? .todo
        return Button {
            if let tab = FlightTab(rawValue: s.stage) { focus.openTab(tab) }
        } label: {
            HStack(spacing: 4) {
                Circle().fill(ReadyRow.color(state)).frame(width: 7, height: 7)
                Text(s.label)
                if s.open > 0 { Text("\(s.open)").monospacedDigit().fontWeight(.semibold) }
            }
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule().fill(s.stage == stage ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(s.label): \(s.open == 0 ? "ready" : "\(s.open) to do")")
        .accessibilityAddTraits(s.stage == stage ? .isSelected : [])
        .accessibilityIdentifier("ready-stage-\(s.stage)")
    }

    /// The first thing left to do: its section (a form: its File & forms page).
    private func goToFirst(_ item: ReadyItem) {
        if let s = model.readyDetail(item).section {
            focus.open(section: s)
        } else if let tab = FlightTab(rawValue: item.stage) {
            focus.openTab(tab)
        }
    }

    // MARK: rows

    private func row(_ item: ReadyItem) -> some View {
        let detail = model.readyDetail(item)
        return HStack(alignment: .firstTextBaseline) {
            Button {
                if let s = detail.section { focus.open(section: s) }
            } label: {
                ReadyRow(item: item).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("ready-row-\(item.id)")
            action(item, detail)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ready-item")
    }

    @ViewBuilder
    private func action(_ item: ReadyItem, _ detail: ReadyDetail) -> some View {
        if detail.markRead {
            Button("Mark read") { Task { await model.markNotamsRead() } }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("notams-mark-read")
        } else if let link = detail.link {
            Button("\(link.label) →") { focus.open(link: link) }
                .buttonStyle(.borderless)
                .font(.subheadline)
                .accessibilityIdentifier("ready-link")
        } else if item.state != .ok, let w = detail.warning, let t = fixes[w] {
            Button("\(t.focus != nil ? "Fix" : (t.link?.label ?? "Fix")) →") { focus.route(t) }
                .buttonStyle(.borderless)
                .font(.subheadline)
                .accessibilityIdentifier("warning-fix")
        }
    }

    private var warnings: [String] {
        items.compactMap { model.readyDetail($0).warning }
    }

    private func resolveFixes() async {
        var out: [String: CoreFocusTarget] = [:]
        for w in warnings {
            if let t = await model.focusTarget(text: w), t.fix != nil { out[w] = t }
        }
        fixes = out
    }
}

struct ReadyRow: View {
    var item: ReadyItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Self.color(item.state))
                .font(.body.weight(.semibold))
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.label).font(.body).foregroundStyle(.primary)
                if let t = item.text { Text(t).font(.subheadline).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.label): \(stateText)\(item.text.map { ". \($0)" } ?? "")")
    }

    private var icon: String {
        switch item.state {
        case .ok: "checkmark.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .danger: "xmark.octagon.fill"
        case .todo: "circle.dashed"
        }
    }

    static func color(_ state: ReadyItem.State) -> Color {
        switch state {
        case .ok: .green
        case .warn: .orange
        case .danger: .red
        case .todo: .secondary
        }
    }

    private var stateText: String {
        switch item.state {
        case .ok: "ready"
        case .warn: "warning"
        case .danger: "problem"
        case .todo: "to do"
        }
    }
}
