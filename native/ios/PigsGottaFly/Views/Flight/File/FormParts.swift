import SwiftUI

// What the Form 731, General Declaration and W&B & performance screens share: the sheet's preview
// row, the missing details with their Fix, a send button, and the server's answer under it.

/// Opens the PDF made on the device (SheetRenderer), with Share and Print.
struct FormPreviewRow: View {
    var title: String
    @ObservedObject var pdf: SheetExport
    var id: String

    var body: some View {
        if let file = pdf.file {
            NavigationLink {
                PDFPreview(file: file, title: title)
            } label: {
                HStack {
                    Label(title, systemImage: "doc.richtext")
                    Spacer()
                    if pdf.busy { ProgressView() }
                }
            }
            .accessibilityIdentifier(id)
        } else if let e = pdf.error {
            Label(e, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                .accessibilityIdentifier("\(id)-error")
        } else {
            HStack {
                Text("Preparing \(title)…").foregroundStyle(.secondary)
                Spacer()
                ProgressView()
            }
        }
    }
}

/// What is missing from a filled form, each with its Fix (the website's FormWarnings, ExportWarnings).
/// `fixes`: the model's fix of each warning by its text (a form's), or nil to resolve the text itself.
struct FormWarningsSection: View {
    var warnings: [String]
    var fixes: JSON?
    var title = "Missing details"
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @Environment(\.focusRouter) private var focus
    @State private var targets: [String: CoreFocusTarget] = [:]

    var body: some View {
        if !warnings.isEmpty {
            Section(title) {
                ForEach(warnings, id: \.self) { w in
                    HStack(alignment: .firstTextBaseline) {
                        Label(w, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let t = targets[w] {
                            Button("\(t.focus != nil ? "Fix" : (t.link?.label ?? "Fix")) →") { focus.route(t) }
                                .buttonStyle(.borderless)
                                .font(.subheadline)
                                .accessibilityIdentifier("form-warning-fix")
                        }
                    }
                }
            }
            .task(id: warnings) { await resolve() }
        }
    }

    private func resolve() async {
        guard let core = app.core else { return }
        let flightId = model.id
        let aircraftId = model.flight?["aircraftId"]?.string
        var out: [String: CoreFocusTarget] = [:]
        for w in warnings {
            let fix = fixes?[w]?.text
            if let t = try? await core.run({
                try $0.focusTarget(text: w, fix: fix, flightId: flightId, aircraftId: aircraftId)
            }), t.fix != nil || t.focus != nil || t.link != nil {
                out[w] = t
            }
        }
        targets = out
    }
}

/// A send button with "Sending…" while it runs, and why it cannot be pressed.
struct FormSendButton: View {
    var label: String
    var enabled: Bool
    var hint: String?
    var sending: Bool
    var id: String
    var action: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                Task { await action() }
            } label: {
                Label(sending ? "Sending…" : label, systemImage: "paperplane.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!enabled || sending)
            .accessibilityIdentifier(id)
            if !enabled, let hint, !hint.isEmpty {
                Text(hint).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("\(id)-hint")
            }
        }
    }
}

/// A line the server's state says (sent to whom and when; why nothing can be e-mailed), or an error.
struct FormNote: View {
    var text: String
    var error = false
    var id: String?

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(error ? .red : .secondary)
            .accessibilityIdentifier(id ?? (error ? "form-error" : "form-note"))
    }
}

extension BriefTone {
    /// The panels' 'ok' | 'warn' | 'danger'.
    init(panel: String) { self = BriefTone(rawValue: panel) ?? .warn }
}

extension SheetInputs {
    /// When the stored inputs of a form's sheet besides the flight were last written: the pilot's
    /// profile, the aircraft and the reference data (a form cannot be drawn without them).
    @MainActor
    static func key(_ app: AppModel, _ model: FlightModel) -> String {
        let aircraft = model.flight?["aircraftId"]?.string.map { Store.Key.aircraft($0) }
        return ([.pilot, app.store.refKey(date: model.flight?["date"]?.string)] + [aircraft].compactMap { $0 })
            .map { app.store.modified($0).map { "\($0.timeIntervalSince1970)" } ?? "-" }
            .joined(separator: ",")
    }
}
