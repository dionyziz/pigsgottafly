import CoreLocation
import Foundation

/// One open flight: its data (cache first, then the server), what the core computes from it, the
/// chart, and the quick edits (PUT with the version; on 409 the edit is applied again on top of the
/// server's copy).
@MainActor
final class FlightModel: ObservableObject {
    let id: String
    let app: AppModel
    private var api: API { app.api }
    private var store: Store { app.store }
    private var core: Core? { app.core }

    @Published private(set) var flight: JSON?
    @Published private(set) var computed: ComputedFlight?
    @Published private(set) var paperwork: [ReadyItem] = []
    @Published private(set) var metar: MetarTafResponse?
    @Published private(set) var notams: NotamBriefing?
    @Published private(set) var filing: FilingState?
    @Published private(set) var styleURL: URL?
    @Published private(set) var chartData: JSON?
    @Published private(set) var loading = false
    @Published private(set) var saving = false
    @Published private(set) var offline = false
    @Published var error: String?

    /// The relevant NOTAMs of the briefing were marked read (and none came since).
    @Published private(set) var notamsRead = false

    /// Plan, Brief and File's summaries (PGF.readinessStages of the readiness and paperwork rows).
    @Published private(set) var stages: [CoreStageSummary] = []

    /// The workspace's: every edit can be undone (Undo/Redo in the toolbar, shake, ⌘Z).
    weak var undoManager: UndoManager?

    private var flightText: String?
    private var computedText: String?
    private var readinessRows: [JSON] = []
    private var paperworkRows: [JSON] = []
    private var progressBusy = false
    /// The leg of the last progress answer (PGF.progress lastLegIndex).
    private var lastLegIndex: Int?

    init(id: String, app: AppModel) {
        self.id = id
        self.app = app
    }

    // MARK: reading

    var title: String {
        let t = flight?["title"]?.string ?? ""
        if !t.isEmpty { return t }
        let route = flight?["route"]?.array ?? []
        guard let a = route.first?["name"]?.string, let b = route.last?["name"]?.string else { return "Flight" }
        return "\(a) → \(b)"
    }
    var date: String { flight?["date"]?.string ?? "" }
    var blockOff: String { flight?["blockOff"]?.string ?? "" }
    var version: Int { flight?["version"]?.int ?? 0 }
    /// A flight shared for viewing only.
    var readOnly: Bool { flight?["access"]?["role"]?.string == "view" }
    var routeCoordinates: [CLLocationCoordinate2D] {
        (flight?["route"]?.array ?? []).compactMap { p in
            guard let lat = p["lat"]?.double, let lon = p["lon"]?.double else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lon)
        }
    }
    /// The ICAO of the departure and the destination (their NOTAM groups always show).
    var endAerodromes: [String] {
        let route = flight?["route"]?.array ?? []
        return [route.first, route.count > 1 ? route.last : nil].compactMap { p -> String? in
            guard let p, p["kind"]?.string == "aerodrome" else { return nil }
            let code = p["refId"]?.string ?? p["name"]?.string ?? ""
            return code.count == 4 ? code : nil
        }
    }
    /// Route and aircraft are chosen: there is something to fly (FlightTab.initial).
    var planned: Bool { route.count >= 2 && flight?["aircraftId"]?.string != nil }

    /// The route's points (RoutePoint JSON).
    var route: [JSON] { flight?["route"]?.array ?? [] }

    /// The last point's name (the Fly strip's destination line).
    var destinationName: String? { flight?["route"]?.array?.last?["name"]?.string }

    // MARK: loading

    /// Shows the cached copy at once, then asks the server.
    /// The opening load runs in a task of its own: SwiftUI cancels a view's .task when it re-creates the
    /// view (Fly hiding its bars, a rotation), which must not stop the flight from loading.
    private var opening: Task<Void, Never>?

    func open() async {
        if let opening {
            await opening.value
            return
        }
        let t = Task { await self.load() }
        opening = t
        await t.value
    }

    private func load() async {
        loadCached()
        await app.ensureTerrain()
        await recompute()
        await prepareChart()
        await refresh()
    }

    private func loadCached() {
        if let d = store.read(.flight(id)), let j = try? JSON.parse(d) { setFlight(j) }
        setNotams(store.decode(NotamBriefing.self, .notams(id)))
        filing = store.decode(FilingState.self, .filing(id))
        readMetar()
    }

    func setNotams(_ b: NotamBriefing?) {
        notams = b
        notamsRead = b.map { store.text(.notamsRead(id)) == Self.relevantSignature($0) } ?? false
    }

    /// The relevant NOTAMs as one string: marking them read holds until it changes (the website's
    /// ReadinessBar relevantSignature).
    nonisolated static func relevantSignature(_ b: NotamBriefing) -> String {
        b.notams.filter(\.relevant).map(\.key).sorted().joined(separator: ",")
    }

    /// The relevant NOTAMs were read: the NOTAMs row of "Ready to fly" turns ready.
    func markNotamsRead() async {
        guard let b = notams else { return }
        try? store.write(Data(Self.relevantSignature(b).utf8), .notamsRead(id))
        setNotams(b)
        await recompute()
    }

    private func setFlight(_ j: JSON) {
        flight = j
        flightText = j.text
    }

    func refresh() async {
        loading = true
        defer { loading = false }
        do {
            try await pushPending()
            let data = try await api.flight(id)
            try? store.write(data, .flight(id))
            setFlight(try JSON.parse(data))
            Task { await api.markOpened(id) }
            offline = false
            if let acId = flight?["aircraftId"]?.string, let ac = try? await api.aircraft(acId) {
                try? store.write(ac, .aircraft(acId))
            }
            if let me = try? await api.me() { try? store.write(me, .pilot) }
            if let w = try? await api.waypoints() { try? store.write(w, .waypoints) }
            let refAge = store.modified(.ref).map { -$0.timeIntervalSinceNow } ?? .infinity
            if refAge > 6 * 3600, let ref = try? await api.refBundle() { try? store.write(ref, .ref) }
            await app.ensureTerrain()
            await recompute()
            await fetchWeather()
            await fetchBriefing()
            await recompute()
            await prepareChart()
            prepareOfflineMap()
        } catch APIError.unauthorized {
            app.session.lost()
        } catch APIError.offline {
            offline = true
        } catch APIError.notFound {
            error = "This flight is no longer there."
        } catch  where isCancellation(error) {
            // replaced or abandoned: nothing to report
        } catch {
            self.error = error.localizedDescription
        }
    }

    func fetchWeather() async {
        guard let core, let flightText else { return }
        let ref = store.text(.ref)
        let paths = (try? await core.run { try $0.weatherRequests(flight: flightText, ref: ref) }) ?? []
        // what was saved for these paths stays until a fresh answer replaces it (offline, a failed fetch)
        let saved = store.read(.weather(id)).flatMap { try? JSON.parse($0) }?.object ?? [:]
        var answers: [String: String] = [:]
        for p in paths {
            if let d = try? await api.get(p), let t = String(data: d, encoding: .utf8), (try? JSON.parse(t)) != nil {
                answers[p] = t
            } else if let old = saved[p] {
                answers[p] = old.text
            }
        }
        try? store.write(Data(Core.object(answers).utf8), .weather(id))
        readMetar()
    }

    private func readMetar() {
        guard let d = store.read(.weather(id)), let w = try? JSON.parse(d), let o = w.object else {
            metar = nil
            return
        }
        var stations: [String: MetarTafResponse.Station] = [:]
        var fetched = 0.0
        for (path, answer) in o where path.contains("weather/metar") {
            guard let data = try? answer.data(), let r = try? JSONDecoder().decode(MetarTafResponse.self, from: data)
            else { continue }
            stations.merge(r.stations) { $1 }
            fetched = max(fetched, r.fetched)
        }
        metar = stations.isEmpty ? nil : MetarTafResponse(stations: stations, fetched: fetched)
    }

    func fetchBriefing() async {
        if let d = try? await api.notams(id, maxAltFt: computed?.maxAltFt) {
            try? store.write(d, .notams(id))
            setNotams(try? JSONDecoder().decode(NotamBriefing.self, from: d))
        }
        if let d = try? await api.filing(id) {
            try? store.write(d, .filing(id))
            filing = try? JSONDecoder().decode(FilingState.self, from: d)
        }
        if let d = try? await api.forms(id) { try? store.write(d, .forms(id)) }
        if let d = try? await api.declarations(id) { try? store.write(d, .declarations(id)) }
        await computePaperwork()
    }

    // MARK: the core

    /// computeFlight from what is cached.
    func recompute() async {
        guard let core else {
            error = app.coreError
            return
        }
        guard let flightText else { return }
        let acId = flight?["aircraftId"]?.string
        let aircraft = acId.flatMap { store.text(.aircraft($0)) }
        let pilot = store.text(.pilot)
        // the core keeps the last ref given; without any (a first launch offline) there is nothing to compute
        guard let ref = store.text(.ref) else { return }
        let weather = store.text(.weather(id)) ?? "{}"
        let notams = store.text(.notams(id))
        let read = notamsRead
        let now = Self.clock
        do {
            let result = try await core.run {
                try $0.computeFlight(
                    flight: flightText, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather, notams: notams,
                    notamsRead: read, now: now)
            }
            computedText = result.text
            computed = ComputedFlight(result)
            readinessRows = result["readiness"]?.array ?? []
        } catch  where isCancellation(error) {
        } catch {
            self.error = error.localizedDescription
        }
        await computePaperwork()
    }

    private func computePaperwork() async {
        guard let core else { return }
        let filing = store.text(.filing(id))
        let forms = store.text(.forms(id))
        let declarations = store.text(.declarations(id))
        if let rows = try? await core.run({
            try $0.paperwork(filing: filing, forms: forms, declarations: declarations)
        }) {
            paperwork = ReadyItem.list(rows)
            paperworkRows = rows.array ?? []
        }
        let items = JSON.array(readinessRows + paperworkRows).text
        if let s = try? await core.run({ try $0.readinessStages(items: items) }) { stages = s }
    }

    /// The rows of one stage ("plan", "brief", "file"), the core's and the paperwork's.
    func readiness(stage: String) -> [ReadyItem] {
        ((computed?.readiness ?? []) + paperwork).filter { $0.stage == stage }
    }

    /// Where a warning's Fix leads (PGF.focusTarget).
    func focusTarget(text: String) async -> CoreFocusTarget? {
        guard let core else { return nil }
        let id = self.id
        // the aircraft's warnings lead to its page in the hangar
        let aircraftId = flight?["aircraftId"]?.string
        return try? await core.run { try $0.focusTarget(text: text, flightId: id, aircraftId: aircraftId) }
    }

    /// Where the aircraft is along the route (nil while the core is busy with the last fix).
    func progress(at fix: Position) async -> Progress? {
        guard let core, let computedText, !progressBusy else { return nil }
        progressBusy = true
        defer { progressBusy = false }
        let last = lastLegIndex
        guard
            let j = try? await core.run({
                try $0.progress(computed: computedText, position: fix, lastLegIndex: last)
            }),
            let p = Progress(j)
        else { return nil }
        lastLegIndex = p.legIndex
        return p
    }

    // MARK: the chart

    func prepareChart() async {
        guard let core, let flightText else { return }
        var fetched = store.text(.vectorStyle)
        if fetched == nil, !app.noNetwork { fetched = await fetchVectorStyle() }
        let vector = fetched
        guard let ref = store.text(.ref) else { return }
        let notamsText = store.text(.notams(id))
        let layers = flight?["options"]?["mapLayers"]?.text
        let waypoints = store.text(.waypoints)
        let style = try? await core.run { try $0.chartStyle(base: "light", vector: vector, layers: layers) }
        // per flight: the style shows the flight's map layers
        if let style {
            try? store.write(Data(style.utf8), .chartStyle("light-\(id)"))
            styleURL = store.url(.chartStyle("light-\(id)"))
        }
        chartData = try? await core.run {
            try $0.chartData(ref: ref, flight: flightText, notams: notamsText, layers: layers, waypoints: waypoints)
        }
    }

    /// OpenFreeMap's Positron (the website's "Light" base map, src/features/editor/map/style.ts).
    private func fetchVectorStyle() async -> String? {
        var req = URLRequest(url: URL(string: "https://tiles.openfreemap.org/styles/positron")!)
        req.timeoutInterval = 6
        guard let (data, response) = try? await URLSession.shared.data(for: req),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let j = try? JSON.parse(data), j["version"]?.int == 8, j["layers"]?.array != nil
        else { return nil }
        try? store.write(data, .vectorStyle)
        return String(data: data, encoding: .utf8)
    }

    private func prepareOfflineMap() {
        guard !app.fixtures, let styleURL,
            let b = Geo.bounds(routeCoordinates, marginNm: 15)
        else { return }
        OfflineMaps.ensurePack(flightId: id, version: version, styleURL: styleURL, bounds: b)
    }

    // MARK: edits

    /// Applies `change` here at once, then PUTs the flight; on 409 applies it again to the server's copy.
    /// The flight as it was goes on the undo stack first.
    func edit(_ change: @escaping (inout JSON) -> Void) async {
        guard var f = flight, !readOnly else { return }
        registerUndo(restoring: f)
        change(&f)
        setFlight(f)
        try? store.write(try f.data(), .flight(id))
        await recompute()
        saving = true
        defer { saving = false }
        var doc = withSummary(Self.docOf(f))
        var v = version
        for _ in 0..<3 {
            do {
                let r = try await api.updateFlight(id, doc: doc, version: v)
                var now = flight ?? f
                now["version"] = .number(Double(r.version))
                now["updated"] = .number(r.updated)
                setFlight(now)
                try? store.write(try now.data(), .flight(id))
                store.remove(.pendingEdit(id))
                offline = false
                return
            } catch APIError.conflict(let body) {
                guard var server = try? JSON.parse(body) else { break }
                // the snapshots on the stack predate the server's copy: undoing one would drop its changes
                undoManager?.removeAllActions(withTarget: self)
                change(&server)
                setFlight(server)
                try? store.write(try server.data(), .flight(id))
                await recompute()
                doc = withSummary(Self.docOf(server))
                v = server["version"]?.int ?? v
            } catch APIError.offline {
                offline = true
                let pending = JSON.object(["doc": doc, "version": .number(Double(v))])
                try? store.write(try pending.data(), .pendingEdit(id))
                return
            } catch APIError.unauthorized {
                app.session.lost()
                return
            } catch {
                self.error = "Not saved: \(error.localizedDescription)"
                return
            }
        }
    }

    /// Registered synchronously, so that UndoManager files the inverse of an undo as its redo.
    private func registerUndo(restoring before: JSON) {
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            guard let now = model.flight else { return }
            model.registerUndo(restoring: now)
            let doc = Self.docOf(before)
            Task { await model.save(replacingDocWith: doc) }
        }
    }

    /// An undo or redo: the editable part becomes `doc`, saved as any edit but with no undo step of its
    /// own (`registerUndo` filed the inverse already).
    private func save(replacingDocWith doc: JSON) async {
        let manager = undoManager
        undoManager = nil
        defer { undoManager = manager }
        await edit { f in
            guard var next = doc.object else { return }
            for k in ["id", "version", "created", "updated", "opened", "deleted", "access"] { next[k] = f[k] }
            f = .object(next)
        }
    }

    /// An edit made offline: sent before anything else; ours wins over a newer server copy (as the
    /// website's flightStore does).
    private func pushPending() async throws {
        guard let d = store.read(.pendingEdit(id)), let p = try? JSON.parse(d), let doc = p["doc"],
            var v = p["version"]?.int
        else { return }
        for _ in 0..<2 {
            do {
                _ = try await api.updateFlight(id, doc: doc, version: v)
                store.remove(.pendingEdit(id))
                return
            } catch APIError.conflict(let body) {
                v = (try? JSON.parse(body))?["version"]?.int ?? v
            }
        }
    }

    /// The editable part of a Flight (src/data/flightStore.ts docOf).
    nonisolated static func docOf(_ f: JSON) -> JSON {
        guard var o = f.object else { return f }
        for k in ["id", "version", "created", "updated", "opened", "deleted", "access"] { o[k] = nil }
        return .object(o)
    }

    /// The lobby row data follows the edit (title, date, time, route, totals), as the website's editor
    /// writes it (src/features/editor/state.tsx summaryOf).
    private func withSummary(_ doc: JSON) -> JSON {
        var d = doc
        guard var s = d["summary"]?.object else { return d }
        s["date"] = d["date"] ?? s["date"]
        s["blockOff"] = d["blockOff"] ?? s["blockOff"]
        let title = (d["title"]?.string ?? "").trimmingCharacters(in: .whitespaces)
        s["title"] = .string(title.isEmpty ? (d["date"]?.string ?? "") : title)
        if let route = d["route"]?.array {
            s["route"] = .array(
                route.map { p in
                    .array([p["lat"], p["lon"]].map { .number((($0?.double ?? 0) * 1000).rounded() / 1000) })
                })
            s["from"] = route.first?["name"] ?? ""
            s["to"] = route.count > 1 ? route.last?["name"] ?? "" : ""
        }
        if let c = computed {
            if c.local == nil, let x = c.totalDistNm { s["distNm"] = .number(x) }
            if let x = c.totalEteMin { s["eteMin"] = .number(x) }
            if let x = c.totalFuelL { s["fuelL"] = .number(x) }
        }
        d["summary"] = .object(s)
        return d
    }
}
