import CoreLocation
import Foundation

/// One open flight: its data (cache first, then the server), what the core computes from it, the
/// chart, and the quick edits (PUT with the version; on 409 the edit is applied again on top of the
/// server's copy).
@MainActor
final class FlightModel: ObservableObject {
    let id: String
    private let app: AppModel
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

    private var flightText: String?
    private var computedText: String?
    private var progressBusy = false

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

    // MARK: loading

    /// Shows the cached copy at once, then asks the server.
    func open() async {
        loadCached()
        await recompute()
        await prepareChart()
        await refresh()
    }

    private func loadCached() {
        if let d = store.read(.flight(id)), let j = try? JSON.parse(d) { setFlight(j) }
        notams = store.decode(NotamBriefing.self, .notams(id))
        filing = store.decode(FilingState.self, .filing(id))
        readMetar()
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
            let refAge = store.modified(.ref).map { -$0.timeIntervalSinceNow } ?? .infinity
            if refAge > 6 * 3600, let ref = try? await api.refBundle() { try? store.write(ref, .ref) }
            await recompute()
            await fetchWeather()
            await recompute()
            await fetchBriefing()
            await prepareChart()
            prepareOfflineMap()
        } catch APIError.unauthorized {
            app.session.lost()
        } catch APIError.offline {
            offline = true
        } catch APIError.notFound {
            error = "This flight is no longer there."
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func fetchWeather() async {
        guard let core, let flightText else { return }
        let paths = (try? await core.run { try $0.weatherRequests(flight: flightText) }) ?? []
        var answers: [String: String] = [:]
        for p in paths {
            if let d = try? await api.get(p), let t = String(data: d, encoding: .utf8) { answers[p] = t }
        }
        guard !answers.isEmpty || paths.isEmpty else { return }
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

    private func fetchBriefing() async {
        if let d = try? await api.notams(id, maxAltFt: computed?.maxAltFt) {
            try? store.write(d, .notams(id))
            notams = try? JSONDecoder().decode(NotamBriefing.self, from: d)
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
        let ref = store.text(.ref) ?? "{}"
        let weather = store.text(.weather(id)) ?? "{}"
        let flightJSON = flight ?? .null
        do {
            let result = try await core.run {
                try $0.computeFlight(flight: flightText, aircraft: aircraft, pilot: pilot, ref: ref, weather: weather)
            }
            computedText = result.text
            computed = ComputedFlight(result, flight: flightJSON)
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
        }
    }

    /// Where the aircraft is along the route (nil while the core is busy with the last fix).
    func progress(at fix: Position) async -> Progress? {
        guard let core, let flightText, let computedText, !progressBusy else { return nil }
        progressBusy = true
        defer { progressBusy = false }
        let day = Fmt.isoDay(date)
        guard
            let j = try? await core.run({ try $0.progress(flight: flightText, computed: computedText, position: fix) })
        else { return nil }
        return Progress(j, day: day)
    }

    // MARK: the chart

    private func prepareChart() async {
        guard let core, let flightText else { return }
        var fetched = store.text(.vectorStyle)
        if fetched == nil, !app.noNetwork { fetched = await fetchVectorStyle() }
        let vector = fetched
        let ref = store.text(.ref) ?? "{}"
        let notamsText = store.text(.notams(id))
        let layers = flight?["options"]?["mapLayers"]?.text
        let style = try? await core.run { try $0.chartStyle(base: "light", vector: vector) }
        if let style {
            try? store.write(Data(style.utf8), .chartStyle("light"))
            styleURL = store.url(.chartStyle("light"))
        }
        chartData = try? await core.run {
            try $0.chartData(ref: ref, flight: flightText, notams: notamsText, layers: layers)
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
    func edit(_ change: @escaping (inout JSON) -> Void) async {
        guard var f = flight, !readOnly else { return }
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

    /// The lobby row data follows the edit (date, time, totals).
    private func withSummary(_ doc: JSON) -> JSON {
        var d = doc
        guard var s = d["summary"]?.object else { return d }
        s["date"] = d["date"] ?? s["date"]
        s["blockOff"] = d["blockOff"] ?? s["blockOff"]
        if let c = computed {
            if let x = c.totalDistNm { s["distNm"] = .number(x) }
            if let x = c.totalEteMin { s["eteMin"] = .number(x) }
            if let x = c.totalFuelL { s["fuelL"] = .number(x) }
        }
        d["summary"] = .object(s)
        return d
    }

    func setDate(_ day: String) async {
        await edit { $0["date"] = .string(day) }
    }

    func setBlockOff(_ clock: String) async {
        await edit { $0["blockOff"] = .string(clock) }
    }

    func setAltitude(legKey: String, feet: Int) async {
        await edit { f in
            var all = f["legOverrides"]?.object ?? [:]
            var o = all[legKey]?.object ?? [:]
            o["altFt"] = .number(Double(feet))
            all[legKey] = .object(o)
            f["legOverrides"] = .object(all)
        }
    }
}
