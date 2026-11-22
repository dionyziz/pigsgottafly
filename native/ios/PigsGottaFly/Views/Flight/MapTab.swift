import SwiftUI

/// The planning chart: the route over the flight's layers, framed to fit. Phase 1E adds route editing,
/// the layer menu and the feature sheets.
struct MapTab: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @State private var following = false

    var body: some View {
        ChartMapView(
            styleURL: model.styleURL, chartData: model.chartData, symbols: app.symbols,
            route: model.routeCoordinates, fix: nil, trackUp: false, following: $following
        )
        .ignoresSafeArea(.container, edges: .horizontal)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(FlightTab.map.bodyID)
    }
}
