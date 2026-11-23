import Foundation

// Brief's refreshes and edits as the website's sections make them: METAR/TAF and the winds fetched
// again (MetarSection, calc.tsx refreshWeather), the NOTAM briefing reloaded past the server's cache
// (NotamSection), the runway and surface of each take-off and landing (PerformanceSection), and the
// ATC list saved to doc.atc (AtcSection); the "Ready to fly" rows' sections and Fix (ReadinessBar).

/// A row of the flight's ATC list (src/shared/types.ts AtcEntry).
struct AtcUnit: Equatable, Identifiable, Sendable {
    var id: String
    var role: String
    /// The heading it is listed under, e.g. 'LGTT DEKELIA / TATOI'.
    var group: String
    var callsign: String
    var service: String
    /// MHz as printed, e.g. '122.650'.
    var primary: String
    var backups: [String]
    var remark: String
    /// The generator's key; nil for a row added by hand.
    var sourceKey: String?

    init(
        id: String, role: String = "custom", group: String = "Other", callsign: String = "", service: String = "",
        primary: String = "", backups: [String] = [], remark: String = "", sourceKey: String? = nil
    ) {
        self.id = id
        self.role = role
        self.group = group
        self.callsign = callsign
        self.service = service
        self.primary = primary
        self.backups = backups
        self.remark = remark
        self.sourceKey = sourceKey
    }

    init?(_ j: JSON) {
        guard let id = j["id"]?.string else { return nil }
        self.init(
            id: id, role: j["role"]?.string ?? "custom", group: j["group"]?.string ?? "",
            callsign: j["callsign"]?.string ?? "", service: j["service"]?.string ?? "",
            primary: j["primary"]?.string ?? "", backups: (j["backups"]?.array ?? []).compactMap(\.string),
            remark: j["remark"]?.string ?? "", sourceKey: j["sourceKey"]?.string)
    }

    var json: JSON {
        [
            "id": .string(id), "role": .string(role), "group": .string(group), "callsign": .string(callsign),
            "service": .string(service), "primary": .string(primary), "backups": .array(backups.map(JSON.string)),
            "remark": .string(remark), "sourceKey": sourceKey.map(JSON.string) ?? .null,
        ]
    }

    /// '122.650 / 118.500' (src/data/atc.ts atcFreqText).
    var frequencies: String { ([primary] + backups).filter { !$0.isEmpty }.joined(separator: " / ") }

    /// A frequency as the ATC section accepts it: 123.450.
    static func validFrequency(_ s: String) -> Bool {
        s.range(of: #"^\d{3}\.\d{1,3}$"#, options: .regularExpression) != nil
    }

    /// The backups field split as the website splits it (spaces, commas, slashes).
    static func backups(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "/" }).map(String.init)
    }

    /// A row id like the website's uid(): eight of [a-z0-9].
    static func newId() -> String {
        let abc = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<8).map { _ in abc.randomElement()! })
    }
}

/// The ATC section's list (PGF.regenerateAtc): what the generator gives for the route, what is shown,
/// whether the edited list is outdated, and doc.atc after Regenerate.
struct AtcState: Equatable {
    var generated: [AtcUnit]
    var list: [AtcUnit]
    /// The flight has a list of its own (doc.atc), no longer following the route.
    var edited: Bool
    var stale: Bool
    var afterRegenerate: JSON
}

/// Where a "Ready to fly" row leads (ReadinessBar Row).
struct ReadyDetail: Equatable {
    /// The section that row is about (the website's focusSection(item.section)).
    var section: FlightSection?
    /// The worst warning of the row, whose Fix it offers.
    var warning: String?
    /// A page elsewhere that fixes it (the pilot's details).
    var link: CoreFocusTarget.Link?
    /// The NOTAMs row with NOTAMs to read: "Mark read".
    var markRead: Bool
}

extension FlightModel {
    /// Launch argument `-now <ISO 8601>`: the clock of the flight's computations (tests, screenshots:
    /// whether a METAR is current depends on it); else the device's.
    static var clock: Date? = LaunchArgs.value("-now").flatMap { ISO8601DateFormatter().date(from: $0) }

    /// The flight's aircraft as the core takes it: the hangar's copy, else the one a shared flight
    /// comes with.
    private var aircraftText: String? {
        guard let acId = flight?["aircraftId"]?.string else { return nil }
        if let t = app.store.text(.aircraft(acId)) { return t }
        return flight?["access"]?["aircraft"].flatMap { $0["id"]?.string == acId ? $0.text : nil }
    }

    /// The Brief's sections (PGF.brief) from the last computeFlight.
    func brief(showAll: Bool = false) async -> CoreBrief? {
        guard let core = app.core, let computed, let flight else { return nil }
        let computedText = computed.raw.text
        let flightText = flight.text
        let aircraft = aircraftText
        let notams = app.store.text(.notams(id))
        let ref = app.store.text(.ref)
        let now = Self.clock
        return try? await core.run {
            try $0.brief(
                computed: computedText, flight: flightText, aircraft: aircraft, notams: notams, ref: ref, now: now,
                showAll: showAll)
        }
    }

    // MARK: weather

    /// METAR and TAF fetched again (the website's METAR box does so every five minutes while shown);
    /// the rest of the weather stays as it was.
    func refreshMetar() async {
        guard let core = app.core, let flightText = flight?.text else { return }
        let ref = app.store.text(.ref)
        let paths =
            (try? await core.run { try $0.weatherRequests(flight: flightText, ref: ref) })?
            .filter { $0.contains("/weather/metar") } ?? []
        guard !paths.isEmpty else { return }
        var answers = app.store.read(.weather(id)).flatMap { try? JSON.parse($0) }?.object ?? [:]
        var fresh = false
        for p in paths {
            if let d = try? await app.api.get(p), let j = try? JSON.parse(d), j.object != nil {
                answers[p] = j
                fresh = true
            }
        }
        guard fresh, let data = try? JSON.object(answers).data() else { return }
        try? app.store.write(data, .weather(id))
        await recompute()
    }

    /// The winds aloft and METAR/TAF fetched again (the website's "Refresh weather").
    func refreshWeather() async {
        await fetchWeather()
        await recompute()
    }

    // MARK: NOTAMs

    /// The briefing fetched again past the server's ten-minute cache (NotamSection's reload); the
    /// error to show when it could not be.
    func reloadNotams() async -> String? {
        var path = "flights/\(app.api.seg(id))/notams?refresh=1"
        if let alt = computed?.maxAltFt { path += "&maxAltFt=\(alt)" }
        do {
            let d = try await app.api.get(path)
            let b = try JSONDecoder().decode(NotamBriefing.self, from: d)
            try? app.store.write(d, .notams(id))
            setNotams(b)
        } catch APIError.offline {
            return "Offline: NOTAMs not loaded."
        } catch {
            return "NOTAMs could not be loaded (\(error.localizedDescription))."
        }
        await recompute()
        await prepareChart()
        return nil
    }

    // MARK: take-off and landing

    enum PerformanceChoice {
        case runway, surface
    }

    /// A take-off's or landing's runway or surface (nil: automatic, or paved and dry): the route ends'
    /// in the flight's options, a stop's on its aerodrome request (PerformanceSection setRunway).
    func setPerformance(_ e: CoreBrief.Performance.Endpoint, _ choice: PerformanceChoice, _ value: String?) async {
        let takeoff = e.phase == "takeoff"
        let core = app.core
        await edit { f in
            var o = f["options"]?.object ?? [:]
            if let uid = e.stopUid, let kind = e.stopKind {
                let key = choice == .surface ? "surface" : takeoff ? "takeoffRunway" : "landingRunway"
                guard
                    let requests = try? core?.setRequest(
                        o["aerodromeRequests"]?.text, pointUid: uid, .choice(kind: kind, key: key, value: value))
                else { return }
                o["aerodromeRequests"] = requests
            } else {
                let key =
                    choice == .runway
                    ? (takeoff ? "departureRunway" : "arrivalRunway")
                    : (takeoff ? "departureSurface" : "arrivalSurface")
                o[key] = value.map(JSON.string) ?? .null
            }
            f["options"] = .object(o)
        }
    }

    // MARK: ATC

    func atcState() async -> AtcState? {
        guard let core = app.core, let flight else { return nil }
        let flightText = flight.text
        let altitudes = (computed?.raw["altitudesFt"]?.array ?? []).compactMap(\.double)
        let pilot = app.store.text(.pilot)
        let ref = app.store.text(.ref)
        guard
            let r = try? await core.run({
                try $0.regenerateAtc(flight: flightText, altitudesFt: altitudes, pilot: pilot, ref: ref)
            })
        else { return nil }
        let units = { (j: JSON) in (j.array ?? []).compactMap(AtcUnit.init) }
        return AtcState(
            generated: units(r.generated), list: units(r.list), edited: (flight["atc"]?.array) != nil, stale: r.stale,
            afterRegenerate: r.atc)
    }

    /// Every change makes the list the flight's own (doc.atc), starting from the generated one.
    func editAtc(_ change: @escaping ([AtcUnit]) -> [AtcUnit]) async {
        let generated = await atcState()?.generated ?? []
        await edit { f in
            let list = f["atc"]?.array.map { $0.compactMap(AtcUnit.init) } ?? generated
            f["atc"] = .array(change(list).map(\.json))
        }
    }

    /// The generated rows refreshed, the rows added by hand kept; with none, the list follows the
    /// route again (doc.atc null).
    func regenerateAtc() async {
        guard let s = await atcState() else { return }
        await edit { $0["atc"] = s.afterRegenerate }
    }

    // MARK: readiness

    /// Where a "Ready to fly" row leads: its section, its warning's Fix, or a page elsewhere.
    func readyDetail(_ item: ReadyItem) -> ReadyDetail {
        let markRead = item.id == "notams" && item.state == .todo && (item.text ?? "").contains("to read")
        if item.stage == "file" {
            return ReadyDetail(section: Self.paperworkSection[item.id] ?? .flightPlan, markRead: false)
        }
        let row = (computed?.raw["readiness"]?.array ?? []).first { $0["id"]?.string == item.id }
        let link = row?["link"].flatMap { l -> CoreFocusTarget.Link? in
            guard let to = l["to"]?.string, let label = l["label"]?.string else { return nil }
            return CoreFocusTarget.Link(to: to, label: label)
        }
        return ReadyDetail(
            section: row?["section"]?.string.flatMap(FlightSection.init(webSection:)),
            warning: row?["warning"]?["text"]?.string, link: link, markRead: markRead)
    }

    /// The File & forms page a paperwork row opens (readiness.ts PAPERWORK_KIND).
    static let paperworkSection: [String: FlightSection] = [
        "filing": .flightPlan, "form731": .form731, "gendec": .genDec, "operator": .wbPerf,
    ]

    /// Every row that needs attention, by stage (plan, brief, file).
    var openItems: [ReadyItem] {
        ["plan", "brief", "file"].flatMap { readiness(stage: $0).filter { $0.state != .ok } }
    }
}
