import Foundation

/// Chunked files (api/_lib/routes/files.ts): an aircraft's photo and documents, an operator's documents,
/// the pilot's licence and medical certificate. The same routes under three parents; chunks travel as
/// base64 in JSON because the API takes JSON bodies only (src/data/aircraftFiles.ts).
extension API {
    enum FileScope: Sendable, Equatable {
        case aircraft(String)
        case operators(String)
        /// The pilot's own id only.
        case pilot(String)
    }

    /// src/shared/types.ts FileKind.
    enum FileKind: String, Codable, Sendable {
        case photo, document, licence, medical
    }

    struct FileStart: Codable, Equatable, Sendable {
        var kind: FileKind
        var name: String
        var title: String
        var mime: String
        var size: Int
    }

    private func files(_ scope: FileScope) -> String {
        switch scope {
        case .aircraft(let id): "aircraft/\(seg(id))/files"
        case .operators(let id): "operators/\(seg(id))/files"
        case .pilot(let id): "pilots/\(seg(id))/files"
        }
    }

    /// GET …/files → AircraftFiles, OperatorFiles or PilotFiles.
    func fileList<T: Decodable>(_ scope: FileScope, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", files(scope), as: type)
    }

    /// POST …/files → the AircraftFile row, incomplete until `completeFile`.
    func startFile<T: Decodable>(_ scope: FileScope, _ start: FileStart, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", files(scope), body: start, as: type)
    }

    /// PUT …/files/:fileId/chunks/:seq { data: base64 }.
    func putFileChunk(_ scope: FileScope, fileId: String, seq: Int, base64: String) async throws {
        try await sendIgnoringBody(
            "PUT", "\(files(scope))/\(seg(fileId))/chunks/\(seq)", body: ["data": JSON.string(base64)] as JSON)
    }

    func completeFile<T: Decodable>(_ scope: FileScope, fileId: String, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", "\(files(scope))/\(seg(fileId))/complete", as: type)
    }

    /// GET …/files/:fileId/chunks/:seq → the chunk's bytes.
    func fileChunk(_ scope: FileScope, fileId: String, seq: Int) async throws -> Data {
        let r = try await call("GET", "\(files(scope))/\(seg(fileId))/chunks/\(seq)", as: [String: String].self)
        guard let b = r["data"], let d = Data(base64Encoded: b) else { throw APIError.http(0, "A damaged chunk.") }
        return d
    }

    func renameFile<T: Decodable>(_ scope: FileScope, fileId: String, title: String, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("PUT", "\(files(scope))/\(seg(fileId))", body: ["title": JSON.string(title)] as JSON, as: type)
    }

    func deleteFile(_ scope: FileScope, fileId: String) async throws {
        try await sendIgnoringBody("DELETE", "\(files(scope))/\(seg(fileId))")
    }
}
