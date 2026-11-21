import Foundation

/// Sends one request. URLSession in the app; bundled fixtures in fixture mode; a fake in the tests.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: HTTPTransport {
    var session: URLSession

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0, "No HTTP response") }
        return (data, http)
    }
}

enum APIError: Error, Equatable, LocalizedError {
    /// 401: the session is gone.
    case unauthorized
    case notFound
    /// 409 on PUT /flights/:id: the body is the current flight.
    case conflict(Data)
    case http(Int, String)
    /// No connection (or the server could not be reached).
    case offline

    var errorDescription: String? {
        switch self {
        case .unauthorized: "You are signed out."
        case .notFound: "Not found."
        case .conflict: "The flight was changed on another device."
        case .http(let code, let message): message.isEmpty ? "The server answered \(code)." : message
        case .offline: "No connection."
        }
    }
}

/// A cancelled task or request (a view went away, a newer load replaced it): not something to show the pilot.
func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    if let e = error as? URLError, e.code == .cancelled { return true }
    return false
}

/// The website's API (https://pigsgottafly.com/api; src/shared/api.ts). Paths are relative to /api.
final class API: Sendable {
    static let site = URL(string: "https://pigsgottafly.com")!
    let base: URL
    let transport: HTTPTransport

    init(base: URL = API.site.appendingPathComponent("api"), transport: HTTPTransport) {
        self.base = base
        self.transport = transport
    }

    /// The app's URLSession: the shared cookie storage keeps the session cookie.
    static func live() -> API {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        return API(transport: URLSessionTransport(session: URLSession(configuration: config)))
    }

    /// '/api/flights/x', 'api/flights/x' or 'flights/x' → the URL under base.
    func url(_ path: String) -> URL {
        var p = path
        while p.hasPrefix("/") { p.removeFirst() }
        if p.hasPrefix("api/") { p.removeFirst(4) }
        return URL(
            string: p, relativeTo: base.absoluteString.hasSuffix("/") ? base : URL(string: base.absoluteString + "/")!)!
            .absoluteURL
    }

    func request(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        try await send(method, url(path), body: body)
    }

    /// GET a file of the website outside /api ('terrain/greece.bin').
    func site(_ path: String) async throws -> Data {
        let root = base.deletingLastPathComponent()
        return try await send("GET", root.appendingPathComponent(path), body: nil)
    }

    private func send(_ method: String, _ url: URL, body: Data?) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(req)
        } catch let e as APIError {
            throw e
        } catch let e as URLError where e.code != .cancelled {
            throw APIError.offline
        }
        switch response.statusCode {
        case 200..<300: return data
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notFound
        case 409: throw APIError.conflict(data)
        default:
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? ""
            throw APIError.http(response.statusCode, message)
        }
    }

    func get(_ path: String) async throws -> Data { try await request("GET", path) }

    func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }

    // MARK: routes

    func session() async throws -> SessionResponse {
        try decode(SessionResponse.self, try await get("session"))
    }

    func logout() async throws {
        _ = try await request("POST", "logout", body: Data("{}".utf8))
    }

    /// GET /flights (the pilot's and the shared ones).
    func flights() async throws -> Data { try await get("flights") }

    func flight(_ id: String) async throws -> Data { try await get("flights/\(escape(id))") }

    /// PUT /flights/:id with { flight, version }; 409 → APIError.conflict(current flight).
    func updateFlight(_ id: String, doc: JSON, version: Int) async throws -> FlightUpdateResponse {
        let body = try JSON.object(["flight": doc, "version": .number(Double(version))]).data()
        return try decode(FlightUpdateResponse.self, try await request("PUT", "flights/\(escape(id))", body: body))
    }

    /// POST /flights/:id/copy: "Fly again" (title '' names it after the route).
    func copyFlight(_ id: String, date: String) async throws -> Data {
        let body = try JSON.object(["title": "", "date": .string(date)]).data()
        return try await request("POST", "flights/\(escape(id))/copy", body: body)
    }

    func markOpened(_ id: String) async { _ = try? await request("POST", "flights/\(escape(id))/opened") }

    func aircraft(_ id: String) async throws -> Data { try await get("aircraft/\(escape(id))") }
    func me() async throws -> Data { try await get("me") }
    func refBundle() async throws -> Data { try await get("ref/bundle") }

    func notams(_ id: String, maxAltFt: Int?) async throws -> Data {
        try await get("flights/\(escape(id))/notams" + (maxAltFt.map { "?maxAltFt=\($0)" } ?? ""))
    }
    func filing(_ id: String) async throws -> Data { try await get("flights/\(escape(id))/filing") }
    func forms(_ id: String) async throws -> Data { try await get("flights/\(escape(id))/forms") }
    func declarations(_ id: String) async throws -> Data { try await get("flights/\(escape(id))/declarations") }

    /// POST /flights (FlightCreateRequest: a partial flight; the server fills in the profile's
    /// defaults: taxi times, wind model, PIC on the manifest) → 201 the new Flight.
    func createFlight(_ doc: JSON) async throws -> Data {
        try await request("POST", "flights", body: try doc.data())
    }

    /// GET /aircraft: the pilot's own aircraft and those shared with them.
    func aircraftList() async throws -> Data { try await get("aircraft") }

    /// POST /aircraft (AircraftInput, as PGF.aircraftFromTemplate builds it) → 201 the aircraft.
    func createAircraft(_ input: Data) async throws -> Data {
        try await request("POST", "aircraft", body: input)
    }

    /// GET /waypoints: the pilot's saved points.
    func waypoints() async throws -> Data { try await get("waypoints") }

    /// PUT /me (PilotUpdate: only the fields sent change) → the pilot.
    func updateMe(_ patch: JSON) async throws -> Data {
        try await request("PUT", "me", body: try patch.data())
    }

    /// DELETE /me { confirm: the account's e-mail }: the account and everything it owns.
    func deleteAccount(confirm: String) async throws {
        _ = try await request("DELETE", "me", body: try JSON.object(["confirm": .string(confirm)]).data())
    }

    private func escape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/")))
            ?? s
    }
}
