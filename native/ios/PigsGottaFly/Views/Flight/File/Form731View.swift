import SwiftUI

/// Form 731: signature links and sending to HCAA (phase 2A). Until then, the website's page.
struct Form731View: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.form731)
    }
}
