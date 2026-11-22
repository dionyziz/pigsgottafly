import SwiftUI

/// What the core warns about the flight (computeFlight `warnings`), each with its Fix.
struct WarningsView: View {
    @ObservedObject var model: FlightModel
    @Environment(\.focusRouter) private var focus

    var body: some View {
        List {
            Section("Warnings") {
                if let c = model.computed {
                    if c.warnings.isEmpty { Text("No warnings.").foregroundStyle(.secondary) }
                    ForEach(c.warnings, id: \.self) { w in
                        HStack(alignment: .firstTextBaseline) {
                            Label(w, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            Spacer()
                            Button("Fix") { focus.fix(text: w) }
                                .buttonStyle(.borderless)
                                .accessibilityIdentifier("warning-fix")
                        }
                    }
                } else {
                    Text("Preparing…").foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(FlightSection.warnings.screenID)
    }
}
