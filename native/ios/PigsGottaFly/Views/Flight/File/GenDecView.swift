import SwiftUI

/// The General Declaration: who sends it, and sending (phase 2A). Until then, the website's page.
struct GenDecView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.genDec)
    }
}
