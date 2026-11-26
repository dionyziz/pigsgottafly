import SwiftUI

/// The General Declaration as the website's page has it (src/features/exports/gendec/GenDec.tsx,
/// SendPanel.tsx): who sends it (each end's handling with its reason from the AIP and the NOTAMs, and
/// the flight's own choice), "Send to HCAA" when the PIC sends it, the missing details with their
/// Fix, and the declaration with the PIC's signature as a PDF made on the device.
struct GenDecView: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var forms: FormsModel
    @StateObject private var pdf = SheetExport()
    @State private var panel: CoreGenDecPanel?
    @State private var sheet: JSON?

    init(model: FlightModel) {
        self.model = model
        _forms = StateObject(wrappedValue: FormsModel(flight: model))
    }

    var body: some View {
        List {
            send
            FormWarningsSection(
                warnings: sheet?["warnings"]?.array?.compactMap(\.string) ?? [], fixes: sheet?["fixes"], model: model)
            Section {
                FormPreviewRow(title: "General Declaration", pdf: pdf, id: "gendec-preview")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await forms.load() }
        .task { await forms.load() }
        .task(id: forms.forms?.text) { await makePanel() }
        .task(id: sheetKey) { await makeSheet() }
        .accessibilityIdentifier(FlightSection.genDec.screenID)
    }

    @ViewBuilder
    private var send: some View {
        Section {
            if let p = panel {
                HStack {
                    Text("Status")
                    Spacer()
                    ChipView(text: p.status, tone: BriefTone(panel: p.tone))
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("gendec-status")
                ForEach(p.ends) { e in
                    Label {
                        Text("\(e.label) \(e.reason)")
                    } icon: {
                        Image(systemName: e.handled ? "person.badge.shield.checkmark" : "person.fill.questionmark")
                            .foregroundStyle(e.handled ? .green : .orange)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(e.label) \(e.reason)")
                    .accessibilityIdentifier("gendec-handling-\(e.role)")
                }
                Toggle(
                    "Submitted by a handler",
                    isOn: Binding(get: { p.handled }, set: { on in Task { await setHandled(on) } })
                )
                .disabled(forms.busy != nil || model.readOnly)
                .accessibilityIdentifier("gendec-handled")
                if let a = p.automatic {
                    HStack {
                        ChipView(text: a, tone: nil).accessibilityIdentifier("gendec-override")
                        Spacer()
                        Button("Use automatic") { Task { await forms.setHandled(nil) } }
                            .buttonStyle(.borderless)
                            .disabled(forms.busy != nil || model.readOnly)
                            .accessibilityIdentifier("gendec-handled-auto")
                    }
                }
                if let s = p.send {
                    FormSendButton(
                        label: s.label, enabled: s.enabled && forms.busy == nil, hint: s.hint,
                        sending: forms.busy == "send-gendec", id: "gendec-send-button"
                    ) { await forms.sendGenDec() }
                }
                if let s = p.sent { FormNote(text: s, id: "gendec-sent") }
                if let n = p.note { FormNote(text: n, id: "gendec-note") }
            } else if forms.error == nil {
                ProgressView()
            }
            if let e = forms.error { FormNote(text: e, error: true) }
        } header: {
            Text("Send to HCAA")
        }
    }

    /// The override that "Submitted by a handler" set to `on` saves (back to automatic when it agrees).
    private func setHandled(_ on: Bool) async {
        guard let core = app.core, let st = forms.forms?.text,
            let p = try? await core.run({ try $0.genDecPanel(forms: st, handled: on) })
        else { return }
        await forms.setHandled(p.override)
    }

    private func makePanel() async {
        guard let core = app.core, let st = forms.forms?.text else { return }
        panel = try? await core.run { try $0.genDecPanel(forms: st) }
    }

    /// The stored profile, aircraft and reference data are in it: on a flight opened at launch they
    /// reach the store after the first try, which then has nothing to draw.
    private var sheetKey: String {
        [
            model.flight?.text ?? "", forms.passengers ?? "", panel?.signature.map { Core.text($0) } ?? "",
            SheetInputs.key(app, model),
        ]
        .joined(separator: "|")
    }

    private func makeSheet() async {
        guard let core = app.core, let f = model.flight, let pilot = app.store.text(.pilot) else { return }
        let flight = f.text
        let aircraft = f["aircraftId"]?.string.flatMap { app.store.text(.aircraft($0)) }
        let ref = model.refText
        let passengers = forms.passengers
        guard
            let m = try? await core.run({
                try $0.formModel(
                    .gendec, flight: flight, aircraft: aircraft, pilot: pilot, passengers: passengers, ref: ref)
            })
        else { return }
        sheet = m
        let signature: JSON =
            panel?.signature.map { ["name": .string($0.name), "signedAt": .number($0.signedAt)] } ?? .null
        pdf.update(
            key: sheetKey, name: ["General Declaration", model.date].filter { !$0.isEmpty }.joined(separator: " "),
            .gendec, extra: ["signature": signature]
        ) { m }
    }
}
