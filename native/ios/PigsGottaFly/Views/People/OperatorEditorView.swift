import SwiftUI

/// An operator: its details, declaration recipients and contacts (phase 1G), people (2B), documents (2C).
struct OperatorEditorView: View {
    /// nil: a new operator.
    var operatorId: String?

    var body: some View {
        SectionStub(
            title: operatorId == nil ? "New operator" : "Operator", systemImage: "building.2",
            path: operatorId.map { "operators/\($0)" } ?? "operators", id: "operator-page")
    }
}
