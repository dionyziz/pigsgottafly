import SafariServices
import SwiftUI

/// A report as published (monospaced, wraps).
struct Code: View {
    var text: String
    var body: some View {
        Text(text).font(.callout.monospaced()).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
    }
}

struct ValueRow: View {
    var label: String
    var value: String
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit().foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SafariView: UIViewControllerRepresentable {
    var url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// A row that opens a page of the website in the in-app browser, for what the app does not do yet;
/// `onClose` reads again what the page may have changed.
struct WebLinkRow: View {
    var title: String
    /// A path of https://pigsgottafly.com ("hangar", "flights/<id>/export/fpl").
    var path: String
    var id: String
    var onClose: (() -> Void)?
    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Label(title, systemImage: "safari")
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .accessibilityIdentifier(id)
        .sheet(isPresented: $open, onDismiss: onClose) {
            SafariView(url: API.site.appendingPathComponent(path)).ignoresSafeArea()
        }
    }
}

/// A screen the app has the place for but not yet the form: its title and the website's page.
struct SectionStub: View {
    var title: String
    var systemImage: String
    var path: String
    var id: String
    var onClose: (() -> Void)?

    var body: some View {
        List {
            Section {
                WebLinkRow(title: "Open on pigsgottafly.com", path: path, id: "\(id)-web", onClose: onClose)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier(id)
    }
}
