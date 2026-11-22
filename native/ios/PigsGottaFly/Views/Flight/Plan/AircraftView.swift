import SwiftUI

/// Aircraft, compass card and wind model (phase 1B). Until then, the website's page.
struct AircraftView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.aircraft)
    }
}
