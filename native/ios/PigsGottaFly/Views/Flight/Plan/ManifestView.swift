import SwiftUI

/// Manifest & loading: crew, seats, baggage, the W&B chart (phase 1C). Until then, the website's page.
struct ManifestView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.manifest)
    }
}
