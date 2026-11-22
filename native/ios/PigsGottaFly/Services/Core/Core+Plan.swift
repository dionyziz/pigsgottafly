import Foundation

// Planning a flight (src/native/core/plan.ts; NATIVE.md "core.js API", Plan). Route points, requests
// and the flight's options stay JSON, as the API sends them; the answers the screens read are
// Codable.

/// One edit of the route as the website's editor makes it (PGF.routeEdit).
enum CoreRouteOp: Sendable {
    /// Drawing on the map: before a round trip's closing point unless `toEnd`.
    case add(point: JSON, toEnd: Bool = false)
    case removeDrawn(toEnd: Bool = false)
    /// `index`: leg + 1 to split a leg.
    case insert(index: Int, point: JSON)
    case replace(uid: String, point: JSON)
    /// A point that becomes another one (snapped elsewhere) gets `newUid`.
    case move(uid: String, point: JSON, newUid: String?)
    case remove(uid: String)
    case rename(uid: String, name: String)
    /// The route fields: `aerodrome` is an id or ICAO.
    case setEnd(from: Bool, aerodrome: String)
    case makeLocal
    case setAltitude(legKey: String, altFt: Double?)

    var fields: [String: String] {
        func s(_ v: String) -> String { JSON.string(v).text }
        switch self {
        case .add(let p, let toEnd): return ["op": s("add"), "point": p.text, "toEnd": toEnd ? "true" : "false"]
        case .removeDrawn(let toEnd): return ["op": s("removeDrawn"), "toEnd": toEnd ? "true" : "false"]
        case .insert(let i, let p): return ["op": s("insert"), "index": String(i), "point": p.text]
        case .replace(let uid, let p): return ["op": s("replace"), "uid": s(uid), "point": p.text]
        case .move(let uid, let p, let newUid):
            return ["op": s("move"), "uid": s(uid), "point": p.text, "newUid": newUid.map(s) ?? "null"]
        case .remove(let uid): return ["op": s("remove"), "uid": s(uid)]
        case .rename(let uid, let name): return ["op": s("rename"), "uid": s(uid), "name": s(name)]
        case .setEnd(let from, let ad): return ["op": s("setEnd"), "end": s(from ? "from" : "to"), "aerodrome": s(ad)]
        case .makeLocal: return ["op": s("makeLocal")]
        case .setAltitude(let key, let alt):
            return ["op": s("setAltitude"), "key": s(key), "altFt": alt.map { JSON.number($0).text } ?? "null"]
        }
    }
}

/// The route and leg overrides after an edit: what the flight's PUT carries.
struct CoreRouteEdit: Codable, Equatable, Sendable {
    var route: JSON
    var legOverrides: JSON
}

/// What the map's drawing needs to know of a route (PGF.routeInfo).
struct CoreRouteInfo: Codable, Equatable, Sendable {
    var roundTrip: Bool
    var bareRoundTrip: Bool
    var drawIndex: Int
    var local: Bool
    var autoWaypointName: String
}

/// A point the map snaps to (src/features/editor/map/snap.ts SnapCandidate).
struct CoreSnapCandidate: Codable, Equatable, Sendable {
    var kind: String
    var refId: String?
    var name: String
    var detail: String
    var lat: Double
    var lon: Double
    var penaltyPx: Double
}

struct CoreSnap: Codable, Equatable, Sendable {
    struct Hit: Codable, Equatable, Sendable {
        var cand: CoreSnapCandidate
        var distPx: Double
        /// A point the aerodrome was preferred over: zoom in to pick it.
        var shadowed: CoreSnapCandidate?
    }
    var hit: Hit?
    /// The route point to add (JSON, with its uid).
    var point: JSON?
}

struct CoreLocalFlight: Codable, Equatable, Sendable {
    var local: Bool
    var durationMin: Double?
    var durationOf: Double
    var defaultMin: Double
    var maxMin: Double
    var areaNm: Double
}

/// A change of options.aerodromeRequests (PGF.setRequest).
enum CoreRequestOp: Sendable {
    case set(kind: String, stopMin: Int?)
    /// One kind, or all of the point's requests (nil).
    case remove(kind: String?)
    /// `key`: landingRunway, takeoffRunway or surface; nil value: automatic.
    case choice(kind: String, key: String, value: String?)

    var fields: [String: String] {
        func s(_ v: String) -> String { JSON.string(v).text }
        switch self {
        case .set(let kind, let min):
            return ["op": s("set"), "kind": s(kind), "stopMin": min.map(String.init) ?? "null"]
        case .remove(let kind): return ["op": s("remove"), "kind": kind.map(s) ?? "null"]
        case .choice(let kind, let key, let value):
            return ["op": s("choice"), "kind": s(kind), "key": s(key), "value": value.map(s) ?? "null"]
        }
    }
}

/// The fuel on board by type (src/shared/fuel.ts FuelLoad) and the taxi allowance.
struct CoreFuelLoad: Codable, Equatable, Sendable {
    struct Part: Codable, Equatable, Sendable {
        var type: String
        var litres: Double
        var densityKgPerL: Double
        var kg: Double
    }
    struct Load: Codable, Equatable, Sendable {
        var parts: [Part]
        var totalL: Double
        var kg: Double
        var densityKgPerL: Double
        var mixed: Bool
        var unapproved: [String]
    }
    var load: Load
    var byType: [String: Double]?
    var byTypeTotal: Double
    var taxiAllowanceL: Double
    var types: [String]
    var density: [String: Double]
}

/// A "Ready to fly" stage: its worst row and how many rows need attention.
struct CoreStageSummary: Codable, Equatable, Sendable {
    var stage: String
    var label: String
    var state: String
    var open: Int
}

/// Where a warning's Fix leads (PGF.focusTarget).
struct CoreFocusTarget: Codable, Equatable, Sendable {
    struct Link: Codable, Equatable, Sendable {
        var to: String
        var label: String
    }
    var fix: JSON?
    /// A field of the flight (its data-focus key), with the editor section and readiness stage.
    var focus: String?
    var section: String?
    var stage: String?
    /// A page elsewhere (the website's path).
    var link: Link?
}

struct CoreFocusSections: Codable, Equatable, Sendable {
    var fields: [String: String]
    var stages: [String: String]
}

struct CoreAtcRegeneration: Codable, Equatable, Sendable {
    var generated: JSON
    var list: JSON
    var stale: Bool
    /// The flight's doc.atc after Regenerate (null: follow the generator).
    var atc: JSON
}

extension Core {
    /// `route`: the flight's route (JSON text); `legOverrides`: its overrides (JSON text) or nil; `ref` for `.setEnd`.
    func routeEdit(route: String, legOverrides: String?, _ op: CoreRouteOp, ref: String? = nil) throws -> CoreRouteEdit
    {
        var f = op.fields
        f["route"] = route
        f["legOverrides"] = legOverrides ?? "null"
        if case .setEnd = op { return try callDecoding("routeEdit", ref: ref, fields: f) }
        return try callDecoding("routeEdit", fields: f)
    }

    func routeInfo(route: String) throws -> CoreRouteInfo {
        try callDecoding("routeInfo", fields: ["route": route])
    }

    /// What a tap or drag at (lat, lon) snaps to at map zoom `zoom`. `layers`: the flight's map layers.
    func snap(
        ref: String?, route: String, waypoints: String?, layers: String?, lat: Double, lon: Double, zoom: Double,
        exceptUid: String? = nil, newUid: String? = nil
    ) throws -> CoreSnap {
        try callDecoding(
            "snap", ref: ref,
            fields: [
                "route": route, "waypoints": waypoints ?? "null", "layers": layers ?? "null",
                "lat": JSON.number(lat).text, "lon": JSON.number(lon).text, "zoom": JSON.number(zoom).text,
                "exceptUid": exceptUid.map { JSON.string($0).text } ?? "null",
                "newUid": newUid.map { JSON.string($0).text } ?? "null",
            ])
    }

    func localFlight(route: String, options: String?) throws -> CoreLocalFlight {
        try callDecoding("localFlight", fields: ["route": route, "options": options ?? "null"])
    }

    /// The new options.aerodromeRequests (JSON array).
    func setRequest(_ requests: String?, pointUid: String, _ op: CoreRequestOp) throws -> JSON {
        var f = op.fields
        f["aerodromeRequests"] = requests ?? "null"
        f["pointUid"] = JSON.string(pointUid).text
        return try callJSON("setRequest", fields: f)
    }

    /// { active, allowed, remarks, stopPoints, landingPoints, stopMin }
    func requests(route: String, options: String?, ref: String?) throws -> JSON {
        try callWithRef("requests", ref: ref, fields: ["route": route, "options": options ?? "null"])
    }

    /// FlightOptions.alternates from the alternate fields.
    func fplAlternates(_ fields: [String], ref: String?) throws -> [String] {
        let j = try callWithRef("fplOptions", ref: ref, fields: ["fields": Core.text(fields)])
        return (j["alternates"]?.array ?? []).compactMap(\.string)
    }

    /// `fuel`: the aircraft's fuel (JSON text); `options`: the flight's (its taxi allowance).
    func fuelLoad(fuel: String, totalL: Double, byType: [String: Double]? = nil, options: String? = nil) throws
        -> CoreFuelLoad
    {
        try callDecoding(
            "fuelLoad",
            fields: [
                "fuel": fuel, "totalL": JSON.number(totalL).text, "byType": byType.map(Core.text) ?? "null",
                "options": options ?? "null",
            ])
    }

    /// `items`: computeFlight's readiness rows and paperwork's (a JSON array).
    func readinessStages(items: String) throws -> [CoreStageSummary] {
        try callDecoding("readinessStages", fields: ["items": items])
    }

    func focusTarget(text: String?, fix: String? = nil, flightId: String? = nil, aircraftId: String? = nil) throws
        -> CoreFocusTarget
    {
        try callDecoding(
            "focusTarget",
            fields: [
                "text": text.map { JSON.string($0).text } ?? "null", "fix": fix ?? "null",
                "flightId": flightId.map { JSON.string($0).text } ?? "null",
                "aircraftId": aircraftId.map { JSON.string($0).text } ?? "null",
            ])
    }

    func focusSections() throws -> CoreFocusSections {
        try decode("focusSections", try call("focusSections", json: nil))
    }

    /// `altitudesFt`: computeFlight's.
    func regenerateAtc(flight: String, altitudesFt: [Double], pilot: String?, ref: String?) throws
        -> CoreAtcRegeneration
    {
        try callDecoding(
            "regenerateAtc", ref: ref,
            fields: ["flight": flight, "altitudesFt": Core.text(altitudesFt), "pilot": pilot ?? "null"])
    }
}
