import Foundation

/// Flights kept in memory like the server: a PUT bumps the version (409 on a stale one), POST /flights
/// adds one. A flight's own file is flight-<id>.json; any other id answers flight.json.
extension FixtureTransport {
    func flightRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "flights", 1): return (200, nil, flightList())
        case ("POST", "flights", 1): return createFlight(r.body)
        case ("GET", "flights", 2): return (200, nil, flight(id: r.parts[1]).flatMap(Self.encoded))
        case ("PUT", "flights", 2): return put(id: r.parts[1], body: r.body)
        case ("POST", "flights", 3) where r.parts[2] == "opened": return (204, nil, Data())
        case ("POST", "flights", 3) where r.parts[2] == "copy":
            return (201, nil, flight(id: "fixture-copy").flatMap(Self.encoded))
        default: return nil
        }
    }

    /// The flight under the id asked for, at its current version.
    fileprivate func flight(id: String) -> JSON? {
        if let f = flights[id] { return f }
        guard let data = fixture("flight-\(id).json") ?? fixture("flight.json"), var j = try? JSON.parse(data) else {
            return nil
        }
        j["id"] = .string(id)
        if let v = versions[id] { j["version"] = .number(Double(v)) }
        return j
    }

    fileprivate func flightList() -> Data? {
        let base = emptyAccount ? [] : (fixture("flights.json").flatMap { try? JSON.parse($0) }?.array ?? [])
        let mine = created.compactMap { id in flights[id].map(listItem) }
        return Self.encoded(.array(mine + base))
    }

    /// GET /flights's row of a flight (FlightListItem).
    fileprivate func listItem(_ f: JSON) -> JSON {
        [
            "id": f["id"] ?? "", "summary": f["summary"] ?? [:],
            "points": .array((f["route"]?.array ?? []).map { $0["name"] ?? "" }),
            "passengers": [], "date": f["date"] ?? "", "aircraftId": f["aircraftId"] ?? nil,
            "version": f["version"] ?? 1, "created": f["created"] ?? 0, "updated": f["updated"] ?? 0,
            "opened": f["updated"] ?? 0, "deleted": false, "filingStatus": nil,
        ]
    }

    /// POST /flights: a new flight from the request, the rest as the server fills it in.
    fileprivate func createFlight(_ body: Data?) -> (Int, String?, Data?) {
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

    fileprivate func put(id: String, body: Data?) -> (Int, String?, Data?) {
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

}
