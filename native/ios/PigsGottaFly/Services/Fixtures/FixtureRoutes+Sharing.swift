import Foundation

/// Aircraft sharing and invitations to the app, kept in memory as the server keeps them
/// (api/_lib/routes/{shares,invitations}.ts): an address of a fixture account gets the aircraft at
/// once, any other one an invitation, which lists it as pending. No e-mail is ever sent.
extension FixtureTransport {
    /// The accounts the fixture server knows besides the pilot: address → (pilot id, name).
    static let fixtureAccounts: [String: (id: String, name: String)] = [
        "copilot@example.com": ("fixture-copilot", "Chris Copilot")
    ]

    func sharingRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        let p = r.parts
        switch (r.method, r.first, r.count) {
        case ("GET", "aircraft", 3) where p[2] == "shares": return sharingOf(p[1])
        case ("POST", "aircraft", 3) where p[2] == "shares": return shareAircraft(p[1], r.body)
        case ("PUT", "aircraft", 4) where p[2] == "shares": return setShareRole(p[1], key: p[3], r.body)
        case ("DELETE", "aircraft", 4) where p[2] == "shares": return removeShare(p[1], key: p[3])
        case ("GET", "invitations", 1): return (200, nil, Self.encoded(.array(invitations)))
        case ("POST", "invitations", 1): return invite(r.body)
        case ("DELETE", "invitations", 2):
            invitations.removeAll { $0["id"]?.string == p[1] }
            return (204, nil, Data())
        case ("DELETE", "invitations", 4) where p[2] == "aircraft":
            if let i = invitations.firstIndex(where: { $0["id"]?.string == p[1] }) {
                invitations[i]["aircraft"] = .array(
                    (invitations[i]["aircraft"]?.array ?? []).filter { $0["aircraftId"]?.string != p[3] })
            }
            return (204, nil, Data())
        default: return nil
        }
    }

    var me: JSON {
        ["pilotId": pilot["id"] ?? "", "name": pilot["fullName"] ?? "", "email": pilot["email"] ?? ""]
    }

    private func aircraftNamed(_ id: String) -> JSON? { aircraft.first { $0["id"]?.string == id } }

    func refuse(_ status: Int, _ message: String) -> (Int, String?, Data?) {
        (status, nil, try? JSON.object(["error": .string(message)]).data())
    }

    /// AircraftSharing: the owner, the accounts, then the invitations that hold the aircraft.
    private func sharing(_ a: JSON) -> JSON {
        let id = a["id"]?.string ?? ""
        let role = a["access"]?["role"]?.string ?? "owner"
        var owner = Self.owned(a) ? me : (a["access"]?["owner"] ?? me)
        owner["role"] = "owner"
        let pending: [JSON] = invitations.compactMap { inv in
            guard let ac = inv["aircraft"]?.array?.first(where: { $0["aircraftId"]?.string == id }) else { return nil }
            return [
                "pilotId": inv["email"] ?? "", "name": "", "email": inv["email"] ?? "", "role": ac["role"] ?? "view",
                "pending": true,
            ]
        }
        // an aircraft shared with the pilot lists them too, with their role
        var shared = aircraftShares[id] ?? []
        if !Self.owned(a) {
            var viewer = me
            viewer["role"] = .string(role)
            shared.insert(viewer, at: 0)
        }
        return [
            "aircraftId": .string(id), "registration": a["registration"] ?? "", "role": .string(role),
            "canManage": .bool(role != "view"), "people": .array([owner] + shared + pending),
        ]
    }

    private func sharingOf(_ id: String) -> (Int, String?, Data?) {
        guard let a = aircraftNamed(id) else { return (404, nil, nil) }
        return (200, nil, Self.encoded(sharing(a)))
    }

    private func shareAircraft(_ id: String, _ body: Data?) -> (Int, String?, Data?) {
        guard let a = aircraftNamed(id) else { return (404, nil, nil) }
        guard sharing(a)["canManage"]?.bool == true else { return refuse(403, "Only the owner or an editor can share") }
        let req = body.flatMap { try? JSON.parse($0) } ?? [:]
        let email = (req["email"]?.string ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        let role = req["role"]?.string ?? "view"
        guard email.contains("@") else { return bad("Enter a valid e-mail address") }
        if email == pilot["email"]?.string?.lowercased() { return bad("That is your own address") }
        let people = sharing(a)["people"]?.array ?? []
        if people.contains(where: { $0["email"]?.string?.lowercased() == email }) {
            return refuse(409, "\(email) already has access")
        }
        if let account = Self.fixtureAccounts[email] {
            aircraftShares[id, default: []].append(
                [
                    "pilotId": .string(account.id), "name": .string(account.name), "email": .string(email),
                    "role": .string(role),
                ])
        } else {
            addToInvitation(
                email: email, message: "",
                aircraft: [
                    [
                        "aircraftId": .string(id),
                        "registration": a["registration"] ?? "", "role": .string(role),
                    ]
                ])
        }
        return (201, nil, Self.encoded(sharing(a)))
    }

    private func setShareRole(_ id: String, key: String, _ body: Data?) -> (Int, String?, Data?) {
        guard let a = aircraftNamed(id) else { return (404, nil, nil) }
        let role = body.flatMap { try? JSON.parse($0) }?["role"] ?? "view"
        if let i = aircraftShares[id]?.firstIndex(where: { $0["pilotId"]?.string == key }) {
            aircraftShares[id]?[i]["role"] = role
        } else if let i = invitations.firstIndex(where: { $0["email"]?.string == key }) {
            invitations[i]["aircraft"] = .array(
                (invitations[i]["aircraft"]?.array ?? []).map { ac in
                    var ac = ac
                    if ac["aircraftId"]?.string == id { ac["role"] = role }
                    return ac
                })
        } else {
            return (404, nil, nil)
        }
        return (200, nil, Self.encoded(sharing(a)))
    }

    /// The pilot's own key leaves the aircraft; an invited address loses this aircraft only (the
    /// invitation to the app stays).
    private func removeShare(_ id: String, key: String) -> (Int, String?, Data?) {
        if key == pilot["id"]?.string { return removeAircraft(id, owner: false) }
        aircraftShares[id]?.removeAll { $0["pilotId"]?.string == key }
        for i in invitations.indices where invitations[i]["email"]?.string == key {
            invitations[i]["aircraft"] = .array(
                (invitations[i]["aircraft"]?.array ?? []).filter { $0["aircraftId"]?.string != id })
        }
        return (204, nil, Data())
    }

    /// POST /invitations: an account gets the aircraft at once; another address an invitation, or the
    /// aircraft added to the one it has (409 when nothing is new).
    private func invite(_ body: Data?) -> (Int, String?, Data?) {
        let req = body.flatMap { try? JSON.parse($0) } ?? [:]
        let email = (req["email"]?.string ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        guard email.contains("@") else { return bad("Enter a valid e-mail address") }
        if email == pilot["email"]?.string?.lowercased() { return bad("That is your own address") }
        var picked: [JSON] = []
        for ac in req["aircraft"]?.array ?? [] {
            guard let id = ac["aircraftId"]?.string, let a = aircraftNamed(id) else { return (404, nil, nil) }
            if sharing(a)["canManage"]?.bool != true { return refuse(403, "You cannot share \(id)") }
            picked.append([
                "aircraftId": .string(id), "registration": a["registration"] ?? "", "role": ac["role"] ?? "view",
            ])
        }
        if let account = Self.fixtureAccounts[email] {
            let new = picked.filter { ac in
                !(aircraftShares[ac["aircraftId"]?.string ?? ""] ?? []).contains { $0["email"]?.string == email }
            }
            if new.isEmpty { return refuse(409, "\(email) already has these aircraft") }
            for ac in new {
                aircraftShares[ac["aircraftId"]?.string ?? "", default: []].append(
                    [
                        "pilotId": .string(account.id), "name": .string(account.name), "email": .string(email),
                        "role": ac["role"] ?? "view",
                    ])
            }
            let answer: JSON = [
                "existing": true, "shared": .array(new.map { $0["registration"] ?? "" }),
                "invitations": .array(invitations),
            ]
            return (201, nil, Self.encoded(answer))
        }
        if !addToInvitation(email: email, message: req["message"]?.string ?? "", aircraft: picked) {
            return refuse(409, "\(email) is already invited")
        }
        return (201, nil, Self.encoded(["existing": false, "shared": [], "invitations": .array(invitations)]))
    }

    /// Whether anything was new.
    @discardableResult
    private func addToInvitation(email: String, message: String, aircraft new: [JSON]) -> Bool {
        if let i = invitations.firstIndex(where: { $0["email"]?.string == email }) {
            let held = invitations[i]["aircraft"]?.array ?? []
            let added = new.filter { ac in !held.contains { $0["aircraftId"] == ac["aircraftId"] } }
            invitations[i]["aircraft"] = .array(held + added)
            return !added.isEmpty
        }
        let inv: JSON = [
            "id": .string("fixture-inv-\(UUID().uuidString.prefix(8).lowercased())"), "email": .string(email),
            "message": .string(message),
            "created": .number(Date().timeIntervalSince1970 * 1000), "aircraft": .array(new),
        ]
        invitations.insert(inv, at: 0)
        return true
    }
}
