import Foundation

// Flight-plan filing (src/native/core/filing.ts; NATIVE.md "core.js API", File & forms): the website's
// Filing panel as a view model, so what may be filed, delayed or cancelled, and how it reads, is the
// website's.

/// What the pilot changed on the screen (src/features/exports/fpl/filing.ts FilingChoices).
struct FilingChoices: Codable, Equatable, Sendable {
    var excluded: [String] = []
    var extra: [String] = []
    var noCopy: [String] = []
    /// "" tries the backends in order, falling back to the next.
    var via = ""
}

struct CoreFilingView: Codable, Equatable, Sendable {
    struct Status: Codable, Equatable, Sendable {
        var label: String
        /// "ok", "danger" or nil.
        var tone: String?
    }
    struct Record: Codable, Equatable, Sendable {
        var via: String
        var filed: Double?
        var polled: Double?
        var message: String
    }
    struct Option: Codable, Equatable, Sendable {
        var id: String
        var label: String
    }
    struct Addressee: Codable, Equatable, Sendable {
        var address: String
        var reasons: String
        var on: Bool
        var byHand: Bool
    }
    struct Copy: Codable, Equatable, Sendable {
        var email: String
        var `for`: String
        var on: Bool
    }
    struct FileAction: Codable, Equatable, Sendable {
        var shown: Bool
        var label: String
        var enabled: Bool
        var hint: String?
    }
    struct Action: Codable, Equatable, Sendable {
        var shown: Bool?
        var enabled: Bool
    }
    struct Head: Codable, Equatable, Sendable {
        var ident: String
        var adep: String
        var eobt: String
        var ades: String
        var dof: String
        var route: String
    }
    struct LogLine: Codable, Equatable, Sendable {
        var id: String
        var at: Double
        var ok: Bool
        var line: String
    }
    struct FilingRef: Codable, Equatable, Sendable {
        var provider: String
        var providerLabel: String?
        var status: String
        var eobt: Double?
        var fpl: String
    }

    var filing: FilingRef?
    var open: Bool
    var enabled: Bool
    var status: Status
    var disabledReason: String?
    var connect: String?
    var connectOnly: Bool
    var connectLabel: String?
    var viaChoice: [Option]?
    var viaLine: String?
    var chosen: String
    /// Who a new plan goes to: the backend, or the ones tried in turn.
    var sendsVia: String
    var record: Record?
    var addressees: [Addressee]
    var addresses: [String]
    var copies: [Copy]
    var copyTo: [String]
    var file: FileAction
    var cancel: Action
    var delay: Action
    var refresh: Action
    /// A fax on its way: its delivery is asked again until it settles.
    var sending: Bool
    var log: [LogLine]
    /// The body of POST /api/flights/:id/filing (with a message).
    var request: JSON?
    var head: Head?
    /// The CNL a faxed plan's cancellation carries.
    var cancelMessage: String?
    var typedAddress: String?
}

struct CoreFilingDelay: Codable, Equatable, Sendable {
    /// Why the delay cannot be sent; nil when it can.
    var problem: String?
    /// The DLA a faxed plan's delay carries.
    var message: String?
}

extension Core {
    /// `state`: GET /api/flights/:id/filing's text; `message`: PGF.fplMessage's AFTN text.
    func filingView(
        state: String?, choices: FilingChoices = .init(), message: String? = nil, complete: Bool = true,
        busy: Bool = false, typed: String? = nil
    ) throws -> CoreFilingView {
        try callDecoding(
            "filingView",
            fields: [
                "state": state ?? "null", "choices": Core.text(choices),
                "message": message.map { JSON.string($0).text } ?? "null", "complete": complete ? "true" : "false",
                "busy": busy ? "true" : "false", "typed": typed.map { JSON.string($0).text } ?? "null",
            ])
    }

    /// A delay of the filed plan to `eobt`.
    func filingDelay(state: String?, eobt: Date, now: Date? = nil) throws -> CoreFilingDelay {
        var fields = ["state": state ?? "null", "eobt": Core.ms(eobt)]
        if let now { fields["now"] = Core.ms(now) }
        return try callDecoding("filingDelay", fields: fields)
    }

    /// How a refused filing action reads (`load`: a failed load of the filing state).
    func filingError(offline: Bool, message: String?, load: Bool = false) throws -> String {
        let j = try callJSON(
            "filingError",
            fields: [
                "offline": offline ? "true" : "false", "message": message.map { JSON.string($0).text } ?? "null",
                "load": load ? "true" : "false",
            ])
        return j["text"]?.string ?? ""
    }
}
