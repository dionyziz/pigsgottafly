import Foundation

/// The hangar: the fixture aircraft, and the ones POST /aircraft adds.
extension FixtureTransport {
    func aircraftRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "aircraft", 1): return (200, nil, Self.encoded(.array(aircraft)))
        case ("POST", "aircraft", 1): return createAircraft(r.body)
        case ("GET", "aircraft", 2):
            if let a = aircraft.first(where: { $0["id"]?.string == r.parts[1] }) { return (200, nil, Self.encoded(a)) }
            return (200, "aircraft.json", nil)
        default: return nil
        }
    }

    fileprivate func createAircraft(_ body: Data?) -> (Int, String?, Data?) {
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

}
