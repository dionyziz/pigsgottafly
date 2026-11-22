import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// A PDF made on the device or fetched (the navlog, the briefing, the forms) as a file to share: Files,
/// AirDrop and Mail take it with its name.
struct PDFFile: Transferable, Equatable, Sendable {
    var url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { SentTransferredFile($0.url) }
    }

    /// Writes `data` to a temporary file named `name`.pdf: the share sheet shows that name.
    static func write(_ data: Data, name: String) throws -> PDFFile {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pdf-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "-") + ".pdf")
        try data.write(to: url)
        return PDFFile(url: url)
    }
}

/// QuickLook's preview with Share and Print in the toolbar.
struct PDFPreview: View {
    var file: PDFFile
    var title: String

    var body: some View {
        QuickLookView(url: file.url)
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        AirPrint.print(file.url, name: title)
                    } label: {
                        Image(systemName: "printer")
                    }
                    .accessibilityLabel("Print")
                    .accessibilityIdentifier("pdf-print")
                    ShareLink(item: file, preview: SharePreview(title, image: Image(systemName: "doc.richtext")))
                        .accessibilityIdentifier("pdf-share")
                }
            }
            .accessibilityIdentifier("pdf-preview")
    }
}

/// QLPreviewController, for its paging, zoom and markup.
struct QuickLookView: UIViewControllerRepresentable {
    var url: URL

    func makeCoordinator() -> Source { Source(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let c = QLPreviewController()
        c.dataSource = context.coordinator
        return c
    }

    func updateUIViewController(_ c: QLPreviewController, context: Context) {
        if context.coordinator.url != url {
            context.coordinator.url = url
            c.reloadData()
        }
    }

    final class Source: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}

@MainActor
enum AirPrint {
    static func print(_ url: URL, name: String) {
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = name
        let c = UIPrintInteractionController.shared
        c.printInfo = info
        c.printingItem = url
        c.present(animated: true)
    }
}
