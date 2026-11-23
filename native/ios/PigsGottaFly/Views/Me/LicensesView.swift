import SwiftUI

/// The open-source licenses: the website's src/data/licenses.json (npm run licenses), bundled as is,
/// so the app and /about/licenses list the same software, fonts and data.
struct Licenses: Decodable {
    struct Entry: Decodable, Identifiable {
        var group: String
        var name: String
        var version: String?
        var license: String
        var copyright: String?
        var url: String?
        var text: String
        var id: String { "\(name)@\(version ?? "")" }
    }

    var entries: [Entry]
    var texts: [String: String]

    static let groups: [(key: String, title: String)] = [
        ("Software", "Software"), ("Fonts", "Fonts"), ("Data", "Map, terrain and weather data"),
    ]

    static func load(bundle: Bundle = .main) -> Licenses? {
        guard let url = bundle.url(forResource: "licenses", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(Licenses.self, from: data)
    }
}

struct LicensesView: View {
    private let licenses = Licenses.load()

    var body: some View {
        List {
            if let licenses {
                ForEach(Licenses.groups, id: \.key) { group in
                    Section(group.title) {
                        ForEach(licenses.entries.filter { $0.group == group.key }) { entry in
                            NavigationLink {
                                LicenseTextView(entry: entry, text: licenses.texts[entry.text] ?? "")
                            } label: {
                                LicenseRow(entry: entry)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Open-source licenses")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("licenses")
    }
}

private struct LicenseRow: View {
    var entry: Licenses.Entry

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                if let v = entry.version {
                    Text(v).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(entry.license).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LicenseTextView: View {
    var entry: Licenses.Entry
    var text: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let c = entry.copyright {
                    Text(c).font(.subheadline)
                }
                if let s = entry.url, let url = URL(string: s) {
                    Link(s, destination: url).font(.subheadline)
                }
                Text(text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
