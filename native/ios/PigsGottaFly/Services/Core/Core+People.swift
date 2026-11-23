import Foundation

// People and typed input (src/native/core/people.ts; NATIVE.md "core.js API", People).

struct CorePersonIssues: Codable, Equatable, Sendable {
    struct Issue: Codable, Equatable, Sendable {
        var field: String
        var message: String
    }
    /// The form as checked (a saved record becomes the form the dialog opens with).
    var form: JSON
    var issues: [Issue]
    /// What the forms and W&B still lack, with the field that takes it (the passenger list's "Missing …").
    struct Missing: Codable, Equatable, Sendable {
        var field: String
        var label: String
    }
    /// The body of POST/PUT /api/passengers; nil while there are issues.
    var input: JSON?
    var missing: [Missing]
}

struct CoreCoords: Codable, Equatable, Sendable {
    struct LatLon: Codable, Equatable, Sendable {
        var lat: Double
        var lon: Double
    }
    var latLon: LatLon?
    var dms: String?
    var icao: String?
    var name: String?
}

struct CoreTypedDate: Codable, Equatable, Sendable {
    /// YYYY-MM-DD, '' when empty, nil when not a date.
    var value: String?
    var problem: String?
    /// As typed so far, with the dashes put in.
    var masked: String
}

extension Core {
    /// The passenger form's issues (`pilot`: the profile's). `form` is the form as typed (JSON text), or
    /// `person` a saved record.
    func personIssues(form: String? = nil, person: String? = nil, pilot: Bool = false, today: String? = nil) throws
        -> CorePersonIssues
    {
        try callDecoding(
            "personIssues",
            fields: [
                "form": form ?? "null", "person": person ?? "null", "pilot": pilot ? "true" : "false",
                "today": today.map { JSON.string($0).text } ?? "null",
            ])
    }

    /// A typed position (and a waypoint name as saved).
    func parseCoords(_ text: String?, name: String? = nil) throws -> CoreCoords {
        try callDecoding(
            "parseCoords",
            fields: [
                "text": text.map { JSON.string($0).text } ?? "null",
                "name": name.map { JSON.string($0).text } ?? "null",
            ])
    }

    private func typed(_ kind: String, _ text: String, _ extra: [String: String] = [:]) throws -> JSON {
        var f = extra
        f["kind"] = JSON.string(kind).text
        f["text"] = JSON.string(text).text
        return try callJSON("parseTyped", fields: f)
    }

    /// HH:MM, or nil.
    func parseTime(_ text: String) throws -> String? {
        try typed("time", text)["value"]?.string
    }

    /// Minutes, or nil.
    func parseDuration(_ text: String) throws -> Int? {
        try typed("duration", text)["value"]?.int
    }

    func parseDate(_ text: String, min: String? = nil, max: String? = nil) throws -> CoreTypedDate {
        var f = ["kind": JSON.string("date").text, "text": JSON.string(text).text]
        if let min { f["min"] = JSON.string(min).text }
        if let max { f["max"] = JSON.string(max).text }
        return try callDecoding("parseTyped", fields: f)
    }

    /// The 15-minute slot nearest a typed time.
    func nearestSlot(_ text: String) throws -> String? {
        try typed("slot", text)["value"]?.string
    }

    /// A route point name as the map takes it ('' when invalid).
    func routePointName(_ text: String) throws -> String {
        try typed("routePoint", text)["value"]?.string ?? ""
    }
}
