import SwiftUI

/// The pilot: profile, planning defaults, map layers, documents, the account, legal, about. iPhone's Me
/// tab; Profile in the iPad sidebar.
struct MeView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var session: Session
    /// The website's CONTACT_EMAIL (src/app/contact.ts).
    static let contactEmail = "dionyziz@commonprefix.com"

    var body: some View {
        Form {
            if let email = app.pilot?.email ?? session.pilot?.email {
                Section("Signed in") {
                    Text(displayName).font(.headline)
                    Text(email).foregroundStyle(.secondary)
                }
            }
            Section {
                link("Profile", "person.text.rectangle", id: "profile") { ProfileView() }
                link("Planning defaults", "slider.horizontal.3", id: "planning-defaults") { PlanningDefaultsView() }
                link("Map layers", "square.3.layers.3d", id: "profile-map-layers") { MapLayersView() }
                link("Licence and medical", "doc.on.doc", id: "pilot-documents") { PilotDocumentsView() }
            }
            if session.billingEnforced || session.admin {
                Section {
                    link("Subscription", "creditcard", id: "subscription-link") { SubscriptionView() }
                }
            }
            Section {
                Button(role: .destructive) {
                    Task { await session.signOut() }
                } label: {
                    Text("Sign out").frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityIdentifier("sign-out")
                link("Account", "person.crop.circle.badge.xmark", id: "account-section") { AccountSettingsView() }
                NavigationLink {
                    DeleteAccountView {}
                } label: {
                    Text("Delete account").foregroundStyle(.red)
                }
                .accessibilityIdentifier("delete-account")
            }
            if session.admin {
                Section {
                    WebLinkRow(title: "Admin", path: "admin", id: "admin-link")
                }
            }
            Section("About") {
                link("Legal", "doc.plaintext", id: "legal") { LegalView() }
                link("Open-source licenses", "doc.text", id: "licenses-link") { LicensesView() }
                if let mail = URL(string: "mailto:\(Self.contactEmail)") {
                    Link(destination: mail) {
                        Label(Self.contactEmail, systemImage: "envelope")
                    }
                    .accessibilityIdentifier("contact")
                }
                ValueRow(label: "App", value: appVersion)
                ValueRow(label: "Core", value: coreVersion)
            }
        }
        .navigationTitle("Me")
        .task { await app.loadPilot() }
        .accessibilityIdentifier("me")
    }

    private func link<D: View>(_ title: String, _ image: String, id: String, @ViewBuilder _ destination: () -> D)
        -> some View
    {
        NavigationLink(destination: destination) {
            Label(title, systemImage: image)
        }
        .accessibilityIdentifier(id)
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
        return core.version
    }
}
