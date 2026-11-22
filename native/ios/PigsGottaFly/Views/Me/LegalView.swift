import SwiftUI

/// The website's legal and help pages, as the sign-in footer links them.
struct LegalView: View {
    var body: some View {
        List {
            WebLinkRow(title: "Privacy", path: "privacy", id: "legal-privacy")
            WebLinkRow(title: "Terms", path: "terms", id: "legal-terms")
            WebLinkRow(title: "Support", path: "support", id: "legal-support")
            WebLinkRow(title: "About", path: "about", id: "about")
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Legal")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("legal-section")
    }
}
