import Foundation

/// Operators and documents as the website's operator pages and documents section call the API
/// (src/features/operators/, src/data/aircraftFiles.ts). Bodies come from the core.
extension AppModel {
    /// GET /api/operators: the list's rows and the list as JSON text.
    func operatorRows() async throws -> [CoreOperatorRow] {
        guard let core else { throw APIError.http(0, coreError ?? "The core did not load.") }
        let list: JSON = try await api.operators()
        return try core.operatorList(list.text)
    }

    /// New operator: POST /api/operators with the name; the new operator's id.
    func createOperator(name: String) async throws -> String {
        guard let core else { throw APIError.http(0, coreError ?? "The core did not load.") }
        let made = try core.newOperator(name: name)
        guard let body = made.body else { throw APIError.http(0, made.error ?? "") }
        let o: JSON = try await api.createOperator(body)
        guard let id = o["id"]?.string else { throw APIError.http(0, "The server sent no operator.") }
        operatorsChanged += 1
        return id
    }

    func deleteOperator(_ id: String) async throws {
        try await api.deleteOperator(id)
        operatorsChanged += 1
    }

    // MARK: documents

    /// GET …/files' documents (JSON text).
    func documentList(_ scope: API.FileScope) async throws -> String {
        let files: JSON = try await api.fileList(scope)
        return (files["documents"] ?? []).text
    }

    /// Uploads a PDF chunk by chunk (`start` from PGF.documents); `progress` gets 0…1.
    func uploadDocument(
        _ scope: API.FileScope, data: Data, start: API.FileStart, chunkBytes: Int,
        progress: @escaping (Double) -> Void
    ) async throws {
        let f: JSON = try await api.startFile(scope, start)
        guard let id = f["id"]?.string else { throw APIError.http(0, "The server sent no file.") }
        let count = max(1, f["chunks"]?.int ?? 1)
        for seq in 0..<count {
            let lo = seq * chunkBytes
            let part = data.subdata(in: min(lo, data.count)..<min(lo + chunkBytes, data.count))
            try await api.putFileChunk(scope, fileId: id, seq: seq, base64: part.base64EncodedString())
            progress(Double(seq + 1) / Double(count))
        }
        let _: JSON = try await api.completeFile(scope, fileId: id)
    }

    /// A document's content, chunk by chunk.
    func downloadDocument(_ scope: API.FileScope, file: JSON) async throws -> Data {
        guard let id = file["id"]?.string else { throw APIError.notFound }
        var out = Data()
        for seq in 0..<max(1, file["chunks"]?.int ?? 1) {
            out.append(try await api.fileChunk(scope, fileId: id, seq: seq))
        }
        return out
    }
}
