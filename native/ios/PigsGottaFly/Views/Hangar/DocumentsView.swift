import SwiftUI

/// The aircraft's documents (phase 2C). Until then, the aircraft's page on the website.
struct DocumentsView: View {
    var aircraftId: String

    var body: some View {
        SectionStub(title: "Documents", systemImage: "doc.on.doc", path: "hangar/\(aircraftId)", id: "hangar-documents")
    }
}
