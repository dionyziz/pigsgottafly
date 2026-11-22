import Foundation

// The hangar (src/native/core/hangar.ts; NATIVE.md "core.js API", Hangar): validation, the editors'
// helpers and the version history in words.

/// An issue of the aircraft page's issues bar (src/features/hangar/model.ts Issue).
struct CoreAircraftIssue: Codable, Equatable, Sendable {
    enum Level: String, Codable, Sendable {
        case error, warning
    }
    var level: Level
    var section: String
    /// Dotted path of the field ('fuel.usableL'); '' for the section.
    var path: String
    var message: String
}

struct CoreAircraftValidation: Codable, Equatable, Sendable {
    var issues: [CoreAircraftIssue]
    /// Errors refuse the save.
    var errors: Int
    /// What the navlog, W&B or flight plan need that is not set.
    var missing: [String]
    var at: [CoreAircraftIssue]?
}

struct CoreCardStatus: Codable, Equatable, Sendable {
    /// valid, expiring, expired or unknown
    var state: String
    var days: Int?
}

struct CoreHistoryText: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        var title: String
        var changes: [String]
        var summary: String
    }
    var entries: [Entry]
    var versionChanges: [String]
}

extension Core {
    /// `today`: YYYY-MM-DD (nil: today in Greece); `path`: also that field's issues.
    func validateAircraft(_ aircraft: String, today: String? = nil, path: String? = nil) throws
        -> CoreAircraftValidation
    {
        try callDecoding(
            "validateAircraft",
            fields: [
                "aircraft": aircraft, "today": today.map { JSON.string($0).text } ?? "null",
                "path": path.map { JSON.string($0).text } ?? "null",
            ])
    }

    /// One of the editors' helpers by `op` (NATIVE.md lists them); `fields` are JSON texts.
    func aircraftHelper(_ op: String, _ fields: [String: String] = [:]) throws -> JSON {
        var f = fields
        f["op"] = JSON.string(op).text
        return try callJSON("aircraftHelpers", fields: f)
    }

    func split10a(_ text: String) throws -> [String] {
        (try aircraftHelper("split10a", ["text": JSON.string(text).text])["codes"]?.array ?? []).compactMap(\.string)
    }

    func join10a(_ codes: [String]) throws -> String {
        try aircraftHelper("join10a", ["codes": Core.text(codes)])["text"]?.string ?? ""
    }

    func split10b(_ text: String) throws -> (ssr: String, ads: [String]) {
        let j = try aircraftHelper("split10b", ["text": JSON.string(text).text])
        return (j["ssr"]?.string ?? "", (j["ads"]?.array ?? []).compactMap(\.string))
    }

    func badPbn(_ text: String) throws -> [String] {
        (try aircraftHelper("badPbn", ["text": JSON.string(text).text])["bad"]?.array ?? []).compactMap(\.string)
    }

    /// `card`: a compass card (JSON text).
    func cardStatus(_ card: String, today: String? = nil) throws -> CoreCardStatus {
        var f = ["op": JSON.string("cardStatus").text, "card": card]
        if let today { f["today"] = JSON.string(today).text }
        return try callDecoding("aircraftHelpers", fields: f)
    }

    func deviation(forDeg: Double, steerDeg: Double) throws -> Double {
        try aircraftHelper("deviation", ["forDeg": JSON.number(forDeg).text, "steerDeg": JSON.number(steerDeg).text])[
            "deviationDeg"]?.double ?? 0
    }

    /// `entries`: GET /api/aircraft/:id/log or /revisions entries (JSON text); `myId`: the session pilot's id.
    func historyText(entries: String?, myId: String, versionChanges: String? = nil) throws -> CoreHistoryText {
        try callDecoding(
            "historyText",
            fields: [
                "entries": entries ?? "null", "myId": JSON.string(myId).text,
                "versionChanges": versionChanges ?? "null",
            ])
    }
}
