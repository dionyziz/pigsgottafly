import SwiftUI

/// The ATC frequencies along the route, edited and regenerated (phase 1D). Until then, the website's page.
struct AtcView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.atc)
    }
}
