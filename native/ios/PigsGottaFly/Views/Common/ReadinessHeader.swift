import SwiftUI

/// A stage's "Ready to fly" summary (PGF.readinessStages) and its rows; a row with something to do
/// offers its Fix.
struct ReadinessHeader: View {
    var stage: String
    var summary: CoreStageSummary?
    var items: [ReadyItem]
    @Environment(\.focusRouter) private var focus

    var body: some View {
        Section {
            if items.isEmpty {
                Text(summary == nil ? "Preparing…" : "Nothing to check.").foregroundStyle(.secondary)
            }
            ForEach(items) { item in
                HStack(alignment: .firstTextBaseline) {
                    ReadyRow(item: item)
                    if item.state != .ok, let text = item.text {
                        Spacer()
                        Button("Fix") { focus.fix(text: text) }
                            .buttonStyle(.borderless)
                            .accessibilityIdentifier("warning-fix")
                    }
                }
                .accessibilityIdentifier("ready-item")
            }
        } header: {
            HStack {
                Text(summary?.label ?? "Ready to fly")
                Spacer()
                if let s = summary {
                    Text(s.open == 0 ? "Ready" : "\(s.open) to check")
                        .foregroundStyle(ReadyRow.color(ReadyItem.State(rawValue: s.state) ?? .todo))
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("ready-\(stage)")
        }
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
                Text(item.label).font(.body)
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
