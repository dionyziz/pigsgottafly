import SwiftUI

/// METAR and TAF at the route's aerodromes and those near it, while the flight is about to start or
/// under way, fetched again every five minutes while shown (the website's MetarSection); the winds
/// aloft as used, refreshed with the reports.
struct WeatherView: View {
    @ObservedObject var model: FlightModel
    @State private var box: CoreBrief.Metar?
    @State private var refreshing = false

    /// How often the reports are fetched again while shown (MetarSection REFETCH_MS).
    private static let refetch: Duration = .seconds(5 * 60)

    var body: some View {
        List {
            reports
            winds
        }
        .listStyle(.insetGrouped)
        .refreshable { await refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if refreshing {
                    ProgressView()
                } else {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Refresh weather", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("weather-refresh")
                }
            }
        }
        .task(id: model.computed) { box = await model.brief()?.metar }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.refetch)
                if Task.isCancelled { break }
                if box?.shown == true { await model.refreshMetar() }
            }
        }
        .accessibilityIdentifier(FlightSection.weather.screenID)
    }

    private func refresh() async {
        refreshing = true
        await model.refreshWeather()
        refreshing = false
    }

    @ViewBuilder
    private var reports: some View {
        Section {
            if let box {
                if !box.shown {
                    Text("Shown from 6 hours before take-off until an hour after landing.").foregroundStyle(.secondary)
                } else if box.rows.isEmpty {
                    Text("No reports from these aerodromes.").foregroundStyle(.secondary)
                }
                // the ages move on by the minute
                TimelineView(.everyMinute) { context in
                    ForEach(box.rows) { MetarRow(row: $0, now: FlightModel.clock ?? context.date) }
                }
            } else {
                Text(model.computed == nil ? "Preparing…" : "Loading…").foregroundStyle(.secondary)
            }
        } header: {
            HStack {
                Text("METAR & TAF")
                Spacer()
                if let n = box?.rows.filter({ $0.metar != nil || $0.taf != nil }).count, n > 0 {
                    Text("\(n)").monospacedDigit()
                }
            }
        }
    }

    @ViewBuilder
    private var winds: some View {
        if let message = model.computed?.raw["weather"]?["winds"]?["message"]?.string, !message.isEmpty {
            Section("Winds aloft") {
                Label(message, systemImage: model.computed?.windsMessage == nil ? "wind" : "exclamationmark.triangle")
                    .foregroundStyle(model.computed?.windsMessage == nil ? Color.primary : Color.orange)
                    .accessibilityIdentifier("winds-status")
            }
        }
    }
}

struct MetarRow: View {
    var row: CoreBrief.Metar.Row
    var now: Date

    /// Older than this, the report's age shows as a warning (MetarSection STALE_MS).
    private static let staleMs = 75.0 * 60 * 1000

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.icao).font(.headline.monospaced())
                Text("\(row.place) · \(row.name)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                if let observed = row.observedMs {
                    let ms = now.timeIntervalSince1970 * 1000
                    Text(Self.age(observed, now: ms))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(ms - observed > Self.staleMs ? Color.orange : .secondary)
                        .accessibilityIdentifier("metar-age")
                }
            }
            if let m = row.metar {
                Code(text: m)
            } else {
                Text("No METAR from this aerodrome.").font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("metar-none")
            }
            if let t = row.taf { Code(text: t).foregroundStyle(.secondary).accessibilityIdentifier("taf") }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("wx-\(row.icao)")
    }

    /// '12 min ago', '1 h 5 min ago' (MetarSection age).
    static func age(_ ms: Double, now: Double) -> String {
        let min = max(0, Int(((now - ms) / 60000).rounded()))
        return min < 60 ? "\(min) min ago" : "\(min / 60) h \(min % 60) min ago"
    }
}
