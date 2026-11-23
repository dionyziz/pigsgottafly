import SwiftUI

/// The website's "Share SX-ASV" dialog: add people by e-mail as viewer or editor (an address no
/// account uses gets an invitation to the app, listed as pending), change their role, remove them,
/// or remove one's own access. The rows and messages come from the core (PGF.sharing).
struct ShareAircraftView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    var aircraftId: String
    var registration: String
    /// The pilot removed their own access: the aircraft left their hangar.
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
        return try? app.core?.sharing(sharing, myId: app.pilot?.id ?? "", email: email, role: role)
    }

    /// The sharing names the aircraft; the caller's name stands in until it loads.
    private var shownRegistration: String {
        sharing.flatMap { try? JSON.parse($0) }?["registration"]?.string ?? registration
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
            .navigationTitle("Share \(shownRegistration)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(busy).accessibilityIdentifier("share-done")
                }
            }
            .confirmDestructive(
                "Remove \(shownRegistration) from your hangar?", isPresented: $leaving, action: "Remove"
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
            Section("People with access") {
                ForEach(v.rows) { row($0, roles: v.roles) }
            }
            .accessibilityIdentifier("share-people")
        }
        .disabled(busy)
    }

    private func row(_ p: CoreSharing.Row, roles: [CoreSharing.RoleOption]) -> some View {
        HStack(spacing: 12) {
            Text(p.initial)
                .font(.headline)
                .frame(width: 36, height: 36)
                .background(.tint.opacity(0.15), in: Circle())
                .accessibilityHidden(true)
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
                Button(p.isSelf ? "Leave" : "Remove") { removeTapped(p) }.tint(.red)
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
                Task { await run { try await app.setAircraftShareRole(aircraftId, key: p.key, role: new) } }
            })
    }

    /// The pilot's own access asks first, as removing it from the hangar list does.
    private func removeTapped(_ p: CoreSharing.Row) {
        if p.isSelf { leaving = true } else { Task { await remove(p.key) } }
    }

    private func load() async {
        do {
            sharing = try await app.aircraftSharing(aircraftId)
        } catch {
            if !isCancellation(error) { loadError = error.localizedDescription }
        }
    }

    private func add(_ v: CoreSharing) async {
        guard let body = v.body else {
            error = v.error
            return
        }
        if await run({ try await app.shareAircraft(aircraftId, body) }) { email = "" }
    }

    private func remove(_ key: String) async {
        var left = false
        _ = await run {
            let s = try await app.removeAircraftShare(aircraftId, key: key)
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
