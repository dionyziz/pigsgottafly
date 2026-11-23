import Foundation

/// Fixture mode (launch argument `-fixtures`): the API answers from the JSON files bundled in
/// Fixtures/, with no network and no sign-in. It keeps what is changed in memory like the server: a
/// PUT bumps the version and keeps the flight, POST /flights and POST /aircraft add one, PUT /me
/// changes the profile. `-emptyAccount` starts as a brand-new pilot: no profile, no aircraft, no
/// flights. A flight's own file is `flight-<id>.json`; any other id answers `flight.json`.
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    let dir: URL
    private let lock = NSLock()
    var versions: [String: Int] = [:]
    /// Flights created or saved here, by id.
    var flights: [String: JSON] = [:]
    /// The ids of the flights created here, newest first.
    var created: [String] = []
    var aircraft: [JSON]
    var pilot: JSON
    let emptyAccount: Bool

    init(directory: URL, emptyAccount: Bool = false) {
        dir = directory
        self.emptyAccount = emptyAccount
        let read = { (name: String) in (try? Data(contentsOf: directory.appendingPathComponent(name))) }
        let ac = read("aircraft.json").flatMap { try? JSON.parse($0) }
        aircraft = emptyAccount ? [] : [ac].compactMap { $0 }
        var p = read("pilot.json").flatMap { try? JSON.parse($0) } ?? [:]
        if emptyAccount {
            for k in ["fullName", "phone"] { p[k] = "" }
            for k in ["homeAerodrome", "defaultAircraftId"] { p[k] = .null }
            p["settings"] = ["taxiOutMin": nil, "taxiInMin": nil, "reserveMin": nil, "windModel": "best_match"]
        }
        pilot = p
    }

    /// The Fixtures folder of a bundle (the app's).
    static func bundled(_ bundle: Bundle = .main, emptyAccount: Bool = false) -> FixtureTransport? {
        guard let url = bundle.url(forResource: "Fixtures", withExtension: nil) else { return nil }
        return FixtureTransport(directory: url, emptyAccount: emptyAccount)
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
        if method == "GET", parts == ["weather", "grid"], let answer = grid(url) {
            let ok = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (answer, ok)
        }
        let (status, name, body) = lock.withLock { route(method: method, parts: parts, body: request.httpBody) }
        let data = body ?? name.flatMap(fixture) ?? Data(#"{"error":"Not found"}"#.utf8)
        let response = HTTPURLResponse(
            url: url, statusCode: body == nil && name.flatMap(fixture) == nil ? 404 : status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"])!
        return (data, response)
    }

    static func encoded(_ j: JSON) -> Data? { try? j.data() }

    /// GET /weather/grid: weather-grid.json holds the answers for the fixture flights' paths (from the
    /// website's test double of Open-Meteo); another path is not found (the core computes without it).
    private func grid(_ url: URL) -> Data? {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: true)?.percentEncodedQuery ?? ""
        guard let all = fixture("weather-grid.json").flatMap({ try? JSON.parse($0) }) else { return nil }
        return all["/api/weather/grid?" + query].flatMap(Self.encoded)
    }

    /// Each domain answers its own paths (FixtureRoutes+<Domain>.swift); nil there means "not mine".
    private func route(method: String, parts: [String], body: Data?) -> (Int, String?, Data?) {
        let r = FixtureRequest(method: method, parts: parts, body: body)
        for domain in [
            accountRoutes, flightRoutes, briefingRoutes, aircraftRoutes, peopleRoutes, fileRoutes, formRoutes,
            exportRoutes,
        ] {
            if let answer = domain(r) { return answer }
        }
        return (404, nil, nil)
    }

    func bad(_ message: String) -> (Int, String?, Data?) {
        (400, nil, try? JSON.object(["error": .string(message)]).data())
    }
}

/// One request as the fixture routes see it: the path under /api/ split into its segments.
struct FixtureRequest {
    var method: String
    var parts: [String]
    var body: Data?

    var first: String? { parts.first }
    var count: Int { parts.count }
}
