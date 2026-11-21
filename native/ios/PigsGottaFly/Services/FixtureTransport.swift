import Foundation

/// Fixture mode (launch argument `-fixtures`): the API answers from the JSON files bundled in
/// Fixtures/, with no network and no sign-in. It keeps what is changed in memory like the server: a
/// PUT bumps the version and keeps the flight, POST /flights and POST /aircraft add one, PUT /me
/// changes the profile. `-emptyAccount` starts as a brand-new pilot: no profile, no aircraft, no
/// flights. A flight's own file is `flight-<id>.json`; any other id answers `flight.json`.
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    private let dir: URL
    private let lock = NSLock()
    private var versions: [String: Int] = [:]
    /// Flights created or saved here, by id.
    private var flights: [String: JSON] = [:]
    /// The ids of the flights created here, newest first.
    private var created: [String] = []
    private var aircraft: [JSON]
    private var pilot: JSON
    private let emptyAccount: Bool

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

    private static func encoded(_ j: JSON) -> Data? { try? j.data() }

    /// GET /weather/grid: weather-grid.json holds the answers for the fixture flights' paths (from the
    /// website's test double of Open-Meteo); another path answers like metar.json did (not decoded).
    private func grid(_ url: URL) -> Data? {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: true)?.percentEncodedQuery ?? ""
        guard let all = fixture("weather-grid.json").flatMap({ try? JSON.parse($0) }) else { return nil }
        return all["/api/weather/grid?" + query].flatMap(Self.encoded)
    }

    private func route(method: String, parts: [String], body: Data?) -> (Int, String?, Data?) {
        switch (method, parts.first, parts.count) {
        case ("GET", "session", _): return (200, "session.json", nil)
        case ("POST", "logout", _): return (200, nil, Data(#"{"ok":true}"#.utf8))
        case ("GET", "me", 1): return (200, nil, Self.encoded(pilot))
        case ("PUT", "me", 1): return updateMe(body)
        case ("DELETE", "me", 1): return deleteMe(body)
        case ("GET", "ref", _): return (200, "ref.json", nil)
        case ("GET", "weather", _): return (200, "metar.json", nil)
        case ("GET", "waypoints", 1):
            return (200, emptyAccount ? nil : "waypoints.json", emptyAccount ? Data("[]".utf8) : nil)
        case ("GET", "aircraft", 1): return (200, nil, Self.encoded(.array(aircraft)))
        case ("POST", "aircraft", 1): return createAircraft(body)
        case ("GET", "aircraft", 2):
            if let a = aircraft.first(where: { $0["id"]?.string == parts[1] }) { return (200, nil, Self.encoded(a)) }
            return (200, "aircraft.json", nil)
        case ("GET", "flights", 1): return (200, nil, flightList())
        case ("POST", "flights", 1): return createFlight(body)
        case ("GET", "flights", 2): return (200, nil, flight(id: parts[1]).flatMap(Self.encoded))
        case ("GET", "flights", 3):
            switch parts[2] {
            case "notams": return (200, "notams.json", nil)
            case "filing": return (200, "filing.json", nil)
            case "forms": return (200, "forms.json", nil)
            case "declarations": return (200, "declarations.json", nil)
            default: return (404, nil, nil)
            }
        case ("POST", "flights", 3) where parts[2] == "opened": return (204, nil, Data())
        case ("POST", "flights", 3) where parts[2] == "copy":
            return (201, nil, flight(id: "fixture-copy").flatMap(Self.encoded))
        case ("PUT", "flights", 2): return put(id: parts[1], body: body)
        default: return (404, nil, nil)
        }
    }

    // MARK: flights

    /// The flight under the id asked for, at its current version.
    private func flight(id: String) -> JSON? {
        if let f = flights[id] { return f }
        guard let data = fixture("flight-\(id).json") ?? fixture("flight.json"), var j = try? JSON.parse(data) else {
            return nil
        }
        j["id"] = .string(id)
        if let v = versions[id] { j["version"] = .number(Double(v)) }
        return j
    }

    private func flightList() -> Data? {
        let base = emptyAccount ? [] : (fixture("flights.json").flatMap { try? JSON.parse($0) }?.array ?? [])
        let mine = created.compactMap { id in flights[id].map(listItem) }
        return Self.encoded(.array(mine + base))
    }

    /// GET /flights's row of a flight (FlightListItem).
    private func listItem(_ f: JSON) -> JSON {
        [
            "id": f["id"] ?? "", "summary": f["summary"] ?? [:],
            "points": .array((f["route"]?.array ?? []).map { $0["name"] ?? "" }),
            "passengers": [], "date": f["date"] ?? "", "aircraftId": f["aircraftId"] ?? nil,
            "version": f["version"] ?? 1, "created": f["created"] ?? 0, "updated": f["updated"] ?? 0,
            "opened": f["updated"] ?? 0, "deleted": false, "filingStatus": nil,
        ]
    }

    /// POST /flights: a new flight from the request, the rest as the server fills it in.
    private func createFlight(_ body: Data?) -> (Int, String?, Data?) {
        guard let body, let req = try? JSON.parse(body), req.object != nil else { return bad("Bad request") }
        guard var f = fixture("flight.json").flatMap({ try? JSON.parse($0) }) else { return (404, nil, nil) }
        let id = "fixture-new-\(created.count + 1)"
        let now = Date().timeIntervalSince1970 * 1000
        let route = req["route"] ?? []
        f["id"] = .string(id)
        f["version"] = 1
        for k in ["created", "updated", "opened"] { f[k] = .number(now) }
        f["title"] = ""
        f["date"] = req["date"] ?? .string(Fmt.isoDay(from: Date()))
        f["blockOff"] = req["blockOff"] ?? ""
        f["aircraftId"] = req["aircraftId"] ?? pilot["defaultAircraftId"] ?? .null
        f["route"] = route
        f["legOverrides"] = [:]
        f["atc"] = .null
        f["baggageKg"] = [:]
        f["options"]?["alternates"] = []
        let points = route.array ?? []
        let registration = aircraft.first { $0["id"] == f["aircraftId"] }?["registration"] ?? ""
        f["summary"] = [
            "title": f["date"] ?? "", "date": f["date"] ?? "", "blockOff": f["blockOff"] ?? "",
            "aircraft": registration,
            "route": .array(points.map { [$0["lat"] ?? 0, $0["lon"] ?? 0] }),
            "from": points.first?["name"] ?? "", "to": points.count > 1 ? points.last?["name"] ?? "" : "",
            "distNm": nil, "eteMin": nil, "fuelL": nil,
        ]
        flights[id] = f
        created.insert(id, at: 0)
        return (201, nil, Self.encoded(f))
    }

    private func put(id: String, body: Data?) -> (Int, String?, Data?) {
        guard let body, let req = try? JSON.parse(body), let sent = req["version"]?.int, let doc = req["flight"]?.object
        else {
            return bad("Bad request")
        }
        let current = flight(id: id)?["version"]?.int ?? 7
        guard sent == current, var f = flight(id: id) else { return (409, nil, flight(id: id).flatMap(Self.encoded)) }
        for (k, v) in doc { f[k] = v }
        let now = Date().timeIntervalSince1970 * 1000
        f["version"] = .number(Double(current + 1))
        f["updated"] = .number(now)
        versions[id] = current + 1
        flights[id] = f
        return (200, nil, Data(#"{"version":\#(current + 1),"updated":\#(Int(now))}"#.utf8))
    }

    // MARK: aircraft, profile, account

    private func createAircraft(_ body: Data?) -> (Int, String?, Data?) {
        guard let body, var a = try? JSON.parse(body), let reg = a["registration"]?.string, !reg.isEmpty else {
            return bad("registration is required")
        }
        let id = "fixture-ac-\(aircraft.count + 1)"
        a["id"] = .string(id)
        a["access"] = ["role": "owner"]
        aircraft.append(a)
        if pilot["defaultAircraftId"]?.string == nil { pilot["defaultAircraftId"] = .string(id) }
        return (201, nil, Self.encoded(a))
    }

    private func updateMe(_ body: Data?) -> (Int, String?, Data?) {
        guard let body, let patch = try? JSON.parse(body), let o = patch.object else { return bad("Bad request") }
        for (k, v) in o where k != "settings" { pilot[k] = v }
        if let s = o["settings"]?.object {
            var current = pilot["settings"]?.object ?? [:]
            for (k, v) in s { current[k] = v }
            pilot["settings"] = .object(current)
        }
        return (200, nil, Self.encoded(pilot))
    }

    private func deleteMe(_ body: Data?) -> (Int, String?, Data?) {
        let confirm = body.flatMap { try? JSON.parse($0) }?["confirm"]?.string ?? ""
        guard confirm.lowercased() == (pilot["email"]?.string ?? "").lowercased() else {
            return bad("Type your account's e-mail address to confirm")
        }
        return (200, nil, Data(#"{"ok":true}"#.utf8))
    }

    private func bad(_ message: String) -> (Int, String?, Data?) {
        (400, nil, try? JSON.object(["error": .string(message)]).data())
    }
}
