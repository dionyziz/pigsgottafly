import Foundation

/// What the flight list changes on the fixture server: the trash, restore, copies, renamed titles,
/// leaving a shared flight, and POST /flights with no route starting at the home aerodrome.
struct LobbyFixtures {
    var trashed: Set<String> = []
    var left: Set<String> = []
}

extension FixtureTransport {
    func lobbyRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "flights", 1):
            return (200, nil, Self.encoded(.array(lobbyList(trash: r.query.contains("trash=1")))))
        case ("POST", "flights", 1):
            return createAtHome(r)
        case ("DELETE", "flights", 2):
            let id = r.parts[1]
            guard ownRow(id) != nil else { return (404, nil, nil) }
            lobby.trashed.insert(id)
            return (204, nil, Data())
        case ("POST", "flights", 3) where r.parts[2] == "restore":
            let id = r.parts[1]
            guard lobby.trashed.remove(id) != nil else { return (404, nil, nil) }
            return (200, nil, lobbyFlight(id).flatMap(Self.encoded))
        case ("POST", "flights", 3) where r.parts[2] == "copy":
            return copy(r.parts[1], body: r.body)
        case ("DELETE", "flights", 4) where r.parts[2] == "shares" && r.parts[3] == pilot["id"]?.string:
            let id = r.parts[1]
            guard baseRows().contains(where: { $0["id"]?.string == id && $0["sharedBy"] != nil }) else { return nil }
            lobby.left.insert(id)
            return (204, nil, Data())
        default:
            return nil
        }
    }

    private func baseRows() -> [JSON] {
        emptyAccount ? [] : (fixture("flights.json").flatMap { try? JSON.parse($0) }?.array ?? [])
    }

    /// Every row the pilot has, trashed or not: the ones made here, then flights.json's, each with
    /// what was saved since (a rename's title).
    private func allRows() -> [JSON] {
        let base = baseRows()
        let made = created.compactMap { id in flights[id].map { row($0, like: nil) } }
        let given = base.map { b in flights[b["id"]?.string ?? ""].map { row($0, like: b) } ?? b }
        return (made + given).filter { !lobby.left.contains($0["id"]?.string ?? "") }
    }

    private func lobbyList(trash: Bool) -> [JSON] {
        // JSON is nil-literal expressible: a bare nil here would be a JSON null, not a dropped row
        allRows().compactMap { r -> JSON? in
            let id = r["id"]?.string ?? ""
            if r["sharedBy"] != nil { return trash ? .none : r }
            guard lobby.trashed.contains(id) == trash else { return .none }
            var out = r
            out["deleted"] = .bool(trash)
            return out
        }
    }

    private func ownRow(_ id: String) -> JSON? {
        allRows().first { $0["id"]?.string == id && $0["sharedBy"] == nil }
    }

    /// GET /flights's row of a flight; a flights.json row keeps its passengers, filing and sharing.
    private func row(_ f: JSON, like base: JSON?) -> JSON {
        var r: JSON =
            base ?? [
                "passengers": [], "deleted": false, "filingStatus": nil,
            ]
        var summary = base?["summary"]?.object ?? [:]
        for (k, v) in f["summary"]?.object ?? [:] { summary[k] = v }
        r["id"] = f["id"] ?? ""
        r["summary"] = .object(summary)
        r["points"] = .array((f["route"]?.array ?? []).map { $0["name"] ?? "" })
        r["date"] = f["date"] ?? ""
        r["aircraftId"] = f["aircraftId"] ?? nil
        for k in ["version", "created", "updated"] { r[k] = f[k] ?? 0 }
        r["opened"] = f["updated"] ?? 0
        return r
    }

    /// The flight as GET /flights/:id answers it.
    private func lobbyFlight(_ id: String) -> JSON? {
        if let f = flights[id] { return f }
        guard let data = fixture("flight-\(id).json") ?? fixture("flight.json"), var j = try? JSON.parse(data) else {
            return nil
        }
        j["id"] = .string(id)
        if let v = versions[id] { j["version"] = .number(Double(v)) }
        return j
    }

    /// POST /flights/:id/copy as the server names it: "Fly again" (title '' and a date) keeps the
    /// route's name; otherwise the title given, else "Copy of …".
    private func copy(_ id: String, body: Data?) -> (Int, String?, Data?) {
        guard var f = lobbyFlight(id) else { return (404, nil, nil) }
        let req = body.flatMap { try? JSON.parse($0) } ?? [:]
        let title = req["title"]?.string
        let date = req["date"]?.string
        let again = title == "" && date != nil
        let current = f["title"]?.string ?? ""
        let given = (title ?? "").trimmingCharacters(in: .whitespaces)
        let name =
            again
            ? ""
            : !given.isEmpty
                ? given : "Copy of \(current.isEmpty ? f["summary"]?["title"]?.string ?? "flight" : current)"
        let newId = "fixture-copy-\(created.count + 1)"
        let now = Date().timeIntervalSince1970 * 1000
        f["id"] = .string(newId)
        f["version"] = 1
        for k in ["created", "updated", "opened"] { f[k] = .number(now) }
        f["title"] = .string(name)
        if let date { f["date"] = .string(date) }
        var summary = f["summary"]?.object ?? [:]
        if !again { summary["title"] = .string(name) }
        if let date { summary["date"] = .string(date) }
        f["summary"] = .object(summary)
        flights[newId] = f
        created.insert(newId, at: 0)
        return (201, nil, Self.encoded(f))
    }

    /// The server starts a flight with no route given at the home aerodrome, with no destination.
    private func createAtHome(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard var req = r.body.flatMap({ try? JSON.parse($0) }), req.object != nil, req["route"] == nil,
            let home = pilot["homeAerodrome"]?.string, !home.isEmpty,
            let ref = fixture("ref.json").flatMap({ try? JSON.parse($0) }),
            let ad = Places.aerodromes(ref: ref).first(where: { $0.code == home || $0.refId == home })
        else { return nil }
        req["route"] = [ad.routePoint()]
        return flightRoutes(FixtureRequest(method: r.method, parts: r.parts, query: r.query, body: try? req.data()))
    }
}
