import Foundation

/// Session, profile, account and the pilot's own autorouter link (api/_lib/routes/{session,me,account,
/// autorouter,admin,monitoring}.ts; the website's src/data/api.ts).
extension API {
    func session() async throws -> SessionResponse {
        try decode(SessionResponse.self, try await get("session"))
    }

    func logout() async throws {
        _ = try await request("POST", "logout", body: Data("{}".utf8))
    }

    /// POST /session/revoke-all: every other device is signed out (Profile, "Sign out everywhere").
    func revokeAllSessions() async throws {
        try await sendIgnoringBody("POST", "session/revoke-all")
    }

    func me() async throws -> Data { try await get("me") }

    /// PUT /me (PilotUpdate: only the fields sent change) → the pilot.
    func updateMe(_ patch: JSON) async throws -> Data {
        try await request("PUT", "me", body: try patch.data())
    }

    /// DELETE /me { confirm: the account's e-mail }: the account and everything it owns.
    func deleteAccount(confirm: String) async throws {
        _ = try await request("DELETE", "me", body: try JSON.object(["confirm": .string(confirm)]).data())
    }

    /// GET /me/export: everything the account holds, the JSON file the website downloads (GDPR
    /// portability).
    func exportAccount() async throws -> Data { try await get("me/export") }

    func autorouter() async throws -> AutorouterLink {
        try decode(AutorouterLink.self, try await get("autorouter"))
    }

    /// POST /autorouter/app-connect → the page that starts linking, for the sign-in sheet (it has
    /// Safari's cookies, not the app's session, so the URL carries a short-lived ticket).
    func autorouterConnectURL() async throws -> URL {
        let r = try decode(
            [String: String].self, try await request("POST", "autorouter/app-connect", body: Data("{}".utf8)))
        guard let s = r["url"], let url = URL(string: s) else { throw APIError.http(0, "No link to autorouter.") }
        return url
    }

    func autorouterDisconnect() async throws -> AutorouterLink {
        try decode(AutorouterLink.self, try await request("POST", "autorouter/disconnect", body: Data("{}".utf8)))
    }

    // MARK: admin (403 for everyone but ADMIN_EMAILS)

    func adminPilots<T: Decodable>(as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "admin/pilots", as: type)
    }

    func adminMail<T: Decodable>(pilot: String? = nil, kind: String? = nil, as type: T.Type = JSON.self)
        async throws -> T
    {
        var q = URLComponents()
        q.queryItems = [("pilot", pilot), ("kind", kind)].compactMap { k, v in
            guard let v, !v.isEmpty else { return nil }
            return URLQueryItem(name: k, value: v)
        }
        return try await call("GET", "admin/mail?" + (q.percentEncodedQuery ?? ""), as: type)
    }

    enum ErrorStatus: String, Sendable {
        case open, resolved, all
    }

    func adminErrors<T: Decodable>(status: ErrorStatus = .open, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "admin/errors?status=\(status.rawValue)", as: type)
    }

    func adminError<T: Decodable>(_ fingerprint: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "admin/errors/\(seg(fingerprint))", as: type)
    }

    func resolveAdminError(_ fingerprint: String) async throws {
        try await sendIgnoringBody("POST", "admin/errors/\(seg(fingerprint))/resolve")
    }
}
