import SwiftUI

/// The MD 4.3 loading sheet and the MD 4.4 performance log as the website's page has them
/// (src/features/exports/wbperf/WbPerfExport.tsx, SendPanel.tsx): the checks with their verdicts, the
/// weather they were made with (refresh), their warnings, "Send to <operator>" when the aircraft's
/// operator asks for them before each flight, and the sheets signed by the PIC as a PDF made on the device.
struct WbPerfView: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var forms: FormsModel
    @StateObject private var pdf = SheetExport()
    @State private var sheets: CoreWbPerfContent?
    @State private var send: CoreOperatorPanel?
    @State private var refreshing = false
    @Environment(\.focusRouter) private var focus

    init(model: FlightModel) {
        self.model = model
        _forms = StateObject(wrappedValue: FormsModel(flight: model))
    }

    var body: some View {
        List {
            checks
            operatorSection
            FormWarningsSection(warnings: sheets?.warnings ?? [], title: "Warnings", model: model)
            Section {
                FormPreviewRow(title: "W&B and performance", pdf: pdf, id: "wbperf-preview")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await forms.load() }
        .task { await forms.load() }
        .task(id: model.computed?.raw.text) { await make() }
        .task(id: sendKey) { await makeSend() }
        .accessibilityIdentifier(FlightSection.wbPerf.screenID)
    }

    // MARK: sections

    private var checks: some View {
        Section {
            if let s = sheets {
                verdict("W&B", s.wb, id: "wb-status")
                verdict("Performance", s.perf, id: "performance-status")
            }
            if hasLegs {
                Label(
                    windsOk ? "Trip fuel with forecast winds" : "Trip fuel without winds (calm)",
                    systemImage: windsOk ? "wind" : "wind.circle"
                )
                .foregroundStyle(windsOk ? .green : .orange)
            }
            Label(
                anyWeather ? "Surface weather loaded" : "No surface weather: ISA and calm",
                systemImage: "thermometer.medium"
            )
            .foregroundStyle(anyWeather ? .green : .orange)
            Button {
                Task { await refreshWeather() }
            } label: {
                Label(refreshing ? "Loading…" : "Refresh weather", systemImage: "arrow.clockwise")
            }
            .disabled(refreshing)
            .accessibilityIdentifier("refresh-weather")
        } header: {
            Text("Checks")
        }
    }

    private func verdict(_ label: String, _ m: JSON, id: String) -> some View {
        let v = m["verdict"]?.string ?? ""
        let tone: BriefTone = v == "pass" ? .ok : v == "fail" ? .danger : .warn
        return HStack {
            Text(label)
            Spacer()
            ChipView(text: m["verdictText"]?.string ?? "", tone: tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    @ViewBuilder
    private var operatorSection: some View {
        if let p = send {
            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    ChipView(text: p.status, tone: BriefTone(panel: p.tone))
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("operator-send-status")
                if let a = p.address {
                    Text("W&B and performance sheets to \(a)").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Button("Set the operator's address →") {
                        focus.open(link: CoreFocusTarget.Link(to: p.addressPath, label: "Set the address"))
                    }
                    .accessibilityIdentifier("operator-set-address")
                }
                FormSendButton(
                    label: p.send.label, enabled: p.send.enabled && forms.busy == nil, hint: p.send.hint,
                    sending: forms.busy == "operator", id: "operator-send-button"
                ) {
                    guard let content = sheets?.content else { return }
                    await forms.sendDeclarations(content: content, resend: p.send.resend)
                }
                if let s = p.sent { FormNote(text: s, id: "operator-send-sent") }
                if let n = p.note { FormNote(text: n, id: "operator-send-note") }
                if let e = forms.error { FormNote(text: e, error: true) }
            } header: {
                Text(p.title)
            }
            .accessibilityIdentifier("operator-send")
        }
    }

    // MARK: the weather the sheets were made with

    private var hasLegs: Bool { !(model.computed?.rows.isEmpty ?? true) }

    private var windsOk: Bool { model.computed?.raw["weather"]?["winds"]?["status"]?.string == "ok" }

    /// Surface conditions at a take-off or landing (the METAR), as the website's chip checks.
    private var anyWeather: Bool {
        guard let raw = model.computed?.raw else { return false }
        let has = { (j: JSON?) in j?["conditions"].map { !$0.isNull } ?? false }
        if has(raw["departure"]) || has(raw["arrival"]) { return true }
        return (raw["stops"]?.array ?? []).contains { has($0["landing"]) || has($0["takeoff"]) }
    }

    private func refreshWeather() async {
        refreshing = true
        defer { refreshing = false }
        await model.fetchWeather()
        await model.recompute()
    }

    // MARK: the core

    private func make() async {
        guard let core = app.core, let inputs = SheetInputs(app: app, model: model) else { return }
        guard
            let s = try? await core.run({
                try $0.wbPerfContent(
                    flight: inputs.flight, aircraft: inputs.aircraft, pilot: inputs.pilot, ref: inputs.ref,
                    weather: inputs.weather)
            })
        else { return }
        sheets = s
        // signed by the PIC when made, as the website draws it (and the server when it sends them)
        let pilotName = app.store.read(.pilot).flatMap { try? JSON.parse($0) }?["fullName"]?.string ?? ""
        let signer =
            pilotName.trimmingCharacters(in: .whitespaces).isEmpty
            ? (s.wb["pilot"]?.string ?? "").trimmingCharacters(in: .whitespaces)
            : pilotName.trimmingCharacters(in: .whitespaces)
        let signature: JSON =
            signer.isEmpty
            ? .null : ["name": .string(signer), "signedAt": .number((Date().timeIntervalSince1970 * 1000).rounded())]
        let name = ["W&B and performance", s.content["registration"]?.string ?? "", s.content["date"]?.string ?? ""]
            .filter { !$0.isEmpty }.joined(separator: " ")
        pdf.update(key: s.text, name: name, .wbperf, extra: ["signature": signature]) { s.content }
    }

    private var sendKey: String { (forms.declarations?.text ?? "") + "|" + (sheets?.text ?? "") }

    private func makeSend() async {
        guard let core = app.core else { return }
        let d = forms.declarations?.text
        let hash = sheets?.hash
        let ready = sheets != nil
        send = (try? await core.run { try $0.operatorPanel(declarations: d, hash: hash, ready: ready) }) ?? nil
    }
}
