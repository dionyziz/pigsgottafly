import SwiftUI

/// The MD 4.2 navigation log as the website's navlog page prints it (src/features/exports/navlog/
/// NavlogExport.tsx): the sheets made on the device as A4 pages (SheetRenderer) to preview, share and
/// print, the weather they were made with (refresh), their warnings, and "E-mail me" (the server prints
/// the same sheets and mails them to the pilot: MailPanel.tsx).
struct NavlogExportView: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var pdf = SheetExport()
    @State private var document: JSON?
    @State private var content: JSON?
    @State private var mail: NavlogMailState?
    @State private var mailError: String?
    @State private var sending = false
    @State private var refreshing = false
    @State private var showWarnings = false

    var body: some View {
        VStack(spacing: 0) {
            panel
            Divider()
            preview
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(FlightSection.navlogExport.screenID)
        .task(id: model.computed?.raw.text) { await make() }
        .task { await loadMail() }
    }

    private var warnings: [String] { document?["warnings"]?.array?.compactMap(\.string) ?? [] }
    private var sources: String { (document?["sources"]?.array?.compactMap(\.string) ?? []).joined(separator: " · ") }
    private var hasLegs: Bool { !(model.computed?.rows.isEmpty ?? true) }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 8) {
            if hasLegs {
                HStack(alignment: .firstTextBaseline) {
                    Text(refreshing ? "Loading…" : sources.isEmpty ? "Weather" : sources)
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        .accessibilityIdentifier("navlog-sources")
                    Spacer()
                    Button {
                        Task { await refreshWeather() }
                    } label: {
                        Label("Refresh weather", systemImage: "arrow.clockwise")
                    }
                    .disabled(refreshing)
                    .accessibilityIdentifier("refresh-weather")
                }
            }
            if !warnings.isEmpty {
                DisclosureGroup(isExpanded: $showWarnings) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(warnings, id: \.self) { w in
                            Label(w, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Text(warnings.count == 1 ? "1 warning" : "\(warnings.count) warnings").font(.subheadline)
                }
                .accessibilityIdentifier("navlog-warnings")
            }
            mailRow
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var mailRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Button {
                    Task { await send() }
                } label: {
                    Label(sending ? "Sending…" : "E-mail me the navlog", systemImage: "envelope")
                }
                .buttonStyle(.borderedProminent)
                .disabled(sending || content == nil || refreshing || mail?.emailEnabled != true)
                .accessibilityIdentifier("navlog-mail-button")
                Spacer()
            }
            if let s = mail?.sent {
                Text("Sent to \(s.to) at \(Self.sentText(s.sentAt))")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("navlog-mail-sent")
            }
            if let m = mail, !m.emailEnabled, let reason = m.emailReason {
                Text(reason).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("navlog-mail-reason")
            }
            if let e = mailError {
                Text(e).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("navlog-mail-error")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("navlog-mail")
    }

    @ViewBuilder
    private var preview: some View {
        if let file = pdf.file {
            PDFPreview(file: file, title: "Navigation log")
                .overlay(alignment: .top) {
                    if pdf.busy { ProgressView().padding(8) }
                }
        } else if let e = pdf.error {
            ContentUnavailableView("No navlog", systemImage: "doc.plaintext", description: Text(e))
                .frame(maxHeight: .infinity)
        } else {
            ProgressView("Preparing the navlog…").frame(maxHeight: .infinity)
        }
    }

    nonisolated static func sentText(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    private func make() async {
        guard let core = app.core, let inputs = SheetInputs(app: app, model: model) else { return }
        guard
            let n = try? await core.run({
                try $0.navlogContent(
                    flight: inputs.flight, aircraft: inputs.aircraft, pilot: inputs.pilot, ref: inputs.ref,
                    weather: inputs.weather)
            })
        else { return }
        document = n.document
        content = n.content
        let date = n.content["sheets"]?[0]?["header"]?["date"]?.string ?? model.date
        pdf.update(key: n.content.text, name: [date, "navlog"].filter { !$0.isEmpty }.joined(separator: "-"), .navlog) {
            n.content
        }
    }

    private func refreshWeather() async {
        refreshing = true
        defer { refreshing = false }
        await model.fetchWeather()
        await model.recompute()
    }

    private func loadMail() async {
        do {
            mail = try await app.api.navlogMail(model.id, as: NavlogMailState.self)
        } catch {
            if mail == nil { mailError = Self.errText(error) }
        }
    }

    private func send() async {
        guard let content else { return }
        sending = true
        mailError = nil
        defer { sending = false }
        do {
            mail = try await app.api.sendNavlogMail(model.id, content: content, as: NavlogMailState.self)
        } catch {
            mailError = Self.errText(error)
        }
    }

    nonisolated static func errText(_ e: Error) -> String {
        if case APIError.offline = e { return "Offline: try again when connected." }
        return e.localizedDescription
    }
}

/// GET/POST /api/flights/:id/exports/navlog/email (src/shared/navlogSheets.ts NavlogMailState).
struct NavlogMailState: Codable, Equatable, Sendable {
    struct Sent: Codable, Equatable, Sendable {
        var sentAt: Double
        var to: String
    }
    var to: String
    var sent: Sent?
    var emailEnabled: Bool
    var emailReason: String?
}
