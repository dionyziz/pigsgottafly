import SwiftUI

/// Each aerodrome of the route at the time the flight uses it (the website's Aerodromes section).
struct AerodromesView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        List {
            Section("Aerodromes") {
                if let c = model.computed, !c.aerodromes.isEmpty {
                    ForEach(c.aerodromes) { AerodromeRow(check: $0) }
                } else {
                    Text(model.computed == nil ? "Preparing…" : "No aerodromes.").foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier(FlightSection.aerodromes.screenID)
    }
}

/// An aerodrome at the time the flight uses it: the aerodrome's, the ATS's and the handling's hours.
struct AerodromeRow: View {
    var check: AerodromeCheck

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: icon).foregroundStyle(color).accessibilityHidden(true)
                Text(check.icao).font(.headline)
                Text(check.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Text(check.role.capitalized).font(.caption).foregroundStyle(.secondary)
            }
            if let w = check.when { Text(w).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            if let h = check.aerodrome { line("Aerodrome", h) }
            if let h = check.ats { line("ATS", h) }
            if let h = check.handling { line("Handling", h) }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func line(_ label: String, _ h: AerodromeCheck.Hours) -> some View {
        Text("\(label): \(h.text)").font(.subheadline)
    }

    private var icon: String {
        switch check.worst {
        case "open": "checkmark.circle.fill"
        case "closed": "xmark.octagon.fill"
        default: "questionmark.circle.fill"
        }
    }
    private var color: Color {
        switch check.worst {
        case "open": .green
        case "closed": .red
        default: .orange
        }
    }
}
