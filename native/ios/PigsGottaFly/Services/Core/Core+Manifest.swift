import Foundation

// The manifest, the W&B chart and the share suggestions (src/native/core/manifest.ts; NATIVE.md
// "core.js API", Manifest).

/// One change of the manifest as the website's Manifest section makes it (PGF.manifest).
enum CoreManifestOp: Sendable {
    case seats
    case addPassenger(JSON)
    /// The PIC back in front left (GET /api/me).
    case addPic(pilot: JSON)
    case changeSeat(index: Int, seat: String)
    case remove(index: Int)
    case editField(index: Int, key: String, value: JSON)
    case apply(index: Int, person: JSON)
    case reset(index: Int, person: JSON)
    /// `before`/`now`: { "PIC" | passengerId: person }.
    case sync(before: JSON?, now: JSON)

    var fields: [String: String] {
        func s(_ v: String) -> String { JSON.string(v).text }
        switch self {
        case .seats: return ["op": s("seats")]
        case .addPassenger(let p): return ["op": s("addPassenger"), "passenger": p.text]
        case .addPic(let p): return ["op": s("addPic"), "pilot": p.text]
        case .changeSeat(let i, let seat): return ["op": s("changeSeat"), "index": String(i), "seat": s(seat)]
        case .remove(let i): return ["op": s("remove"), "index": String(i)]
        case .editField(let i, let k, let v):
            return ["op": s("editField"), "index": String(i), "key": s(k), "value": v.text]
        case .apply(let i, let p): return ["op": s("apply"), "index": String(i), "person": p.text]
        case .reset(let i, let p): return ["op": s("reset"), "index": String(i), "person": p.text]
        case .sync(let before, let now): return ["op": s("sync"), "before": before?.text ?? "null", "now": now.text]
        }
    }
}

struct CoreManifest: Codable, Equatable, Sendable {
    struct Seat: Codable, Equatable, Sendable, Identifiable {
        var id: String
        var label: String
    }
    /// The crew after the change (the flight's `crew`).
    var crew: JSON
    /// False when the change could not be made (every seat taken).
    var ok: Bool
    /// Who moved to free the PIC seat.
    var moved: JSON?
    var seats: [Seat]
    var full: Bool
    var picSeat: String
    /// validateCrew: the manifest's problems.
    var errors: [String]
}

/// The MD 4.3 chart (moment vs mass) of an aircraft's envelopes and the flight's points.
struct CoreWbChart: Codable, Equatable, Sendable {
    struct Envelope: Codable, Equatable, Sendable {
        var category: String
        var label: String
        var maxKg: Double
        /// [moment kg·m, mass kg]
        var outline: [[Double]]
        var cgOutline: [[Double]]?
    }
    struct Domain: Codable, Equatable, Sendable {
        var x0: Double
        var x1: Double
        var y0: Double
        var y1: Double
        var xTicks: [Double]
        var yTicks: [Double]
    }
    struct Point: Codable, Equatable, Sendable {
        var massKg: Double
        var momentKgM: Double
    }
    var envelopes: [Envelope]
    var domain: Domain
}

struct CoreMomentEnvelope: Codable, Equatable, Sendable {
    /// As the hangar stores it (rounded).
    var moment: [[Double]]
    /// As the chart draws it.
    var outline: [[Double]]
}

struct CoreShareSuggestions: Codable, Equatable, Sendable {
    struct Contact: Codable, Equatable, Sendable {
        var name: String
        var email: String
    }
    var contacts: [Contact]
    var suggestions: [Contact]
}

extension Core {
    /// `crew`: the flight's crew (JSON text); `stations`: the aircraft's massBalance.stations, or nil without one.
    func manifest(crew: String, stations: String?, _ op: CoreManifestOp) throws -> CoreManifest {
        var f = op.fields
        f["crew"] = crew
        f["stations"] = stations ?? "null"
        return try callDecoding("manifest", fields: f)
    }

    /// `massBalance`: the aircraft's (JSON text); `points`: e.g. computeFlight's wb take-off and landing.
    func wbChart(massBalance: String, points: [CoreWbChart.Point] = []) throws -> CoreWbChart {
        try callDecoding("wbChart", fields: ["massBalance": massBalance, "points": Core.text(points)])
    }

    /// A CG envelope [[arm m, mass kg]] in moment space.
    func cgToMoment(polygon: [[Double]]) throws -> CoreMomentEnvelope {
        try callDecoding("cgToMoment", fields: ["polygon": Core.text(polygon)])
    }

    /// `people`: GET /api/flights/:id/shares' people (JSON text), or nil.
    func shareSuggestions(crew: String, passengers: String, people: String?) throws -> CoreShareSuggestions {
        try callDecoding(
            "shareSuggestions", fields: ["crew": crew, "passengers": passengers, "people": people ?? "null"])
    }
}
