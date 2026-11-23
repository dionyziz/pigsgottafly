import Foundation

/// A flight's Form 731 and General Declaration (GET /api/flights/:id/forms) and its W&B and
/// performance declarations (GET /declarations), as the website's panels hold them: the saved copy
/// at once, then the server's. Every action answers the whole new state, which replaces the old one,
/// is saved for offline, and the File & forms rows follow (FlightModel.computePaperwork).
@MainActor
final class FormsModel: ObservableObject {
    let flight: FlightModel

    /// FormsState.
    @Published private(set) var forms: JSON?
    /// DeclarationsState.
    @Published private(set) var declarations: JSON?
    /// GET /api/passengers (JSON text): details the manifest's snapshots lack, as the forms pages use.
    @Published private(set) var passengers: String?
    /// The signing links made here, by person key: the server answers a token only to the request
    /// that made it, so they are not saved.
    @Published private(set) var links: [String: String] = [:]
    /// The action under way: "links", "email-all", "send", "handled", "operator", "renew-<key>", …
    @Published private(set) var busy: String?
    @Published var error: String?

    init(flight: FlightModel) {
        self.flight = flight
    }

    private var app: AppModel { flight.app }
    private var id: String { flight.id }

    // MARK: reading

    func load() async {
        forms = app.store.read(.forms(id)).flatMap { try? JSON.parse($0) }
        declarations = app.store.read(.declarations(id)).flatMap { try? JSON.parse($0) }
        do {
            await setForms(try JSON.parse(try await app.api.forms(id)))
            error = nil
        } catch {
            // the saved copy stays on screen; with none, say why there is nothing
            if forms == nil { self.error = Self.errText(error) }
        }
        if let d = try? await app.api.declarations(id), let j = try? JSON.parse(d) { await setDeclarations(j) }
        if let p = try? await app.api.passengers(as: JSON.self) { passengers = p.text }
    }

    // MARK: Form 731

    func requestLinks() async {
        await run("links") { api, id in try await api.request731Links(id) }
    }

    func renew(_ key: String) async {
        await run("renew-\(key)") { api, id in try await api.renew731Link(id, key: key) }
    }

    func revoke(_ key: String) async {
        await run("revoke-\(key)") { api, id in try await api.revoke731Link(id, key: key) }
    }

    /// The server e-mails them the form and a new signing link.
    func email(_ key: String) async {
        await run("email-\(key)") { api, id in try await api.email731(id, key: key) }
    }

    /// One e-mail after the other, as the website's "E-mail all": a failure stops the rest.
    func emailAll(_ keys: [String]) async {
        await run("email-all", keys.map { key in { api, id in try await api.email731(id, key: key) } })
    }

    func send731() async {
        await run("send") { api, id in try await api.send731(id) }
    }

    // MARK: General Declaration

    func sendGenDec() async {
        await run("send-gendec") { api, id in try await api.sendGenDec(id) }
    }

    /// `handled`: PGF.genDecPanel's `override` (nil: automatic). The server keeps it on the flight and
    /// bumps its version, so the flight is read again.
    func setHandled(_ handled: Bool?) async {
        await run("handled") { api, id in try await api.setGenDecHandled(id, handled: handled) }
        await flight.refresh()
    }

    // MARK: the operator

    /// `content`: PGF.wbPerfContent's.
    func sendDeclarations(content: JSON, resend: Bool) async {
        busy = "operator"
        error = nil
        defer { busy = nil }
        do {
            await setDeclarations(try await app.api.sendDeclarations(id, content: content, resend: resend))
        } catch {
            self.error = Self.errText(error)
        }
    }

    // MARK: plumbing

    typealias Step = @MainActor (API, String) async throws -> JSON

    private func run(_ what: String, _ step: @escaping Step) async {
        await run(what, [step])
    }

    private func run(_ what: String, _ steps: [Step]) async {
        busy = what
        error = nil
        defer { busy = nil }
        do {
            for step in steps {
                var s = try await step(app.api, id)
                for (k, v) in s["links"]?.object ?? [:] {
                    if let token = v.string { links[k] = token }
                }
                s["links"] = nil
                await setForms(s)
            }
        } catch APIError.unauthorized {
            app.session.lost()
        } catch {
            self.error = Self.errText(error)
        }
    }

    private func setForms(_ s: JSON) async {
        forms = s
        if let d = try? s.data() { try? app.store.write(d, .forms(id)) }
        await flight.computePaperwork()
    }

    private func setDeclarations(_ s: JSON) async {
        declarations = s
        if let d = try? s.data() { try? app.store.write(d, .declarations(id)) }
        await flight.computePaperwork()
    }

    /// The server's own words where it gives them (a 409: not everyone has signed, already sent).
    nonisolated static func errText(_ e: Error) -> String {
        switch e {
        case APIError.offline: return "Offline: try again when connected."
        case APIError.conflict(let body):
            return (try? JSON.parse(body))?["error"]?.string ?? "The request failed."
        default: return e.localizedDescription
        }
    }
}
