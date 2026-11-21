import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let p = session.pilot {
                    Section("Signed in") {
                        Text(p.fullName.flatMap { $0.isEmpty ? nil : $0 } ?? p.name).font(.headline)
                        Text(p.email).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Link(destination: API.site.appendingPathComponent("profile")) {
                        Label("Profile on the website", systemImage: "person.text.rectangle")
                    }
                    .frame(minHeight: 44)
                } footer: {
                    Text("Your details for the forms, your settings, and deleting the account are on the website.")
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
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    private var coreVersion: String {
        guard let core = app.core else { return app.coreError ?? "Not loaded" }
        return core.version
    }
}
