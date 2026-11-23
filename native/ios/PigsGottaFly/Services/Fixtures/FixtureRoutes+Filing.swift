import Foundation

/// Filing on the fixture server, so that the Flight plan screen runs offline and nothing reaches ATC
/// (api/_lib/routes/filing.ts, simulated): a flight starts from `filing-<id>.json` (else filing.json);
/// filing through autorouter answers "filed" at once, through the fax "sending", which the next status
/// request turns "delivered"; delay and cancel change the record as the server does, and every action
/// goes to the log.
struct FilingFixtures {
    var states: [String: JSON] = [:]
    var serial = 0
}

extension FixtureTransport {
    /// The fax number of the fixture's ATS office (AIP Greece GEN 3.1.5.3, Athens Central AIS).
    private static let faxTo: JSON = ["number": "+302103532635", "unit": "Athens Central AIS"]
    private static let open: Set<String> = [
        "created", "filed", "manual_correction", "suspended", "departed", "terminated", "arriving", "sending",
        "delivered",
    ]

    func filingRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        guard r.first == "flights", r.count >= 3, r.parts[2] == "filing" else { return nil }
        let id = r.parts[1]
        switch (r.method, r.count, r.count == 4 ? r.parts[3] : "") {
        case ("GET", 3, _): return answer(id)
        case ("POST", 3, _): return fileFixture(id, r.body)
        case ("POST", 4, "delay"): return delayFixture(id, r.body)
        case ("POST", 4, "cancel"): return cancelFixture(id)
        case ("POST", 4, "refresh"): return refreshFixture(id)
        default: return nil
        }
    }

    private func filingState(_ id: String) -> JSON {
        if let s = filing.states[id] { return s }
        let data = fixture("filing-\(id).json") ?? fixture("filing.json")
        return data.flatMap { try? JSON.parse($0) } ?? ["enabled": false, "reason": "No fixture.", "filing": nil]
    }

    private func answer(_ id: String) -> (Int, String?, Data?) { (200, nil, Self.encoded(filingState(id))) }

    private func refused(_ status: Int, _ message: String) -> (Int, String?, Data?) {
        (status, nil, try? JSON.object(["error": .string(message)]).data())
    }

    private static var now: Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    /// The flight's date and block start as epoch ms (the EOBT the server files with).
    private func blockOff(_ id: String) -> Double? {
        let f = flights[id] ?? (fixture("flight-\(id).json") ?? fixture("flight.json")).flatMap { try? JSON.parse($0) }
        guard let day = f?["date"]?.string, let clock = f?["blockOff"]?.string, !clock.isEmpty else { return nil }
        return (Fmt.date(day: day, clock: clock).timeIntervalSince1970 * 1000).rounded()
    }

    private func log(_ s: inout JSON, _ id: String, _ action: String, via: String?, _ message: String) {
        filing.serial += 1
        let entry: JSON = [
            "id": .string("fg-\(filing.serial)"), "flightId": .string(id), "at": .number(Self.now),
            "action": .string(action), "via": via.map(JSON.string) ?? .null, "ok": true, "message": .string(message),
        ]
        s["log"] = .array([entry] + (s["log"]?.array ?? []))
    }

    private func isOpen(_ s: JSON) -> Bool {
        guard let f = s["filing"], f["providerId"]?.string != nil, let st = f["status"]?.string else { return false }
        return Self.open.contains(st)
    }

    private func fileFixture(_ id: String, _ body: Data?) -> (Int, String?, Data?) {
        var s = filingState(id)
        guard s["enabled"]?.bool == true else { return refused(503, s["reason"]?.string ?? "Filing is not enabled.") }
        guard let b = body.flatMap({ try? JSON.parse($0) }), let fpl = b["fpl"]?.string, fpl.hasPrefix("(FPL-") else {
            return bad("fpl must be an ICAO message: (FPL-…)")
        }
        if isOpen(s) { return refused(409, "this flight already has a filed plan: delay or cancel it") }
        let filers = s["filers"]?.array?.filter { $0["available"]?.bool == true } ?? []
        let via = b["via"]?.string ?? filers.first?["id"]?.string ?? "autorouter"
        guard let filer = filers.first(where: { $0["id"]?.string == via }) else {
            return bad("via must be one of the filing backends")
        }
        guard let eobt = blockOff(id) else { return bad("set the block start time first") }
        filing.serial += 1
        let fax = via == "fax"
        s["filing"] = [
            "provider": .string(via), "providerLabel": filer["label"] ?? .string(via),
            "capabilities": filer["capabilities"] ?? [:], "providerId": .string("fixture-\(filing.serial)"),
            "faxTo": fax ? Self.faxTo : .null, "status": .string(fax ? "sending" : "filed"), "eobt": .number(eobt),
            "fpl": .string(fpl), "addresses": b["addresses"] ?? [], "message": "", "filed": .number(Self.now),
            "updated": .number(Self.now), "polled": .null,
        ]
        log(&s, id, "file", via: via, fax ? "fax sending to Athens Central AIS" : "filed")
        filing.states[id] = s
        return answer(id)
    }

    private func delayFixture(_ id: String, _ body: Data?) -> (Int, String?, Data?) {
        var s = filingState(id)
        guard isOpen(s) else { return refused(409, "no open filed plan to delay") }
        guard let eobt = body.flatMap({ try? JSON.parse($0) })?["eobt"]?.double else {
            return bad("eobt must be a time (ms since 1970)")
        }
        let via = s["filing"]?["provider"]?.string
        s["filing"]?["eobt"] = .number(eobt)
        s["filing"]?["updated"] = .number(Self.now)
        s["filing"]?["message"] = .string(via == "fax" ? "Delay faxed to Athens Central AIS." : "")
        log(&s, id, "delay", via: via, "delayed to \(Fmt.zulu(Date(timeIntervalSince1970: eobt / 1000)))")
        filing.states[id] = s
        return answer(id)
    }

    private func cancelFixture(_ id: String) -> (Int, String?, Data?) {
        var s = filingState(id)
        guard isOpen(s) else { return refused(409, "no open filed plan to cancel") }
        let via = s["filing"]?["provider"]?.string
        s["filing"]?["status"] = "cancelled"
        s["filing"]?["updated"] = .number(Self.now)
        s["filing"]?["message"] = ""
        log(&s, id, "cancel", via: via, "cancelled")
        filing.states[id] = s
        return answer(id)
    }

    private func refreshFixture(_ id: String) -> (Int, String?, Data?) {
        var s = filingState(id)
        guard s["filing"]?["providerId"]?.string != nil else { return refused(409, "this flight has no filed plan") }
        if s["filing"]?["status"]?.string == "sending" { s["filing"]?["status"] = "delivered" }
        s["filing"]?["polled"] = .number(Self.now)
        log(&s, id, "refresh", via: s["filing"]?["provider"]?.string, "status \(s["filing"]?["status"]?.string ?? "")")
        filing.states[id] = s
        return answer(id)
    }
}
