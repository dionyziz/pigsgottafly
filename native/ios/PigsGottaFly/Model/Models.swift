import Foundation

// The API's simple shapes (src/shared/api.ts, src/shared/briefing.ts), decoded with Codable. Only the
// fields the app shows; everything else stays in the JSON passed to the core.

/// GET /api/session
struct SessionResponse: Codable, Equatable {
    struct PilotInfo: Codable, Equatable {
        var id: String
        var email: String
        var name: String
        var fullName: String?
    }
    var authed: Bool
    var mode: String
    var pilot: PilotInfo?
}

/// FlightSummary: the lobby row data.
struct FlightSummary: Codable, Equatable {
    var title: String
    var date: String
    var blockOff: String
    var aircraft: String
    var from: String
    var to: String
    var distNm: Double?
    var eteMin: Double?
    var fuelL: Double?
}

/// GET /api/flights → [FlightListItem]
struct FlightListItem: Codable, Equatable, Identifiable {
    struct SharedBy: Codable, Equatable {
        var pilotId: String
        var name: String
        var email: String
    }
    var id: String
    var summary: FlightSummary
    var points: [String]
    var date: String
    var aircraftId: String?
    var version: Int
    var updated: Double
    var deleted: Bool
    var filingStatus: String?
    var sharedBy: SharedBy?
    var role: String?

    /// The flight's title; an untitled flight (the server names it after its date) by its route.
    var title: String {
        if !summary.title.isEmpty, summary.title != summary.date, summary.title != date { return summary.title }
        if !summary.from.isEmpty || !summary.to.isEmpty { return "\(summary.from) → \(summary.to)" }
        return "Untitled flight"
    }
}

/// PUT /api/flights/:id → FlightUpdateResponse
struct FlightUpdateResponse: Codable, Equatable {
    var version: Int
    var updated: Double
}

/// GET /api/weather/metar → MetarTafResponse
struct MetarTafResponse: Codable, Equatable {
    struct Station: Codable, Equatable {
        var metar: String?
        var taf: String?
        var observed: Double?
    }
    var stations: [String: Station]
    var fetched: Double
}

/// One NOTAM of the briefing.
struct Notam: Codable, Equatable, Identifiable {
    var key: String
    var itemA: [String]
    var fir: String
    var subject: String?
    var condition: String?
    var text: String
    var raw: String
    var relevant: Bool
    var reasons: [String]
    var from: Double
    var to: Double?
    var estimated: Bool?
    var schedule: String?
    var lowerText: String?
    var upperText: String?
    var legIndex: Int?
    var sources: [String]?

    var id: String { key }
    /// Only autorouter returned it (src/data/notams.ts onlyFromAutorouter).
    var onlyFromAutorouter: Bool { !(sources ?? []).isEmpty && (sources ?? []).allSatisfy { $0 == "autorouter" } }
    /// An aerodrome NOTAM (src/data/notams.ts isAerodromeNotam): one location that is not the FIR.
    var isAerodrome: Bool { itemA.count == 1 && itemA[0] != fir }
}

/// GET /api/flights/:id/notams → NotamBriefing
struct NotamBriefing: Codable, Equatable {
    var status: String
    var message: String?
    var fetched: Double?
    var notams: [Notam]
    var relevantCount: Int
    var hiddenCount: Int
}

/// A group of the NOTAM list: an aerodrome's, or the airspace's (icao nil).
struct NotamGroup: Equatable, Identifiable {
    var icao: String?
    var notams: [Notam]
    var id: String { icao ?? "airspace" }
}

extension NotamBriefing {
    /// The relevant NOTAMs grouped like the website (src/data/notams.ts groupNotams): the `always`
    /// aerodromes (departure, destination) first even with none, then the others, then the airspace.
    func groups(always: [String]) -> [NotamGroup] {
        var order: [String] = []
        var byAd: [String: [Notam]] = [:]
        for icao in always where byAd[icao] == nil {
            order.append(icao)
            byAd[icao] = []
        }
        var air: [Notam] = []
        for n in notams where n.relevant {
            if n.isAerodrome {
                let k = n.itemA[0]
                if byAd[k] == nil { order.append(k) }
                byAd[k, default: []].append(n)
            } else {
                air.append(n)
            }
        }
        var out = order.map { NotamGroup(icao: $0, notams: byAd[$0] ?? []) }
        if !air.isEmpty { out.append(NotamGroup(icao: nil, notams: air)) }
        return out
    }
}

/// GET /api/flights/:id/filing → FilingState (what the Brief shows of it).
struct FilingState: Codable, Equatable {
    struct Record: Codable, Equatable {
        var status: String
        var eobt: Double?
        var message: String
        var filed: Double?
    }
    var enabled: Bool
    var reason: String?
    var filing: Record?
}

/// src/shared/briefing.ts FILING_STATUS_LABEL
enum FilingStatusLabel {
    static let labels: [String: String] = [
        "not-filed": "Not filed",
        "created": "Created",
        "filed": "Filed",
        "manual_correction": "Queued for manual correction",
        "suspended": "Suspended",
        "departed": "Departed",
        "terminated": "Terminated",
        "arriving": "Arriving",
        "arrived": "Arrived",
        "closed": "Closed",
        "cancelled": "Cancelled",
        "rejected": "Rejected",
        "sending": "Sending by fax",
        "delivered": "Delivered by fax",
        "failed": "Fax failed",
        "unknown": "Unknown",
    ]
    static func label(_ status: String?) -> String {
        guard let status else { return "Not filed" }
        return labels[status] ?? status.capitalized
    }
}
