import Foundation

/// Flights kept in memory like the server: a PUT bumps the version (409 on a stale one), POST /flights
/// adds one. A flight's own file is flight-<id>.json; any other id answers flight.json.
extension FixtureTransport {
    func flightRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("POST", "flights", 1): return createFlight(r.body)
        case ("GET", "flights", 2): return (200, nil, flight(id: r.parts[1]).flatMap(Self.encoded))
        case ("PUT", "flights", 2): return put(id: r.parts[1], body: r.body)
        case ("POST", "flights", 3) where r.parts[2] == "opened": return (204, nil, Data())
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
        // a flight flights.json lists as shared with the pilot comes with their access, as the server's
        let rows = fixture("flights.json").flatMap { try? JSON.parse($0) }?.array ?? []
        if let row = rows.first(where: { $0["id"]?.string == id }), let by = row["sharedBy"] {
            j["access"] = ["role": row["role"] ?? "view", "owner": by, "aircraft": nil]
        }
        return j
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
        // options given at creation (a local flight's duration) go on top of the profile's
        for (k, v) in req["options"]?.object ?? [:] { f["options"]?[k] = v }
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
