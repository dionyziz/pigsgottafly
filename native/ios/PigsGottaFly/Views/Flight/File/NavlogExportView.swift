import SwiftUI

/// The navigation log as a PDF: preview, share, print, e-mail (phase 1H). Until then, the website's page.
struct NavlogExportView: View {
    @ObservedObject var model: FlightModel

    var body: some View {
        model.stub(.navlogExport)
    }
}
