import SwiftUI

/// The relevant NOTAMs by group (departure, destination, airspace), marked read as on the website.
struct NotamsView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        List {
            notams
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier(FlightSection.notams.screenID)
    }

    @ViewBuilder
    private var notams: some View {
        if let b = model.notams {
            if b.status != "ok" {
                Section("NOTAMs") {
                    Text(b.message ?? "NOTAMs are not available.").foregroundStyle(.secondary)
                }
            } else {
                ForEach(b.groups(always: model.endAerodromes)) { g in
                    Section {
                        if g.notams.isEmpty {
                            Text("No relevant NOTAMs.").foregroundStyle(.secondary)
                        }
                        ForEach(g.notams) { NotamRow(notam: $0) }
                    } header: {
                        Text(groupTitle(g))
                    }
                }
                if b.notams.contains(where: \.relevant) {
                    Section {
                        if model.notamsRead {
                            Label("The relevant NOTAMs are read.", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("notams-read")
                        } else {
                            Button {
                                Task { await model.markNotamsRead() }
                            } label: {
                                Label("Mark the relevant NOTAMs read", systemImage: "checkmark.circle")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                            .accessibilityIdentifier("mark-notams-read")
                        }
                    }
                }
            }
        } else {
            Section("NOTAMs") {
                Text(model.offline ? "No NOTAM briefing saved for this flight." : "Loading…").foregroundStyle(
                    .secondary)
            }
        }
    }

    private func groupTitle(_ g: NotamGroup) -> String {
        guard let icao = g.icao else { return "NOTAMs · Airspace" }
        let name = model.computed?.aerodromes.first { $0.icao == icao }?.name
        return name.map { "NOTAMs · \(icao) \($0)" } ?? "NOTAMs · \(icao)"
    }
}

struct NotamRow: View {
    var notam: Notam
    @State private var showRaw = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(notam.key).font(.subheadline.weight(.semibold).monospaced())
                if notam.onlyFromAutorouter {
                    Text("autorouter").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                        .accessibilityIdentifier("notam-autorouter-only")
                }
                if let s = notam.subject {
                    Text([s, notam.condition].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Text(notam.text).font(.body)
            Text(validity).font(.caption).foregroundStyle(.secondary)
            if showRaw { Code(text: notam.raw) }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture { showRaw.toggle() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(showRaw ? "Hides the NOTAM as published" : "Shows the NOTAM as published")
    }

    private var validity: String {
        var parts = [
            "\(Self.when(notam.from)) – \(notam.to.map(Self.when) ?? "PERM")\(notam.estimated == true ? " EST" : "")"
        ]
        if let s = notam.schedule { parts.append(s) }
        if let lo = notam.lowerText, let hi = notam.upperText { parts.append("\(lo) – \(hi)") }
        return parts.joined(separator: " · ")
    }

    private static func when(_ ms: Double) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMM HH:mm'Z'"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}
