import SwiftUI

/// The operators the pilot flies for or shares (GET /api/operators).
struct OperatorsView: View {
    @EnvironmentObject private var app: AppModel
    var selection: Binding<String?>?

    var body: some View {
        RecordList(
            title: "Operators", id: "operator-list", rowPrefix: "operator", empty: "No operators yet",
            load: { try await app.api.operators(as: [JSON].self) },
            label: { ($0["name"]?.string ?? "Operator", nil) },
            selection: selection
        ) { OperatorEditorView(operatorId: $0["id"]?.string) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    OperatorEditorView(operatorId: nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add an operator")
                .accessibilityIdentifier("add-operator")
            }
        }
    }
}
