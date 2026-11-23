import CoreLocation
import Foundation

// What the app needs to start a flight and change its route: the pilot's profile (GET /api/me), the
// aircraft list (GET /api/aircraft), the places a route point can be (the reference data's aerodromes
// and VFR points, the pilot's saved waypoints) and the route edits, as the website makes them
// (src/shared/aerodrome.ts aerodromePoint, src/features/editor/map/snap.ts, routeEdit.ts).

/// GET /api/me: the fields the app shows (a new account has only its e-mail).
struct PilotProfile: Codable, Equatable {
    var id: String
    var email: String
    var name: String
    var fullName: String
    var phone: String
    var homeAerodrome: String?
    var defaultAircraftId: String?
    var settings: JSON?

    /// PUT /api/me as the website's profile sends these fields (src/features/profile/ProfilePage.tsx
    /// profileUpdate): the name with single spaces, the phone, the home aerodrome's code. Any of them
    /// may be empty.
    func update(fullName: String, phone: String, home: Place?) -> JSON {
        let name = fullName.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return [
            "fullName": .string(name),
            "phone": .string(phone.trimmingCharacters(in: .whitespacesAndNewlines)),
            "homeAerodrome": home.map { .string($0.code) } ?? .null,
        ]
    }
}

/// GET /api/aircraft → one row (HangarAircraft).
struct AircraftItem: Codable, Equatable, Identifiable {
    var id: String
    var registration: String
    var makeModel: String?
    var access: Access?

    /// src/shared/sharing.ts AircraftAccess: owner, edit or view.
    struct Access: Codable, Equatable {
        var role: String
        /// The owner, for "Shared by …" (the pilot themselves on their own aircraft).
        var owner: Owner?
    }

    struct Owner: Codable, Equatable {
        var pilotId: String?
        var name: String
        var email: String
    }

    /// Only the owner deletes an aircraft; anyone else removes it from their own hangar.
    var isOwner: Bool { (access?.role ?? "owner") == "owner" }

    var label: String {
        guard let m = makeModel, !m.isEmpty else { return registration }
        return "\(registration) · \(m)"
    }
}

/// PGF.aircraftTemplates(): the hangar's type templates.
struct AircraftTemplate: Equatable, Identifiable {
    var id: String
    var label: String
    var description: String
}

/// Where a route point can be: an aerodrome, a VFR reporting point or a saved waypoint.
struct Place: Equatable, Identifiable, Hashable {
    enum Kind: String {
        case aerodrome, vfr, waypoint
    }
    var kind: Kind
    /// The reference id (aerodrome id, VFR point id 'LGAV/PIKAD', waypoint id).
    var refId: String
    /// The route point's name: an aerodrome's ICAO code (or the last part of its name), the point's name.
    var name: String
    /// A line under the name in the search list.
    var detail: String
    var lat: Double
    var lon: Double
    /// An aerodrome's ICAO code, else its id (what the profile's home aerodrome holds).
    var code: String

    var id: String { "\(kind.rawValue):\(refId)" }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }

    /// A new route point here (RoutePoint: { uid, kind, refId, name, lat, lon }).
    func routePoint(uid: String = Places.newUid()) -> JSON {
        [
            "uid": .string(uid), "kind": .string(kind.rawValue), "refId": .string(refId), "name": .string(name),
            "lat": .number(lat), "lon": .number(lon),
        ]
    }
}

enum Places {
    /// A random route point uid, as the website's uid(): 8 of [a-z0-9].
    static func newUid() -> String {
        let abc = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<8).map { _ in abc.randomElement()! })
    }

    /// The aerodromes of GET /api/ref/bundle.
    static func aerodromes(ref: JSON) -> [Place] {
        (ref["aerodromes"]?.array ?? []).compactMap { a in
            guard let id = a["id"]?.string, let full = a["name"]?.string, let lat = a["lat"]?.double,
                let lon = a["lon"]?.double
            else { return nil }
            let icao = a["icao"]?.string ?? ""
            let short = full.split(separator: "/").last.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
            let name = !icao.isEmpty ? icao : (!short.isEmpty ? short : full)
            return Place(
                kind: .aerodrome, refId: id, name: name, detail: full.capitalized, lat: lat, lon: lon,
                code: icao.isEmpty ? id : icao)
        }
    }

    /// The VFR reporting points; an open flightmaps point within 0.5 NM of a charted one of the same
    /// name is left out (snap.ts).
    static func vfrPoints(ref: JSON) -> [Place] {
        let all = ref["vfrPoints"]?.array ?? []
        let charted = all.filter { $0["src"]?.string != "ofm" }
        return all.compactMap { v in
            guard let id = v["id"]?.string, let name = v["name"]?.string, let lat = v["lat"]?.double,
                let lon = v["lon"]?.double
            else { return nil }
            let ofm = v["src"]?.string == "ofm"
            if ofm,
                charted.contains(where: { c in
                    c["name"]?.string == name
                        && distanceNm(lat, lon, c["lat"]?.double ?? 0, c["lon"]?.double ?? 0) <= 0.5
                })
            {
                return nil
            }
            let chart = v["chart"]?.string ?? ""
            let detail = ofm ? "VFR point (open flightmaps)" : "VFR reporting point · \(chart) chart"
            return Place(kind: .vfr, refId: id, name: name, detail: detail, lat: lat, lon: lon, code: id)
        }
    }

    /// GET /api/waypoints.
    static func waypoints(_ list: JSON?) -> [Place] {
        (list?.array ?? []).compactMap { w in
            guard let id = w["id"]?.string, let name = w["name"]?.string, let lat = w["lat"]?.double,
                let lon = w["lon"]?.double
            else { return nil }
            return Place(kind: .waypoint, refId: id, name: name, detail: "My waypoint", lat: lat, lon: lon, code: id)
        }
    }

    /// The places matching `query` (code or name, any case and accents), best first: the exact code or
    /// name, then those starting with it, then a word starting with it, then the rest that contain it.
    static func search(_ query: String, in places: [Place], limit: Int = 60) -> [Place] {
        let q = fold(query)
        guard !q.isEmpty else { return Array(places.prefix(limit)) }
        var scored: [(Int, Int, Place)] = []
        for (i, p) in places.enumerated() {
            let name = fold(p.name)
            let code = fold(p.code)
            let detail = fold(p.detail)
            let score: Int
            if name == q || code == q {
                score = 0
            } else if name.hasPrefix(q) || code.hasPrefix(q) {
                score = 1
            } else if (name + " " + detail).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: {
                $0.hasPrefix(q)
            }) {
                score = 2
            } else if name.contains(q) || detail.contains(q) {
                score = 3
            } else {
                continue
            }
            scored.append((score, i, p))
        }
        return scored.sorted { ($0.0, $0.1) < ($1.0, $1.1) }.prefix(limit).map(\.2)
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en"))
            .trimmingCharacters(in: .whitespaces).uppercased()
    }

    static func distanceNm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = Double.pi / 180
        let dLat = (lat2 - lat1) * r
        let dLon = (lon2 - lon1) * r
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * r) * cos(lat2 * r) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * atan2(sqrt(a), sqrt(1 - a)) * 3440.065
    }
}

/// Route edits on a flight (src/features/editor/map/routeEdit.ts).
enum RouteEdit {
    /// Where a new point adds the least distance: the index it is inserted at (between the ends).
    static func bestIndex(for p: Place, in route: [JSON]) -> Int {
        guard route.count >= 2 else { return route.count }
        var best = route.count - 1
        var bestCost = Double.infinity
        for i in 0..<(route.count - 1) {
            guard let a = coord(route[i]), let b = coord(route[i + 1]) else { continue }
            let cost =
                Places.distanceNm(a.0, a.1, p.lat, p.lon) + Places.distanceNm(p.lat, p.lon, b.0, b.1)
                - Places.distanceNm(a.0, a.1, b.0, b.1)
            if cost < bestCost {
                bestCost = cost
                best = i + 1
            }
        }
        return best
    }

    /// Inserts a point where it adds the least distance.
    static func add(_ p: Place, to flight: inout JSON) {
        var route = flight["route"]?.array ?? []
        route.insert(p.routePoint(), at: bestIndex(for: p, in: route))
        flight["route"] = .array(route)
        pruneOverrides(&flight)
    }

    static func remove(uid: String, from flight: inout JSON) {
        let route = (flight["route"]?.array ?? []).filter { $0["uid"]?.string != uid }
        flight["route"] = .array(route)
        pruneOverrides(&flight)
    }

    /// Leg overrides of legs that no longer exist are dropped.
    static func pruneOverrides(_ flight: inout JSON) {
        let route = flight["route"]?.array ?? []
        var keep = Set<String>()
        for i in 0..<max(0, route.count - 1) {
            keep.insert("\(route[i]["uid"]?.string ?? "")>\(route[i + 1]["uid"]?.string ?? "")")
        }
        guard let o = flight["legOverrides"]?.object else { return }
        flight["legOverrides"] = .object(o.filter { keep.contains($0.key) })
    }

    private static func coord(_ p: JSON) -> (Double, Double)? {
        guard let lat = p["lat"]?.double, let lon = p["lon"]?.double else { return nil }
        return (lat, lon)
    }
}
