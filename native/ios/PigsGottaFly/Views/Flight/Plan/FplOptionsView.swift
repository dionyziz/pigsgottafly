import SwiftUI

/// Flight plan options: alternates, remarks, touch-and-go and stop requests (phase 1B). Until then, the website's page.
struct FplOptionsView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.fplOptions)
    }
}
