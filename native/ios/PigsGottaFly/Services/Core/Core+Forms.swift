import Foundation

// File & forms panels (src/native/core/forms.ts; NATIVE.md "core.js API", File & forms): what the
// Form 731, General Declaration and operator screens show and offer, decided as on the website.

/// A button the panel offers: its title, and whether it can be pressed now (`hint`: why not).
struct CoreFormButton: Codable, Equatable, Sendable {
    var label: String
    var enabled: Bool
    var hint: String?
}

struct CoreShownSignature: Codable, Equatable, Sendable {
    var name: String
    var signedAt: Double
}

struct CoreForm731Panel: Codable, Equatable, Sendable {
    struct Person: Codable, Equatable, Sendable, Identifiable {
        struct Actions: Codable, Equatable, Sendable {
            var renew: Bool
            var revoke: Bool
            var email: Bool
            var addEmail: Bool
        }
        struct Link: Codable, Equatable, Sendable {
            var url: String
            /// What goes with the link when shared.
            var text: String
        }
        var key: String
        var role: String
        var name: String
        var signed: Bool
        var needsResign: Bool
        /// "signed 2026-11-22 10:40", "link opened …, not signed", "no link"
        var status: String
        var email: String
        /// "e-mailed 2026-11-22 10:40"
        var emailed: String?
        var actions: Actions
        /// The website's page where the address is added.
        var addEmailPath: String
        /// A link made in this session (a token is answered once).
        var link: Link?

        var id: String { key }
    }
    struct Toggle: Codable, Equatable, Sendable {
        var shown: Bool
        var enabled: Bool
    }
    struct EmailAll: Codable, Equatable, Sendable {
        var shown: Bool
        var enabled: Bool
        var keys: [String]
        var hint: String?
    }
    var needed: Bool
    var allSigned: Bool
    /// "1 of 2 signed · Anna has not opened the link"
    var summary: String
    var tone: String
    /// The signatures drawn on the sheet, by person key.
    var signatures: [String: CoreShownSignature]
    var people: [Person]
    var request: Toggle
    var emailAll: EmailAll
    var send: CoreFormButton
    var sent: String?
    var note: String?
    var emailEnabled: Bool
}

struct CoreGenDecPanel: Codable, Equatable, Sendable {
    struct End: Codable, Equatable, Sendable, Identifiable {
        var role: String
        var label: String
        var reason: String
        var handled: Bool
        var id: String { role }
    }
    var status: String
    var tone: String
    /// Only when the PIC sends it.
    var send: CoreFormButton?
    var sent: String?
    var note: String?
    var ends: [End]
    /// "Submitted by a handler", as decided now.
    var handled: Bool
    /// "Automatic: you send it" while the flight overrides the decision.
    var automatic: String?
    var signature: CoreShownSignature?
    var pilotSends: Bool
    /// What POST /forms/gendec/handled takes for the `handled` asked about.
    var override: Bool?
}

struct CoreOperatorPanel: Codable, Equatable, Sendable {
    struct Send: Codable, Equatable, Sendable {
        var label: String
        var enabled: Bool
        var hint: String?
        var resend: Bool
    }
    var title: String
    var status: String
    var tone: String
    var changed: Bool
    var send: Send
    /// nil: the operator has no address yet (`addressPath` on the website sets it).
    var address: String?
    var addressPath: String
    var sent: String?
    var note: String?
}

extension Core {
    /// `forms`: GET /api/flights/:id/forms (JSON text); `links`: the signing links made in this session.
    func form731Panel(forms: String, links: [String: String], now: Date? = nil) throws -> CoreForm731Panel {
        var f = ["forms": forms, "links": Core.text(links), "origin": JSON.string(API.site.absoluteString).text]
        if let now { f["now"] = Core.ms(now) }
        return try callDecoding("form731Panel", fields: f)
    }

    /// `handled`: "Submitted by a handler" set to it (the answer's `override` is what to save).
    func genDecPanel(forms: String, handled: Bool? = nil) throws -> CoreGenDecPanel {
        try callDecoding(
            "genDecPanel", fields: ["forms": forms, "handled": handled.map { $0 ? "true" : "false" } ?? "null"])
    }

    /// nil when the operator does not ask for the sheets. `hash`: CoreWbPerfContent.hash of the sheets
    /// shown; `ready`: they are made.
    func operatorPanel(declarations: String?, hash: String?, ready: Bool) throws -> CoreOperatorPanel? {
        let text = try call(
            "operatorPanel",
            fields: [
                "declarations": declarations ?? "null", "hash": hash.map { JSON.string($0).text } ?? "null",
                "ready": ready ? "true" : "false",
            ])
        return text == "null" ? nil : try decode("operatorPanel", text, as: CoreOperatorPanel.self)
    }

    /// What the server hashes of the sheets POST /declarations/send takes (`content`: JSON text).
    func declarationText(content: String) throws -> String {
        try callJSON("declarationText", fields: ["content": content])["text"]?.string ?? ""
    }
}
