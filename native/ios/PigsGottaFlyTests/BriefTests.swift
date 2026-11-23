import XCTest

@testable import PigsGottaFly

/// The fixture server, with the requests it was sent.
private final class Recorder: HTTPTransport, @unchecked Sendable {
    let inner = FixtureTransport.bundled()!
    private let lock = NSLock()
    private var sent: [URLRequest] = []

    var requests: [URLRequest] { lock.withLock { sent } }
    func clear() { lock.withLock { sent = [] } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { sent.append(request) }
        return try await inner.send(request)
    }

    /// The flight docs PUT, in order.
    var puts: [JSON] {
        requests.filter { $0.httpMethod == "PUT" }.compactMap { $0.httpBody.flatMap { try? JSON.parse($0) }?["flight"] }
    }
}

/// The Brief's sections and edits on the fixtures: each PUT carries what the website's sections write
/// (options' runway and surface, doc.atc), the NOTAM reload and the METAR refresh ask what the website
/// asks, and the readiness rows lead where ReadinessBar's do.
@MainActor
final class BriefTests: XCTestCase {
    private var transport: Recorder!

    override func setUp() async throws {
        // 75 minutes before the fixture flight's take-off: its METARs are current
        FlightModel.clock = ISO8601DateFormatter().date(from: "2026-11-22T07:30:00Z")
    }

    override func tearDown() async throws {
        FlightModel.clock = nil
    }

    private func open(_ id: String) async -> FlightModel {
        transport = Recorder()
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        let model = FlightModel(id: id, app: app)
        await model.open()
        return model
    }

    private func brief(_ m: FlightModel) async throws -> CoreBrief {
        let b = await m.brief()
        return try XCTUnwrap(b)
    }

    private func atcState(_ m: FlightModel) async throws -> AtcState {
        let s = await m.atcState()
        return try XCTUnwrap(s)
    }

    private func target(_ m: FlightModel, _ text: String) async throws -> CoreFocusTarget {
        let t = await m.focusTarget(text: text)
        return try XCTUnwrap(t)
    }

    func testBriefSectionsOfTheFixtureFlight() async throws {
        let model = await open("fixture-lgtt-lgsy")
        let b = try await brief(model)
        XCTAssertEqual(b.aerodromes.items.map(\.title), ["Departure LGTT", "Destination LGSY"])
        XCTAssertEqual(b.aerodromes.items[0].chip?.text, "Open")
        XCTAssertEqual(b.aerodromes.items[0].hours?.ad?.text, "Open 05:14–15:08Z (HJ)")
        XCTAssertEqual(b.performance.endpoints.map(\.tid), ["takeoff", "landing"])
        XCTAssertEqual(b.performance.endpoints[0].summary, "Fits · RWY 03 · TODR/TODA 344/1868 m")
        XCTAssertFalse(b.performance.noGo)
        let notams = try XCTUnwrap(b.notams)
        XCTAssertEqual(notams.groups.map(\.id), ["LGTT", "LGSY", "airspace"])
        XCTAssertTrue(notams.groups[0].notams.isEmpty, "the departure's group shows with no NOTAM")
    }

    func testMetarBoxShowsFromSixHoursBeforeTakeOff() throws {
        let core = try Core.bundled()
        let ref = try Fixtures.text("ref.json")
        let flight = try Fixtures.text("flight.json")
        let weather = Core.object(["/api/weather/metar?ids=LGSY,LGTT": try Fixtures.text("metar.json")])
        let computed = try core.computeFlight(
            flight: flight, aircraft: try Fixtures.text("aircraft.json"), pilot: try Fixtures.text("pilot.json"),
            ref: ref, weather: weather)
        let before = ISO8601DateFormatter().date(from: "2026-11-22T07:30:00Z")!
        let box = try core.brief(
            computed: computed.text, flight: flight, aircraft: nil, notams: nil, ref: ref, now: before
        )
        .metar
        XCTAssertTrue(box.shown)
        XCTAssertEqual(box.rows.map(\.icao), ["LGTT", "LGSY"])
        XCTAssertEqual(box.rows[1].metar, "LGSY 220820Z 01012KT CAVOK 15/07 Q1020")
        XCTAssertEqual(box.rows[1].place, "Destination")
        let dayAfter = ISO8601DateFormatter().date(from: "2026-11-23T12:00:00Z")!
        XCTAssertFalse(
            try core.brief(computed: computed.text, flight: flight, aircraft: nil, notams: nil, ref: ref, now: dayAfter)
                .metar.shown)
        XCTAssertEqual(MetarRow.age(0, now: 65 * 60000), "1 h 5 min ago")
    }

    func testRunwayAndSurfaceGoToTheOptions() async throws {
        let model = await open("fixture-brief")
        var b = try await brief(model)
        XCTAssertTrue(b.performance.noGo, "a 12 kt tailwind on runway 17")
        let landing = b.performance.endpoints[1]
        XCTAssertEqual(landing.runway, "17")
        XCTAssertEqual(landing.verdictLabel, "No-go")
        XCTAssertEqual(landing.reason, "Outside the AFM table: distances extrapolated.")

        await model.setPerformance(landing, .runway, nil)
        XCTAssertEqual(transport.puts.last?["options"]?["arrivalRunway"], .null)
        b = try await brief(model)
        XCTAssertFalse(b.performance.noGo)
        XCTAssertEqual(b.performance.endpoints[1].runwayAuto, "35")

        await model.setPerformance(b.performance.endpoints[0], .surface, "short wet grass")
        XCTAssertEqual(transport.puts.last?["options"]?["departureSurface"], "short wet grass")
        let surface = try await brief(model).performance.endpoints[0].surface
        XCTAssertEqual(surface, "short wet grass")
    }

    func testAStopsRunwayGoesOnItsRequest() async throws {
        let model = await open("fixture-lgtt-lgsy")
        let kimi = try XCTUnwrap(model.route[2]["uid"]?.string)
        await model.edit { f in
            var o = f["options"]?.object ?? [:]
            o["aerodromeRequests"] = [["pointUid": .string(kimi), "kind": "touch-and-go", "stopMin": nil]]
            f["options"] = .object(o)
        }
        let e = CoreBrief.Performance.Endpoint(
            tid: "tng-takeoff", phase: "takeoff", title: "Touch-and-go take-off", stopUid: kimi,
            stopKind: "touch-and-go", aerodrome: true, icao: "", name: "", verdict: nil, verdictLabel: nil,
            verdictText: "", reason: nil, summary: "", time: nil, conditions: nil, weather: "", metar: nil, runway: nil,
            runwayAuto: nil, runways: [], surface: nil, surfaces: [], components: nil, paDa: nil, mass: nil,
            distances: [], noAircraft: false)
        await model.setPerformance(e, .runway, "21")
        let req = transport.puts.last?["options"]?["aerodromeRequests"]?.array?.first
        XCTAssertEqual(req?["pointUid"]?.string, kimi)
        XCTAssertEqual(req?["takeoffRunway"], "21")
    }

    func testAtcListEditsAreSavedToTheFlight() async throws {
        let model = await open("fixture-lgtt-lgsy")
        // the fixture's list was edited for an older route: outdated
        var s = try await atcState(model)
        XCTAssertTrue(s.edited)
        XCTAssertTrue(s.stale)
        XCTAssertEqual(s.list.map(\.id), ["a1", "a2", "a3"])

        // Regenerate with no row added by hand: the list follows the route again
        await model.regenerateAtc()
        XCTAssertEqual(transport.puts.last?["atc"], .null)
        s = try await atcState(model)
        XCTAssertFalse(s.edited)
        XCTAssertEqual(s.list.first?.callsign, "TATOI TOWER")
        XCTAssertEqual(s.list.first?.frequencies, "122.650 / 118.500")

        // an edit makes the generated list the flight's own
        let tower = s.list[0]
        var swapped = tower
        swapped.primary = "118.500"
        swapped.backups = ["122.650"]
        await model.editAtc { $0.map { $0.id == tower.id ? swapped : $0 } }
        var atc = try XCTUnwrap(transport.puts.last?["atc"]?.array)
        XCTAssertEqual(atc.count, s.list.count)
        XCTAssertEqual(atc[0]["primary"], "118.500")
        XCTAssertEqual(atc[0]["sourceKey"], "ad:LGTT:TATOI TOWER")
        s = try await atcState(model)
        XCTAssertTrue(s.edited)
        XCTAssertFalse(s.stale)

        // a unit added by hand, then Regenerate: the generated rows as generated, the custom one kept
        let mine = AtcUnit(id: AtcUnit.newId(), callsign: "CLUB", primary: "123.500")
        await model.editAtc { $0 + [mine] }
        await model.regenerateAtc()
        atc = try XCTUnwrap(transport.puts.last?["atc"]?.array)
        XCTAssertEqual(atc.first?["primary"], "122.650")
        XCTAssertEqual(atc.last?["callsign"], "CLUB")
        XCTAssertEqual(atc.last?["sourceKey"], .null)

        // removed, the list is the generated one again
        await model.editAtc { $0.filter { $0.id != mine.id } }
        await model.regenerateAtc()
        XCTAssertEqual(transport.puts.last?["atc"], .null)
    }

    func testFrequencyFormat() {
        XCTAssertTrue(AtcUnit.validFrequency("122.650"))
        XCTAssertTrue(AtcUnit.validFrequency("118.5"))
        XCTAssertFalse(AtcUnit.validFrequency("1225"))
        XCTAssertEqual(AtcUnit.backups("118.500, 122.100/ 130.0"), ["118.500", "122.100", "130.0"])
        XCTAssertTrue(AtcUnit.newId().range(of: "^[a-z0-9]{8}$", options: .regularExpression) != nil)
    }

    func testNotamReloadBypassesTheServerCache() async throws {
        let model = await open("fixture-lgtt-lgsy")
        transport.clear()
        let error = await model.reloadNotams()
        XCTAssertNil(error)
        let url = try XCTUnwrap(transport.requests.first { $0.url?.path.hasSuffix("/notams") == true }?.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(query.first { $0.name == "refresh" }?.value, "1")
        XCTAssertNotNil(query.first { $0.name == "maxAltFt" })
        XCTAssertEqual(model.notams?.notams.count, 2)
    }

    func testMetarRefreshAsksForTheReportsOnly() async throws {
        let model = await open("fixture-lgtt-lgsy")
        transport.clear()
        await model.refreshMetar()
        let paths = transport.requests.compactMap { $0.url?.path }
        XCTAssertEqual(paths, ["/api/weather/metar"])
        XCTAssertNil(model.computed?.windsMessage, "the winds kept")
    }

    func testReadinessRowsLeadWhereTheWebsitesDo() async throws {
        let model = await open("fixture-brief")
        let notams = try XCTUnwrap(model.readiness(stage: "brief").first { $0.id == "notams" })
        XCTAssertEqual(model.readyDetail(notams), ReadyDetail(section: .notams, markRead: true))
        let perf = try XCTUnwrap(model.readiness(stage: "brief").first { $0.id == "performance" })
        let detail = model.readyDetail(perf)
        XCTAssertEqual(detail.section, .performance)
        XCTAssertEqual(detail.warning, "Landing LGSY: Tailwind 11.6 kt on runway 17.")
        let filing = try XCTUnwrap(model.readiness(stage: "file").first { $0.id == "filing" })
        XCTAssertEqual(model.readyDetail(filing).section, .flightPlan)
        XCTAssertEqual(model.openItems.first?.id, "aircraft")

        // the performance warning's Fix: the performance field of Brief; the aircraft's: its hangar page
        let fix = try await target(model, try XCTUnwrap(detail.warning))
        XCTAssertEqual(fix.section, "performance")
        XCTAssertEqual(fix.focus, "performance")
        let aircraft = try await target(model, "Landing LGSY: Outside the AFM table: distances extrapolated.")
        XCTAssertEqual(aircraft.link?.to, "/hangar/fixture-sx-asv?focus=performance")

        await model.markNotamsRead()
        let read = try XCTUnwrap(model.readiness(stage: "brief").first { $0.id == "notams" })
        XCTAssertFalse(model.readyDetail(read).markRead)
    }

    func testFixRoutes() {
        var opened: (FlightSection, String?)?
        var tab: FlightTab?
        var link: URL?
        let router = FocusRouter(
            openSection: { opened = ($0, $1) }, openTab: { tab = $0 }, openLink: { link = $0 })
        router.route(
            CoreFocusTarget(fix: nil, focus: "blockOff", section: "when", stage: "plan", link: nil))
        XCTAssertEqual(opened?.0, .when)
        XCTAssertEqual(opened?.1, "blockOff")
        router.route(CoreFocusTarget(fix: nil, focus: nil, section: "metar", stage: "brief", link: nil))
        XCTAssertEqual(opened?.0, .weather)
        router.route(
            CoreFocusTarget(
                fix: nil, focus: nil, section: nil, stage: nil,
                link: .init(to: "/passengers?edit=me&fields=phone", label: "Add your phone")))
        XCTAssertEqual(link?.absoluteString, "https://pigsgottafly.com/passengers?edit=me&fields=phone")
        XCTAssertEqual(FixLinkView.destination(link!), .profile)
        XCTAssertEqual(
            FixLinkView.destination(URL(string: "https://pigsgottafly.com/hangar/ac1?focus=performance")!),
            .aircraft("ac1"))
        XCTAssertEqual(FixLinkView.destination(URL(string: "https://pigsgottafly.com/passengers?edit=p1")!), .web)

        router.showOnMap(notam: "A1234/26", flightId: "f1")
        XCTAssertEqual(tab, .map)
        XCTAssertEqual(MapFocus.take(flightId: "f1"), "A1234/26")
        XCTAssertNil(MapFocus.take(flightId: "f1"), "once")
    }
}
