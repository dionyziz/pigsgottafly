import SwiftUI

/// A passenger's details for the manifest and the forms, as the website's passenger dialog has them
/// (src/features/passengers/PassengerDialog.tsx, PersonFields.tsx): name, phone, e-mail, date of
/// birth, weight, nationality, ID / passport number and notes. The core checks them as the website
/// does (`PGF.personIssues`: the problems under their fields, the body saved, what the forms still
/// lack). A new passenger is added with "Add passenger"; a saved one saves by itself while it has no
/// problems (Autosave). Delete asks first and can be undone, as the website's toast: the details come
/// back as a new record.
struct PassengerEditorView: View {
    /// nil: a new passenger.
    var passengerId: String?
    /// The field to start in (a missing-details link: "email", "weightKg", …).
    var focus: String?
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var editor = PassengerEditor()
    @FocusState private var focused: String?
    @State private var confirmDelete = false

    var body: some View {
        Form {
            if let deleted = editor.deleted {
                Section {
                    Label("Deleted \(deleted["fullName"]?.string ?? "the passenger")", systemImage: "trash")
                        .accessibilityIdentifier("passenger-deleted")
                    Button("Undo") { Task { await editor.restore(app: app) } }
                        .accessibilityIdentifier("passenger-restore")
                }
            } else if editor.form != nil {
                fields
            } else if let e = editor.error {
                ContentUnavailableView("No passenger", systemImage: "person.slash", description: Text(e))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(editor.id == nil ? "New passenger" : "Passenger")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task {
            await editor.open(app: app, id: passengerId)
            focused = focus ?? (passengerId == nil ? "fullName" : nil)
        }
        .onDisappear { Task { await editor.flush() } }
        .confirmDestructive(
            "Delete \(editor.form?["fullName"]?.string ?? "this passenger")?", isPresented: $confirmDelete,
            action: "Delete"
        ) { Task { await editor.delete(app: app) } }
        .accessibilityIdentifier("passenger-editor")
    }

    // MARK: fields

    @ViewBuilder
    private var fields: some View {
        if !editor.missing.isEmpty {
            Section {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("Missing")
                    ForEach(Array(editor.missing.enumerated()), id: \.offset) { i, m in
                        Button(m.label + (i < editor.missing.count - 1 ? "," : "")) { focused = m.field }
                            .buttonStyle(.borderless)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.orange)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("passenger-missing")
            }
        }
        Section {
            field("Full name", "fullName", prompt: "As on their ID")
                .textContentType(.name)
                .textInputAutocapitalization(.characters)
            field("Phone", "phone", prompt: "+30 …").keyboardType(.phonePad)
            field("E-mail", "email", prompt: "name@example.com")
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        Section {
            birthDate
            weight
            field("Nationality", "nationality", prompt: "e.g., GREEK").textInputAutocapitalization(.characters)
            field("ID / passport number", "idNumber", prompt: "e.g., AK 123456")
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
        }
        Section("Notes") {
            TextField("Notes", text: text("notes"), axis: .vertical)
                .lineLimit(2...6)
                .focused($focused, equals: "notes")
                .accessibilityIdentifier("passenger-notes")
        }
        if editor.id != nil {
            Section {
                Button("Delete", role: .destructive) { confirmDelete = true }
                    .accessibilityIdentifier("passenger-delete")
            }
        }
    }

    private func field(_ label: String, _ key: String, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(label) {
                TextField(label, text: text(key), prompt: Text(prompt))
                    .multilineTextAlignment(.trailing)
                    .focused($focused, equals: key)
                    .accessibilityIdentifier("passenger-\(key)")
            }
            issues(key)
        }
    }

    @ViewBuilder
    private func issues(_ key: String) -> some View {
        ForEach(editor.shownIssues(key), id: \.self) { message in
            Label(message, systemImage: "xmark.octagon.fill")
                .font(.footnote)
                .foregroundStyle(.red)
                // one element that reads the message: the symbol would otherwise be its own, "Error"
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(message)
                .accessibilityIdentifier("passenger-\(key)-issue")
        }
    }

    private func text(_ key: String) -> Binding<String> {
        Binding(
            get: { editor.form?[key]?.string ?? "" },
            set: { v in editor.change(app: app) { $0[key] = .string(v) } })
    }

    private var weight: some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent("Weight") {
                HStack(spacing: 4) {
                    TextField(
                        "Weight",
                        text: Binding(
                            get: { editor.form?["weightKg"]?.double.map(Self.kg) ?? "" },
                            set: { v in
                                let t = v.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
                                if t.isEmpty {
                                    editor.change(app: app) { $0["weightKg"] = .null }
                                } else if let n = Double(t) {
                                    editor.change(app: app) { $0["weightKg"] = .number(n) }
                                }
                            }),
                        prompt: Text("kg")
                    )
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .focused($focused, equals: "weightKg")
                    .accessibilityIdentifier("passenger-weightKg")
                    Text("kg").foregroundStyle(.secondary)
                }
            }
            issues("weightKg")
        }
    }

    nonisolated static func kg(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(n)
    }

    private var birthDate: some View {
        VStack(alignment: .leading, spacing: 4) {
            let iso = editor.form?["dateOfBirth"]?.string ?? ""
            if let day = Fmt.isoDay(iso) {
                HStack {
                    DatePicker(
                        "Date of birth",
                        selection: Binding(
                            get: { day },
                            set: { d in editor.change(app: app) { $0["dateOfBirth"] = .string(Fmt.isoDay(from: d)) } }),
                        in: ...Date(), displayedComponents: .date
                    )
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    .accessibilityIdentifier("passenger-dateOfBirth")
                    Button {
                        editor.change(app: app) { $0["dateOfBirth"] = "" }
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear the date of birth")
                }
            } else {
                LabeledContent("Date of birth") {
                    Button("Add") {
                        let start = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
                        editor.change(app: app) { $0["dateOfBirth"] = .string(Fmt.isoDay(from: start)) }
                    }
                    .accessibilityIdentifier("passenger-dateOfBirth-add")
                }
            }
            issues("dateOfBirth")
        }
    }

    // MARK: toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if editor.id == nil {
                Button(editor.busy ? "Adding…" : "Add passenger") {
                    Task { if await editor.add(app: app) { dismiss() } }
                }
                .disabled(editor.busy || editor.form == nil)
                .accessibilityIdentifier("passenger-add")
            } else if let s = editor.autosave {
                AutosaveStatus(autosave: s)
            }
        }
    }
}

/// Saving…, Saved, Offline, or why not (the website's AutosaveFooter).
private struct AutosaveStatus: View {
    @ObservedObject var autosave: Autosave<JSON>

    var body: some View {
        Group {
            if autosave.saving {
                ProgressView()
            } else if autosave.offline {
                Image(systemName: "wifi.slash").accessibilityLabel("Offline: not saved yet")
            } else if let e = autosave.error {
                Text(e).font(.caption).foregroundStyle(.red).lineLimit(2)
            } else if !autosave.hasPending {
                Text("Saved").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("passenger-save-status")
    }
}

/// Not sent while the details have a problem: the problems are shown under their fields.
private struct PersonNotValid: LocalizedError {
    var errorDescription: String? { "fix the details first" }
}

/// The editor's state: the record, the form as typed (PersonForm), the core's check of it.
@MainActor
final class PassengerEditor: ObservableObject {
    @Published private(set) var id: String?
    @Published private(set) var record: JSON?
    /// A new passenger's form (a saved one's is `autosave.value`).
    @Published private var draft: JSON?
    @Published private(set) var autosave: Autosave<JSON>?
    @Published private(set) var check: CorePersonIssues?
    /// A new passenger's problems show once "Add passenger" was tried, as on the website.
    @Published private(set) var tried = false
    @Published private(set) var busy = false
    @Published private(set) var deleted: JSON?
    @Published var error: String?

    var form: JSON? { autosave?.value ?? draft }
    var missing: [CorePersonIssues.Missing] { check?.missing ?? [] }

    func shownIssues(_ field: String) -> [String] {
        guard id != nil || tried else { return [] }
        return (check?.issues ?? []).filter { $0.field == field }.map(\.message)
    }

    func open(app: AppModel, id: String?) async {
        guard form == nil, deleted == nil else { return }
        self.id = id
        guard let core = app.core else { return }
        do {
            let person: String? = id == nil ? nil : (try await app.api.passenger(id!, as: JSON.self)).text
            let c = try await core.run { try $0.personIssues(person: person) }
            record = try person.map { try JSON.parse($0) }
            check = c
            if id == nil { draft = c.form } else { start(app: app, form: c.form) }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func start(app: AppModel, form: JSON) {
        guard let id, let core = app.core else { return }
        let api = app.api
        let s = Autosave<JSON>(form, version: 0) { form, _ in
            let text = form.text
            guard let input = try await core.run({ try $0.personIssues(form: text) }).input else {
                throw PersonNotValid()
            }
            let saved = try await api.updatePassenger(id, patch: input, as: JSON.self)
            await MainActor.run {
                self.record = saved
                RecordListChanged.post()
            }
            return .saved(version: 0)
        }
        autosave = s
    }

    func change(app: AppModel, _ edit: @escaping (inout JSON) -> Void) {
        if let s = autosave {
            s.update(edit)
        } else if var d = draft {
            edit(&d)
            draft = d
        }
        Task { await recheck(app: app) }
    }

    private func recheck(app: AppModel) async {
        guard let core = app.core, let text = form?.text else { return }
        if let c = try? await core.run({ try $0.personIssues(form: text) }), form?.text == text { check = c }
    }

    func flush() async { await autosave?.flush() }

    /// POST /passengers; false while the form has problems (they show under their fields).
    func add(app: AppModel) async -> Bool {
        tried = true
        await recheck(app: app)
        guard let input = check?.input else { return false }
        busy = true
        defer { busy = false }
        do {
            _ = try await app.api.createPassenger(input, as: JSON.self)
            RecordListChanged.post()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func delete(app: AppModel) async {
        guard let id, let record else { return }
        await autosave?.flush()
        do {
            try await app.api.deletePassenger(id)
            deleted = self.record ?? record
            autosave = nil
            self.id = nil
            RecordListChanged.post()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Undo: the details come back as a new record (POST), as the website's Undo does.
    func restore(app: AppModel) async {
        guard var input = deleted?.object else { return }
        for k in ["id", "created", "updated"] { input[k] = nil }
        do {
            let p = try await app.api.createPassenger(.object(input), as: JSON.self)
            deleted = nil
            record = nil
            id = nil
            await open(app: app, id: p["id"]?.string)
            RecordListChanged.post()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
