import SwiftUI

/// The server's NOTAM briefing for the flight by group (departure, destination, other aerodromes, the
/// airspace), as the website's NotamSection: reloaded past the server's cache, the hidden ones on
/// request, each shown on the map, and the relevant ones marked read.
struct NotamsView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.focusRouter) private var focus
    @State private var list: CoreBrief.Notams?
    @State private var showAll = false
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            content
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if loading {
                    ProgressView()
                } else {
                    Button {
                        Task { await reload() }
                    } label: {
                        Label("Reload NOTAMs", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("notams-refresh")
                }
            }
        }
        .task(id: Key(computed: model.computed, notams: model.notams, showAll: showAll)) {
            list = await model.brief(showAll: showAll)?.notams
        }
        .accessibilityIdentifier(FlightSection.notams.screenID)
    }

    private struct Key: Equatable {
        var computed: ComputedFlight?
        var notams: NotamBriefing?
        var showAll: Bool
    }

    private func reload() async {
        loading = true
        error = await model.reloadNotams()
        loading = false
    }

    @ViewBuilder
    private var content: some View {
        if let error {
            Section { Text(error).foregroundStyle(.orange) }
        }
        if let b = list {
            if !b.ok {
                Section("NOTAMs") {
                    Text(b.message ?? "NOTAMs are not available.").foregroundStyle(.orange)
                        .accessibilityIdentifier("notams-status")
                }
            } else {
                Section {
                    if let meta = b.meta {
                        Text(meta).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("notams-meta")
                    }
                    if let m = b.message { Text(m).font(.footnote).foregroundStyle(.orange) }
                } header: {
                    HStack {
                        Text("NOTAMs")
                        Spacer()
                        if b.relevantCount > 0 {
                            ChipView(text: "\(b.relevantCount)", tone: .warn)
                        } else {
                            Text("none relevant")
                        }
                    }
                }
                if b.groups.isEmpty {
                    Section { Text("No NOTAM concerns this flight.").foregroundStyle(.secondary) }
                }
                ForEach(b.groups) { g in group(g) }
                markRead
                if b.hiddenCount > 0 {
                    Section {
                        Button(showAll ? "Show only the relevant ones" : "Show all (\(b.hiddenCount) hidden)") {
                            showAll.toggle()
                        }
                        .accessibilityIdentifier("notams-show-all")
                    }
                }
            }
        } else {
            Section("NOTAMs") {
                Text(placeholder).foregroundStyle(.secondary)
            }
        }
    }

    private var placeholder: String {
        if model.offline && model.notams == nil { return "No NOTAM briefing saved for this flight." }
        if model.route.isEmpty { return "No route." }
        return "Loading the NOTAM briefing…"
    }

    private func group(_ g: CoreBrief.Notams.Group) -> some View {
        Section {
            if g.notams.isEmpty {
                Text("No relevant NOTAMs.").foregroundStyle(.secondary)
            }
            ForEach(g.notams) { n in
                NotamRow(notam: n)
                    .swipeActions(edge: .leading) {
                        Button {
                            focus.showOnMap(notam: n.key, flightId: model.id)
                        } label: {
                            Label("Show on map", systemImage: "map")
                        }
                        .tint(.blue)
                        .accessibilityIdentifier("notam-show-on-map")
                    }
                    .contextMenu {
                        Button {
                            focus.showOnMap(notam: n.key, flightId: model.id)
                        } label: {
                            Label("Show on map", systemImage: "map")
                        }
                        ShareLink(item: n.raw)
                    }
                    .accessibilityAction(named: "Show on map") { focus.showOnMap(notam: n.key, flightId: model.id) }
            }
        } header: {
            HStack {
                if let icao = g.icao {
                    Text(icao).monospaced()
                    Text(g.name).lineLimit(1)
                } else {
                    Text("Airspace")
                }
                Spacer()
                Text("\(g.notams.count)").monospacedDigit()
            }
            .accessibilityIdentifier("notam-group-\(g.icao ?? "airspace")")
        }
    }

    @ViewBuilder
    private var markRead: some View {
        if model.notams?.notams.contains(where: \.relevant) == true {
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
}

struct NotamRow: View {
    var notam: CoreBrief.Notams.Item
    @State private var showRaw = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(notam.key).font(.subheadline.weight(.semibold).monospaced())
                Text(notam.place).font(.subheadline).foregroundStyle(.secondary)
                if notam.autorouter {
                    Text("autorouter").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                        .accessibilityIdentifier("notam-autorouter-only")
                }
                Spacer()
                if let leg = notam.leg { Text("leg \(leg)").font(.caption).foregroundStyle(.secondary) }
            }
            Text(notam.subject).font(.subheadline.weight(.medium))
            Text(([notam.validity, notam.limits] + [notam.schedule].compactMap { $0 }).joined(separator: " · "))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Text(notam.text).font(.body)
            if !notam.reasons.isEmpty {
                Text((notam.relevant ? "" : "Hidden: ") + notam.reasons.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(notam.relevant ? Color.orange : .secondary)
            }
            if showRaw { Code(text: notam.raw).accessibilityIdentifier("notam-raw") }
        }
        .padding(.vertical, 2)
        .opacity(notam.relevant ? 1 : 0.6)
        .contentShape(Rectangle())
        .onTapGesture { showRaw.toggle() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(showRaw ? "Hides the ICAO text" : "Shows the ICAO text")
        .accessibilityIdentifier("notam-\(notam.key)")
    }
}
