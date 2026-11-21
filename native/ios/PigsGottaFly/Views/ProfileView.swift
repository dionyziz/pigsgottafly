import SwiftUI

/// The pilot's name, phone and home aerodrome (PUT /api/me). A new pilot is asked for them first
/// (`welcome`), as on the website: the name and phone go on the flight plan and the forms, and new
/// flights start at the home aerodrome.
struct ProfileView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    var welcome: Bool

    @State private var fullName = ""
    @State private var phone = ""
    @State private var home: Place?
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            if welcome {
                Section {
                    Text(
                        "Welcome. Your name and phone go on the flight plan and the forms; new flights start at your home aerodrome."
                    )
                    .font(.callout)
                }
            }
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
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            if welcome {
                Section {
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        .frame(minHeight: 44)
                }
            }
        }
        .navigationTitle(welcome ? "Your profile" : "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button(welcome ? "Continue" : "Save") { Task { await save() } }
                        .disabled(!ready)
                        .accessibilityIdentifier("save-profile")
                }
            }
        }
        .task { await load() }
    }

    private var ready: Bool {
        !fullName.trimmingCharacters(in: .whitespaces).isEmpty && !phone.trimmingCharacters(in: .whitespaces).isEmpty
            && home != nil && !busy
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
            if !welcome { dismiss() }
        } catch {
            self.error = error.localizedDescription
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
            self.error = error.localizedDescription
        }
    }
}
