import SwiftUI

/// What a check found about one field (the core's validateAircraft / personIssues `issues`, the
/// website's field issues): an error stops a save or a form, a warning does not.
struct FieldIssue: Equatable, Hashable, Identifiable, Sendable {
    enum Level: String, Sendable {
        case error, warning
    }
    var level: Level
    var message: String
    var id: String { "\(level.rawValue):\(message)" }
}

/// A text field with its issues under it, as the website shows them under its inputs.
struct IssueField: View {
    var label: String
    @Binding var text: String
    var issues: [FieldIssue] = []
    var prompt: String?
    var id: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(label) {
                TextField(label, text: $text, prompt: prompt.map { Text($0) })
                    .multilineTextAlignment(.trailing)
                    .accessibilityIdentifier(id)
            }
            ForEach(issues) { issue in
                Label(
                    issue.message,
                    systemImage: issue.level == .error ? "xmark.octagon.fill" : "exclamationmark.triangle.fill"
                )
                .font(.footnote)
                .foregroundStyle(issue.level == .error ? .red : .orange)
                // one element that reads the message: the symbol would otherwise be its own, "Error"
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(issue.message)
                .accessibilityIdentifier("\(id)-issue")
            }
        }
    }
}
