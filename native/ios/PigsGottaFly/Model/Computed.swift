import Foundation

// Read-only views of what the core computes (PGF.computeFlight, PGF.paperwork, PGF.progress; NATIVE.md
// "core.js API"). The core owns the shapes; these read the fields the screens show and tolerate the
// ones that are missing.

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

/// One row of the navlog (src/calc NavlogLeg) with the names of its ends (computeFlight's `legs`).
struct NavRow: Equatable, Identifiable {
    var index: Int
    var from: String
    var to: String
    /// legOverrides key: "<from uid>><to uid>".
    var key: String
    var altFt: Double?
    /// Magnetic heading (MH), as the website's navlog.
    var heading: Double?
    var distNm: Double?
    var eteMin: Double?
    var fuelL: Double?
    var gsKt: Double?
    /// Minutes after 00:00 UTC of the flight date (nil without a block-off time).
    var startMin: Double?
    var endMin: Double?
    var id: Int { index }
}

/// An aerodrome of the route at the time the flight uses it (computeFlight's `aerodromeChecks`):
/// the aerodrome's, the ATS's and the handling's hours then.
struct AerodromeCheck: Equatable, Identifiable {
    struct Hours: Equatable {
        /// 'open' | 'closed' | 'unknown' (and what else the core says)
        var status: String
        var why: String?

        init?(_ j: JSON?) {
            guard let j, let status = j["status"]?.string else { return nil }
            self.status = status
            why = j["why"]?.string
        }

        init(status: String, why: String?) {
            self.status = status
            self.why = why
        }

        /// 'Open (HJ 0514-1508Z)'
        var text: String {
            let s = status.prefix(1).uppercased() + status.dropFirst()
            guard let why, !why.isEmpty else { return s }
            return "\(s) (\(why))"
        }
    }

    var id: String { "\(role)-\(pointIndex)" }
    var role: String
    var pointIndex: Int
    var icao: String
    var name: String
    /// 'block start 08:30Z – take-off 08:45Z'
    var when: String?
    var aerodrome: Hours?
    var ats: Hours?
    var handling: Hours?

    init?(_ j: JSON) {
        guard let a = j["aerodrome"], let code = a["icao"]?.string ?? a["id"]?.string else { return nil }
        role = j["role"]?.string ?? ""
        pointIndex = j["pointIndex"]?.int ?? 0
        icao = code
        name = a["name"]?.string ?? code
        when = j["when"]?.string
        aerodrome = Hours(j["ad"])
        ats = Hours(j["ats"])
        handling = Hours(j["handling"])
    }

    /// The worst of the three: what the row's icon shows.
    var worst: String {
        let all = [aerodrome, ats].compactMap { $0?.status }
        if all.contains("closed") { return "closed" }
        if all.contains("unknown") { return "unknown" }
        return all.isEmpty ? "unknown" : "open"
    }
}

/// PGF.computeFlight's result, as the Brief and the Navlog read it.
struct ComputedFlight: Equatable {
    var raw: JSON
    var readiness: [ReadyItem]
    var rows: [NavRow]
    /// The navlog was computed (it needs the flight's aircraft); else `rows` are the bare legs.
    var hasNavlog: Bool
    var totalDistNm: Double?
    var totalEteMin: Double?
    var totalFuelL: Double?
    var tripFuelL: Double?
    var fobL: Double?
    var landingFuelL: Double?
    var enduranceMin: Double?
    /// 'HH:MM' UTC (nil without a block-off time).
    var blockOff: String?
    var takeoff: String?
    var landing: String?
    var blockOn: String?
    /// 'HH:MM' UTC at the destination on the flight's date.
    var sunset: String?
    var aerodromes: [AerodromeCheck]
    var warnings: [String]
    /// The winds aloft as used (nil: fetched and fine), e.g. 'Winds unavailable: not fetched'.
    var windsMessage: String?

    init(_ j: JSON) {
        raw = j
        readiness = ReadyItem.list(j["readiness"])
        let legs = j["legs"]?.array ?? []
        let navlog = j["navlog"]
        let times = j["times"]
        let timed = times?["blockOffSet"]?.bool ?? false
        rows = (navlog?["legs"]?.array ?? []).enumerated().map { i, l in
            let index = l["index"]?.int ?? i
            let leg: JSON? = legs.indices.contains(index) ? legs[index] : nil
            return NavRow(
                index: index,
                from: leg?["from"]?["name"]?.string ?? "?",
                to: leg?["to"]?["name"]?.string ?? "?",
                key: leg?["key"]?.string ?? "",
                altFt: l["altFt"]?.double ?? leg?["altFt"]?.double,
                heading: l["mh"]?.double,
                distNm: l["dist"]?.double,
                eteMin: l["ete"]?.double,
                fuelL: l["fuel"]?.double,
                gsKt: l["gs"]?.double,
                startMin: timed ? l["startMin"]?.double : nil,
                endMin: timed ? l["endMin"]?.double : nil)
        }
        // no navlog without an aircraft: the legs still show (and their altitudes can be changed)
        if navlog?["legs"]?.array == nil {
            rows = legs.enumerated().map { i, leg in
                NavRow(
                    index: leg["index"]?.int ?? i, from: leg["from"]?["name"]?.string ?? "?",
                    to: leg["to"]?["name"]?.string ?? "?", key: leg["key"]?.string ?? "", altFt: leg["altFt"]?.double,
                    heading: nil, distNm: leg["distNm"]?.double)
            }
        }
        hasNavlog = navlog?["legs"]?.array != nil
        let totals = navlog?["totals"]
        totalDistNm = totals?["dist"]?.double
        totalEteMin = totals?["ete"]?.double
        totalFuelL = totals?["fuel"]?.double
        tripFuelL = totals?["tripFuel"]?.double
        let fuel = j["fuel"]
        fobL = fuel?["fobL"]?.double
        landingFuelL = fuel?["landingFuelL"]?.double
        enduranceMin = fuel?["enduranceMin"]?.double
        func clock(_ key: String) -> String? {
            timed ? times?[key]?.double.map(Fmt.clock(minutes:)) : nil
        }
        blockOff = clock("blockOffMin")
        takeoff = clock("takeoffMin")
        landing = clock("landingMin")
        blockOn = clock("blockOnMin")
        sunset = times?["sunsetMin"]?.double.map(Fmt.clock(minutes:))
        aerodromes = (j["aerodromeChecks"]?.array ?? []).compactMap(AerodromeCheck.init)
        warnings = (j["warnings"]?.array ?? []).compactMap { w in
            guard let text = w["text"]?.string else { return nil }
            return w["level"]?.string == "info" ? nil : text
        }
        let winds = j["weather"]?["winds"]
        windsMessage = winds?["status"]?.string == "ok" ? nil : winds?["message"]?.string
    }

    /// The highest planned altitude (the NOTAM briefing's maxAltFt).
    var maxAltFt: Int? {
        rows.compactMap(\.altFt).max().map { Int($0) }
    }
}

/// A unit to talk to, as progress returns it (the flight's ATC list row).
struct Frequency: Equatable {
    var callsign: String
    var service: String
    /// MHz, as published ('130.925').
    var primary: String
    var backups: [String]

    init(callsign: String, service: String = "", primary: String, backups: [String] = []) {
        self.callsign = callsign
        self.service = service
        self.primary = primary
        self.backups = backups
    }

    init?(_ j: JSON?) {
        guard let j, let primary = j["primary"]?.string, !primary.isEmpty else { return nil }
        self.primary = primary
        callsign = j["callsign"]?.string ?? ""
        service = j["service"]?.string ?? ""
        backups = (j["backups"]?.array ?? []).compactMap(\.string)
    }
}

/// PGF.progress's result.
struct Progress: Equatable {
    var legIndex: Int
    /// The next waypoint's name.
    var toWaypoint: String
    var distNm: Double?
    /// To the next waypoint, degrees true and magnetic.
    var bearingDeg: Double?
    var bearingMagDeg: Double?
    var crossTrackNm: Double?
    var eteMin: Double?
    var eta: Date?
    /// The groundspeed the ETE uses and where it came from ('gps' | 'navlog').
    var gsKt: Double?
    var gsSource: String?
    /// To the destination along the route.
    var remainingNm: Double?
    var eteDestMin: Double?
    var etaDest: Date?
    var plannedAltFt: Double?
    /// The navlog's magnetic heading.
    var plannedHdg: Double?
    var freq: Frequency?
    var nextFreq: Frequency?
    var offRoute: Bool
    /// Past the last waypoint.
    var arrived: Bool

    init(
        legIndex: Int, toWaypoint: String, distNm: Double? = nil, bearingDeg: Double? = nil,
        bearingMagDeg: Double? = nil, crossTrackNm: Double? = nil, eteMin: Double? = nil, eta: Date? = nil,
        gsKt: Double? = nil, gsSource: String? = nil, remainingNm: Double? = nil, eteDestMin: Double? = nil,
        etaDest: Date? = nil, plannedAltFt: Double? = nil, plannedHdg: Double? = nil, freq: Frequency? = nil,
        nextFreq: Frequency? = nil, offRoute: Bool = false, arrived: Bool = false
    ) {
        self.legIndex = legIndex
        self.toWaypoint = toWaypoint
        self.distNm = distNm
        self.bearingDeg = bearingDeg
        self.bearingMagDeg = bearingMagDeg
        self.crossTrackNm = crossTrackNm
        self.eteMin = eteMin
        self.eta = eta
        self.gsKt = gsKt
        self.gsSource = gsSource
        self.remainingNm = remainingNm
        self.eteDestMin = eteDestMin
        self.etaDest = etaDest
        self.plannedAltFt = plannedAltFt
        self.plannedHdg = plannedHdg
        self.freq = freq
        self.nextFreq = nextFreq
        self.offRoute = offRoute
        self.arrived = arrived
    }

    /// nil when the core found no leg (no route, no position).
    init?(_ j: JSON) {
        guard let legIndex = j["legIndex"]?.int, let to = j["toWaypoint"]?["name"]?.string else { return nil }
        let date = { (k: String) in j[k]?.double.map { Date(timeIntervalSince1970: $0 / 1000) } }
        self.init(
            legIndex: legIndex, toWaypoint: to, distNm: j["distNm"]?.double, bearingDeg: j["bearingDeg"]?.double,
            bearingMagDeg: j["bearingMagDeg"]?.double, crossTrackNm: j["crossTrackNm"]?.double,
            eteMin: j["eteMin"]?.double, eta: date("eta"), gsKt: j["gsKt"]?.double, gsSource: j["gsSource"]?.string,
            remainingNm: j["remainingNm"]?.double, eteDestMin: j["eteDestMin"]?.double, etaDest: date("etaDest"),
            plannedAltFt: j["plannedAltFt"]?.double, plannedHdg: j["plannedHdg"]?.double, freq: Frequency(j["freq"]),
            nextFreq: Frequency(j["nextFreq"]), offRoute: j["offRoute"]?.bool ?? false,
            arrived: j["arrived"]?.bool ?? false)
    }
}
