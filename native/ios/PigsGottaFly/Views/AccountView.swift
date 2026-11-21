import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let email = app.pilot?.email ?? session.pilot?.email {
                    Section("Signed in") {
                        Text(displayName).font(.headline)
                        Text(email).foregroundStyle(.secondary)
                    }
                }
                Section {
                    NavigationLink {
                        ProfileView(welcome: false)
                    } label: {
                        Label("Profile", systemImage: "person.text.rectangle")
                    }
                    .accessibilityIdentifier("profile")
                    Link(destination: API.site.appendingPathComponent("profile")) {
                        Label("Settings on the website", systemImage: "safari")
                    }
                    .frame(minHeight: 44)
                } footer: {
                    Text(
                        "Your name, phone and home aerodrome. Your other details for the forms, the hangar and your settings are on pigsgottafly.com."
                    )
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            await session.signOut()
                            dismiss()
                        }
                    } label: {
                        Text("Sign out").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityIdentifier("sign-out")
                    NavigationLink {
                        DeleteAccountView { dismiss() }
                    } label: {
                        Text("Delete account").foregroundStyle(.red)
                    }
                    .accessibilityIdentifier("delete-account")
                }
                Section("About") {
                    ValueRow(label: "App", value: appVersion)
                    ValueRow(label: "Core", value: coreVersion)
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { await app.loadPilot() }
    }

    private var displayName: String {
        if let n = app.pilot?.fullName, !n.isEmpty { return n }
        if let n = session.pilot?.fullName, !n.isEmpty { return n }
        return app.pilot?.name ?? session.pilot?.name ?? ""
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    private var coreVersion: String {
        guard let core = app.core else { return app.coreError ?? "Not loaded" }
        return core.isStub ? "\(core.version) (stub)" : core.version
    }
}
