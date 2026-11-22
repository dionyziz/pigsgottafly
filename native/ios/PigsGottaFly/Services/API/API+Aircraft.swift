import Foundation

/// The hangar: aircraft, their version history, attachments and sharing (api/_lib/routes/{aircraft,
/// attachments,shares}.ts). Bodies are AircraftInput as JSON: the core builds and validates them
/// (PGF.aircraftFromTemplate, PGF.validateAircraft), so the app does not mirror the type.
extension API {
    /// GET /aircraft: the pilot's own aircraft and those shared with them.
    func aircraftList() async throws -> Data { try await get("aircraft") }

    func aircraft(_ id: String) async throws -> Data { try await get("aircraft/\(seg(id))") }

    /// POST /aircraft (AircraftInput, as PGF.aircraftFromTemplate builds it) → 201 the aircraft; it
    /// becomes the default aircraft when the pilot has none.
    func createAircraft(_ input: Data) async throws -> Data {
        try await request("POST", "aircraft", body: input)
    }

    /// PUT /aircraft/:id (Partial<AircraftInput>) → the aircraft.
    func updateAircraft(_ id: String, patch: JSON) async throws -> Data {
        try await send("PUT", "aircraft/\(seg(id))", body: patch)
    }

    /// DELETE /aircraft/:id (owner only; flights keep aircraftId = null).
    func deleteAircraft(_ id: String) async throws {
        try await sendIgnoringBody("DELETE", "aircraft/\(seg(id))")
    }

    /// GET /aircraft/:id/log: the change log (who changed what).
    func aircraftLog<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "aircraft/\(seg(id))/log", as: type)
    }

    // MARK: revisions

    /// GET /aircraft/:id/revisions[?before=] → AircraftRevisionPage.
    func aircraftRevisions<T: Decodable>(_ id: String, before: Int? = nil, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("GET", "aircraft/\(seg(id))/revisions" + (before.map { "?before=\($0)" } ?? ""), as: type)
    }

    /// GET /aircraft/:id/revisions/:rev → AircraftRevisionDetail (with the snapshot).
    func aircraftRevision<T: Decodable>(_ id: String, rev: Int, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "aircraft/\(seg(id))/revisions/\(rev)", as: type)
    }

    struct RestoreRequest: Encodable, Sendable {
        /// The newest revision the app has seen: 409 when the aircraft has a newer one. nil: no check.
        var head: Int?
        var headAt: Double?
    }

    /// POST /aircraft/:id/revisions/:rev/restore → AircraftRestoreResult (a new revision).
    func restoreAircraftRevision<T: Decodable>(
        _ id: String, rev: Int, _ req: RestoreRequest = .init(), as type: T.Type = JSON.self
    ) async throws -> T {
        try await call("POST", "aircraft/\(seg(id))/revisions/\(rev)/restore", body: req, as: type)
    }

    // MARK: attachments (compass swing reports)

    struct AttachmentInput: Encodable, Sendable {
        var name: String
        var mime: String
        /// The file, base64 with no data: prefix.
        var data: String
    }

    /// POST /aircraft/:id/attachments → AttachmentRef.
    func uploadAttachment<T: Decodable>(aircraftId: String, _ input: AttachmentInput, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", "aircraft/\(seg(aircraftId))/attachments", body: input, as: type)
    }

    /// GET /aircraft/:id/attachments/:fileId → Attachment (with the base64 data).
    func attachment<T: Decodable>(aircraftId: String, fileId: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "aircraft/\(seg(aircraftId))/attachments/\(seg(fileId))", as: type)
    }

    func deleteAttachment(aircraftId: String, fileId: String) async throws {
        try await sendIgnoringBody("DELETE", "aircraft/\(seg(aircraftId))/attachments/\(seg(fileId))")
    }

    // MARK: sharing

    /// GET /aircraft/:id/shares → AircraftSharing.
    func aircraftShares<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "aircraft/\(seg(id))/shares", as: type)
    }

    func shareAircraft<T: Decodable>(_ id: String, email: String, role: ShareRole, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", "aircraft/\(seg(id))/shares", body: ShareInput(email: email, role: role), as: type)
    }

    func setAircraftShareRole<T: Decodable>(
        _ id: String, pilotId: String, role: ShareRole, as type: T.Type = JSON.self
    ) async throws -> T {
        try await call("PUT", "aircraft/\(seg(id))/shares/\(seg(pilotId))", body: RoleInput(role: role), as: type)
    }

    /// With the pilot's own id: removes their own access (the aircraft leaves their hangar).
    func removeAircraftShare(_ id: String, pilotId: String) async throws {
        try await sendIgnoringBody("DELETE", "aircraft/\(seg(id))/shares/\(seg(pilotId))")
    }
}

/// src/shared/sharing.ts ShareRole.
enum ShareRole: String, Codable, Sendable, CaseIterable {
    case view, edit
}

struct ShareInput: Encodable, Sendable {
    var email: String
    var role: ShareRole
}

struct RoleInput: Encodable, Sendable {
    var role: ShareRole
}
