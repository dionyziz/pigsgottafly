import SwiftUI

/// An operator: its details, declaration recipients and contacts (phase 1G), documents (2C); Share
/// (the website's operator page Share and People with access) opens the share sheet.
struct OperatorEditorView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// nil: a new operator.
    var operatorId: String?
    @State private var sharing: ShareTarget?

    var body: some View {
        SectionStub(
            title: operatorId == nil ? "New operator" : "Operator", systemImage: "building.2",
            path: operatorId.map { "operators/\($0)" } ?? "operators", id: "operator-page"
        )
        .toolbar {
            if let operatorId {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await share(operatorId) }
                    } label: {
                        Image(systemName: "person.2")
                    }
                    .accessibilityLabel("Share")
                    .accessibilityIdentifier("share-operator")
                }
            }
        }
        .sheet(item: $sharing) { t in
            // leaving: the website says "You no longer have …" and goes back to the operators
            ShareSheet(target: t) { dismiss() }
        }
    }

    /// The sheet's title is the operator's name; the sharing names it too once it loads.
    private func share(_ id: String) async {
        let op: JSON? = try? await app.api.operatorItem(id)
        sharing = ShareTarget(kind: .operator, id: id, name: op?["name"]?.string ?? "Operator")
    }
}
