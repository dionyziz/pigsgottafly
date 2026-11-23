import SwiftUI
import UniformTypeIdentifiers

/// The website's documents section (src/features/hangar/AircraftFiles.tsx DocumentsSection) for an
/// operator's (or an aircraft's) PDFs: each with its title and file line; open in the viewer, share;
/// whoever may edit adds a PDF (with a title, else the file's name), renames and removes. What may be
/// uploaded and how a row reads come from the core (PGF.documents).
struct DocumentsSection: View {
    @EnvironmentObject private var app: AppModel
    var scope: API.FileScope
    var canEdit: Bool
    /// "No documents."
    var empty = "No documents."
    /// "Title, e.g., Operations manual"
    var placeholder = "Title, e.g., Operations manual"

    @State private var files: String?
    @State private var error: String?
    @State private var title = ""
    @State private var importing = false
    @State private var progress: (name: String, done: Double)?
    @State private var opened: OpenedPDF?
    @State private var renaming: CoreDocuments.Row?
    @State private var renameText = ""

    struct OpenedPDF: Identifiable {
        var file: PDFFile
        var title: String
        var id: URL { file.url }
    }

    private var view: CoreDocuments? { try? app.core?.documents(files ?? "[]") }

    private func file(_ id: String) -> JSON? {
        (files.flatMap { try? JSON.parse($0) }?.array ?? []).first { $0["id"]?.string == id }
    }

    var body: some View {
        let v = view
        Section {
            if files == nil && error == nil {
                ProgressView()
            } else if v?.rows.isEmpty ?? true {
                Text(empty).foregroundStyle(.secondary)
            }
            ForEach(v?.rows ?? []) { row($0) }
            if canEdit {
                TextField(placeholder, text: $title)
                    .disabled(progress != nil)
                    .accessibilityIdentifier("doc-title-new")
                Button {
                    importing = true
                } label: {
                    Label("Add PDF", systemImage: "doc.badge.plus")
                }
                .disabled(progress != nil)
                .accessibilityIdentifier("doc-pick")
            }
            if let progress {
                ProgressView("Uploading \(progress.name)", value: progress.done)
            }
        } header: {
            Text("Documents")
        } footer: {
            if let error {
                Text(error).foregroundStyle(.red).accessibilityIdentifier("doc-error")
            } else if canEdit, let hint = v?.hint {
                Text(hint)
            }
        }
        .task { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result { Task { await upload(url) } }
        }
        .sheet(item: $opened) { o in
            NavigationStack { PDFPreview(file: o.file, title: o.title) }
        }
        .alert("Document title", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let r = renaming { Task { await rename(r) } } }
        }
    }

    private func row(_ r: CoreDocuments.Row) -> some View {
        Button {
            Task { await open(r) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.richtext").foregroundStyle(.red)
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).foregroundStyle(.primary)
                    Text(r.detail).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("doc-\(r.id)")
        .swipeActions {
            if canEdit {
                Button("Remove", role: .destructive) { Task { await remove(r) } }
            }
        }
        .contextMenu {
            Button("Open", systemImage: "doc.text.magnifyingglass") { Task { await open(r) } }
            if canEdit {
                Button("Rename", systemImage: "pencil") {
                    renameText = r.title
                    renaming = r
                }
                Button("Remove \(r.title)", systemImage: "trash", role: .destructive) { Task { await remove(r) } }
            }
        }
    }

    private func load() async {
        do {
            files = try await app.documentList(scope)
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func upload(_ url: URL) async {
        error = nil
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            guard
                let check = try app.core?.documents(
                    pick: ("application/pdf", data.count, url.lastPathComponent), title: title)
            else { return }
            guard let start = check.start else {
                error = check.pickError
                return
            }
            progress = (url.lastPathComponent, 0)
            defer { progress = nil }
            try await app.uploadDocument(scope, data: data, start: start, chunkBytes: check.chunkBytes) { p in
                Task { @MainActor in progress = (url.lastPathComponent, p) }
            }
            title = ""
            await load()
        } catch {
            if !isCancellation(error) { self.error = "Upload failed: \(error.localizedDescription)" }
        }
    }

    private func open(_ r: CoreDocuments.Row) async {
        guard let f = file(r.id) else { return }
        do {
            let data = try await app.downloadDocument(scope, file: f)
            opened = OpenedPDF(file: try PDFFile.write(data, name: r.title), title: r.title)
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func rename(_ r: CoreDocuments.Row) async {
        guard let to = try? app.core?.documents(rename: (r.title, renameText)).renamed else { return }
        do {
            let _: JSON = try await app.api.renameFile(scope, fileId: r.id, title: to)
            await load()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func remove(_ r: CoreDocuments.Row) async {
        do {
            try await app.api.deleteFile(scope, fileId: r.id)
            await load()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }
}
