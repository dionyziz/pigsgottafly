import SwiftUI

/// What a share sheet is about: an aircraft, a flight or an operator.
struct ShareTarget: Identifiable, Hashable {
    enum Kind: String {
        case aircraft, flight, `operator`
    }
    var kind: Kind
    var id: String
    /// The registration, the flight's title, the operator's name.
    var name: String
    /// A flight's manifest contacts (PGF.shareSuggestions' `contacts`, JSON text): those it is not
    /// shared with yet are offered as viewers.
    var passengers: String?

    static func aircraft(_ id: String, _ registration: String) -> ShareTarget {
        ShareTarget(kind: .aircraft, id: id, name: registration)
    }

    /// What removing one's own access is called, and its question.
    var leaveAction: String { kind == .flight ? "Leave" : "Remove" }
    func leaveQuestion(_ name: String) -> String {
        switch kind {
        case .aircraft: "Remove \(name) from your hangar?"
        case .flight: "Leave “\(name)”?"
        case .operator: "Remove your access to \(name)?"
        }
    }
}

/// The website's share dialog (src/features/hangar/ShareDialog.tsx) for an aircraft, a flight or an
/// operator: add people by e-mail as viewer or editor (an address no account uses is invited and
/// listed as pending), a flight's passengers offered as viewers, change a role, remove someone, or
/// remove one's own access. The rows and messages come from the core (PGF.sharing).
struct ShareSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var target: ShareTarget
    /// The pilot removed their own access: the record left their lists.
    var onLeft: () -> Void = {}

    @State private var sharing: String?
    @State private var loadError: String?
    @State private var email = ""
    @State private var role: ShareRole = .view
    @State private var busy = false
    @State private var error: String?
    @State private var leaving = false

    private var view: CoreSharing? {
        guard let sharing else { return nil }
        return try? app.core?.sharing(
            sharing, myId: app.pilot?.id ?? "", kind: target.kind.rawValue, email: email, role: role,
            passengers: target.passengers)
    }

    /// The sharing names the aircraft, flight or operator; the caller's name stands in until it loads.
    private var shownName: String {
        let s = sharing.flatMap { try? JSON.parse($0) }
        let named = s?["registration"]?.string ?? s?["title"]?.string ?? s?["name"]?.string ?? ""
        return named.isEmpty ? target.name : named
    }

    var body: some View {
        NavigationStack {
            Group {
                if let loadError {
                    ContentUnavailableView(
                        "Could not load the sharing", systemImage: "wifi.slash", description: Text(loadError))
                } else if let v = view {
                    form(v)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Share \(shownName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(busy).accessibilityIdentifier("share-done")
                }
            }
            .confirmDestructive(
                target.leaveQuestion(shownName), isPresented: $leaving, action: target.leaveAction
            ) {
                Task { await remove(app.pilot?.id ?? "") }
            }
        }
        .task { await load() }
        .accessibilityIdentifier("share-dialog")
    }

    private func form(_ v: CoreSharing) -> some View {
        Form {
            if v.canManage {
                Section {
                    TextField("Add people by email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: email) { error = nil }
                        .onSubmit { Task { await add(v) } }
                        .accessibilityIdentifier("share-email")
                    Picker("Role", selection: $role) {
                        ForEach(v.roles, id: \.role) { Text($0.label).tag($0.role) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("share-role")
                    Button("Share") { Task { await add(v) } }
                        .disabled(busy)
                        .accessibilityIdentifier("share-add")
                } footer: {
                    if let error { Text(error).foregroundStyle(.red).accessibilityIdentifier("share-error") }
                }
            } else if let error {
                Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("share-error") }
            }
            if !v.suggestions.isEmpty {
                Section("Passengers on this flight") {
                    ForEach(v.suggestions, id: \.email) { suggestion($0) }
                }
            }
            Section("People with access") {
                ForEach(v.rows) { row($0, roles: v.roles) }
            }
        }
        .disabled(busy)
    }

    private func suggestion(_ c: CoreSharing.Contact) -> some View {
        HStack(spacing: 12) {
            avatar(String(c.name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).lineLimit(1)
                if c.name != c.email { Text(c.email).font(.footnote).foregroundStyle(.secondary) }
            }
            Spacer()
            Button("Share (view)") {
                Task { await run { try await app.addShare(target, ShareInput(email: c.email, role: .view)) } }
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Share with \(c.name) as viewer")
            .accessibilityIdentifier("share-suggestion-add")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("share-suggestion-\(c.email)")
    }

    private func avatar(_ initial: String) -> some View {
        Text(initial)
            .font(.headline)
            .frame(width: 36, height: 36)
            .background(.tint.opacity(0.15), in: Circle())
            .accessibilityHidden(true)
    }

    private func row(_ p: CoreSharing.Row, roles: [CoreSharing.RoleOption]) -> some View {
        HStack(spacing: 12) {
            avatar(p.initial)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name + (p.isSelf ? " (you)" : "")).lineLimit(1)
                ForEach([p.email, p.note, p.via].filter { !$0.isEmpty }, id: \.self) {
                    Text($0).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer()
            switch p.control {
            case "manage":
                Menu {
                    Picker("Role", selection: roleBinding(p)) {
                        ForEach(roles, id: \.role) { Text($0.label).tag($0.role) }
                    }
                    Divider()
                    Button(p.removeLabel, role: .destructive) { removeTapped(p) }
                } label: {
                    HStack(spacing: 2) {
                        Text(p.roleLabel)
                        Image(systemName: "chevron.up.chevron.down").font(.caption2)
                    }
                }
                .accessibilityLabel("Role of \(p.name)")
                .accessibilityIdentifier("share-role-\(p.key)")
            default:
                VStack(alignment: .trailing, spacing: 4) {
                    Text(p.roleLabel).foregroundStyle(.secondary)
                    if p.canRemove {
                        Button(p.removeLabel) { removeTapped(p) }
                            .font(.footnote)
                            .buttonStyle(.borderless)
                            .accessibilityIdentifier("share-leave")
                    }
                }
            }
        }
        .swipeActions {
            if p.canRemove {
                Button(p.isSelf ? target.leaveAction : "Remove") { removeTapped(p) }.tint(.red)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("share-person-\(p.key)")
    }

    private func roleBinding(_ p: CoreSharing.Row) -> Binding<ShareRole> {
        Binding(
            get: { ShareRole(rawValue: p.role) ?? .view },
            set: { new in
                guard new.rawValue != p.role else { return }
                Task { await run { try await app.setShareRole(target, key: p.key, role: new) } }
            })
    }

    /// The pilot's own access asks first, as leaving from the lists does.
    private func removeTapped(_ p: CoreSharing.Row) {
        if p.isSelf { leaving = true } else { Task { await remove(p.key) } }
    }

    private func load() async {
        do {
            sharing = try await app.sharingOf(target)
        } catch {
            if !isCancellation(error) { loadError = error.localizedDescription }
        }
    }

    private func add(_ v: CoreSharing) async {
        guard let body = v.body else {
            error = v.error
            return
        }
        if await run({ try await app.addShare(target, body) }) { email = "" }
    }

    private func remove(_ key: String) async {
        var left = false
        _ = await run {
            let s = try await app.removeShare(target, key: key)
            left = s == nil
            return s
        }
        if left {
            dismiss()
            onLeft()
        }
    }

    /// One change: the sheet shows the server's sharing after it, or its error.
    @discardableResult
    private func run(_ change: () async throws -> String?) async -> Bool {
        busy = true
        error = nil
        defer { busy = false }
        do {
            if let s = try await change() { sharing = s }
            return true
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
            return false
        }
    }
}
