import SwiftUI

/// A short status in a capsule, coloured by its tone (the website's Chip).
struct ChipView: View {
    var text: String
    var tone: BriefTone?

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(Self.color(tone))
            .background(Capsule().fill(Self.color(tone).opacity(0.15)))
    }

    static func color(_ tone: BriefTone?) -> Color {
        switch tone {
        case .ok: .green
        case .warn: .orange
        case .danger: .red
        case nil: .secondary
        }
    }
}

/// A figure with its label, an optional line under it, coloured by its tone (the website's KV).
struct FigureRow: View {
    var label: String
    var text: String
    var sub: String?
    var tone: BriefTone?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(text).monospacedDigit().foregroundStyle(tone == nil ? .secondary : ChipView.color(tone))
                if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
