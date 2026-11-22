import SwiftUI

/// Fuel on board per fuel type and the taxi allowance (phase 1B). Until then, the website's page.
struct FuelView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.fuel)
    }
}
