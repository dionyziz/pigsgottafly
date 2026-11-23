import Foundation

/// A flight's and an operator's sharing, kept in memory as the server keeps them
/// (api/_lib/routes/{flightShares,operators}.ts). A flight's address with no account becomes a
/// pending invite; an operator can only be shared with an account. The fixture flight's sharing
/// starts from Fixtures/manifest/shares.json; any other flight starts with its owner. Leaving a
/// flight shared with the pilot is the lobby's (FixtureRoutes+Lobby.swift). No e-mail is ever sent.
extension FixtureTransport {
    func recordShareRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        let p = r.parts
        guard p.count >= 3, p[2] == "shares", let kind = Kind(rawValue: p[0]) else { return nil }
        switch (r.method, p.count) {
        case ("GET", 3): return (200, nil, Self.encoded(shares(kind, p[1])))
        case ("POST", 3): return add(kind, p[1], r.body)
        case ("PUT", 4): return setRole(kind, p[1], key: p[3], r.body)
        case ("DELETE", 4): return remove(kind, p[1], key: p[3])
        default: return nil
        }
    }

    private enum Kind: String {
        case flights, operators
    }

    private func shares(_ kind: Kind, _ id: String) -> JSON {
        if let s = kind == .flights ? flightShares[id] : operatorShares[id] { return s }
        var owner = me
        owner["role"] = "owner"
        owner["added"] = .null
        if kind == .operators {
            // an operator of operators.json shared with the pilot: its owner, then the pilot
            let op = operators.first { $0["id"]?.string == id }
            let role = op?["access"]?["role"]?.string ?? "owner"
            if role != "owner", let by = op?["access"]?["owner"] { owner = by }
            owner["role"] = "owner"
            owner["added"] = .null
            owner["via"] = []
            owner["direct"] = true
            var people = [owner]
            if role != "owner" {
                var mine = me
                mine["role"] = .string(role)
                mine["added"] = .null
                mine["via"] = []
                mine["direct"] = true
                people.append(mine)
            }
            return [
                "operatorId": .string(id), "name": op?["name"] ?? "", "role": .string(role),
                "canManage": .bool(role != "view"), "people": .array(people),
            ]
        }
        if let seeded = fixture("manifest/shares.json").flatMap({ try? JSON.parse($0) }),
            seeded["flightId"]?.string == id
        {
            return seeded
        }
        // a flight shared with the pilot (flights.json's sharedBy): its owner, then the pilot
        let rows = fixture("flights.json").flatMap { try? JSON.parse($0) }?.array ?? []
        if let row = rows.first(where: { $0["id"]?.string == id }), var by = row["sharedBy"] {
            let role = row["role"]?.string ?? "view"
            by["role"] = "owner"
            var mine = me
            mine["role"] = .string(role)
            return [
                "flightId": .string(id), "title": row["summary"]?["title"] ?? "", "role": .string(role),
                "canManage": .bool(role == "edit"), "people": [by, mine],
            ]
        }
        let title = flights[id]?["title"] ?? ""
        return ["flightId": .string(id), "title": title, "role": "owner", "canManage": true, "people": [owner]]
    }

    private func save(_ kind: Kind, _ id: String, _ s: JSON) {
        if kind == .flights { flightShares[id] = s } else { operatorShares[id] = s }
    }

    private func add(_ kind: Kind, _ id: String, _ body: Data?) -> (Int, String?, Data?) {
        var s = shares(kind, id)
        guard s["canManage"]?.bool == true else { return refuse(403, "Only the owner or an editor can share") }
        let req = body.flatMap { try? JSON.parse($0) } ?? [:]
        let email = (req["email"]?.string ?? "").trimmingCharacters(in: .whitespaces)
        let lower = email.lowercased()
        guard lower.contains("@") else { return bad("Enter a valid e-mail address") }
        if lower == pilot["email"]?.string?.lowercased() { return bad("That is your own address") }
        var people = s["people"]?.array ?? []
        if people.contains(where: { $0["email"]?.string?.lowercased() == lower }) {
            return refuse(409, "\(email) already has access")
        }
        let role = req["role"] ?? "view"
        if let account = Self.fixtureAccounts[lower] {
            var person: JSON = [
                "pilotId": .string(account.id), "name": .string(account.name), "email": .string(lower), "role": role,
                "added": .number(Date().timeIntervalSince1970 * 1000),
            ]
            if kind == .operators {
                person["via"] = []
                person["direct"] = true
            }
            people.append(person)
        } else if kind == .operators {
            return refuse(
                404,
                "No Pig’s Gotta Fly account uses \(email). They need to sign in once before you can share with them.")
        } else {
            people.append([
                "pilotId": .string(lower), "name": "", "email": .string(lower), "role": role, "added": .null,
                "pending": true,
            ])
        }
        s["people"] = .array(people)
        save(kind, id, s)
        return (201, nil, Self.encoded(s))
    }

    private func setRole(_ kind: Kind, _ id: String, key: String, _ body: Data?) -> (Int, String?, Data?) {
        var s = shares(kind, id)
        guard s["canManage"]?.bool == true else { return refuse(403, "Only the owner or an editor can share") }
        let role = body.flatMap { try? JSON.parse($0) }?["role"] ?? "view"
        var people = s["people"]?.array ?? []
        guard let i = people.firstIndex(where: { $0["pilotId"]?.string == key && $0["role"]?.string != "owner" })
        else { return (404, nil, nil) }
        people[i]["role"] = role
        s["people"] = .array(people)
        save(kind, id, s)
        return (200, nil, Self.encoded(s))
    }

    private func remove(_ kind: Kind, _ id: String, key: String) -> (Int, String?, Data?) {
        var s = shares(kind, id)
        let mine = key == pilot["id"]?.string
        guard mine || s["canManage"]?.bool == true else { return refuse(403, "Only the owner or an editor can share") }
        s["people"] = .array((s["people"]?.array ?? []).filter { $0["pilotId"]?.string != key })
        save(kind, id, s)
        return (204, nil, Data())
    }
}
