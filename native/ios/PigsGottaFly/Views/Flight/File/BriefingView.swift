import SwiftUI

/// The NOTAM briefing sheet as the website's briefing page prints it (src/features/exports/briefing/
/// BriefingExport.tsx): the relevant NOTAMs with their ICAO text, the filtered-out ones only counted,
/// made on the device as A4 pages (SheetRenderer) to preview, share and print. "Reload NOTAMs" asks
/// the server for a fresh briefing.
struct BriefingView: View {
    @ObservedObject var model: FlightModel
    @EnvironmentObject private var app: AppModel
    @StateObject private var pdf = SheetExport()
    @State private var reloading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            panel
            Divider()
            preview
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(FlightSection.briefing.screenID)
        .task(id: key) { await make() }
    }

    /// What the sheet is drawn from: the flight and the briefing.
    private var key: String {
        (model.flight?.text ?? "") + "|" + (app.store.text(.notams(model.id)) ?? "")
    }

    private var status: (text: String, tone: Color) {
        guard let b = model.notams, !reloading else { return ("Loading…", .secondary) }
        guard b.status == "ok" else { return ("Not loaded", .orange) }
        let relevant = b.notams.filter(\.relevant).count
        return ("\(relevant) relevant, \(b.notams.count - relevant) hidden", relevant > 0 ? .orange : .green)
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(status.text).font(.subheadline.weight(.semibold)).foregroundStyle(status.tone)
                    .accessibilityIdentifier("briefing-status")
                Spacer()
                Button {
                    Task { await reload() }
                } label: {
                    Label("Reload NOTAMs", systemImage: "arrow.clockwise")
                }
                .disabled(reloading)
                .accessibilityIdentifier("briefing-reload")
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.orange)
                    .accessibilityIdentifier("briefing-warnings")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var preview: some View {
        if let file = pdf.file {
            PDFPreview(file: file, title: "NOTAM briefing")
                .overlay(alignment: .top) {
                    if pdf.busy { ProgressView().padding(8) }
                }
        } else if let e = pdf.error {
            ContentUnavailableView("No briefing", systemImage: "doc.text.magnifyingglass", description: Text(e))
                .frame(maxHeight: .infinity)
        } else {
            ProgressView("Preparing the briefing…").frame(maxHeight: .infinity)
        }
    }

    private func make() async {
        guard let core = app.core, let inputs = SheetInputs(app: app, model: model) else { return }
        let date = model.date
        pdf.update(key: key, name: ["NOTAM briefing", date].filter { !$0.isEmpty }.joined(separator: " "), .briefing) {
            try await core.run { try $0.briefingModel(flight: inputs.flight, briefing: inputs.notams) }
        }
    }

    private func reload() async {
        reloading = true
        defer { reloading = false }
        var path =
            "flights/\(model.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model.id)/notams"
        var query = ["refresh=1"]
        if let alt = model.computed?.maxAltFt { query.insert("maxAltFt=\(alt)", at: 0) }
        path += "?" + query.joined(separator: "&")
        do {
            let d = try await app.api.get(path)
            try? app.store.write(d, .notams(model.id))
            error = nil
            await model.fetchBriefing()
        } catch APIError.offline {
            error = "Offline: the NOTAMs could not be loaded."
        } catch {
            self.error = "The NOTAMs could not be loaded (\(error.localizedDescription))."
        }
    }
}
