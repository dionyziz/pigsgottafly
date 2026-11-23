import Foundation

/// Form 731, the General Declaration and the operator's W&B and performance sheets as the server keeps
/// them (api/_lib/routes/forms.ts, declarations.ts), in memory: signing links, passengers signing,
/// sending to the HCAA and to the operator. Nothing is e-mailed. A flight's states start from
/// forms-<id>.json and declarations-<id>.json (else forms.json and declarations.json).
struct PaperworkFixtures {
    var forms: [String: JSON] = [:]
    var declarations: [String: JSON] = [:]
    /// The passengers given a link who have not signed yet, by flight: they sign before the next read,
    /// as if they had opened the link meanwhile.
    var signing: [String: Set<String>] = [:]
    var tokens = 0
    /// The sent sheets are hashed as the server hashes them (PGF.declarationText).
    var core: Core?
}

extension FixtureTransport {
    func paperworkRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard r.first == "flights", r.count >= 3, ["forms", "declarations"].contains(r.parts[2]) else { return nil }
        let id = r.parts[1]
        let rest = Array(r.parts[3...])
        switch (r.method, r.parts[2], rest) {
        case ("GET", "forms", []):
            signPending(id)
            return answer(formsState(id))
        case ("POST", "forms", ["731", "links"]):
            return createLinks(id)
        case ("POST", "forms", let p) where p.count == 4 && p[0] == "731" && p[1] == "links" && p[3] == "renew":
            return renewLink(id, key: p[2])
        case ("POST", "forms", let p) where p.count == 4 && p[0] == "731" && p[1] == "links" && p[3] == "revoke":
            return revokeLink(id, key: p[2])
        case ("POST", "forms", let p) where p.count == 3 && p[0] == "731" && p[1] == "email":
            return emailPassenger(id, key: p[2])
        case ("POST", "forms", ["731", "send"]):
            return send731(id, body: r.body)
        case ("POST", "forms", ["gendec", "send"]):
            return sendGenDec(id, body: r.body)
        case ("POST", "forms", ["gendec", "handled"]):
            return setHandled(id, body: r.body)
        case ("GET", "declarations", []):
            return answer(declarationsState(id))
        case ("POST", "declarations", ["send"]):
            return sendDeclarations(id, body: r.body)
        default:
            return nil
        }
    }

    private var nowMs: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    private func answer(_ j: JSON) -> (Int, String?, Data?) { (200, nil, Self.encoded(j)) }

    private func conflict(_ message: String) -> (Int, String?, Data?) {
        (409, nil, try? JSON.object(["error": .string(message)]).data())
    }

    private func resend(_ body: Data?) -> Bool {
        body.flatMap { try? JSON.parse($0) }?["resend"]?.bool == true
    }

    // MARK: Form 731

    func formsState(_ id: String) -> JSON {
        if let s = paperwork.forms[id] { return s }
        let s = (fixture("forms-\(id).json") ?? fixture("forms.json")).flatMap { try? JSON.parse($0) } ?? [:]
        paperwork.forms[id] = s
        return s
    }

    private func setForms(_ id: String, _ s: JSON) {
        var s = s
        let sigs = s["form731"]?["signatures"]?.array ?? []
        s["form731"]?["allSigned"] = .bool(sigs.allSatisfy { $0["signed"]?.bool == true })
        paperwork.forms[id] = s
    }

    /// Changes one person's row (nil: no such person on the form).
    private func updatePerson(_ id: String, key: String, _ change: (inout JSON) -> Void) -> Bool {
        var s = formsState(id)
        var sigs = s["form731"]?["signatures"]?.array ?? []
        guard let i = sigs.firstIndex(where: { $0["key"]?.string == key }) else { return false }
        change(&sigs[i])
        s["form731"]?["signatures"] = .array(sigs)
        setForms(id, s)
        return true
    }

    private func newLink(_ id: String, key: String) -> String {
        paperwork.tokens += 1
        let token = "fixture-token-\(paperwork.tokens)"
        let now = nowMs
        _ = updatePerson(id, key: key) { p in
            p["link"] = [
                "created": .number(now), "firstOpened": nil, "lastOpened": nil, "revoked": false,
                "expires": .number(now + 2 * 86_400_000),
            ]
        }
        paperwork.signing[id, default: []].insert(key)
        return token
    }

    private func withLinks(_ id: String, _ links: [String: String]) -> (Int, String?, Data?) {
        var s = formsState(id)
        s["links"] = .object(links.mapValues(JSON.string))
        return answer(s)
    }

    private func createLinks(_ id: String) -> (Int, String?, Data?) {
        let now = nowMs
        let need = (formsState(id)["form731"]?["signatures"]?.array ?? []).filter { p in
            guard p["role"]?.string == "PAX", p["signed"]?.bool != true else { return false }
            let l = p["link"]
            return l == nil || l == .null || l?["revoked"]?.bool == true || (l?["expires"]?.double ?? 0) < now
        }
        var links: [String: String] = [:]
        for p in need {
            if let key = p["key"]?.string { links[key] = newLink(id, key: key) }
        }
        return withLinks(id, links)
    }

    private func renewLink(_ id: String, key: String) -> (Int, String?, Data?) {
        guard hasPassenger(id, key) else { return (404, nil, nil) }
        return withLinks(id, [key: newLink(id, key: key)])
    }

    private func revokeLink(_ id: String, key: String) -> (Int, String?, Data?) {
        _ = updatePerson(id, key: key) { p in p["link"]?["revoked"] = true }
        paperwork.signing[id]?.remove(key)
        return answer(formsState(id))
    }

    /// The form and a new link go to the passenger's address; the token is in the e-mail only.
    private func emailPassenger(_ id: String, key: String) -> (Int, String?, Data?) {
        let person = (formsState(id)["form731"]?["signatures"]?.array ?? []).first { $0["key"]?.string == key }
        guard let person else { return (404, nil, nil) }
        guard let email = person["email"]?.string, !email.isEmpty else {
            return conflict("\(person["name"]?.string ?? "This passenger") has no e-mail address")
        }
        _ = newLink(id, key: key)
        let now = nowMs
        _ = updatePerson(id, key: key) { p in p["emailedAt"] = .number(now) }
        return answer(formsState(id))
    }

    private func hasPassenger(_ id: String, _ key: String) -> Bool {
        (formsState(id)["form731"]?["signatures"]?.array ?? []).contains {
            $0["key"]?.string == key && $0["role"]?.string == "PAX"
        }
    }

    /// The passengers whose link was given sign (the link opened, then signed).
    private func signPending(_ id: String) {
        guard let keys = paperwork.signing[id], !keys.isEmpty else { return }
        let now = nowMs
        for key in keys {
            _ = updatePerson(id, key: key) { p in
                p["signed"] = true
                p["signedAt"] = .number(now)
                p["needsResign"] = false
                p["link"]?["firstOpened"] = .number(now)
                p["link"]?["lastOpened"] = .number(now)
            }
        }
        paperwork.signing[id] = []
    }

    private func send731(_ id: String, body: Data?) -> (Int, String?, Data?) {
        var s = formsState(id)
        let unsigned = (s["form731"]?["signatures"]?.array ?? []).filter { $0["signed"]?.bool != true }
        if !unsigned.isEmpty {
            return conflict(
                "not everyone has signed: \(unsigned.compactMap { $0["name"]?.string }.joined(separator: ", "))")
        }
        if let sub = s["form731"]?["submission"], sub != .null, sub["changed"]?.bool != true, !resend(body) {
            return conflict("this version of the form was already sent; send {\"resend\": true} to send it again")
        }
        s["form731"]?["submission"] = [
            "sentAt": .number(nowMs), "messageId": "fixture-731", "to": "731@hcaa.gov.gr", "changed": false,
        ]
        setForms(id, s)
        return answer(s)
    }

    // MARK: General Declaration

    private func sendGenDec(_ id: String, body: Data?) -> (Int, String?, Data?) {
        var s = formsState(id)
        if (s["gendec"]?["content"]?["placeCount"]?.int ?? 0) < 2 {
            return conflict("the route needs a departure and a destination")
        }
        if let sub = s["gendec"]?["submission"], sub != .null, sub["changed"]?.bool != true, !resend(body) {
            return conflict("this version of the form was already sent; send {\"resend\": true} to send it again")
        }
        s["gendec"]?["submission"] = [
            "sentAt": .number(nowMs), "messageId": "fixture-gendec", "to": "gendec@hcaa.gov.gr", "changed": false,
        ]
        setForms(id, s)
        return answer(s)
    }

    /// The override is part of the flight: it is saved there and the flight's version goes up.
    private func setHandled(_ id: String, body: Data?) -> (Int, String?, Data?) {
        guard let b = body.flatMap({ try? JSON.parse($0) }), let v = b["handled"],
            v == .null || v.bool != nil
        else { return bad("handled must be true, false or null") }
        var s = formsState(id)
        let auto = s["gendec"]?["handling"]?["autoPilotSends"]?.bool ?? true
        let pilotSends = v.bool.map { !$0 } ?? auto
        s["gendec"]?["handling"]?["override"] = v
        s["gendec"]?["handling"]?["pilotSends"] = .bool(pilotSends)
        s["gendec"]?["pilotSends"] = .bool(pilotSends)
        setForms(id, s)
        if var f = flight(id: id) {
            let next = (f["version"]?.int ?? 7) + 1
            f["options"]?["genDecHandled"] = v
            f["version"] = .number(Double(next))
            f["updated"] = .number(nowMs)
            versions[id] = next
            flights[id] = f
        }
        return answer(s)
    }

    // MARK: the operator's sheets

    func declarationsState(_ id: String) -> JSON {
        if let s = paperwork.declarations[id] { return s }
        let s =
            (fixture("declarations-\(id).json") ?? fixture("declarations.json")).flatMap { try? JSON.parse($0) } ?? [:]
        paperwork.declarations[id] = s
        return s
    }

    private func sendDeclarations(_ id: String, body: Data?) -> (Int, String?, Data?) {
        var s = declarationsState(id)
        guard let op = s["operator"], op != .null else { return conflict("the flight’s aircraft has no operator") }
        let name = op["name"]?.string ?? "The operator"
        guard op["requiresWbPerf"]?.bool == true else {
            return conflict("\(name) does not ask for the W&B and performance sheets")
        }
        guard let to = op["declarationsEmail"]?.string, !to.isEmpty else {
            return conflict("\(name) has no e-mail address for the declarations")
        }
        guard let content = body.flatMap({ try? JSON.parse($0) })?["content"], content != .null else {
            return bad("content is required")
        }
        if paperwork.core == nil { paperwork.core = try? Core.bundled() }
        guard let text = try? paperwork.core?.declarationText(content: content.text) else {
            return bad("the sheets are not valid")
        }
        let hash = CoreWbPerfContent.hash(text)
        if let sub = s["submission"], sub != .null, sub["hash"]?.string == hash, !resend(body) {
            return conflict("this version of the form was already sent; send {\"resend\": true} to send it again")
        }
        s["submission"] = [
            "sentAt": .number(nowMs), "to": .string(to), "hash": .string(hash), "messageId": "fixture-op",
        ]
        paperwork.declarations[id] = s
        return answer(s)
    }
}
