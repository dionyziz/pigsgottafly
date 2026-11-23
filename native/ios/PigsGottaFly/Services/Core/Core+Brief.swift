import Foundation

// The Brief stage (src/native/core/brief.ts; NATIVE.md "core.js API", Brief): the METAR box, the
// aerodrome hours, the take-off and landing cards and the NOTAM list, as the website's sections show
// them, worked out from computeFlight's answer.

/// 'ok' | 'warn' | 'danger' (the website's Chip tones).
enum BriefTone: String, Codable, Sendable {
    case ok, warn, danger
}

struct CoreBrief: Codable, Equatable, Sendable {
    struct Metar: Codable, Equatable, Sendable {
        struct Row: Codable, Equatable, Sendable, Identifiable {
            var icao: String
            /// 'departure' | 'stop' | 'destination' | 'area'
            var role: String
            /// 'Departure', '6 NM from LGTT', '3 NM off route'
            var place: String
            var name: String
            var metar: String?
            var taf: String?
            var observedMs: Double?
            var id: String { icao }

            enum CodingKeys: String, CodingKey {
                case icao, role, name, metar, taf, observedMs
                case place = "where"
            }
        }
        /// From 6 h before take-off until an hour after landing (the website's metarBoxShown).
        var shown: Bool
        var rows: [Row]
    }

    struct Aerodromes: Codable, Equatable, Sendable {
        struct Chip: Codable, Equatable, Sendable {
            var tone: BriefTone
            var text: String
            var detail: String
        }
        struct Day: Codable, Equatable, Sendable {
            var text: String
            var notams: [String]
        }
        struct AdNotam: Codable, Equatable, Sendable {
            var key: String
            var summary: String
            var text: String?
        }
        struct Line: Codable, Equatable, Sendable {
            var label: String
            var text: String
        }
        struct Hours: Codable, Equatable, Sendable {
            /// 'Sun 22 Nov'
            var day: String
            var ad: Day?
            var ats: Day?
            var handling: Day?
            var customs: String?
            var notams: [AdNotam]
            /// 'LGSY AD 2.3'
            var source: String
            /// The AIP text the parser could not represent exactly, as printed.
            var aip: [Line]
            var notes: [String]
        }
        struct Item: Codable, Equatable, Sendable, Identifiable {
            var id: String
            var role: String
            /// 'Departure LGTT'
            var title: String
            var icao: String
            var name: String
            var closed: Bool
            var chip: Chip?
            var when: String?
            var timeNotSet: Bool
            var hours: Hours?
        }
        var closed: Int
        var items: [Item]
    }

    struct Performance: Codable, Equatable, Sendable {
        struct Choice: Codable, Equatable, Sendable, Hashable {
            var value: String
            var label: String
        }
        struct Figure: Codable, Equatable, Sendable {
            var text: String
            var sub: String?
            var tone: BriefTone?
        }
        struct Distance: Codable, Equatable, Sendable, Identifiable {
            var key: String
            var label: String
            var text: String
            var tone: BriefTone?
            var sub: String?
            var id: String { key }
        }
        struct Endpoint: Codable, Equatable, Sendable, Identifiable {
            /// 'takeoff', 'landing', 'stop-takeoff', 'tng-landing'… (the website's test ids)
            var tid: String
            /// 'takeoff' | 'landing'
            var phase: String
            var title: String
            var stopUid: String?
            /// 'stop' | 'touch-and-go' at an intermediate aerodrome
            var stopKind: String?
            var aerodrome: Bool
            var icao: String
            var name: String
            /// 'pass' | 'fail' | 'incomplete'; nil when there is nothing to judge
            var verdict: String?
            /// 'Fits' | 'No-go' | 'Check'
            var verdictLabel: String?
            var verdictText: String
            var reason: String?
            var summary: String
            var time: String?
            var conditions: String?
            var weather: String
            var metar: String?
            var runway: String?
            /// The runway the wind picks when none is chosen.
            var runwayAuto: String?
            var runways: [Choice]
            var surface: String?
            var surfaces: [String]
            var components: Figure?
            var paDa: Figure?
            var mass: Figure?
            var distances: [Distance]
            var noAircraft: Bool
            var id: String { tid + (stopUid ?? "") }
        }
        var has: Bool
        var noGo: Bool
        var endpoints: [Endpoint]
    }

    struct Notams: Codable, Equatable, Sendable {
        struct Item: Codable, Equatable, Sendable, Identifiable {
            var key: String
            var place: String
            /// Only autorouter returned it.
            var autorouter: Bool
            var leg: Int?
            var subject: String
            var validity: String
            var limits: String
            var schedule: String?
            var text: String
            var reasons: [String]
            var relevant: Bool
            var raw: String
            /// It has an area of its own on the map.
            var area: Bool
            var id: String { key }

            enum CodingKeys: String, CodingKey {
                case key, autorouter, leg, subject, validity, limits, schedule, text, reasons, relevant, raw, area
                case place = "where"
            }
        }
        struct Group: Codable, Equatable, Sendable, Identifiable {
            var icao: String?
            var name: String
            var notams: [Item]
            var id: String { icao ?? "airspace" }
        }
        var ok: Bool
        var message: String?
        var meta: String?
        var relevantCount: Int
        var hiddenCount: Int
        var groups: [Group]
    }

    var metar: Metar
    var aerodromes: Aerodromes
    var performance: Performance
    var notams: Notams?
}

extension Core {
    /// `computed`: computeFlight's answer (JSON text); `flight`, `aircraft`, `notams`: JSON texts.
    func brief(
        computed: String, flight: String, aircraft: String?, notams: String?, ref: String?, now: Date? = nil,
        showAll: Bool = false
    ) throws -> CoreBrief {
        var f = [
            "computed": computed, "flight": flight, "aircraft": aircraft ?? "null", "notams": notams ?? "null",
            "showAll": showAll ? "true" : "false",
        ]
        if let now { f["now"] = Core.ms(now) }
        return try callDecoding("brief", ref: ref, fields: f)
    }
}
