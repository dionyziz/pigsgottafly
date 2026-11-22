import SwiftUI

/// Take-off & landing distances with the runway and surface (phase 1D). Until then, the website's page.
struct PerformanceView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.performance)
    }
}
