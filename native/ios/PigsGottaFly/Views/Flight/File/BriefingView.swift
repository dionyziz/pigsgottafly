import SwiftUI

/// The NOTAM briefing as a PDF (phase 1H). Until then, the website's page.
struct BriefingView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.briefing)
    }
}
