import SwiftUI

/// The aircraft's photo (phase 2C). Until then, the aircraft's page on the website.
struct PhotoView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Photo", systemImage: "photo", path: "hangar/\(aircraftId)", id: "aircraft-photo")
    }
}
