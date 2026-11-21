import Foundation

/// Fixture mode (launch argument `-fixtures`): the API answers from the JSON files bundled in
/// Fixtures/, with no network and no sign-in. A PUT bumps the version like the server does.
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    private let dir: URL
    private let lock = NSLock()
    private var versions: [String: Int] = [:]

    init(directory: URL) {
        dir = directory
    }

    /// The Fixtures folder of a bundle (the app's).
    static func bundled(_ bundle: Bundle = .main) -> FixtureTransport? {
        guard let url = bundle.url(forResource: "Fixtures", withExtension: nil) else { return nil }
        return FixtureTransport(directory: url)
    }

    func fixture(_ name: String) -> Data? {
        try? Data(contentsOf: dir.appendingPathComponent(name))
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        var path = url.path
        if let r = path.range(of: "/api/") { path = String(path[r.upperBound...]) }
        let parts = path.split(separator: "/").map(String.init)
        let method = request.httpMethod ?? "GET"
        let (status, name, body) = route(method: method, parts: parts, body: request.httpBody)
        let data = body ?? name.flatMap(fixture) ?? Data(#"{"error":"Not found"}"#.utf8)
        let response = HTTPURLResponse(
            url: url, statusCode: body == nil && name.flatMap(fixture) == nil ? 404 : status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"])!
        return (data, response)
    }

    private func route(method: String, parts: [String], body: Data?) -> (Int, String?, Data?) {
        switch (method, parts.first, parts.count) {
        case ("GET", "session", _): return (200, "session.json", nil)
        case ("POST", "logout", _): return (200, nil, Data(#"{"ok":true}"#.utf8))
        case ("GET", "me", _): return (200, "pilot.json", nil)
        case ("GET", "ref", _): return (200, "ref.json", nil)
        case ("GET", "weather", _): return (200, "metar.json", nil)
        case ("GET", "aircraft", 2): return (200, "aircraft.json", nil)
        case ("GET", "flights", 1): return (200, "flights.json", nil)
        case ("GET", "flights", 2): return (200, nil, flight(id: parts[1]))
        case ("GET", "flights", 3):
            switch parts[2] {
            case "notams": return (200, "notams.json", nil)
            case "filing": return (200, "filing.json", nil)
            case "forms": return (200, "forms.json", nil)
            case "declarations": return (200, "declarations.json", nil)
            default: return (404, nil, nil)
            }
        case ("POST", "flights", 3) where parts[2] == "opened": return (204, nil, Data())
        case ("POST", "flights", 3) where parts[2] == "copy": return (201, nil, flight(id: "fixture-copy"))
        case ("PUT", "flights", 2): return put(id: parts[1], body: body)
        default: return (404, nil, nil)
        }
    }

    /// The fixture flight under the id asked for, at its current version.
    private func flight(id: String) -> Data? {
        guard let data = fixture("flight.json"), var j = try? JSON.parse(data) else { return nil }
        j["id"] = .string(id)
        lock.lock()
        let v = versions[id]
        lock.unlock()
        if let v { j["version"] = .number(Double(v)) }
        return try? j.data()
    }

    private func put(id: String, body: Data?) -> (Int, String?, Data?) {
        guard let body, let req = try? JSON.parse(body), let sent = req["version"]?.int else {
            return (400, nil, Data(#"{"error":"Bad request"}"#.utf8))
        }
        lock.lock()
        let current = versions[id] ?? 7
        let ok = sent == current
        if ok { versions[id] = current + 1 }
        lock.unlock()
        if !ok { return (409, nil, flight(id: id)) }
        let now = Date().timeIntervalSince1970 * 1000
        return (200, nil, Data(#"{"version":\#(current + 1),"updated":\#(Int(now))}"#.utf8))
    }
}
