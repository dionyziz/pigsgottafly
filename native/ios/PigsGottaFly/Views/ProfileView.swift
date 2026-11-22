import SwiftUI

/// The pilot's name, phone and home aerodrome (PUT /api/me). None is required, as on the website: a
/// new account has only its e-mail, and the flight plan and the forms ask for what they lack.
struct ProfileView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var fullName = ""
    @State private var phone = ""
    @State private var home: Place?
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var autorouter: AutorouterLink?
    @State private var linking = false
    @State private var connector = AutorouterConnect()

    var body: some View {
        Form {
            Section("Pilot") {
                TextField("Full name", text: $fullName)
                    .textContentType(.name)
                    .accessibilityIdentifier("profile-name")
                TextField("Phone", text: $phone)
                    .textContentType(.telephoneNumber)
                    .keyboardType(.phonePad)
                    .accessibilityIdentifier("profile-phone")
            }
            Section("Home aerodrome") {
                NavigationLink {
                    PlaceSearchView(title: "Home aerodrome", aerodromesOnly: true) { home = $0 }
                } label: {
                    HStack {
                        Text("Aerodrome")
                        Spacer()
                        Text(home.map { "\($0.name) · \($0.detail)" } ?? "Choose")
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .accessibilityIdentifier("profile-home")
            }
            if let link = autorouter, link.enabled {
                Section("autorouter") {
                    HStack {
                        Text(
                            link.connected
                                ? "Connected" + (link.account.map { " · \($0)" } ?? "")
                                : link.broken ? "Connection refused by autorouter" : "Not connected"
                        )
                        .accessibilityIdentifier("autorouter-state")
                        Spacer()
                        if linking { ProgressView() }
                    }
                    if !link.connected {
                        Button(link.broken ? "Reconnect" : "Connect") { Task { await connect() } }
                            .disabled(linking)
                            .accessibilityIdentifier("autorouter-connect")
                    }
                    if link.connected || link.broken {
                        Button("Disconnect", role: .destructive) { Task { await disconnect() } }
                            .disabled(linking)
                            .accessibilityIdentifier("autorouter-disconnect")
                    }
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button("Save") { Task { await save() } }
                        .accessibilityIdentifier("save-profile")
                }
            }
        }
        .task { await load() }
        .task { autorouter = try? await app.api.autorouter() }
    }

    private func connect() async {
        linking = true
        error = nil
        defer { linking = false }
        do {
            let result = await connector.run(try await app.api.autorouterConnectURL())
            if result == "failed" { error = "autorouter did not connect. Try again." }
            autorouter = try await app.api.autorouter()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func disconnect() async {
        linking = true
        error = nil
        defer { linking = false }
        do {
            autorouter = try await app.api.autorouterDisconnect()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        if let p = app.pilot {
            fullName = p.fullName
            phone = p.phone
            if let code = p.homeAerodrome, !code.isEmpty {
                home = await app.places(aerodromesOnly: true).first { $0.code == code || $0.refId == code }
            }
        }
    }

    private func save() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await app.saveProfile(fullName: fullName, phone: phone, home: home)
            dismiss()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}

/// Deletes the account and everything it owns (DELETE /api/me), confirmed by typing its e-mail, as on
/// the website's profile page; then the app is signed out and its saved copies are gone.
struct DeleteAccountView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    var onDeleted: () -> Void

    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?

    private var email: String { app.pilot?.email ?? session.pilot?.email ?? "" }
    private var matches: Bool {
        !email.isEmpty && typed.trimmingCharacters(in: .whitespaces).lowercased() == email.lowercased()
    }

    var body: some View {
        Form {
            Section {
                Text(
                    "This deletes your account and everything in it: your flights, aircraft, passengers, waypoints, documents and profile. It cannot be undone."
                )
            }
            Section {
                TextField(email.isEmpty ? "Your e-mail" : email, text: $typed)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("delete-confirm-email")
            } header: {
                Text("Type your e-mail to confirm")
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            Section {
                Button(role: .destructive) {
                    Task { await delete() }
                } label: {
                    HStack {
                        if busy { ProgressView() }
                        Text("Delete my account").frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .disabled(!matches || busy)
                .accessibilityIdentifier("confirm-delete")
            }
        }
        .navigationTitle("Delete account")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func delete() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await app.deleteAccount(confirm: typed.trimmingCharacters(in: .whitespaces))
            onDeleted()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
