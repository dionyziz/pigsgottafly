import SwiftUI

/// Before a plan goes to ATC: the backend, the flight, the AFTN addressees, the e-mail copies and the
/// message, exactly as POST /api/flights/:id/filing will carry them.
struct FileConfirmSheet: View {
    @ObservedObject var filing: FilingModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let v = filing.view {
                    Section("Sent via") {
                        Text(v.sendsVia).accessibilityIdentifier("confirm-via")
                    }
                    if let h = v.head {
                        Section("Flight") {
                            ValueRow(label: "Aircraft", value: h.ident)
                            ValueRow(label: "Departure", value: "\(h.adep) \(h.eobt)Z")
                            ValueRow(label: "Destination", value: h.ades)
                            if !h.dof.isEmpty { ValueRow(label: "Date of flight", value: h.dof) }
                        }
                    }
                    Section("AFTN addressees (\(v.addresses.count))") {
                        ForEach(v.addresses, id: \.self) { Text($0).font(.body.monospaced()) }
                    }
                    Section("Copy by e-mail") {
                        if v.copyTo.isEmpty {
                            Text("To you").foregroundStyle(.secondary)
                        } else {
                            ForEach(v.copyTo, id: \.self) { Text($0) }
                            Text("With you in copy").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Section("Message") {
                        Text(v.request?["fpl"]?.string ?? "")
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                            .accessibilityIdentifier("confirm-message")
                    }
                }
                if let e = filing.error {
                    Section { Text(e).foregroundStyle(.red).accessibilityIdentifier("confirm-error") }
                }
            }
            .navigationTitle("File the flight plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not now") { dismiss() }.disabled(filing.busy != nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(filing.busy == .file ? "Filing…" : "File") {
                        Task { if await filing.file() { dismiss() } }
                    }
                    .disabled(filing.busy != nil || filing.view?.file.enabled != true)
                    .accessibilityIdentifier("confirm-file")
                }
            }
        }
        .interactiveDismissDisabled(filing.busy != nil)
    }
}

/// A new EOBT for the filed plan: checked as the server checks it, with the DLA a fax carries.
struct DelaySheet: View {
    @ObservedObject var filing: FilingModel
    @Environment(\.dismiss) private var dismiss
    @State private var eobt: Date
    @State private var check: CoreFilingDelay?

    private static let utc = TimeZone(identifier: "UTC")!

    @State private var started = false

    init(filing: FilingModel) {
        self.filing = filing
        // until the core says where the delay starts (PGF.filingDelay start)
        _eobt = State(initialValue: filing.eobt ?? FlightModel.clock ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ValueRow(label: "Filed EOBT", value: FilingModel.dateTimeZ(filing.view?.filing?.eobt))
                }
                Section("New EOBT (UTC)") {
                    DatePicker("New EOBT", selection: $eobt, displayedComponents: [.date, .hourAndMinute])
                        .environment(\.timeZone, Self.utc)
                        .accessibilityIdentifier("delay-eobt")
                    HStack {
                        ForEach([15, 30, 60], id: \.self) { min in
                            Button("+\(min) min") { eobt = eobt.addingTimeInterval(Double(min) * 60) }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("delay-plus-\(min)")
                        }
                    }
                    ValueRow(
                        label: "New EOBT", value: FilingModel.dateTimeZ((eobt.timeIntervalSince1970 * 1000).rounded())
                    )
                    .accessibilityIdentifier("delay-new")
                    if let p = check?.problem {
                        Text(p).foregroundStyle(.red).accessibilityIdentifier("delay-problem")
                    }
                }
                Section("Sent") {
                    if let c = check {
                        Text(c.via).font(c.message == nil ? .callout : .footnote)
                            .foregroundStyle(c.message == nil ? .primary : .secondary)
                    }
                    if let m = check?.message {
                        Text(m).font(.callout.monospaced()).textSelection(.enabled)
                            .accessibilityIdentifier("delay-message")
                    }
                }
                if let e = filing.error {
                    Section { Text(e).foregroundStyle(.red).accessibilityIdentifier("delay-error") }
                }
            }
            .navigationTitle("Delay")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                guard !started else { return }
                started = true
                if let s = await filing.delayCheck(nil)?.start { eobt = Date(timeIntervalSince1970: s / 1000) }
            }
            .task(id: eobt) { check = await filing.delayCheck(eobt) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not now") { dismiss() }.disabled(filing.busy != nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(filing.busy == .delay ? "Sending…" : "Send delay") {
                        Task { if await filing.delay(to: eobt) { dismiss() } }
                    }
                    .disabled(filing.busy != nil || check == nil || check?.problem != nil)
                    .accessibilityIdentifier("confirm-delay")
                }
            }
        }
        .interactiveDismissDisabled(filing.busy != nil)
    }
}

/// The ICAO flight plan form filled from the message (the website's FplForm, printed on the device),
/// signed by the pilot as the website's page signs it when it opens.
struct FplFormView: View {
    @ObservedObject var filing: FilingModel
    @ObservedObject var model: FlightModel
    @StateObject private var pdf = SheetExport()
    @State private var signedAt = (Date().timeIntervalSince1970 * 1000).rounded()

    var body: some View {
        Group {
            if let file = pdf.file {
                PDFPreview(file: file, title: "Flight plan")
            } else if let e = pdf.error {
                ContentUnavailableView("No form", systemImage: "doc.plaintext", description: Text(e))
            } else {
                ProgressView("Preparing the form…")
            }
        }
        .navigationTitle("Flight plan")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: key) { make() }
        .accessibilityIdentifier("fpl-form-pdf")
    }

    private var key: String {
        [filing.fpl?.fpl.message ?? "", filing.view?.addresses.joined(separator: " ") ?? ""].joined()
    }

    private func make() {
        guard let m = filing.fpl, let fields = try? JSON.parse(Core.text(m.fpl)) else { return }
        let name = model.app.store.text(.pilot).flatMap { try? JSON.parse($0) }?["fullName"]?.string ?? ""
        var content: [String: JSON] = [
            "fpl": fields, "addresses": .array((filing.view?.addresses ?? []).map(JSON.string)),
        ]
        if !name.trimmingCharacters(in: .whitespaces).isEmpty {
            content["signature"] = ["name": .string(name), "signedAt": .number(signedAt)]
        }
        let date = model.date
        pdf.update(key: key, name: [date, "flight-plan"].filter { !$0.isEmpty }.joined(separator: "-"), .fplform) {
            .object(content)
        }
    }
}
