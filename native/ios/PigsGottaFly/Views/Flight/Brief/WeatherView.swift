import SwiftUI

/// METAR and TAF for the route's aerodromes and alternates, in route order.
struct WeatherView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        List {
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
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
        .accessibilityIdentifier(FlightSection.weather.screenID)
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
