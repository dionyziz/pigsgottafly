import SwiftUI

/// "Add passenger…": the passenger list by name (the website's PersonPicker), or a new passenger from
/// the typed name.
struct AddPassengerSheet: View {
    @ObservedObject var manifest: ManifestModel
    var seats: Int
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                let found = manifest.candidates(query)
                if !manifest.passengersLoaded {
                    ProgressView().frame(maxWidth: .infinity)
                }
                ForEach(found, id: \.paxID) { p in
                    Button {
                        Task {
                            await manifest.add(p)
                            dismiss()
                        }
                    } label: {
                        HStack {
                            Text(p["fullName"]?.string ?? "").foregroundStyle(.primary)
                            Spacer()
                            Text(p["weightKg"]?.double.map { "\(WeightField.format($0)) kg" } ?? "no weight")
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("pax-option-\(p["id"]?.string ?? "")")
                }
                let name = query.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty {
                    NavigationLink {
                        PersonRecordForm(manifest: manifest, mode: .newPassenger(name)) { dismiss() }
                    } label: {
                        Label("Create “\(name)”", systemImage: "plus")
                    }
                    .accessibilityIdentifier("pax-create")
                } else if manifest.passengersLoaded && found.isEmpty {
                    Text(manifest.passengers.isEmpty ? "No passengers yet." : "Everyone is on board.")
                        .foregroundStyle(.secondary)
                }
            }
            .searchable(
                text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name"
            )
            .navigationTitle("Add passenger")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        PersonRecordForm(manifest: manifest, mode: .newPassenger(query)) { dismiss() }
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .accessibilityLabel("New passenger")
                    .accessibilityIdentifier("pax-new")
                }
            }
            .accessibilityIdentifier("pax-picker")
        }
    }
}

/// One manifest row in full: the snapshot's fields as edited for this flight (each then stops
/// following its person), the reset from the saved details, the person's record, removal.
struct CrewDetailSheet: View {
    @ObservedObject var model: FlightModel
    @ObservedObject var manifest: ManifestModel
    var index: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if model.crew.indices.contains(index) {
                    form(model.crew[index])
                } else {
                    Color.clear.onAppear { dismiss() }
                }
            }
            .navigationTitle(model.crew.indices.contains(index) ? title(model.crew[index]) : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func title(_ row: JSON) -> String {
        let n = row["snapshot"]?["fullName"]?.string ?? ""
        return n.isEmpty ? (row["role"]?.string == "PIC" ? "PIC" : "Passenger") : n
    }

    private func form(_ row: JSON) -> some View {
        let s = row["snapshot"] ?? [:]
        let pic = row["role"]?.string == "PIC"
        let source = manifest.source(of: row)
        let edited = Set((row["overrides"]?.array ?? []).compactMap(\.string))
        let ro = model.readOnly
        return Form {
            Section {
                field("Full name", .fullName, s, edited)
                field("Phone", .phone, s, edited, keyboard: .phonePad)
                field("Date of birth", .dateOfBirth, s, edited, prompt: "YYYY-MM-DD")
                LabeledContent(label("Weight", .weightKg, edited)) {
                    WeightField(
                        value: s["weightKg"]?.double, range: 1...300, label: "Weight", id: "snapshot-weightKg"
                    ) { v in Task { await manifest.editField(index, .weightKg, v.map { .number($0) } ?? .null) } }
                }
                Picker(
                    label("ID type", .idType, edited),
                    selection: Binding(
                        get: { s["idType"]?.string ?? "" },
                        set: { v in Task { await manifest.editField(index, .idType, .string(v)) } })
                ) {
                    Text("None").tag("")
                    Text("ID card").tag("ID")
                    Text("Passport").tag("PASSPORT")
                }
                .accessibilityIdentifier("snapshot-idType")
                field("ID number", .idNumber, s, edited)
                field("Nationality", .nationality, s, edited)
                field("Relation", .relation, s, edited)
            } header: {
                Text("On this flight")
            }
            .disabled(ro)
            if !ro {
                Section {
                    if source != nil {
                        Button {
                            Task { await manifest.reset(index) }
                        } label: {
                            Label(
                                pic ? "Reset from my profile" : "Reset from the passenger list",
                                systemImage: "arrow.counterclockwise")
                        }
                        .accessibilityIdentifier("crew-reset")
                    }
                    if let source {
                        NavigationLink {
                            PersonRecordForm(manifest: manifest, mode: pic ? .pilot(source) : .passenger(source)) {}
                        } label: {
                            Label(
                                pic ? "Edit my details" : "Edit \(source["fullName"]?.string ?? "passenger")",
                                systemImage: "person.text.rectangle")
                        }
                        .accessibilityIdentifier(pic ? "pic-record" : "pax-record")
                    }
                }
                if !pic {
                    Section {
                        Button(role: .destructive) {
                            dismiss()
                            Task { await manifest.remove(index) }
                        } label: {
                            Label("Remove from the manifest", systemImage: "trash")
                        }
                        .accessibilityIdentifier("crew-remove")
                    }
                }
            }
        }
        .accessibilityIdentifier("crew-detail")
    }

    private func label(_ text: String, _ key: CrewField, _ edited: Set<String>) -> String {
        edited.contains(key.rawValue) ? "\(text) (edited)" : text
    }

    private func field(
        _ text: String, _ key: CrewField, _ s: JSON, _ edited: Set<String>, keyboard: UIKeyboardType = .default,
        prompt: String? = nil
    ) -> some View {
        CommitTextField(
            label: label(text, key, edited), value: s[key.rawValue]?.string ?? "", prompt: prompt, keyboard: keyboard,
            id: "snapshot-\(key.rawValue)"
        ) { v in
            let value: JSON = key == .dateOfBirth && v.isEmpty ? .null : .string(v)
            Task { await manifest.editField(index, key, value) }
        }
    }
}

/// A text saved when typing ends (Return, or the field losing focus), not on every key.
struct CommitTextField: View {
    var label: String
    var value: String
    var prompt: String?
    var keyboard: UIKeyboardType = .default
    var id: String
    var onCommit: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent(label) {
            TextField(label, text: $text, prompt: prompt.map { Text($0) })
                .multilineTextAlignment(.trailing)
                .keyboardType(keyboard)
                .focused($focused)
                .onSubmit(commit)
                .accessibilityIdentifier(id)
        }
        .onAppear { text = value }
        .onChange(of: value) { _, v in if !focused { text = v } }
        .onChange(of: focused) { _, f in if !f { commit() } }
    }

    private func commit() {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t != value { onCommit(t) }
    }
}

/// A passenger's record (new or saved) or the pilot's details, checked by the core (PGF.personIssues)
/// as the website's PassengerDialog and PilotDetailsDialog check them.
struct PersonRecordForm: View {
    enum Mode {
        case newPassenger(String)
        case passenger(JSON)
        case pilot(JSON)
    }

    @ObservedObject var manifest: ManifestModel
    var mode: Mode
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var form = CrewPersonForm()
    @State private var weightText = ""
    @State private var tried = false
    @State private var saving = false
    @State private var error: String?
    @State private var loaded = false

    private var isPilot: Bool {
        if case .pilot = mode { return true }
        return false
    }

    var body: some View {
        let issues = tried ? (manifest.check(form, pilot: isPilot)?.issues ?? []) : []
        let of = { (field: String) in
            issues.filter { $0.field == field }.map { FieldIssue(level: .error, message: $0.message) }
        }
        Form {
            Section {
                IssueField(label: "Full name", text: $form.fullName, issues: of("fullName"), id: "person-fullName")
                if !isPilot {
                    IssueField(
                        label: "E-mail", text: Binding(get: { form.email ?? "" }, set: { form.email = $0 }),
                        issues: of("email"), id: "person-email"
                    )
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                }
                IssueField(label: "Phone", text: $form.phone, issues: of("phone"), id: "person-phone")
                    .keyboardType(.phonePad)
                IssueField(
                    label: "Date of birth", text: $form.dateOfBirth, issues: of("dateOfBirth"), prompt: "YYYY-MM-DD",
                    id: "person-dateOfBirth")
                IssueField(label: "Weight (kg)", text: $weightText, issues: of("weightKg"), id: "person-weightKg")
                    .keyboardType(.decimalPad)
            }
            Section {
                Picker("ID type", selection: $form.idType) {
                    Text("None").tag("")
                    Text("ID card").tag("ID")
                    Text("Passport").tag("PASSPORT")
                }
                IssueField(label: "ID number", text: $form.idNumber, id: "person-idNumber")
                IssueField(label: "Nationality", text: $form.nationality, prompt: "GREEK", id: "person-nationality")
                    .textInputAutocapitalization(.characters)
                IssueField(label: "Relation", text: $form.relation, id: "person-relation")
                if isPilot {
                    IssueField(
                        label: "Licence", text: Binding(get: { form.licenceNo ?? "" }, set: { form.licenceNo = $0 }),
                        id: "person-licenceNo")
                }
            }
            if !isPilot {
                Section("Notes") {
                    TextField("Notes", text: $form.notes, axis: .vertical).accessibilityIdentifier("person-notes")
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(saving)
                    .accessibilityIdentifier("person-save")
            }
        }
        .onChange(of: weightText) { _, t in form.weightKg = Self.weight(t) }
        .onAppear(perform: start)
        .accessibilityIdentifier("person-form")
    }

    private var title: String {
        switch mode {
        case .newPassenger: "New passenger"
        case .passenger: "Passenger"
        case .pilot: "My details"
        }
    }

    private func start() {
        guard !loaded else { return }
        loaded = true
        switch mode {
        case .newPassenger(let name): form = CrewPersonForm(initialName: name.trimmingCharacters(in: .whitespaces))
        case .passenger(let p), .pilot(let p):
            form = CrewPersonForm(p)
            if isPilot {
                form.email = nil
                form.licenceNo = p["licenceNo"]?.string ?? ""
            }
        }
        weightText = WeightField.format(form.weightKg)
    }

    /// Not a number: a value the core turns down with its own message.
    static func weight(_ t: String) -> Double? {
        let s = t.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if s.isEmpty { return nil }
        return Double(s) ?? -1
    }

    private func save() async {
        tried = true
        guard manifest.check(form, pilot: isPilot)?.input != nil else { return }
        saving = true
        defer { saving = false }
        do {
            switch mode {
            case .newPassenger: try await manifest.create(form)
            case .passenger(let p): try await manifest.update(passengerId: p["id"]?.string ?? "", form)
            case .pilot: try await manifest.updatePilot(form)
            }
            dismiss()
            onDone()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}

extension JSON {
    /// A passenger record's id (the add sheet's rows).
    fileprivate var paxID: String { self["id"]?.string ?? "" }
}
