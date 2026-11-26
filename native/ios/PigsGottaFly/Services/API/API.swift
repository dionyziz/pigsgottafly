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
    /// 402: planning, briefing and filing need the subscription (the trial or subscription ended).
    case subscriptionRequired

    var errorDescription: String? {
        switch self {
        case .unauthorized: "You are signed out."
        case .notFound: "Not found."
        case .conflict: "The flight was changed on another device."
        case .http(let code, let message): message.isEmpty ? "The server answered \(code)." : message
        case .offline: "No connection."
        case .subscriptionRequired: "Your free trial or subscription has ended. Subscribe in Me → Subscription."
        }
    }
}

extension Notification.Name {
    /// The API answered 402: the root view offers the subscription.
    static let subscriptionRequired = Notification.Name("pgf.subscriptionRequired")
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
        case 402:
            await MainActor.run { NotificationCenter.default.post(name: .subscriptionRequired, object: nil) }
            throw APIError.subscriptionRequired
        // a POST's 404 can name what is missing ("No Pig’s Gotta Fly account uses …" when sharing an
        // operator): the pilot reads the server's words
        case 404 where method == "POST":
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? ""
            throw message.isEmpty ? APIError.notFound : APIError.http(404, message)
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

    /// One call with an Encodable body, decoded as `T`: the domain files (API+<Domain>.swift) build on
    /// it, so a screen can pass its own Codable model or take the JSON as it came.
    func call<T: Decodable>(
        _ method: String, _ path: String, body: (any Encodable)? = nil, as type: T.Type = JSON.self
    ) async throws -> T {
        try decode(type, try await send(method, path, body: body))
    }

    /// The API refuses any non-GET without a JSON body (CSRF defence, api/_lib/app.ts): "{}" when there
    /// is nothing to send.
    func send(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> Data {
        let data: Data?
        if let json = body as? JSON {
            data = try json.data()
        } else if let body {
            data = try JSONEncoder().encode(body)
        } else {
            data = method == "GET" ? nil : Data("{}".utf8)
        }
        return try await request(method, path, body: data)
    }

    /// A 204 has no body: decoding it as JSON would fail.
    func sendIgnoringBody(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws {
        _ = try await send(method, path, body: body)
    }

    /// A path segment: an id with "/" or spaces stays one segment.
    func seg(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/")))
            ?? s
    }
}
