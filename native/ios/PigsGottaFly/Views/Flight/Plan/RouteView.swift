import SwiftUI

/// Route: the points in order, picked, reordered, inserted, renamed (phase 1B). Until then, the website's page.
struct RouteView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.route)
    }
}
