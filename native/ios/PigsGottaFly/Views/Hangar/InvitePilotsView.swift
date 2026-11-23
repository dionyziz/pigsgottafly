import SwiftUI

/// The website's "Invite pilots": an e-mail, a note, and some of the aircraft the pilot may share
/// (owner or editor) with a role each; an address with an account gets the aircraft at once. Below,
/// the invitations still open, each with Cancel. The lists and messages come from the core
/// (PGF.invite).
struct InvitePilotsView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    /// GET /api/aircraft as JSON text.
    var hangar: String
    /// After an invitation shared aircraft with an existing account (the list's sharing changed).
    var onShared: () -> Void = {}

    @State private var invitations: String?
    @State private var email = ""
    @State private var note = ""
    @State private var picked: [String: ShareRole] = [:]
    @State private var busy = false
    @State private var error: String?
    @State private var done: String?

    private var view: CoreInvite? {
        try? app.core?.invite(
            hangar: hangar, invitations: invitations ?? "[]", email: email, note: note,
            picked: order(picked))
    }

    var body: some View {
        let v = view
        NavigationStack {
            Form {
                Section {
                    TextField("E-mail address", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: email) { error = nil }
                        .accessibilityIdentifier("invite-email")
                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                        .onChange(of: note) { _, new in if new.count > 500 { note = String(new.prefix(500)) } }
                        .accessibilityIdentifier("invite-note")
                }
                if let v, !v.shareable.isEmpty {
                    Section("Share aircraft") {
                        ForEach(v.shareable) { aircraftRow($0) }
                    }
                    .accessibilityIdentifier("invite-aircraft")
                }
                Section {
                    Button("Invite") { Task { await send() } }
                        .disabled(busy)
                        .accessibilityIdentifier("invite-send")
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(.red).accessibilityIdentifier("invite-error")
                    } else if let done {
                        Text(done).accessibilityIdentifier("invite-done")
                    }
                }
                if invitations == nil {
                    Section { ProgressView() }
                } else if let v, !v.invitations.isEmpty {
                    Section("Invited") {
                        ForEach(v.invitations) { invitationRow($0) }
                    }
                    .accessibilityIdentifier("invitations")
                }
            }
            .disabled(busy)
            .navigationTitle("Invite pilots")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(busy).accessibilityIdentifier("invite-done-button")
                }
            }
        }
        .task { await load() }
        .accessibilityIdentifier("invite-dialog")
    }

    private func aircraftRow(_ a: CoreInvite.Aircraft) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: Binding(get: { picked[a.id] != nil }, set: { picked[a.id] = $0 ? .view : nil })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.registration).font(.body.monospaced())
                    if !a.makeModel.isEmpty { Text(a.makeModel).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .accessibilityIdentifier("invite-aircraft-\(a.id)")
            if picked[a.id] != nil {
                Picker(
                    "Role on \(a.registration)",
                    selection: Binding(get: { picked[a.id] ?? .view }, set: { picked[a.id] = $0 })
                ) {
                    Text("Viewer").tag(ShareRole.view)
                    Text("Editor").tag(ShareRole.edit)
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private func invitationRow(_ inv: CoreInvite.Invitation) -> some View {
        HStack(spacing: 12) {
            Text(inv.initial)
                .font(.headline)
                .frame(width: 36, height: 36)
                .background(.tint.opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(inv.email).lineLimit(1)
                if !inv.aircraft.isEmpty {
                    Text(inv.aircraft).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("invitation-aircraft")
                }
            }
            Spacer()
            Button("Cancel") { Task { await cancel(inv) } }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("invitation-cancel")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("invitation-\(inv.id)")
    }

    /// The hangar's order, as the website sends the picked aircraft.
    private func order(_ picked: [String: ShareRole]) -> [(String, ShareRole)] {
        let ids = (try? JSON.parse(hangar))?.array?.compactMap { $0["id"]?.string } ?? []
        return ids.compactMap { id in picked[id].map { (id, $0) } }
    }

    private func load() async {
        do {
            invitations = try await app.invitations()
        } catch {
            if !isCancellation(error) {
                invitations = "[]"
                self.error = error.localizedDescription
            }
        }
    }

    private func send() async {
        guard let v = view else { return }
        guard let body = v.body else {
            error = v.error
            return
        }
        busy = true
        error = nil
        done = nil
        defer { busy = false }
        do {
            let response = try await app.invite(body)
            let answer = try? JSON.parse(response)
            invitations = answer?["invitations"]?.text ?? invitations
            done = (try? app.core?.invite(email: email, response: response))?.done
            if answer?["existing"]?.bool == true { onShared() }
            email = ""
            note = ""
            picked = [:]
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func cancel(_ inv: CoreInvite.Invitation) async {
        busy = true
        error = nil
        done = nil
        defer { busy = false }
        do {
            try await app.cancelInvitation(inv.id)
            invitations = try await app.invitations()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
