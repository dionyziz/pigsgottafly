import SafariServices
import SwiftUI

/// Brief: the "Ready to fly" checklist, times and daylight, METAR/TAF, NOTAMs and the filing status;
/// the forms on the website's File & forms page.
struct BriefView: View {
    @ObservedObject var model: FlightModel
    @State private var showForms = false

    var body: some View {
        List {
            readiness
            times
            aerodromes
            weather
            notams
            filing
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .sheet(isPresented: $showForms) {
            SafariView(url: API.site.appendingPathComponent("flights/\(model.id)/export/fpl")).ignoresSafeArea()
        }
        .accessibilityIdentifier("brief")
    }

    // MARK: sections

    private var readiness: some View {
        Section("Ready to fly") {
            let rows = (model.computed?.readiness ?? []) + model.paperwork
            if rows.isEmpty {
                Text(model.computed == nil ? "Preparing…" : "Nothing to check.").foregroundStyle(.secondary)
            }
            ForEach(rows) { ReadyRow(item: $0) }
        }
    }

    private var times: some View {
        Section("Times (UTC)") {
            if let c = model.computed {
                ValueRow(label: "Date", value: Fmt.day(model.date))
                ValueRow(label: "Block off", value: c.blockOff.map { "\($0)Z" } ?? Fmt.dash)
                ValueRow(label: "Take-off", value: c.takeoff.map { "\($0)Z" } ?? Fmt.dash)
                ValueRow(label: "Landing", value: c.landing.map { "\($0)Z" } ?? Fmt.dash)
                ValueRow(label: "Block on", value: c.blockOn.map { "\($0)Z" } ?? Fmt.dash)
                ValueRow(label: "Sunset", value: c.sunset.map { "\($0)Z" } ?? Fmt.dash)
            } else {
                Text("Preparing…").foregroundStyle(.secondary)
            }
        }
    }

    /// Each aerodrome of the route at the time the flight uses it (the website's Aerodromes section).
    @ViewBuilder
    private var aerodromes: some View {
        if let c = model.computed, !c.aerodromes.isEmpty {
            Section("Aerodromes") {
                ForEach(c.aerodromes) { AerodromeRow(check: $0) }
            }
        }
    }

    private var weather: some View {
        Section("METAR and TAF") {
            if let m = model.metar, !m.stations.isEmpty {
                ForEach(stationOrder(m), id: \.self) { icao in
                    let s = m.stations[icao]!
                    VStack(alignment: .leading, spacing: 4) {
                        Text(icao).font(.headline)
                        if let metar = s.metar { Code(text: metar) }
                        if let taf = s.taf { Code(text: taf) }
                        if s.metar == nil && s.taf == nil { Text("No report.").foregroundStyle(.secondary) }
                    }
                    .padding(.vertical, 2)
                    .accessibilityIdentifier("wx-\(icao)")
                }
            } else {
                Text(model.offline ? "No weather saved for this flight." : "No reports yet.").foregroundStyle(
                    .secondary)
            }
        }
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

    private var filing: some View {
        Section("Flight plan") {
            let status = model.filing?.filing?.status
            HStack {
                Text("Status")
                Spacer()
                FilingBadge(status: status)
            }
            if let eobt = model.filing?.filing?.eobt {
                ValueRow(label: "EOBT", value: Fmt.zulu(Date(timeIntervalSince1970: eobt / 1000)))
            }
            if let m = model.filing?.filing?.message, !m.isEmpty {
                Text(m).font(.callout).foregroundStyle(.secondary)
            }
            Button {
                showForms = true
            } label: {
                Label("File & forms", systemImage: "doc.text")
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .accessibilityHint("Opens the flight plan, Form 731, the General Declaration and the W&B on the website")
        }
    }

    private func groupTitle(_ g: NotamGroup) -> String {
        guard let icao = g.icao else { return "NOTAMs · Airspace" }
        let name = model.computed?.aerodromes.first { $0.icao == icao }?.name
        return name.map { "NOTAMs · \(icao) \($0)" } ?? "NOTAMs · \(icao)"
    }

    /// The route's aerodromes first, in route order, then the others.
    private func stationOrder(_ m: MetarTafResponse) -> [String] {
        let route = (model.flight?["route"]?.array ?? []).compactMap { $0["refId"]?.string ?? $0["name"]?.string }
        let alternates = (model.flight?["options"]?["alternates"]?.array ?? []).compactMap(\.string)
        var order: [String] = []
        for k in route + alternates + m.stations.keys.sorted() where m.stations[k] != nil && !order.contains(k) {
            order.append(k)
        }
        return order
    }
}

struct ReadyRow: View {
    var item: ReadyItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(color)
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
    private var color: Color {
        switch item.state {
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

struct NotamRow: View {
    var notam: Notam
    @State private var showRaw = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(notam.key).font(.subheadline.weight(.semibold).monospaced())
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

/// A report as published (monospaced, wraps).
struct Code: View {
    var text: String
    var body: some View {
        Text(text).font(.callout.monospaced()).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
    }
}

struct ValueRow: View {
    var label: String
    var value: String
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit().foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SafariView: UIViewControllerRepresentable {
    var url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
