import Foundation

/// The hangar: the fixture aircraft, the ones POST /aircraft adds, and DELETE (the owner's delete, or
/// the pilot's own share) as the server answers them.
extension FixtureTransport {
    func aircraftRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "aircraft", 1): return (200, nil, Self.encoded(.array(aircraft)))
        case ("POST", "aircraft", 1): return createAircraft(r.body)
        case ("GET", "aircraft", 2):
            if let a = aircraft.first(where: { $0["id"]?.string == r.parts[1] }) { return (200, nil, Self.encoded(a)) }
            return (200, "aircraft.json", nil)
        case ("DELETE", "aircraft", 2): return removeAircraft(r.parts[1], owner: true)
        case ("DELETE", "aircraft", 4) where r.parts[2] == "shares" && r.parts[3] == pilot["id"]?.string:
            return removeAircraft(r.parts[1], owner: false)
        default: return nil
        }
    }

    fileprivate func createAircraft(_ body: Data?) -> (Int, String?, Data?) {
        guard let body, var a = try? JSON.parse(body), let reg = a["registration"]?.string, !reg.isEmpty else {
            return bad("registration is required")
        }
        if aircraft.contains(where: { $0["registration"]?.string == reg && Self.owned($0) }) {
            return (409, nil, try? JSON.object(["error": .string("\(reg) is already in the hangar")]).data())
        }
        let id = "fixture-ac-\(aircraft.count + 1)"
        a["id"] = .string(id)
        a["access"] = ["role": "owner"]
        aircraft.append(a)
        if pilot["defaultAircraftId"]?.string == nil { pilot["defaultAircraftId"] = .string(id) }
        return (201, nil, Self.encoded(a))
    }

    /// The server clears the pilot's default aircraft when it leaves their hangar.
    fileprivate func removeAircraft(_ id: String, owner: Bool) -> (Int, String?, Data?) {
        guard let i = aircraft.firstIndex(where: { $0["id"]?.string == id }) else { return (404, nil, nil) }
        if owner && !Self.owned(aircraft[i]) {
            return (403, nil, try? JSON.object(["error": "Only the owner can delete the aircraft"]).data())
        }
        aircraft.remove(at: i)
        if pilot["defaultAircraftId"]?.string == id { pilot["defaultAircraftId"] = .null }
        return (200, nil, Data(#"{"ok":true}"#.utf8))
    }

    static func owned(_ a: JSON) -> Bool { (a["access"]?["role"]?.string ?? "owner") == "owner" }
}
