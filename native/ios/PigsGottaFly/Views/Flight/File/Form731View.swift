import SwiftUI

/// Form 731 as the website's page has it (src/features/exports/form731/Form731.tsx, SignaturesPanel.tsx):
/// who has signed (the PIC signs when the form is made; each passenger on the signing page their
/// link opens), their links (request, share, e-mail, renew, revoke), "Send to HCAA" once everyone has
/// signed and again when the form changed since; the missing details with their Fix; and the form
/// with its signatures as a PDF made on the device.
struct Form731View: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var forms: FormsModel
    @StateObject private var pdf = SheetExport()
    @State private var panel: CoreForm731Panel?
    @State private var sheet: JSON?
    /// The passenger whose e-mail address is being added (their key is their passenger id).
    @State private var addingEmail: EditedPassenger?

    init(model: FlightModel) {
        self.model = model
        _forms = StateObject(wrappedValue: FormsModel(flight: model))
    }

    var body: some View {
        List {
            signatures
            people
            actions
            FormWarningsSection(
                warnings: sheet?["warnings"]?.array?.compactMap(\.string) ?? [], fixes: sheet?["fixes"], model: model)
            Section {
                FormPreviewRow(title: "Form 731", pdf: pdf, id: "f731-preview")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await forms.load() }
        .task { await forms.load() }
        .task(id: panelKey) { await makePanel() }
        .task(id: sheetKey) { await makeSheet() }
        .sheet(item: $addingEmail, onDismiss: { Task { await forms.load() } }) { p in
            NavigationStack {
                PassengerEditorView(passengerId: p.id, focus: "email")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { addingEmail = nil }.accessibilityIdentifier("passenger-done")
                        }
                    }
            }
        }
        .accessibilityIdentifier(FlightSection.form731.screenID)
    }

    // MARK: sections

    @ViewBuilder
    private var signatures: some View {
        Section {
            if let p = panel {
                HStack(alignment: .firstTextBaseline) {
                    Image(systemName: p.allSigned ? "checkmark.seal.fill" : "signature")
                        .foregroundStyle(ChipView.color(BriefTone(panel: p.tone)))
                    Text(p.summary).font(.subheadline.weight(.semibold))
                        .foregroundStyle(ChipView.color(BriefTone(panel: p.tone)))
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("f731-summary")
                if let s = p.sent { FormNote(text: s, id: "f731-sent") }
                if let n = p.note { FormNote(text: n, id: "f731-note") }
            } else if forms.error == nil {
                ProgressView()
            }
            if let e = forms.error { FormNote(text: e, error: true) }
        } header: {
            Text("Signatures")
        }
    }

    @ViewBuilder
    private var people: some View {
        if let p = panel {
            Section {
                ForEach(p.people) { person in
                    PersonRow(person: person, busy: forms.busy, emailEnabled: p.emailEnabled, forms: forms) {
                        addingEmail = EditedPassenger(id: person.key)
                    }
                }
            } footer: {
                if !forms.links.isEmpty { Text("Links are shown once.") }
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        if let p = panel {
            Section {
                if p.request.shown {
                    Button {
                        Task { await forms.requestLinks() }
                    } label: {
                        Label(
                            forms.busy == "links" ? "Creating links…" : "Request signatures",
                            systemImage: "link.badge.plus")
                    }
                    .disabled(forms.busy != nil || !p.request.enabled)
                    .accessibilityIdentifier("f731-request")
                }
                if p.emailAll.shown {
                    Button {
                        Task { await forms.emailAll(p.emailAll.keys) }
                    } label: {
                        Label(forms.busy == "email-all" ? "E-mailing…" : "E-mail all", systemImage: "envelope")
                    }
                    .disabled(forms.busy != nil || !p.emailAll.enabled)
                    .accessibilityIdentifier("f731-email-all")
                }
                FormSendButton(
                    label: p.send.label, enabled: p.send.enabled && forms.busy == nil, hint: p.send.hint,
                    sending: forms.busy == "send", id: "f731-send"
                ) { await forms.send731() }
            }
        }
    }

    // MARK: the core

    private var panelKey: String {
        (forms.forms?.text ?? "") + "|"
            + forms.links.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined()
    }

    private func makePanel() async {
        guard let core = app.core, let st = forms.forms?.text else { return }
        let links = forms.links
        panel = try? await core.run { try $0.form731Panel(forms: st, links: links) }
    }

    /// The stored profile, aircraft and reference data are in it: on a flight opened at launch they
    /// reach the store after the first try, which then has nothing to draw.
    private var sheetKey: String {
        [
            model.flight?.text ?? "", forms.passengers ?? "", panel.map { Core.text($0.signatures) } ?? "",
            SheetInputs.key(app, model),
        ]
        .joined(separator: "|")
    }

    private func makeSheet() async {
        guard let core = app.core, let f = model.flight, let pilot = app.store.text(.pilot) else { return }
        let flight = f.text
        let aircraft = f["aircraftId"]?.string.flatMap { app.store.text(.aircraft($0)) }
        let ref = app.store.text(.ref)
        let passengers = forms.passengers
        guard
            let m = try? await core.run({
                try $0.formModel(
                    .form731, flight: flight, aircraft: aircraft, pilot: pilot, passengers: passengers, ref: ref)
            })
        else { return }
        sheet = m
        let signatures = JSON.object(
            (panel?.signatures ?? [:]).mapValues { s in
                ["name": .string(s.name), "signedAt": .number(s.signedAt)]
            })
        pdf.update(
            key: sheetKey, name: ["Form 731", model.date].filter { !$0.isEmpty }.joined(separator: " "), .form731,
            extra: ["signatures": signatures]
        ) { m }
    }
}

/// One person on the form: their status, and what can be done about their signature.
private struct PersonRow: View {
    var person: CoreForm731Panel.Person
    var busy: String?
    var emailEnabled: Bool
    @ObservedObject var forms: FormsModel
    var addEmail: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: icon).foregroundStyle(color).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(person.name).font(.body.weight(.semibold))
                        if person.role == "PIC" { Text("PIC").font(.caption).foregroundStyle(.secondary) }
                    }
                    Text(person.status).font(.subheadline).foregroundStyle(person.signed ? .primary : .secondary)
                        .accessibilityIdentifier("f731-status-\(person.key)")
                    if let e = person.emailed {
                        Text(e).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("f731-emailed")
                    }
                }
                Spacer()
                if busy?.hasSuffix(person.key) == true { ProgressView() }
                if hasActions { menu }
            }
            if let link = person.link, let url = URL(string: link.url) {
                ShareLink(item: url, subject: Text("Form 731"), message: Text(link.text)) {
                    Label("Share the signing link", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("f731-link-\(person.key)")
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("f731-person-\(person.key)")
    }

    private var hasActions: Bool {
        let a = person.actions
        return a.renew || a.revoke || a.email || a.addEmail
    }

    private var menu: some View {
        Menu {
            if person.actions.email {
                Button {
                    Task { await forms.email(person.key) }
                } label: {
                    Label("E-mail the form to \(person.email)", systemImage: "envelope")
                }
                .disabled(busy != nil || !emailEnabled)
                .accessibilityIdentifier("f731-email-\(person.key)")
            }
            if person.actions.addEmail {
                Button(action: addEmail) {
                    Label("Add an e-mail address", systemImage: "envelope.badge")
                }
                .accessibilityIdentifier("f731-add-email-\(person.key)")
            }
            if person.actions.renew {
                Button {
                    Task { await forms.renew(person.key) }
                } label: {
                    Label("New link", systemImage: "arrow.clockwise")
                }
                .disabled(busy != nil)
                .accessibilityIdentifier("f731-renew-\(person.key)")
            }
            if person.actions.revoke {
                Button(role: .destructive) {
                    Task { await forms.revoke(person.key) }
                } label: {
                    Label("Revoke the link", systemImage: "link.badge.minus")
                }
                .disabled(busy != nil)
                .accessibilityIdentifier("f731-revoke-\(person.key)")
            }
        } label: {
            Image(systemName: "ellipsis.circle").imageScale(.large)
        }
        .accessibilityLabel("Signature of \(person.name)")
        .accessibilityIdentifier("f731-menu-\(person.key)")
    }

    private var icon: String {
        person.signed ? "checkmark.circle.fill" : person.needsResign ? "exclamationmark.circle.fill" : "circle.dashed"
    }

    private var color: Color {
        person.signed ? .green : person.needsResign ? .orange : .secondary
    }
}

private struct EditedPassenger: Identifiable {
    var id: String
}
