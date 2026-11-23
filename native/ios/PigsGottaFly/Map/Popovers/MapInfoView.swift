import SwiftUI

/// The details of what is at a tapped place (the website's map details box, MapPopover): the
/// aerodrome with its hours of the flight's day, the radio navaid, the airspaces and the NOTAM areas,
/// one open at a time as there. A sheet with detents on iPhone, a popover beside the place on iPad.
struct MapInfoView: View {
    var info: MapInfo
    /// Opens a link (AIP PDFs, VFR charts) in the in-app browser.
    var open: (URL) -> Void
    /// The NOTAMs section of the briefing (the website selects the NOTAM in its panel).
    var openNotams: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var expanded: String?

    var body: some View {
        NavigationStack {
            List {
                if let a = info.aerodrome { AerodromeSection(a: a, open: open) }
                if let n = info.navaid { NavaidSection(n: n, open: open) }
                if !info.airspaces.isEmpty {
                    Section("Airspace") {
                        ForEach(info.airspaces) { a in
                            DisclosureGroup(isExpanded: binding(a.id)) {
                                AirspaceBody(a: a, open: open)
                            } label: {
                                AirspaceHead(a: a)
                            }
                            .accessibilityIdentifier("airspace-item")
                        }
                    }
                    .accessibilityIdentifier("airspace-pop")
                }
                if !info.notams.isEmpty {
                    Section("NOTAM") {
                        ForEach(info.notams) { n in
                            DisclosureGroup(isExpanded: binding(n.key)) {
                                NotamBody(n: n, openNotams: openNotams)
                            } label: {
                                NotamHead(n: n)
                            }
                            .accessibilityIdentifier("notam-item")
                        }
                    }
                    .accessibilityIdentifier("notam-pop")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("map-pop-close")
                }
            }
        }
        .accessibilityIdentifier("map-pop")
        .onAppear { expanded = info.airspaces.first?.id ?? info.notams.first?.key }
        .frame(minWidth: 340, idealWidth: 400, minHeight: 320, idealHeight: 520)
    }

    private var title: String {
        if let a = info.aerodrome { return a.icao ?? a.title }
        if let n = info.navaid { return n.title }
        return "Details"
    }

    /// One airspace or NOTAM open at a time (the website's accordion).
    private func binding(_ id: String) -> Binding<Bool> {
        Binding(get: { expanded == id }, set: { expanded = $0 ? id : (expanded == id ? nil : expanded) })
    }
}

// MARK: rows

private struct TypeBadge: View {
    var text: String
    var color: Color
    var faint = false

    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .foregroundStyle(.white)
            .background(color.opacity(faint ? 0.45 : 1), in: RoundedRectangle(cornerRadius: 4))
    }
}

private struct DetailRow: View {
    var row: MapRow

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(row.label).font(.subheadline).foregroundStyle(.secondary).frame(width: 92, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.text).font(.subheadline).textSelection(.enabled)
                if let n = row.notams, !n.isEmpty {
                    Text("NOTAM \(n.joined(separator: ", "))").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
            }
        }
    }
}

private struct LinkRow: View {
    var title: String
    var url: String
    var open: (URL) -> Void

    var body: some View {
        if let u = URL(string: url) {
            Button {
                open(u)
            } label: {
                Label(title, systemImage: "doc.richtext")
            }
            .accessibilityIdentifier("aip-link")
        }
    }
}

private struct ChartLinks: View {
    var charts: [VfrChartLink]
    var open: (URL) -> Void

    var body: some View {
        ForEach(charts, id: \.icao) { c in
            if let u = URL(string: c.url) {
                Button {
                    open(u)
                } label: {
                    Label("VFR chart \(c.icao)", systemImage: "map")
                }
                .accessibilityIdentifier("vfr-chart-link")
            }
        }
    }
}

// MARK: aerodrome

private struct AerodromeSection: View {
    var a: AerodromeCard
    var open: (URL) -> Void

    var body: some View {
        Section {
            HStack {
                TypeBadge(text: "AD", color: .indigo)
                Text(a.title).font(.headline)
                Spacer()
                if let e = a.elevFt { Text("\(e) ft").foregroundStyle(.secondary) }
            }
            if a.published {
                ForEach(a.rows, id: \.self) { DetailRow(row: $0) }
                    .accessibilityIdentifier("ad-hours")
                ForEach(a.notams, id: \.self) { n in
                    DetailRow(
                        row: MapRow(label: "NOTAM", text: "\(n.key) \(n.summary)" + (n.text.map { " · \($0)" } ?? ""))
                    )
                    .accessibilityIdentifier("ad-hours-notam")
                }
                if !a.partial.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(a.partial, id: \.self) { r in
                            (Text(r.label).bold() + Text(" \(r.text)")).font(.caption)
                        }
                        if !a.partialNotes.isEmpty {
                            Text(a.partialNotes.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("ad-hours-aip-text")
                }
                if let s = a.hoursSource { LinkRow(title: s.ref, url: s.url, open: open) }
            } else {
                Text("No operational hours published for this aerodrome.").foregroundStyle(.secondary)
            }
            LinkRow(title: "AIP Greece \(a.source.ref) (PDF)", url: a.source.url, open: open)
            ChartLinks(charts: a.charts, open: open)
        } header: {
            Text("Aerodrome")
        } footer: {
            Text("AIRAC \(a.airac)")
        }
        .accessibilityIdentifier("aerodrome-pop")
    }
}

// MARK: navaid

private struct NavaidSection: View {
    var n: NavaidCard
    var open: (URL) -> Void

    var body: some View {
        Section {
            HStack {
                TypeBadge(text: n.type, color: .teal)
                Text(n.title).font(.headline)
                Spacer()
                Text(n.freq).foregroundStyle(.secondary)
            }
            ForEach(n.rows, id: \.self) { DetailRow(row: $0) }
            ForEach(n.sources, id: \.self) { s in LinkRow(title: "AIP Greece \(s.ref)", url: s.url, open: open) }
            ChartLinks(charts: n.charts, open: open)
        } header: {
            Text("Radio navaid")
        } footer: {
            Text("AIRAC \(n.airac)")
        }
        .accessibilityIdentifier("navaid-pop")
    }
}

// MARK: airspace

private func airspaceColor(_ type: String) -> Color {
    switch type {
    case "P": .red
    case "R": .orange
    case "D": .pink
    case "CTR", "ATZ": .blue
    case "MIL", "MTMA": .brown
    case "ACT": .green
    default: .purple
    }
}

private struct AirspaceHead: View {
    var a: AirspaceCard

    var body: some View {
        HStack {
            TypeBadge(text: a.type, color: airspaceColor(a.type))
            Text(a.title).lineLimit(2)
            Spacer()
            Text([a.cls, a.vertical].filter { !$0.isEmpty }.joined(separator: " "))
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct AirspaceBody: View {
    var a: AirspaceCard
    var open: (URL) -> Void

    var body: some View {
        ForEach(a.rows, id: \.self) { DetailRow(row: $0) }
        if a.showUnits {
            if a.units.isEmpty {
                DetailRow(row: MapRow(label: "Units", text: "None published"))
            } else {
                ForEach(a.units, id: \.self) { u in
                    DetailRow(
                        row: MapRow(
                            label: u == a.units.first ? "Units" : "",
                            text: ([u.callsign] + [u.freqs.joined(separator: " · ")].filter { !$0.isEmpty }).joined(
                                separator: " ")
                                + (u.hours.map { " · \($0)" } ?? "")))
                }
            }
        }
        if !a.remarks.isEmpty { DetailRow(row: MapRow(label: "Remarks", text: a.remarks)) }
        ChartLinks(charts: a.charts, open: open)
        LinkRow(title: "AIP \(a.source.ref) · AIRAC \(a.airac)", url: a.source.url, open: open)
    }
}

// MARK: NOTAM

private struct NotamHead: View {
    var n: NotamCard

    var body: some View {
        HStack {
            TypeBadge(text: "NOTAM", color: .orange, faint: !n.relevant)
            Text("\(n.key) · \(n.where)")
            Spacer()
            Text(n.limits).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct NotamBody: View {
    var n: NotamCard
    var openNotams: (() -> Void)?
    @State private var raw = false

    var body: some View {
        DetailRow(
            row: MapRow(label: "Subject", text: "\(n.subject) (\(n.qcode))" + (n.autorouter ? " · autorouter" : "")))
        DetailRow(row: MapRow(label: "Valid", text: n.validity + (n.schedule.map { "\n\($0)" } ?? "")))
        DetailRow(row: MapRow(label: "Vertical", text: n.limits))
        if let leg = n.leg { DetailRow(row: MapRow(label: "Leg", text: leg)) }
        Text(n.text).font(.callout.monospaced()).textSelection(.enabled)
        Button(raw ? "Hide ICAO" : "Show ICAO") { raw.toggle() }
        if raw { Text(n.raw).font(.caption.monospaced()).textSelection(.enabled) }
        if let openNotams {
            Button("Open in NOTAMs", action: openNotams)
        }
    }
}
