import CryptoKit
import Foundation

// File & forms (src/native/core/exports.ts; NATIVE.md "core.js API", File & forms): the documents as
// the website's export pages build them. The sheet models stay JSON (the PDF renderer takes them as
// they are); what the screens show and send is typed.

struct CoreFplMessage: Codable, Equatable, Sendable {
    struct Fpl: Codable, Equatable, Sendable {
        var fields: JSON
        /// The AFTN text POST /api/flights/:id/filing takes.
        var message: String
        var lines: [String]
        var complete: Bool
        var warnings: [String]
        var fixes: JSON
    }
    struct Warning: Codable, Equatable, Sendable {
        var text: String
        var fix: JSON?
    }
    var fpl: Fpl
    var oneLine: String
    /// The FPL page's list: the aircraft first, then the message's.
    var warnings: [Warning]
}

struct CoreNavlogContent: Codable, Equatable, Sendable {
    /// { sheets, terminal, warnings, sources }
    var document: JSON
    /// The body of POST /api/flights/:id/exports/navlog/email.
    var content: JSON
}

struct CoreWbPerfContent: Codable, Equatable, Sendable {
    var wb: JSON
    var perf: JSON
    /// The body of POST /api/flights/:id/declarations/send.
    var content: JSON
    var warnings: [String]
    /// What the server hashes to tell the sheets changed since they were sent.
    var text: String

    /// The hash the server keeps of the sent sheets (SHA-256, base64url, as sha256Url on the website).
    var hash: String {
        Data(SHA256.hash(data: Data(text.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum CoreForm: String, Sendable {
    case form731 = "731"
    case gendec
}

extension Core {
    private func flightFields(
        flight: String, aircraft: String?, pilot: String?, weather: String, now: Date?
    ) -> [String: String] {
        var f = ["flight": flight, "aircraft": aircraft ?? "null", "pilot": pilot ?? "null", "weather": weather]
        if let now { f["now"] = Core.ms(now) }
        return f
    }

    /// As computeFlight takes them: `weather` is { path: answer } for weatherRequests' paths.
    func fplMessage(
        flight: String, aircraft: String?, pilot: String?, ref: String?, weather: String, now: Date? = nil
    ) throws -> CoreFplMessage {
        try callDecoding(
            "fplMessage", ref: ref,
            fields: flightFields(flight: flight, aircraft: aircraft, pilot: pilot, weather: weather, now: now))
    }

    func navlogContent(
        flight: String, aircraft: String?, pilot: String?, ref: String?, weather: String, now: Date? = nil
    ) throws -> CoreNavlogContent {
        try callDecoding(
            "navlogContent", ref: ref,
            fields: flightFields(flight: flight, aircraft: aircraft, pilot: pilot, weather: weather, now: now))
    }

    func wbPerfContent(
        flight: String, aircraft: String?, pilot: String?, ref: String?, weather: String, now: Date? = nil
    ) throws -> CoreWbPerfContent {
        try callDecoding(
            "wbPerfContent", ref: ref,
            fields: flightFields(flight: flight, aircraft: aircraft, pilot: pilot, weather: weather, now: now))
    }

    /// Form 731 or the General Declaration, with `warnings` and their `fixes`. `pilot`: GET /api/me;
    /// `passengers`: GET /api/passengers.
    func formModel(
        _ kind: CoreForm, flight: String, aircraft: String?, pilot: String, passengers: String?, ref: String?
    ) throws -> JSON {
        try callWithRef(
            "formModel", ref: ref,
            fields: [
                "kind": JSON.string(kind.rawValue).text, "flight": flight, "aircraft": aircraft ?? "null",
                "pilot": pilot, "passengers": passengers ?? "null",
            ])
    }

    /// The NOTAM briefing laid out for print.
    func briefingModel(flight: String, briefing: String?) throws -> JSON {
        try callJSON("briefingModel", fields: ["flight": flight, "briefing": briefing ?? "null"])
    }
}
