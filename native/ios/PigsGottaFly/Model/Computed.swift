import Foundation

// Read-only views of what the core computes (PGF.computeFlight, PGF.paperwork, PGF.progress). The core
// owns the shapes; these read the fields the screens show and tolerate the ones that are missing.

/// A "Ready to fly" row (src/features/editor/panels/readiness.ts ReadyItem).
struct ReadyItem: Equatable, Identifiable {
    enum State: String {
        case ok, warn, danger, todo
    }
    var id: String
    var stage: String
    var state: State
    var label: String
    var text: String?

    init(id: String, stage: String, state: State, label: String, text: String?) {
        self.id = id
        self.stage = stage
        self.state = state
        self.label = label
        self.text = text
    }

    init?(_ j: JSON) {
        guard let label = j["label"]?.string else { return nil }
        id = j["id"]?.string ?? label
        stage = j["stage"]?.string ?? ""
        state = State(rawValue: j["state"]?.string ?? "") ?? .todo
        self.label = label
        text = j["text"]?.string
    }

    static func list(_ j: JSON?) -> [ReadyItem] {
        (j?.array ?? []).compactMap(ReadyItem.init)
    }
}

/// One row of the navlog (NavlogLeg) with the names of its ends.
struct NavRow: Equatable, Identifiable {
    var index: Int
    var from: String
    var to: String
    /// legOverrides key: "<from uid>><to uid>".
    var key: String
    var altFt: Double?
    var heading: Double?
    var distNm: Double?
    var eteMin: Double?
    var fuelL: Double?
    var gsKt: Double?
    /// Minutes after 00:00 UTC of the flight date.
    var startMin: Double?
    var endMin: Double?
    var id: Int { index }
}

/// An aerodrome of the route with its hours on the day.
struct AerodromeHours: Equatable, Identifiable {
    var id: String
    var name: String
    var role: String
    var hours: String
    var handling: String?
}

/// PGF.computeFlight's result, as the Brief and the Navlog read it.
struct ComputedFlight: Equatable {
    var raw: JSON
    var readiness: [ReadyItem]
    var rows: [NavRow]
    var totalDistNm: Double?
    var totalEteMin: Double?
    var totalFuelL: Double?
    var tripFuelL: Double?
    /// 'HH:MM' UTC strings (from `times`, else from the navlog's minutes).
    var blockOff: String?
    var takeoff: String?
    var landing: String?
    var blockOn: String?
    var sunset: String?
    var aerodromes: [AerodromeHours]
    var warnings: [String]

    init(_ j: JSON, flight: JSON) {
        raw = j
        readiness = ReadyItem.list(j["readiness"])
        let route = flight["route"]?.array ?? []
        let legs = j["legs"]?.array ?? []
        let navlog = j["navlog"]
        rows = (navlog?["legs"]?.array ?? []).enumerated().map { i, l in
            let index = l["index"]?.int ?? i
            let a: JSON? = route.indices.contains(index) ? route[index] : nil
            let b: JSON? = route.indices.contains(index + 1) ? route[index + 1] : nil
            let leg: JSON? = legs.indices.contains(index) ? legs[index] : nil
            let fromName = leg?["from"]?.string ?? a?["name"]?.string ?? "?"
            let toName = leg?["to"]?.string ?? b?["name"]?.string ?? "?"
            let key = leg?["key"]?.string ?? "\(a?["uid"]?.string ?? "")>\(b?["uid"]?.string ?? "")"
            return NavRow(
                index: index, from: fromName, to: toName, key: key,
                altFt: l["altFt"]?.double,
                heading: l["mh"]?.double ?? l["mc"]?.double ?? l["th"]?.double ?? l["tc"]?.double,
                distNm: l["dist"]?.double,
                eteMin: l["ete"]?.double,
                fuelL: l["fuel"]?.double,
                gsKt: l["gs"]?.double,
                startMin: l["startMin"]?.double,
                endMin: l["endMin"]?.double)
        }
        let totals = navlog?["totals"]
        totalDistNm = totals?["dist"]?.double
        totalEteMin = totals?["ete"]?.double
        totalFuelL = totals?["fuel"]?.double
        tripFuelL = totals?["tripFuel"]?.double
        let times = j["times"]
        let nt = navlog?["times"]
        func clock(_ key: String, _ minKey: String) -> String? {
            times?[key]?.string ?? nt?[minKey]?.double.map(Fmt.clock(minutes:))
        }
        blockOff = clock("blockOff", "blockOffMin")
        takeoff = clock("takeoff", "takeoffMin")
        landing = clock("landing", "landingMin")
        blockOn = clock("blockOn", "blockOnMin")
        sunset = times?["sunset"]?.string ?? navlog?["sunsetMin"]?.double.map(Fmt.clock(minutes:))
        aerodromes = (times?["aerodromes"]?.array ?? []).compactMap { a in
            guard let id = a["icao"]?.string ?? a["id"]?.string else { return nil }
            return AerodromeHours(
                id: id, name: a["name"]?.string ?? id, role: a["role"]?.string ?? "",
                hours: a["hours"]?.string ?? "Unknown", handling: a["handling"]?.string)
        }
        warnings = (j["warnings"]?.array ?? []).compactMap { w in
            guard let text = w["text"]?.string ?? w.string else { return nil }
            return w["level"]?.string == "info" ? nil : text
        }
    }

    /// The highest planned altitude (the NOTAM briefing's maxAltFt).
    var maxAltFt: Int? {
        rows.compactMap(\.altFt).max().map { Int($0) }
    }
}

/// A frequency as the progress returns it: { callsign, mhz } (or a plain string).
struct Frequency: Equatable {
    var callsign: String
    var mhz: String

    init(callsign: String, mhz: String) {
        self.callsign = callsign
        self.mhz = mhz
    }

    init?(_ j: JSON?) {
        guard let j, !j.isNull else { return nil }
        if let s = j.string {
            callsign = ""
            mhz = s
            return
        }
        let mhz =
            j["mhz"]?.string ?? j["primary"]?.string ?? j["freq"]?.string
            ?? j["mhz"]?.double.map { String(format: "%.3f", $0) }
        guard let mhz else { return nil }
        self.mhz = mhz
        callsign = j["callsign"]?.string ?? j["name"]?.string ?? ""
    }
}

/// PGF.progress's result.
struct Progress: Equatable {
    var legIndex: Int
    var toWaypoint: String
    var distNm: Double?
    var bearingDeg: Double?
    var crossTrackNm: Double?
    var eteMin: Double?
    var eta: Date?
    var plannedAltFt: Double?
    var plannedHdg: Double?
    var freq: Frequency?
    var nextFreq: Frequency?
    var offRoute: Bool

    init(
        legIndex: Int, toWaypoint: String, distNm: Double?, bearingDeg: Double?, crossTrackNm: Double?,
        eteMin: Double?, eta: Date?, plannedAltFt: Double?, plannedHdg: Double?, freq: Frequency?,
        nextFreq: Frequency?, offRoute: Bool
    ) {
        self.legIndex = legIndex
        self.toWaypoint = toWaypoint
        self.distNm = distNm
        self.bearingDeg = bearingDeg
        self.crossTrackNm = crossTrackNm
        self.eteMin = eteMin
        self.eta = eta
        self.plannedAltFt = plannedAltFt
        self.plannedHdg = plannedHdg
        self.freq = freq
        self.nextFreq = nextFreq
        self.offRoute = offRoute
    }

    /// `eta` is epoch ms (or an ISO date, or 'HH:MM' UTC on `day`).
    init?(_ j: JSON, day: Date? = nil) {
        guard case .object = j else { return nil }
        legIndex = j["legIndex"]?.int ?? 0
        toWaypoint = j["toWaypoint"]?.string ?? j["toWaypoint"]?["name"]?.string ?? "?"
        distNm = j["distNm"]?.double
        bearingDeg = j["bearingDeg"]?.double
        crossTrackNm = j["crossTrackNm"]?.double
        eteMin = j["eteMin"]?.double
        if let ms = j["eta"]?.double {
            eta = Date(timeIntervalSince1970: ms / 1000)
        } else if let s = j["eta"]?.string {
            eta = Fmt.parseEta(s, day: day)
        } else {
            eta = nil
        }
        plannedAltFt = j["plannedAltFt"]?.double
        plannedHdg = j["plannedHdg"]?.double
        freq = Frequency(j["freq"])
        nextFreq = Frequency(j["nextFreq"])
        offRoute = j["offRoute"]?.bool ?? false
    }
}
