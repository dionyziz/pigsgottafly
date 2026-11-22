import Foundation

/// Session, profile and account: PUT /me changes the profile like the server; DELETE /me checks the
/// typed e-mail.
extension FixtureTransport {
    func accountRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "session", 1): (200, "session.json", nil)
        case ("POST", "logout", _): (200, nil, Data(#"{"ok":true}"#.utf8))
        case ("POST", "session", 2) where r.parts[1] == "revoke-all": (200, nil, Data(#"{"ok":true}"#.utf8))
        case ("GET", "me", 1): (200, nil, Self.encoded(pilot))
        case ("GET", "me", 2) where r.parts[1] == "export": (200, nil, Self.encoded(["pilot": pilot]))
        case ("PUT", "me", 1): updateMe(r.body)
        case ("DELETE", "me", 1): deleteMe(r.body)
        default: nil
        }
    }

    fileprivate func updateMe(_ body: Data?) -> (Int, String?, Data?) {
        guard let body, let patch = try? JSON.parse(body), let o = patch.object else { return bad("Bad request") }
        for (k, v) in o where k != "settings" { pilot[k] = v }
        if let s = o["settings"]?.object {
            var current = pilot["settings"]?.object ?? [:]
            for (k, v) in s { current[k] = v }
            pilot["settings"] = .object(current)
        }
        return (200, nil, Self.encoded(pilot))
    }

    fileprivate func deleteMe(_ body: Data?) -> (Int, String?, Data?) {
        let confirm = body.flatMap { try? JSON.parse($0) }?["confirm"]?.string ?? ""
        guard confirm.lowercased() == (pilot["email"]?.string ?? "").lowercased() else {
            return bad("Type your account's e-mail address to confirm")
        }
        return (200, nil, Data(#"{"ok":true}"#.utf8))
    }

}
