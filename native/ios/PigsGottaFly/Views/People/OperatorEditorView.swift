import SwiftUI

/// An operator, as the website's operator page (src/features/operators/OperatorPage.tsx): its
/// details, what it wants before each flight, its documents, the aircraft it operates and the people
/// with access; Share, and Delete for its owner. Edits save by themselves (Autosave: a PUT when the
/// pilot pauses); an issue holds the save back, as on the website. The checks, the body and the texts
/// come from the core (PGF.operatorForm).
struct OperatorEditorView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var operatorId: String

    @State private var model: OperatorModel?
    @State private var loadError: (title: String, message: String)?

    var body: some View {
        Group {
            if let model {
                OperatorForm(model: model, autosave: model.autosave) { dismiss() }
            } else if let loadError {
                ContentUnavailableView(
                    loadError.title, systemImage: "building.2", description: Text(loadError.message))
            } else {
                ProgressView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("operator-page")
        .task(id: operatorId) { await load() }
    }

    private func load() async {
        do {
            let op: JSON = try await app.api.operatorItem(operatorId)
            model = OperatorModel(app: app, operator: op)
        } catch APIError.notFound {
            loadError = ("Operator not found", "It may have been deleted.")
        } catch {
            if !isCancellation(error) { loadError = ("Could not load the operator", error.localizedDescription) }
        }
    }
}

/// The operator as read, its edited fields (Autosave) and who has access.
@MainActor
final class OperatorModel: ObservableObject {
    let app: AppModel
    let id: String
    @Published var operatorJSON: JSON
    /// GET /api/operators/:id/shares' people (JSON text).
    @Published var people: String?
    let autosave: Autosave<JSON>

    init(app: AppModel, operator op: JSON) {
        self.app = app
        id = op["id"]?.string ?? ""
        operatorJSON = op
        let fields = (try? app.core?.operatorForm(op.text))?.input ?? op
        var put: ((JSON, Int) async throws -> Autosave<JSON>.Outcome)?
        autosave = Autosave(fields, version: 0) { value, version in try await put!(value, version) }
        put = { [weak self] value, version in
            guard let self else { return .saved(version: version) }
            return try await self.save(value, version: version)
        }
    }

    /// What the form shows now: the fields as edited, their issues, the head and the people.
    func form(_ draft: JSON) -> CoreOperatorForm? {
        try? app.core?.operatorForm(operatorJSON.text, draft: draft.text, people: people, myId: app.pilot?.id ?? "")
    }

    /// PUT /api/operators/:id with the core's body. While an issue holds it back nothing is sent:
    /// each PUT carries every field, so the next valid edit sends this one too.
    private func save(_ value: JSON, version: Int) async throws -> Autosave<JSON>.Outcome {
        guard let body = form(value)?.body else { return .saved(version: version) }
        let saved: JSON = try await app.api.updateOperator(id, patch: body)
        let renamed = saved["name"] != operatorJSON["name"]
        operatorJSON = saved
        if renamed { app.operatorsChanged += 1 }
        return .saved(version: version)
    }

    func loadPeople() async {
        if let s: JSON = try? await app.api.operatorShares(id) { people = (s["people"] ?? []).text }
    }
}

private struct OperatorForm: View {
    @EnvironmentObject private var app: AppModel
    @ObservedObject var model: OperatorModel
    @ObservedObject var autosave: Autosave<JSON>
    var close: () -> Void
    @State private var sharing: ShareTarget?
    @State private var deleting = false
    @State private var deleteError: String?

    var body: some View {
        let f = model.form(autosave.value)
        let readOnly = f?.head.readOnly ?? true
        Form {
            if let f { head(f) }
            Section("Details") {
                IssueField(label: "Name", text: text("name"), issues: f?.issues("name") ?? [], id: "operator-name")
                TextField("Phone", text: text("phone"), prompt: Text("+30 …"))
                    .keyboardType(.phonePad)
                    .accessibilityIdentifier("operator-phone")
                IssueField(label: "E-mail", text: text("email"), issues: f?.issues("email") ?? [], id: "operator-email")
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                TextField("AFTN or ATS contact", text: text("aftn")).accessibilityIdentifier("operator-aftn")
                TextField("Address", text: text("address")).accessibilityIdentifier("operator-address")
                TextField("Notes", text: text("notes"), axis: .vertical)
                    .lineLimit(2...6)
                    .accessibilityIdentifier("operator-notes")
            }
            .disabled(readOnly)
            Section("Before each flight") {
                Toggle("Requires the W&B and performance sheets before each flight", isOn: flag("requiresWbPerf"))
                    .accessibilityIdentifier("operator-requires")
                if autosave.value["requiresWbPerf"]?.bool == true {
                    IssueField(
                        label: "Send them to", text: text("declarationsEmail"),
                        issues: f?.issues("declarationsEmail") ?? [], prompt: "ops@example.com",
                        id: "operator-declarations-email"
                    )
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                }
                Toggle("Wants a copy of each filed flight plan by e-mail", isOn: flag("requiresFplCopy"))
                    .accessibilityIdentifier("operator-requires-fpl")
                if autosave.value["requiresFplCopy"]?.bool == true {
                    IssueField(
                        label: "Send it to", text: text("fplCopyEmail"), issues: f?.issues("fplCopyEmail") ?? [],
                        prompt: "ops@example.com", id: "operator-fpl-copy-email"
                    )
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                }
            }
            .disabled(readOnly)
            DocumentsSection(scope: .operators(model.id), canEdit: !readOnly)
            aircraft
            if let f { people(f) }
        }
        .navigationTitle(name)
        .toolbar { toolbar(f) }
        .sheet(item: $sharing, onDismiss: { Task { await model.loadPeople() } }) { t in
            ShareSheet(target: t) {
                if let left = f?.head.left { app.toast = Toast(message: left) }
                app.operatorsChanged += 1
                close()
            }
        }
        .confirmDestructive(
            f?.head.deleteTitle ?? "", isPresented: $deleting, action: "Delete", message: f?.head.deleteMessage
        ) {
            Task { await delete() }
        }
        .alert(
            "Could not delete", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
        .task { await model.loadPeople() }
        .onDisappear { Task { await autosave.flush() } }
    }

    private var name: String {
        let n = autosave.value["name"]?.string ?? ""
        return n.isEmpty ? "Operator" : n
    }

    @ViewBuilder
    private func head(_ f: CoreOperatorForm) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(f.head.subtitle).foregroundStyle(.secondary).accessibilityIdentifier("operator-subtitle")
                if let chip = f.head.chip {
                    Label(chip.text, systemImage: "person.2.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.accentColor)
                        .accessibilityLabel(chip.title)
                        .accessibilityIdentifier("shared-chip")
                }
                if let viewOnly = f.head.viewOnly {
                    Text("View only · \(viewOnly)").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("operator-view-only")
                }
                if autosave.offline {
                    Text("Offline: changes not saved yet").font(.footnote).foregroundStyle(.orange)
                } else if let error = autosave.error {
                    Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("problem-bar")
                }
            }
        }
    }

    private var aircraft: some View {
        let list = model.operatorJSON["aircraft"]?.array ?? []
        return Section("Aircraft") {
            if list.isEmpty { Text("None.").foregroundStyle(.secondary) }
            ForEach(list.indices, id: \.self) { i in
                let a = list[i]
                let id = a["id"]?.string ?? ""
                let reg = a["registration"]?.string ?? ""
                NavigationLink {
                    AircraftEditorView(aircraftId: id, title: reg)
                } label: {
                    Text(reg).font(.body.monospaced())
                }
                .accessibilityIdentifier("operator-aircraft-\(id)")
            }
        }
    }

    private func people(_ f: CoreOperatorForm) -> some View {
        Section {
            if f.people == nil { ProgressView() }
            ForEach(f.people ?? []) { p in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name + (p.isSelf ? " (you)" : ""))
                        if !p.email.isEmpty { Text(p.email).font(.footnote).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Text(p.label).font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("operator-person-\(p.key)")
            }
            Button("Share") { share() }
        } header: {
            Text("People with access")
        }
    }

    @ToolbarContentBuilder
    private func toolbar(_ f: CoreOperatorForm?) -> some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if autosave.saving { ProgressView().accessibilityLabel("Saving") }
            Button {
                share()
            } label: {
                Image(systemName: "person.2")
            }
            .accessibilityLabel("Share")
            .accessibilityIdentifier("share-operator")
            if f?.head.canDelete == true {
                Menu {
                    Button("Delete operator", systemImage: "trash", role: .destructive) { deleting = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Operator actions")
                .accessibilityIdentifier("operator-actions")
            }
        }
    }

    private func share() {
        sharing = ShareTarget(kind: .operator, id: model.id, name: name)
    }

    private func text(_ key: String) -> Binding<String> {
        Binding(
            get: { autosave.value[key]?.string ?? "" },
            set: { v in autosave.update { $0[key] = .string(v) } })
    }

    private func flag(_ key: String) -> Binding<Bool> {
        Binding(
            get: { autosave.value[key]?.bool ?? false },
            set: { v in autosave.update { $0[key] = .bool(v) } })
    }

    private func delete() async {
        do {
            let deleted = model.form(autosave.value)?.head.deleted
            try await app.deleteOperator(model.id)
            if let deleted { app.toast = Toast(message: deleted) }
            close()
        } catch {
            if !isCancellation(error) { deleteError = error.localizedDescription }
        }
    }
}
