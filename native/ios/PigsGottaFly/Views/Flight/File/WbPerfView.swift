import SwiftUI

/// The W&B and performance sheets, previewed and sent to the operator (phase 2A). Until then, the website's page.
struct WbPerfView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.wbPerf)
    }
}
