import SwiftUI
import UIKit

/// The website's File & forms → Flight plan page (src/features/exports/fpl/FplExport.tsx and
/// FilingPanel.tsx): the filing status and what the backend reports, File (with a confirmation of
/// exactly what goes to whom), Delay with a new EOBT, Cancel and Refresh status; the backend, the AFTN
/// addressees and the e-mail copies to review; the FPL message with its warnings; the ICAO form; the
/// filing log. What may be done and how it reads is the website's (PGF.filingView).
struct FlightPlanView: View {
    @ObservedObject var model: FlightModel
    @StateObject private var filing: FilingModel
    @Environment(\.focusRouter) private var focus
    @State private var confirmFile = false
    @State private var showDelay = false
    @State private var confirmCancel = false
    @State private var typed = ""
    @State private var typedValid = false
    @State private var fixes: [String: CoreFocusTarget] = [:]
    @State private var copied = ""
    @State private var connector = AutorouterConnect()
    @State private var linking = false

    init(model: FlightModel) {
        self.model = model
        _filing = StateObject(wrappedValue: FilingModel(flight: model))
    }

    var body: some View {
        List {
            statusSection
            if let v = filing.view, !v.connectOnly {
                viaSection(v)
                addresseesSection(v)
                if !v.copies.isEmpty { copiesSection(v) }
            }
            messageSection
            if let v = filing.view, !v.log.isEmpty { logSection(v) }
        }
        .listStyle(.insetGrouped)
        .refreshable { await filing.load() }
        .task { await filing.load() }
        .task(id: model.computed?.raw.text) {
            await filing.makeMessage()
            await filing.rebuild()
            await resolveFixes()
        }
        .task(id: filing.view?.sending) { await filing.followDelivery() }
        .task(id: typed) { typedValid = await filing.typedAddress(typed) != nil }
        .sheet(isPresented: $confirmFile) { FileConfirmSheet(filing: filing) }
        .sheet(isPresented: $showDelay) { DelaySheet(filing: filing) }
        .confirmationDialog("Cancel the filed flight plan?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel the flight plan", role: .destructive) { Task { await filing.cancel() } }
                .accessibilityIdentifier("confirm-cancel-fpl")
            Button("Keep it", role: .cancel) {}
        } message: {
            Text(cancelText)
        }
        .accessibilityIdentifier(FlightSection.flightPlan.screenID)
    }

    // MARK: status and actions

    private var statusSection: some View {
        Section("Flight plan") {
            let v = filing.view
            HStack {
                Text("Status")
                Spacer()
                Text(v?.status.label ?? FilingStatusLabel.label(model.filing?.filing?.status))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tone(v?.status.tone))
                    .accessibilityIdentifier("fpl-filing-status")
            }
            if let r = v?.record {
                Text(r.via).font(.callout).accessibilityIdentifier("fpl-filing-via")
                if r.filed != nil { ValueRow(label: "Filed", value: FilingModel.dateTimeZ(r.filed)) }
                if r.polled != nil { ValueRow(label: "Checked", value: FilingModel.dateTimeZ(r.polled)) }
                if !r.message.isEmpty { Text(r.message).font(.callout).foregroundStyle(.secondary) }
            }
            if let eobt = v?.filing?.eobt {
                ValueRow(label: "EOBT", value: FilingModel.dateTimeZ(eobt)).accessibilityIdentifier("fpl-eobt")
            }
            if let why = v?.disabledReason {
                Label(why, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.orange)
                    .accessibilityIdentifier("fpl-filing-disabled")
            }
            if let e = filing.loadError {
                Label(e, systemImage: "wifi.slash").font(.callout).foregroundStyle(.orange)
            }
            if let e = filing.error {
                Text(e).font(.callout).foregroundStyle(.red).accessibilityIdentifier("fpl-filing-error")
            }
            if let v { actions(v) }
        }
    }

    @ViewBuilder
    private func actions(_ v: CoreFilingView) -> some View {
        if let label = v.connectLabel {
            Button(linking ? "Connecting…" : label) { Task { await connect() } }
                .disabled(linking)
                .accessibilityIdentifier("fpl-autorouter-connect")
        }
        if v.file.shown {
            Button {
                filing.error = nil
                confirmFile = true
            } label: {
                Text(filing.busy == .file ? "Filing…" : v.file.label).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!v.file.enabled)
            .accessibilityIdentifier("fpl-file")
            if let hint = v.file.hint {
                Text(hint).font(.footnote).foregroundStyle(.secondary)
            }
        }
        if v.delay.shown == true {
            Button(filing.busy == .delay ? "Delaying…" : "Delay…") {
                filing.error = nil
                showDelay = true
            }
            .disabled(!v.delay.enabled)
            .accessibilityIdentifier("fpl-delay")
        }
        if v.cancel.shown == true {
            Button(filing.busy == .cancel ? "Cancelling…" : "Cancel…", role: .destructive) { confirmCancel = true }
                .disabled(!v.cancel.enabled)
                .accessibilityIdentifier("fpl-cancel")
        }
        Button(filing.busy == .refresh ? "Checking…" : "Refresh status") { Task { await filing.refresh() } }
            .disabled(!v.refresh.enabled)
            .accessibilityIdentifier("fpl-refresh")
    }

    private var cancelText: String {
        let v = filing.view
        let via = v?.filing?.providerLabel ?? "the service that filed it"
        if let m = v?.cancelMessage { return "The cancellation is faxed to the same office: \(m)" }
        return "Sent through \(via), which cancels the plan with ATC."
    }

    private func tone(_ t: String?) -> Color {
        switch t {
        case "ok": .green
        case "danger": .red
        default: .secondary
        }
    }

    private func connect() async {
        linking = true
        defer { linking = false }
        do {
            let result = await connector.run(try await model.app.api.autorouterConnectURL())
            if result == "failed" { filing.error = "autorouter did not connect. Try again." }
        } catch {
            if !isCancellation(error) { filing.error = error.localizedDescription }
        }
        await filing.load()
    }

    // MARK: what is sent and to whom

    @ViewBuilder
    private func viaSection(_ v: CoreFilingView) -> some View {
        if let options = v.viaChoice {
            Section {
                Picker(
                    "Send via", selection: Binding(get: { v.chosen }, set: { id in Task { await filing.setVia(id) } })
                ) {
                    ForEach(options, id: \.id) { Text($0.label).tag($0.id) }
                }
                .accessibilityIdentifier("fpl-filing-via-choice")
            }
        } else if let line = v.viaLine {
            Section {
                Text(line).font(.callout).foregroundStyle(.secondary)
                    .accessibilityIdentifier("fpl-filing-via-choice")
            }
        }
    }

    private func addresseesSection(_ v: CoreFilingView) -> some View {
        Section {
            ForEach(v.addressees, id: \.address) { a in
                Toggle(
                    isOn: Binding(get: { a.on }, set: { on in Task { await filing.setAddress(a.address, on: on) } })
                ) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.address).font(.body.monospaced())
                        Text(a.reasons).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("addressee-\(a.address)")
            }
            HStack {
                TextField("e.g., LGMGZTZX", text: $typed)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await addTyped() } }
                    .accessibilityLabel("Add an AFTN address")
                    .accessibilityIdentifier("addressee-new")
                Button("Add") { Task { await addTyped() } }
                    .disabled(!typedValid)
                    .accessibilityIdentifier("addressee-add")
            }
        } header: {
            Text("AFTN addressees (\(v.addresses.count))").accessibilityIdentifier("fpl-addressee-count")
        }
    }

    private func addTyped() async {
        if await filing.addAddress(typed) { typed = "" }
    }

    private func copiesSection(_ v: CoreFilingView) -> some View {
        Section("Copy by e-mail") {
            ForEach(v.copies, id: \.email) { c in
                Toggle(isOn: Binding(get: { c.on }, set: { on in Task { await filing.setCopy(c.email, on: on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.email)
                        Text(c.for).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("copy-\(c.email)")
            }
        }
    }

    // MARK: the message

    @ViewBuilder
    private var messageSection: some View {
        Section("FPL message") {
            if let m = filing.fpl {
                Text(m.fpl.message)
                    .font(.callout.monospaced())
                    .textSelection(.enabled)
                    .accessibilityIdentifier("fpl-message")
                HStack {
                    Button(copied == "lines" ? "Copied" : "Copy message") { copy(m.fpl.message, "lines") }
                    Spacer()
                    Button(copied == "one" ? "Copied" : "Copy as one line") { copy(m.oneLine, "one") }
                }
                .buttonStyle(.borderless)
                NavigationLink("ICAO flight plan form") {
                    FplFormView(filing: filing, model: model)
                }
                .accessibilityIdentifier("fpl-form")
            } else {
                Text("Preparing…").foregroundStyle(.secondary)
            }
        }
        if let m = filing.fpl, !m.warnings.isEmpty {
            Section(m.fpl.complete ? "Check before filing" : "Incomplete") {
                ForEach(m.warnings, id: \.text) { w in
                    HStack(alignment: .firstTextBaseline) {
                        Label {
                            Text(w.text)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(m.fpl.complete ? Color.orange : .red)
                        }
                        Spacer()
                        if let t = fixes[w.text] {
                            Button("\(t.focus != nil ? "Fix" : (t.link?.label ?? "Fix")) →") { focus.route(t) }
                                .buttonStyle(.borderless)
                                .font(.subheadline)
                                .accessibilityIdentifier("warning-fix")
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("fpl-warning")
                }
            }
        }
    }

    private func copy(_ text: String, _ kind: String) {
        UIPasteboard.general.string = text
        copied = kind
        Task {
            try? await Task.sleep(for: .seconds(2))
            if copied == kind { copied = "" }
        }
    }

    private func resolveFixes() async {
        var out: [String: CoreFocusTarget] = [:]
        for w in filing.fpl?.warnings ?? [] where out[w.text] == nil {
            if let t = await filing.fixTarget(w) { out[w.text] = t }
        }
        fixes = out
    }

    private func logSection(_ v: CoreFilingView) -> some View {
        Section {
            DisclosureGroup("Filing log (\(v.log.count))") {
                ForEach(v.log, id: \.id) { l in
                    Text("\(FilingModel.dateTimeZ(l.at)) · \(l.line)")
                        .font(.footnote)
                        .foregroundStyle(l.ok ? Color.primary : .red)
                }
            }
            .accessibilityIdentifier("fpl-filing-log")
        }
    }
}
