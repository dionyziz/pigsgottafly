import Foundation

// The Plan sections' edits beyond one field (src/native/core/planEdits.ts; NATIVE.md "core.js API",
// Plan): choosing the aircraft and typing the fuel on board.

/// The fields of the flight that choosing an aircraft changes.
struct CoreAircraftChoice: Codable, Equatable, Sendable {
    var aircraftId: String?
    var crew: JSON
    var baggageKg: JSON
    var options: JSON
}

/// A fuel edit as the Fuel section makes it (PGF.fuelEdit).
enum CoreFuelOp: Sendable, Equatable {
    /// Litres of one fuel typed (nil: cleared); `fuel`: the aircraft's fuel (JSON text).
    case type(fuel: String, type: String, litres: Double?)
    /// The fuel on board of a single-fuel aircraft (nil: required + reserve).
    case total(Double?)
    /// "Use required + reserve".
    case requiredPlusReserve

    var fields: [String: String] {
        func s(_ v: String) -> String { JSON.string(v).text }
        func n(_ v: Double?) -> String { v.map { JSON.number($0).text } ?? "null" }
        switch self {
        case .type(let fuel, let type, let litres):
            return ["op": s("type"), "fuel": fuel, "type": s(type), "litres": n(litres)]
        case .total(let litres): return ["op": s("total"), "litres": n(litres)]
        case .requiredPlusReserve: return ["op": s("default")]
        }
    }
}

struct CoreFuelEdit: Codable, Equatable, Sendable {
    var fobL: Double?
    var options: JSON
}

extension Core {
    /// `doc`: the flight (JSON text: its aircraftId, crew, baggageKg and options are read);
    /// `aircraft`: the aircraft chosen (JSON text), nil for none.
    func setAircraft(doc: String, aircraft: String?) throws -> CoreAircraftChoice {
        try callDecoding("setAircraft", fields: ["doc": doc, "aircraft": aircraft ?? "null"])
    }

    /// `doc`: the flight (JSON text: its fobL and options are read).
    func fuelEdit(doc: String, _ op: CoreFuelOp) throws -> CoreFuelEdit {
        var f = op.fields
        f["doc"] = doc
        return try callDecoding("fuelEdit", fields: f)
    }
}
