import SwiftUI

struct FlightsView: View {
    @EnvironmentObject private var app: AppModel
    @Binding var selection: String?
    @Binding var showAccount: Bool
    /// `-newFlight [ICAO]` opens New flight at launch, with that destination (screenshots).
    @State private var showNewFlight = ProcessInfo.processInfo.arguments.contains("-newFlight")

    var body: some View {
        List(selection: $selection) {
            if !app.mine.isEmpty {
                Section("My flights") {
                    ForEach(app.mine) { row($0) }
                }
            }
            if !app.shared.isEmpty {
                Section("Shared with me") {
                    ForEach(app.shared) { row($0) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if app.flights.isEmpty {
                if app.loadingFlights {
                    ProgressView()
                } else if let e = app.flightsError {
                    ContentUnavailableView("No flights", systemImage: "wifi.slash", description: Text(e))
                } else {
                    ContentUnavailableView {
                        Label("No flights yet", systemImage: "airplane")
                    } description: {
                        Text("Start one here, or plan it on pigsgottafly.com with the same account.")
                    } actions: {
                        Button("New flight") { showNewFlight = true }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("new-flight-empty")
                    }
                }
            }
        }
        .navigationTitle("Flights")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showNewFlight = true
                } label: {
                    Image(systemName: "plus").imageScale(.large)
                }
                .accessibilityLabel("New flight")
                .accessibilityIdentifier("new-flight")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAccount = true
                } label: {
                    Image(systemName: "person.crop.circle").imageScale(.large)
                }
                .accessibilityLabel("Account")
                .accessibilityIdentifier("account")
            }
        }
        .sheet(isPresented: $showNewFlight) {
            NewFlightView(destination: LaunchArgs.value("-newFlight")) { id in selection = id }
        }
        .refreshable { await app.loadFlights() }
        .task { await app.loadFlights() }
    }

    private func row(_ item: FlightListItem) -> some View {
        FlightRow(item: item)
            .tag(item.id)
            .accessibilityIdentifier("flight-\(item.id)")
            .swipeActions(edge: .leading) {
                if item.sharedBy == nil {
                    Button("Fly again") { Task { selection = await app.flyAgain(item) ?? selection } }.tint(.blue)
                }
            }
            .contextMenu {
                if item.sharedBy == nil {
                    Button("Fly again", systemImage: "arrow.clockwise") {
                        Task { selection = await app.flyAgain(item) ?? selection }
                    }
                }
            }
    }
}

struct FlightRow: View {
    var item: FlightListItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.title).font(.headline)
                Spacer()
                FilingBadge(status: item.filingStatus)
            }
            Text(when).font(.subheadline)
            Text(details).font(.subheadline).foregroundStyle(.secondary)
            if let by = item.sharedBy {
                Label("Shared by \(by.name)", systemImage: "person.2").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var when: String {
        var parts = [Fmt.day(item.summary.date.isEmpty ? item.date : item.summary.date)]
        if !item.summary.blockOff.isEmpty { parts.append("\(item.summary.blockOff)Z") }
        return parts.joined(separator: " · ")
    }

    private var details: String {
        var parts: [String] = []
        if !item.summary.aircraft.isEmpty { parts.append(item.summary.aircraft) }
        if let d = item.summary.distNm, d > 0 { parts.append(Fmt.distance(d)) }
        if let e = item.summary.eteMin { parts.append(Fmt.duration(e)) }
        return parts.isEmpty ? " " : parts.joined(separator: " · ")
    }
}

struct FilingBadge: View {
    var status: String?

    var body: some View {
        let label = FilingStatusLabel.label(status)
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .accessibilityLabel("Flight plan: \(label)")
    }

    private var color: Color {
        switch status {
        case "filed", "departed", "arriving", "arrived", "closed", "delivered": .green
        case "rejected", "cancelled", "suspended", "failed": .red
        case "manual_correction", "created", "sending": .orange
        default: .secondary
        }
    }
}
