import Foundation

/// File & forms: flight-plan filing, Form 731 and the GenDec, the W&B and performance declarations, the
/// navlog e-mail (api/_lib/routes/{filing,forms,declarations,navlogMail}.ts). Every call answers the
/// whole new state of its form, so a screen replaces what it shows with the answer.
extension API {
    // MARK: filing (503: filing is not enabled on the server)

    func filing(_ id: String) async throws -> Data { try await get("flights/\(seg(id))/filing") }

    /// src/shared/briefing.ts FilerId.
    enum Filer: String, Encodable, Sendable {
        case autorouter, fax
    }

    /// src/shared/briefing.ts FileRequest.
    struct FileRequest: Encodable, Sendable {
        /// The ICAO 2012 FPL message, '(FPL-…)' (PGF.fplMessage).
        var fpl: String
        /// The reviewed AFTN addressees (8 letters each).
        var addresses: [String]
        /// Epoch ms; nil: the flight's date and block-off.
        var eobt: Double?
        /// nil: every copy FilingState offers.
        var copyTo: [String]?
        /// nil: the first filer available, falling back to the next.
        var via: Filer?
    }

    func fileFlightPlan(_ id: String, _ req: FileRequest) async throws -> FilingState {
        try await call("POST", "flights/\(seg(id))/filing", body: req, as: FilingState.self)
    }

    /// `eobt`: epoch ms.
    func delayFlightPlan(_ id: String, eobt: Double) async throws -> FilingState {
        try await call(
            "POST", "flights/\(seg(id))/filing/delay", body: ["eobt": JSON.number(eobt)] as JSON, as: FilingState.self)
    }

    func cancelFlightPlan(_ id: String, reason: String? = nil, copyTo: [String]? = nil) async throws -> FilingState {
        var body: [String: JSON] = [:]
        if let reason { body["reason"] = .string(reason) }
        if let copyTo { body["copyTo"] = .array(copyTo.map(JSON.string)) }
        return try await call("POST", "flights/\(seg(id))/filing/cancel", body: JSON.object(body), as: FilingState.self)
    }

    func refreshFlightPlan(_ id: String) async throws -> FilingState {
        try await call("POST", "flights/\(seg(id))/filing/refresh", as: FilingState.self)
    }

    // MARK: Form 731 and GenDec (FormsState)

    func forms(_ id: String) async throws -> Data { try await get("flights/\(seg(id))/forms") }

    func request731Links<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/731/links", as: type)
    }

    func renew731Link<T: Decodable>(_ id: String, key: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/731/links/\(seg(key))/renew", as: type)
    }

    func revoke731Link<T: Decodable>(_ id: String, key: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/731/links/\(seg(key))/revoke", as: type)
    }

    /// E-mails Form 731 to HCAA.
    func send731<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/731/send", as: type)
    }

    /// E-mails that passenger the form and a new signing link.
    func email731<T: Decodable>(_ id: String, key: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/731/email/\(seg(key))", as: type)
    }

    func sendGenDec<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("POST", "flights/\(seg(id))/forms/gendec/send", as: type)
    }

    /// Who sends the GenDec: true a handler, false the PIC, nil automatic (the AIP and the NOTAMs).
    func setGenDecHandled<T: Decodable>(_ id: String, handled: Bool?, as type: T.Type = JSON.self) async throws -> T {
        try await call(
            "POST", "flights/\(seg(id))/forms/gendec/handled",
            body: ["handled": handled.map(JSON.bool) ?? .null] as JSON,
            as: type)
    }

    // MARK: declarations (W&B and performance to the operator)

    func declarations(_ id: String) async throws -> Data { try await get("flights/\(seg(id))/declarations") }

    private struct DeclarationBody<C: Encodable & Sendable>: Encodable, Sendable {
        var content: C
        var resend: Bool
    }

    /// `content`: PGF.wbPerfContent's (CoreWbPerfContent) → DeclarationsState.
    func sendDeclarations<C: Encodable & Sendable, T: Decodable>(
        _ id: String, content: C, resend: Bool, as type: T.Type = JSON.self
    ) async throws -> T {
        try await call(
            "POST", "flights/\(seg(id))/declarations/send", body: DeclarationBody(content: content, resend: resend),
            as: type)
    }

    // MARK: the navlog e-mailed to the pilot

    private struct NavlogBody<C: Encodable & Sendable>: Encodable, Sendable {
        var content: C
    }

    func navlogMail<T: Decodable>(_ id: String, as type: T.Type = JSON.self) async throws -> T {
        try await call("GET", "flights/\(seg(id))/exports/navlog/email", as: type)
    }

    /// `content`: PGF.navlogContent's (CoreNavlogContent) → NavlogMailState.
    func sendNavlogMail<C: Encodable & Sendable, T: Decodable>(_ id: String, content: C, as type: T.Type = JSON.self)
        async throws -> T
    {
        try await call("POST", "flights/\(seg(id))/exports/navlog/email", body: NavlogBody(content: content), as: type)
    }
}
