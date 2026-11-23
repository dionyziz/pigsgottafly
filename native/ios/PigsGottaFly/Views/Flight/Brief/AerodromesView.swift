import SwiftUI

/// Each aerodrome of the route at the time the flight uses it, and its hours that day (AIP AD 2.3 /
/// AD 1.6 with the flight's NOTAMs), as the website's "Aerodrome hours" section.
struct AerodromesView: View {
    @ObservedObject var model: FlightModel
    @State private var hours: CoreBrief.Aerodromes?

    var body: some View {
        List {
            if let hours {
                if hours.items.isEmpty {
                    Section { Text("No aerodromes on the route.").foregroundStyle(.secondary) }
                }
                ForEach(hours.items) { AerodromeHoursSection(item: $0) }
            } else {
                Section { Text(model.computed == nil ? "Preparing…" : "Loading…").foregroundStyle(.secondary) }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .toolbar {
            if let n = hours?.closed, n > 0 {
                ToolbarItem(placement: .topBarTrailing) {
                    ChipView(text: "\(n) closed", tone: .danger).accessibilityIdentifier("aerodromes-closed")
                }
            }
        }
        .task(id: Key(computed: model.computed, notams: model.notams)) { hours = await model.brief()?.aerodromes }
        .accessibilityIdentifier(FlightSection.aerodromes.screenID)
    }

    private struct Key: Equatable {
        var computed: ComputedFlight?
        var notams: NotamBriefing?
    }
}

/// One aerodrome: its status at the planned time, then the day's hours.
struct AerodromeHoursSection: View {
    var item: CoreBrief.Aerodromes.Item

    var body: some View {
        Section {
            if let when = item.when {
                Text(when).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            } else if item.timeNotSet {
                Text("Time not set").font(.subheadline).foregroundStyle(.secondary)
            }
            if let chip = item.chip, chip.tone != .ok {
                Text(chip.detail).font(.footnote).foregroundStyle(ChipView.color(chip.tone))
            }
            if let h = item.hours {
                hours(h)
            } else {
                Text("No operational hours published for this aerodrome.").foregroundStyle(.secondary)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text(item.title).monospaced()
                Text(item.name).lineLimit(1)
                Spacer()
                if let chip = item.chip {
                    ChipView(text: chip.text, tone: chip.tone).accessibilityIdentifier("aerodrome-status")
                }
            }
            .textCase(nil)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("aerodrome-hours-item")
    }

    @ViewBuilder
    private func hours(_ h: CoreBrief.Aerodromes.Hours) -> some View {
        if let ad = h.ad { line(h.day, ad).accessibilityIdentifier("ad-hours-day") }
        if let ats = h.ats { line("ATS", ats) }
        if let handling = h.handling { line("Handling", handling).accessibilityIdentifier("ad-hours-handling") }
        if let customs = h.customs { labelled("Customs", Text(customs)) }
        ForEach(h.notams, id: \.key) { n in
            labelled("NOTAM", Text("\(Text(n.key).bold()) \(n.summary)\(n.text.map { " · \($0)" } ?? "")"))
                .accessibilityIdentifier("ad-hours-notam")
        }
        labelled("AIP", Text(h.source))
        if !h.aip.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(h.aip, id: \.label) { l in
                    Text("\(Text(l.label).bold()) \(l.text)").font(.footnote)
                }
                if !h.notes.isEmpty {
                    Text(h.notes.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                }
            }
            .accessibilityIdentifier("ad-hours-aip-text")
        }
    }

    private func line(_ label: String, _ d: CoreBrief.Aerodromes.Day) -> some View {
        labelled(
            label,
            Text(
                "\(d.text)\(d.notams.isEmpty ? "" : " ")\(Text(d.notams.isEmpty ? "" : "NOTAM \(d.notams.joined(separator: ", "))").bold().foregroundColor(.orange))"
            ))
    }

    private func labelled(_ label: String, _ value: Text) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(minWidth: 84, alignment: .leading)
            value.frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }
}
