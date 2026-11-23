import CoreLocation
import Foundation
import SwiftUI

// Editing the route on the map as the website's RouteMap does (src/features/editor/map/RouteMap.tsx):
// drawing with snapping, dragging points and the legs' middle dots, custom named points, a point's
// menu, the details of what is under a tap and the layers. The decisions are the core's (PGF.routeEdit,
// snap, mapInfo, pointMenu, routeFeatures, drawBand, waypointName, mapLayers: src/native/core/map.ts);
// every change of the flight goes through FlightModel.edit, one undo step each.

// MARK: the core's answers

struct MapRow: Codable, Equatable, Hashable, Sendable {
    var label: String
    var text: String
    var notams: [String]?
}

/// An AIP reference and its PDF.
struct MapLink: Codable, Equatable, Hashable, Sendable {
    var ref: String
    var url: String
}

struct VfrChartLink: Codable, Equatable, Hashable, Sendable {
    var icao: String
    var url: String
}

struct AerodromeCard: Codable, Equatable, Sendable {
    struct Notam: Codable, Equatable, Hashable, Sendable {
        var key: String
        var summary: String
        var text: String?
    }
    var id: String
    var icao: String?
    var title: String
    var elevFt: Int?
    var hoursLine: String
    var handlingLine: String
    var closed: Bool
    /// Hours are published (else "No operational hours published").
    var published: Bool
    var rows: [MapRow]
    var notams: [Notam]
    var hoursSource: MapLink?
    /// The AIP text the parser could not represent exactly, as printed.
    var partial: [MapRow]
    var partialNotes: [String]
    var source: MapLink
    var charts: [VfrChartLink]
    var airac: String
}

struct NavaidCard: Codable, Equatable, Sendable {
    var id: String
    var type: String
    var title: String
    var freq: String
    var rows: [MapRow]
    var sources: [MapLink]
    var charts: [VfrChartLink]
    var airac: String
}

struct AirspaceCard: Codable, Equatable, Identifiable, Sendable {
    struct Unit: Codable, Equatable, Hashable, Sendable {
        var callsign: String
        var freqs: [String]
        var hours: String?
    }
    var id: String
    var type: String
    var title: String
    var cls: String
    var vertical: String
    var rows: [MapRow]
    var showUnits: Bool
    var units: [Unit]
    var remarks: String
    var charts: [VfrChartLink]
    var source: MapLink
    var airac: String
}

struct NotamCard: Codable, Equatable, Identifiable, Sendable {
    var key: String
    var `where`: String
    var subject: String
    var qcode: String
    var validity: String
    var schedule: String?
    var limits: String
    var leg: String?
    var text: String
    var raw: String
    var relevant: Bool
    var autorouter: Bool
    var id: String { key }
}

/// What a tap at a place shows (PGF.mapInfo).
struct MapInfo: Codable, Equatable, Sendable {
    var aerodrome: AerodromeCard?
    var navaid: NavaidCard?
    var airspaces: [AirspaceCard]
    var notams: [NotamCard]

    var isEmpty: Bool { aerodrome == nil && navaid == nil && airspaces.isEmpty && notams.isEmpty }
}

/// A route point's menu (PGF.pointMenu).
struct PointMenuModel: Codable, Equatable, Sendable {
    struct Request: Codable, Equatable, Sendable {
        var on: Bool
        var allowed: Bool
        var stopMin: Int?
    }
    struct Requests: Codable, Equatable, Sendable {
        var tng: Request
        var stop: Request
    }
    struct StopLimits: Codable, Equatable, Sendable {
        var `default`: Int
        var max: Int
    }
    var uid: String
    var name: String
    var kind: String
    var kindLabel: String
    var index: Int
    /// "departure", "destination" or nil.
    var end: String?
    var last: Bool
    var aerodromeId: String?
    var requests: Requests?
    var stopMin: StopLimits
    var charts: [VfrChartLink]
}

/// The map's layers (src/shared/mapLayers.ts MapLayers): kept per flight in options.mapLayers.
struct MapLayers: Codable, Equatable, Sendable {
    var base = "light"
    var ofm = false
    var fir = true
    var tma = true
    var zones = true
    var aerodromes = true
    var vfrPoints = true
    var vfrRoutes = true
    var helRoutes = false
    var milRoutes = false
    var navaids = true
    var waypoints = true
    var prd = true
    var mil = true
    var act = true
    var notams = true

    /// The toggles by their MapLayers key.
    static let toggles: [WritableKeyPath<MapLayers, Bool>: String] = [
        \.ofm: "ofm", \.fir: "fir", \.tma: "tma", \.zones: "zones", \.aerodromes: "aerodromes",
        \.vfrPoints: "vfrPoints", \.vfrRoutes: "vfrRoutes", \.helRoutes: "helRoutes", \.milRoutes: "milRoutes",
        \.navaids: "navaids", \.waypoints: "waypoints",
        \.prd: "prd", \.mil: "mil", \.act: "act", \.notams: "notams",
    ]

    func shows(_ key: String) -> Bool {
        Self.toggles.first { $0.value == key }.map { self[keyPath: $0.key] } ?? true
    }

    var json: JSON { (try? JSON.parse(Data(Core.text(self).utf8))) ?? .null }
}

struct MapLayersInfo: Codable, Equatable, Sendable {
    var layers: MapLayers
    var counts: [String: Int]
    var airac: String
}

extension Core {
    /// What a tap at (lat, lon) at map zoom `zoom` shows. `layers`, `notams` (the briefing), `route`: JSON texts.
    func mapInfo(
        ref: String?, lat: Double, lon: Double, zoom: Double, layers: String?, notams: String?, date: String?,
        route: String?
    ) throws -> MapInfo {
        try callDecoding(
            "mapInfo", ref: ref,
            fields: [
                "lat": JSON.number(lat).text, "lon": JSON.number(lon).text, "zoom": JSON.number(zoom).text,
                "layers": layers ?? "null", "notams": notams ?? "null",
                "date": date.map { JSON.string($0).text } ?? "null",
                "route": route ?? "null",
            ])
    }

    /// One aerodrome's details (a route point's "Aerodrome hours…"); `aerodrome`: its id or ICAO.
    func mapInfo(ref: String?, aerodrome: String, notams: String?, date: String?) throws -> MapInfo {
        try callDecoding(
            "mapInfo", ref: ref,
            fields: [
                "aerodrome": JSON.string(aerodrome).text, "notams": notams ?? "null",
                "date": date.map { JSON.string($0).text } ?? "null",
            ])
    }

    /// nil: no point with this uid.
    func pointMenu(ref: String?, route: String, options: String?, uid: String) throws -> PointMenuModel? {
        try callDecoding(
            "pointMenu", ref: ref,
            fields: ["route": route, "options": options ?? "null", "uid": JSON.string(uid).text])
    }

    /// The route's sources ({ sourceId: FeatureCollection }); `handles`: the legs' middle dots.
    func routeFeatures(route: String, selected: String?, handles: Bool) throws -> JSON {
        try callJSON(
            "routeFeatures",
            fields: [
                "route": route, "selected": selected.map { JSON.string($0).text } ?? "null",
                "handles": handles ? "true" : "false",
            ])
    }

    /// The drawing's band (a GeoJSON Feature, or nil before the first point) and its leg readout.
    func drawBand(route: String, toEnd: Bool, lat: Double, lon: Double, date: String?) throws -> (
        band: JSON?, readout: String?
    ) {
        let j = try callJSON(
            "drawBand",
            fields: [
                "route": route, "toEnd": toEnd ? "true" : "false",
                "target": JSON.object(["lat": .number(lat), "lon": .number(lon)]).text,
                "date": date.map { JSON.string($0).text } ?? "null",
            ])
        let band = j["band"].flatMap { $0.isNull ? nil : $0 }
        return (band, j["readout"]?.string)
    }

    /// The name as a custom point takes it, or "" when it cannot be one.
    func waypointName(_ name: String) throws -> String {
        try callJSON("waypointName", fields: ["name": JSON.string(name).text])["name"]?.string ?? ""
    }

    /// `flight`: options.mapLayers; `pilot`: settings.mapLayers (JSON texts).
    func mapLayers(ref: String?, flight: String?, pilot: String?, notams: String?) throws -> MapLayersInfo {
        try callDecoding(
            "mapLayers", ref: ref,
            fields: ["flight": flight ?? "null", "pilot": pilot ?? "null", "notams": notams ?? "null"])
    }
}

// MARK: the map's geometry

/// Screen points of the map the editor hit-tests against (the live MLNMapView; a fake in tests).
@MainActor
protocol MapProjecting: AnyObject {
    func point(for c: CLLocationCoordinate2D) -> CGPoint
    func coordinate(for p: CGPoint) -> CLLocationCoordinate2D
    var zoom: Double { get }
}

// MARK: the editor

@MainActor
final class RouteEditor: ObservableObject {
    enum Mode: String {
        case idle, draw, custom
    }

    /// Something shown beside a screen point of the map.
    struct Anchored<Value>: Identifiable {
        let id = UUID()
        var at: CGPoint
        var value: Value
    }

    /// The hover box: the snap target and the leg while drawing, what is under the pointer otherwise.
    struct Tip: Equatable {
        var at: CGPoint
        var title: String?
        var lines: [String]
    }

    /// A name asked for (a custom point, a rename).
    struct NamePrompt: Identifiable {
        let id = UUID()
        var title: String
        var value: String
        var invalid = false
        fileprivate var answer: (String?) -> Void
    }

    /// The minutes on the ground of a stop request.
    struct StopPrompt: Identifiable {
        let id = UUID()
        var uid: String
        var title: String
        var value: String
    }

    /// A drag of a route point (`insert` false) or of a leg's middle dot (`insert`: a new point).
    private struct Drag {
        var uid: String
        var index: Int
        var insert: Bool
        var start: CGPoint
        var moved = false
        var base: [JSON]
        var orig: JSON
        var hit: CoreSnap?
    }

    let model: FlightModel
    private let app: AppModel
    weak var projection: MapProjecting?

    @Published private(set) var mode: Mode = .idle
    /// Drawing appends after the last point even on a round trip ("Continue drawing").
    @Published private(set) var toEnd = false
    @Published var selected: String?
    /// The route's sources as drawn now (the drag, the edits not saved yet).
    @Published private(set) var routeData: JSON?
    /// The band and the snap mark while drawing or dragging.
    @Published private(set) var drawData: JSON?
    @Published var tip: Tip?
    @Published var namePrompt: NamePrompt?
    @Published var stopPrompt: StopPrompt?
    @Published var menu: Anchored<PointMenuModel>?
    @Published var info: Anchored<MapInfo>?
    @Published var message: String?
    @Published private(set) var layers = MapLayers()
    @Published private(set) var counts: [String: Int] = [:]
    @Published private(set) var airac = ""
    /// The pilot's home aerodrome: where an empty route's map looks.
    @Published private(set) var home: CLLocationCoordinate2D?
    /// Bumped to frame the route.
    @Published private(set) var fitRequest = 0
    /// The editing hint (the website's per-browser "Editing tips").
    @Published var tips: Bool {
        didSet { UserDefaults.standard.set(tips, forKey: Self.tipsKey) }
    }
    private static let tipsKey = "pgf.map.tips"

    private var drag: Drag?
    /// What drawing needs to know of the route as drawn (PGF.routeInfo).
    @Published private var routeInfo: CoreRouteInfo?
    /// The route of the edits computed and not yet applied to the flight: the next edit starts from it.
    private var intended: (route: [JSON], overrides: JSON)?
    private var computeTail: Task<Void, Never>?
    private var saveTail: Task<Void, Never>?
    private var pendingSaves = 0
    private var routeDataBusy = false
    private var routeDataDirty = false
    private var moveBusy = false
    private var hoverBusy = false
    private var refText: String?

    init(model: FlightModel, app: AppModel) {
        self.model = model
        self.app = app
        tips = UserDefaults.standard.object(forKey: Self.tipsKey) as? Bool ?? true
    }

    private var core: Core? { app.core }
    private var readOnly: Bool { model.readOnly }
    /// A local flight (A → A, nothing between) is not drawn on: the Route section's Local flight toggle
    /// sets it, and the map only shows it.
    var local: Bool {
        let r = model.route
        guard r.count == 2, r.allSatisfy({ $0["kind"]?.string == "aerodrome" }) else { return false }
        return r[0]["refId"]?.string != nil && r[0]["refId"]?.string == r[1]["refId"]?.string
    }
    private var ref: String? {
        if refText == nil { refText = app.store.text(.ref) }
        return refText
    }

    /// The route as drawn: the drag's, else the edits not saved yet, else the flight's.
    var route: [JSON] { drawnRoute ?? intended?.route ?? model.route }
    @Published private var drawnRoute: [JSON]?

    // MARK: following the flight

    /// The flight changed (an edit, an undo, a reload): the drawing follows.
    func flightChanged() {
        if selected.map({ uid in !model.route.contains { $0["uid"]?.string == uid } }) == true { selected = nil }
        if model.route.isEmpty && mode == .idle && !readOnly && model.flight != nil { mode = .draw }
        if local && mode != .idle { stopDrawing() }
        refreshLayers()
        refreshRouteData()
    }

    /// Opening: drawing when there is no route yet (or only a bare round trip).
    func start() async {
        refText = app.store.text(.ref)
        if let pilot = app.store.read(.pilot).flatMap({ try? JSON.parse($0) }),
            let code = pilot["homeAerodrome"]?.string, let ref = refText.flatMap({ try? JSON.parse($0) })
        {
            home = Places.aerodromes(ref: ref).first { $0.code == code || $0.refId == code }?.coordinate
        }
        if !readOnly, model.flight != nil {
            let info = await currentRouteInfo()
            if !local && (model.route.count < 2 || info?.bareRoundTrip == true) { mode = .draw }
        }
        flightChanged()
    }

    func refreshLayers() {
        guard let core else { return }
        let flight = model.flight?["options"]?["mapLayers"]?.text
        let pilot = app.store.read(.pilot).flatMap { try? JSON.parse($0) }?["settings"]?["mapLayers"]?.text
        let notams = app.store.text(.notams(model.id))
        guard let ref, let info = try? core.mapLayers(ref: ref, flight: flight, pilot: pilot, notams: notams) else {
            return
        }
        // a viewer's choice is not saved: it holds while the map is open
        if !(readOnly && layersChangedHere) { layers = info.layers }
        counts = info.counts
        airac = info.airac
    }
    private var layersChangedHere = false

    func refreshRouteData() {
        guard core != nil else { return }
        if routeDataBusy {
            routeDataDirty = true
            return
        }
        routeDataBusy = true
        Task {
            repeat {
                routeDataDirty = false
                let text = JSON.array(route).text
                let sel = selected
                let handles = mode == .idle && drag == nil && !readOnly && !local
                if let d = try? await core?.run({ try $0.routeFeatures(route: text, selected: sel, handles: handles) })
                {
                    routeData = d
                }
                routeInfo = try? await core?.run { try $0.routeInfo(route: text) }
            } while routeDataDirty
            routeDataBusy = false
        }
    }

    // MARK: modes

    func setMode(_ m: Mode) {
        if local && m != .idle { return }
        toEnd = false
        mode = m
        if m == .idle { stopDrawing() } else { refreshRouteData() }
    }

    func stopDrawing() {
        mode = .idle
        toEnd = false
        tip = nil
        drawData = nil
        refreshRouteData()
    }

    func fit() { fitRequest += 1 }

    /// The hint over the map (RouteMap's, in its touch wording).
    var hint: String {
        if readOnly { return "" }
        if local { return "Local flight · turn off Local flight in Route to draw a route" }
        let closing = mode != .idle && !toEnd && routeInfo?.roundTrip == true ? route.last?["name"]?.string : nil
        switch mode {
        case .custom:
            return closing.map { "Tap to place a custom point before \($0) and name it" }
                ?? "Tap to place a custom point and name it"
        case .draw:
            if route.isEmpty { return "Tap your departure aerodrome to start" }
            return closing.map { "Tap to add points before the return to \($0) · tap \($0) to finish" }
                ?? "Tap to add points · tap the last point to finish"
        case .idle:
            return route.count >= 2
                ? "Press and hold a point to move it · drag a leg’s middle dot to insert · tap a point for options"
                : ""
        }
    }

    // MARK: hit tests (RouteMap hitPoint, hitMid)

    private func coord(_ p: JSON?) -> CLLocationCoordinate2D? {
        guard let lat = p?["lat"]?.double, let lon = p?["lon"]?.double else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private static func sameSpot(_ a: JSON?, _ b: JSON?) -> Bool {
        guard let a, let b else { return false }
        return a["lat"] == b["lat"] && a["lon"] == b["lon"]
    }

    /// The route point within 10 pt (the last drawn on top).
    func hitPoint(_ p: CGPoint) -> Int? {
        guard let projection else { return nil }
        var best: Int?
        var bd: CGFloat = 10
        for i in route.indices.reversed() {
            guard let c = coord(route[i]) else { continue }
            let q = projection.point(for: c)
            let d = hypot(q.x - p.x, q.y - p.y)
            if d < bd {
                bd = d
                best = i
            }
        }
        return best
    }

    /// The leg whose middle dot is within 8 pt.
    func hitMid(_ p: CGPoint) -> Int? {
        guard let projection, route.count >= 2 else { return nil }
        // a zero-length leg (a local flight) has nothing to split
        if route.count == 2, Self.sameSpot(route[0], route[1]) { return nil }
        for i in 0..<(route.count - 1) {
            guard let a = coord(route[i]), let b = coord(route[i + 1]) else { continue }
            let q = projection.point(for: Self.mercatorMid(a, b))
            if hypot(q.x - p.x, q.y - p.y) <= 8 { return i }
        }
        return nil
    }

    /// The middle of a leg as the map draws it (routeEdit.ts mercatorMid).
    static func mercatorMid(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
        let y = { (lat: Double) in log(tan(Double.pi / 4 + lat * Double.pi / 360)) }
        let ym = (y(a.latitude) + y(b.latitude)) / 2
        return CLLocationCoordinate2D(
            latitude: atan(sinh(ym)) * 180 / Double.pi, longitude: (a.longitude + b.longitude) / 2)
    }

    /// Where drawing adds its next point (PGF.routeInfo drawIndex: before a round trip's closing point).
    private func drawIndex() async -> Int {
        if toEnd { return route.count }
        return await currentRouteInfo()?.drawIndex ?? route.count
    }

    private func currentRouteInfo() async -> CoreRouteInfo? {
        let text = JSON.array(route).text
        let info = try? await core?.run { try $0.routeInfo(route: text) }
        if let info { routeInfo = info }
        return info
    }

    private func near(_ q: JSON?, _ p: CGPoint) -> Bool {
        guard let projection, let c = coord(q) else { return false }
        let s = projection.point(for: c)
        return hypot(s.x - p.x, s.y - p.y) <= 8
    }

    // MARK: snapping

    private var layersText: String { layers.json.text }

    private func snap(_ p: CGPoint, exceptUid: String? = nil, newUid: String? = nil) async -> CoreSnap? {
        guard let core, let projection else { return nil }
        let c = projection.coordinate(for: p)
        let zoom = projection.zoom
        let (ref, route, waypoints, layers) = (ref, JSON.array(route).text, app.store.text(.waypoints), layersText)
        let s = try? await core.run {
            try $0.snap(
                ref: ref, route: route, waypoints: waypoints, layers: layers, lat: c.latitude, lon: c.longitude,
                zoom: zoom, exceptUid: exceptUid, newUid: newUid)
        }
        return s?.hit == nil ? nil : s
    }

    private func snapDetail(_ hit: CoreSnap.Hit) -> String {
        guard let s = hit.shadowed else { return hit.cand.detail }
        let nm = Places.distanceNm(hit.cand.lat, hit.cand.lon, s.lat, s.lon)
        return "\(hit.cand.detail) · \(s.name) (\(String(format: "%.1f", nm)) NM away): zoom in to pick it"
    }

    private func showDraw(band: JSON?, snapAt: CoreSnapCandidate?) {
        let empty: JSON = ["type": "FeatureCollection", "features": []]
        var snapFC = empty
        if let c = snapAt {
            snapFC = [
                "type": "Feature", "properties": [:],
                "geometry": ["type": "Point", "coordinates": [.number(c.lon), .number(c.lat)]],
            ]
        }
        drawData = ["route-band": band ?? empty, "snap": snapFC]
    }

    // MARK: taps

    func tap(at p: CGPoint) {
        Task { await handleTap(p) }
    }

    func handleTap(_ p: CGPoint) async {
        if mode == .idle {
            let hadDetails = info != nil
            info = nil
            tip = nil
            if let i = hitPoint(p) {
                let uid = route[i]["uid"]?.string
                selected = uid
                refreshRouteData()
                if let uid, !readOnly { await openMenu(uid: uid, at: p) }
                return
            }
            if selected != nil {
                selected = nil
                refreshRouteData()
            }
            // a second tap closes the details
            if hadDetails { return }
            await openInfo(at: p)
            return
        }
        guard !readOnly else { return }
        let at = await drawIndex()
        let last = at > 0 ? route[at - 1] : nil
        let next = at < route.count ? route[at] : nil
        if (last != nil && route.count >= 2 && near(last, p)) || near(next, p) {
            stopDrawing()
            return
        }
        let hit = mode == .custom ? nil : await snap(p, newUid: Places.newUid())
        if let hit, let h = hit.hit, let point = hit.point {
            let same = { (q: JSON?) in q?["lat"]?.double == h.cand.lat && q?["lon"]?.double == h.cand.lon }
            if same(last) { return }
            if same(next) {
                stopDrawing()
                return
            }
            await apply(.add(point: point, toEnd: toEnd))
            return
        }
        guard let projection else { return }
        await placeCustom(projection.coordinate(for: p))
    }

    private func placeCustom(_ c: CLLocationCoordinate2D) async {
        guard let name = await askName("Name this point", value: await autoName()) else { return }
        await apply(.add(point: Self.customPoint(uid: Places.newUid(), name: name, c), toEnd: toEnd))
    }

    static func customPoint(uid: String, name: String, _ c: CLLocationCoordinate2D) -> JSON {
        let r = { (x: Double) in (x * 1e6).rounded() / 1e6 }
        return [
            "uid": .string(uid), "kind": "custom", "refId": nil, "name": .string(name),
            "lat": .number(r(c.latitude)), "lon": .number(r(c.longitude)),
        ]
    }

    private func autoName() async -> String {
        await currentRouteInfo()?.autoWaypointName ?? "WP1"
    }

    /// iPad: a secondary click on a point opens its menu; elsewhere it ends drawing.
    func secondaryClick(at p: CGPoint) {
        guard !readOnly else { return }
        if let i = hitPoint(p), let uid = route[i]["uid"]?.string {
            selected = uid
            refreshRouteData()
            Task { await openMenu(uid: uid, at: p) }
        } else if mode != .idle && !route.isEmpty {
            stopDrawing()
        }
    }

    // MARK: hover (iPad pointer)

    func hover(at p: CGPoint?) {
        guard let p, drag == nil else {
            if drag == nil {
                tip = nil
                if mode != .idle { showDraw(band: nil, snapAt: nil) }
            }
            return
        }
        guard !hoverBusy else { return }
        hoverBusy = true
        Task {
            defer { hoverBusy = false }
            if mode == .idle {
                guard info == nil, menu == nil else { return }
                if let i = hitPoint(p) {
                    tip = Tip(at: p, title: route[i]["name"]?.string, lines: [])
                    return
                }
                if hitMid(p) != nil {
                    tip = Tip(at: p, title: nil, lines: ["Drag to insert a point"])
                    return
                }
                tip = await infoAt(p).flatMap { Self.tipOf($0, at: p) }
                return
            }
            guard let core, let projection else { return }
            let hit = mode == .custom ? nil : await snap(p)
            let target =
                hit?.hit.map { CLLocationCoordinate2D(latitude: $0.cand.lat, longitude: $0.cand.lon) }
                ?? projection.coordinate(for: p)
            let (text, toEnd, date) = (JSON.array(route).text, toEnd, model.date)
            let band = try? await core.run {
                try $0.drawBand(route: text, toEnd: toEnd, lat: target.latitude, lon: target.longitude, date: date)
            }
            showDraw(band: band?.band, snapAt: hit?.hit?.cand)
            var lines: [String] = []
            if let h = hit?.hit {
                lines.append(snapDetail(h))
            } else {
                lines.append(route.isEmpty ? "Tap to start at a custom point" : "Custom point: tap and name it")
            }
            if let r = band?.readout, !r.isEmpty { lines.append(r) }
            tip = Tip(at: p, title: hit?.hit?.cand.name, lines: lines)
        }
    }

    /// The hover box of what is under the pointer (RouteMap's map-tip).
    static func tipOf(_ i: MapInfo, at p: CGPoint) -> Tip? {
        var lines: [String] = []
        var title: String?
        if let a = i.aerodrome {
            title = a.title + (a.elevFt.map { " · \($0) ft" } ?? "")
            lines.append(a.hoursLine)
            if !a.handlingLine.isEmpty { lines.append(a.handlingLine) }
        }
        if let n = i.navaid { lines.append("\(n.type) \(n.title) · \(n.freq)") }
        for a in i.airspaces.prefix(4) { lines.append("\(a.type) \(a.title) · \(a.vertical)") }
        if i.airspaces.count > 4 { lines.append("+\(i.airspaces.count - 4) more") }
        for n in i.notams.prefix(4) { lines.append("NOTAM \(n.key) · \(n.subject) · \(n.limits)") }
        guard title != nil || !lines.isEmpty else { return nil }
        return Tip(at: p, title: title, lines: lines + ["Click for details"])
    }

    // MARK: details

    private func infoAt(_ p: CGPoint) async -> MapInfo? {
        guard let core, let projection else { return nil }
        let c = projection.coordinate(for: p)
        let zoom = projection.zoom
        let (ref, layers, notams, date, route) = (
            ref, layersText, app.store.text(.notams(model.id)), model.date, JSON.array(route).text
        )
        let i = try? await core.run {
            try $0.mapInfo(
                ref: ref, lat: c.latitude, lon: c.longitude, zoom: zoom, layers: layers, notams: notams, date: date,
                route: route)
        }
        return i?.isEmpty == false ? i : nil
    }

    func openInfo(at p: CGPoint) async {
        if let i = await infoAt(p) { info = Anchored(at: p, value: i) }
    }

    /// A route point's "Aerodrome hours…".
    func openAerodrome(_ id: String, at p: CGPoint) async {
        guard let core else { return }
        let (ref, notams, date) = (ref, app.store.text(.notams(model.id)), model.date)
        if let i = try? await core.run({ try $0.mapInfo(ref: ref, aerodrome: id, notams: notams, date: date) }),
            !i.isEmpty
        {
            info = Anchored(at: p, value: i)
        }
    }

    // MARK: dragging (RouteMap onDown, onMove, release)

    /// A press on a route point or a leg's middle dot starts a drag; elsewhere it is the map's.
    func canPress(at p: CGPoint) -> Bool {
        !readOnly && !local && mode == .idle && (hitPoint(p) != nil || hitMid(p) != nil)
    }

    @discardableResult
    func pressBegan(at p: CGPoint) -> Bool {
        guard canPress(at: p) else { return false }
        info = nil
        tip = nil
        if let i = hitPoint(p), let uid = route[i]["uid"]?.string {
            selected = uid
            drag = Drag(uid: uid, index: i, insert: false, start: p, base: route, orig: route[i])
        } else if let leg = hitMid(p), let projection {
            let uid = Places.newUid()
            let c = projection.coordinate(for: p)
            drag = Drag(
                uid: uid, index: leg + 1, insert: true, start: p, base: route,
                orig: Self.customPoint(uid: uid, name: "", c))
        }
        return drag != nil
    }

    func pressMoved(to p: CGPoint) {
        guard var d = drag, let projection else { return }
        if !d.moved && hypot(p.x - d.start.x, p.y - d.start.y) < 3 { return }
        d.moved = true
        drag = d
        guard !moveBusy else { return }
        moveBusy = true
        Task {
            defer { moveBusy = false }
            let hit = await snap(p, exceptUid: d.uid, newUid: d.uid)
            guard var now = drag else { return }
            now.hit = hit
            drag = now
            var moved =
                hit?.point
                ?? Self.customPoint(uid: d.uid, name: d.orig["name"]?.string ?? "", projection.coordinate(for: p))
            moved["uid"] = .string(d.uid)
            var next = d.base.map { $0["uid"]?.string == d.uid ? moved : $0 }
            if d.insert && !d.base.contains(where: { $0["uid"]?.string == d.uid }) {
                next.insert(moved, at: min(d.index, next.count))
            }
            drawnRoute = next
            showDraw(band: nil, snapAt: hit?.hit?.cand)
            tip = hit?.hit.map { Tip(at: p, title: $0.cand.name, lines: [snapDetail($0)]) }
            refreshRouteData()
        }
    }

    func pressEnded(at p: CGPoint) {
        Task { await release(at: p) }
    }

    func pressCancelled() {
        drag = nil
        drawnRoute = nil
        tip = nil
        drawData = nil
        refreshRouteData()
    }

    func release(at p: CGPoint) async {
        guard let d = drag else { return }
        drag = nil
        tip = nil
        drawData = nil
        // a press that did not move: the point's menu (the website's long press)
        if !d.moved {
            drawnRoute = nil
            refreshRouteData()
            if !d.insert { await openMenu(uid: d.uid, at: p) }
            return
        }
        // snap where the finger was lifted (the last move may not have been handled yet)
        let hit = await snap(p, exceptUid: d.uid, newUid: d.uid)
        var point: JSON
        if let hp = hit?.point {
            point = hp
        } else {
            var name = d.orig["kind"]?.string == "custom" && !d.insert ? d.orig["name"]?.string ?? "" : ""
            if name.isEmpty {
                guard
                    let asked = await askName(
                        d.insert ? "Name the new point" : "Name this point", value: await autoName())
                else {
                    drawnRoute = nil
                    refreshRouteData()
                    return
                }
                name = asked
            }
            guard let projection else { return }
            point = Self.customPoint(uid: d.uid, name: name, projection.coordinate(for: p))
        }
        drawnRoute = nil
        let next = await apply(
            d.insert ? .insert(index: d.index, point: point) : .move(uid: d.uid, point: point, newUid: nil))
        if !d.insert {
            selected =
                next?.first {
                    $0["lat"] == point["lat"] && $0["lon"] == point["lon"] && $0["name"] == point["name"]
                }?["uid"]?.string
        }
        refreshRouteData()
    }

    // MARK: names

    /// Asks for a point's name; nil when cancelled.
    func askName(_ title: String, value: String) async -> String? {
        await withCheckedContinuation { cont in
            namePrompt = NamePrompt(title: title, value: value) { cont.resume(returning: $0) }
        }
    }

    /// OK in the name prompt: a name the website takes, else the prompt again with its rule.
    func confirmName(_ text: String) {
        guard let p = namePrompt else { return }
        let name = (try? core?.waypointName(text)) ?? ""
        if name.isEmpty {
            var again = NamePrompt(title: p.title, value: text, answer: p.answer)
            again.invalid = true
            namePrompt = nil
            Task { @MainActor in namePrompt = again }
            return
        }
        namePrompt = nil
        p.answer(name)
    }

    func cancelName() {
        guard let p = namePrompt else { return }
        namePrompt = nil
        p.answer(nil)
    }

    // MARK: edits

    /// One edit of the route, from the route as the edits before it left it; saved in order.
    @discardableResult
    func apply(_ op: CoreRouteOp) async -> [JSON]? {
        guard let core, !readOnly else { return nil }
        var result: [JSON]?
        let prev = computeTail
        let t = Task { @MainActor in
            await prev?.value
            let base = intended ?? (model.route, model.flight?["legOverrides"] ?? .object([:]))
            let (routeText, overridesText) = (JSON.array(base.route).text, base.overrides.text)
            guard
                let edit = try? await core.run({ try $0.routeEdit(route: routeText, legOverrides: overridesText, op) }),
                let next = edit.route.array
            else { return }
            intended = (next, edit.legOverrides)
            result = next
            refreshRouteData()
            save(route: edit.route, overrides: edit.legOverrides)
        }
        computeTail = t
        await t.value
        return result
    }

    private func save(route: JSON, overrides: JSON) {
        pendingSaves += 1
        let prev = saveTail
        saveTail = Task { @MainActor in
            await prev?.value
            await model.edit { f in
                f["route"] = route
                f["legOverrides"] = overrides
            }
            pendingSaves -= 1
            if pendingSaves == 0 {
                intended = nil
                refreshRouteData()
                Task { await model.routeChanged() }
            }
        }
    }

    /// Waits for the edits made so far to be saved (tests).
    func settle() async {
        await computeTail?.value
        await saveTail?.value
    }

    // MARK: the point menu

    func openMenu(uid: String, at p: CGPoint) async {
        guard let core else { return }
        let (ref, text, options) = (ref, JSON.array(route).text, model.flight?["options"]?.text)
        if let m = try? await core.run({ try $0.pointMenu(ref: ref, route: text, options: options, uid: uid) }) {
            menu = Anchored(at: p, value: m)
        }
    }

    func rename(uid: String, current: String) async {
        guard let name = await askName("Rename point", value: current), name != current else { return }
        await apply(.rename(uid: uid, name: name))
    }

    func remove(uid: String) async {
        selected = nil
        await apply(.remove(uid: uid))
    }

    /// "Continue drawing" from the last point.
    func continueDrawing() {
        selected = nil
        mode = .draw
        toEnd = true
        refreshRouteData()
    }

    /// Touch-and-go or stop on (with the stop's minutes) or off (MapView onRequest).
    func setRequest(uid: String, kind: String, on: Bool, stopMin: Int? = nil) async {
        guard let core, !readOnly else { return }
        let list = model.flight?["options"]?["aerodromeRequests"]?.text
        let op: CoreRequestOp = on ? .set(kind: kind, stopMin: stopMin) : .remove(kind: kind)
        guard let next = try? core.setRequest(list, pointUid: uid, op) else { return }
        await model.edit { f in
            var o = f["options"]?.object ?? [:]
            o["aerodromeRequests"] = next
            f["options"] = .object(o)
        }
    }

    func askStop(_ m: PointMenuModel) {
        let what = m.end == nil ? "Intermediate stop" : "Full stop"
        stopPrompt = StopPrompt(
            uid: m.uid, title: "\(what) at \(m.name): minutes on the ground",
            value: String(m.requests?.stop.stopMin ?? m.stopMin.default))
    }

    func confirmStop(_ text: String) async {
        guard let p = stopPrompt else { return }
        stopPrompt = nil
        guard let n = Double(text.trimmingCharacters(in: .whitespaces)), n.isFinite, n.rounded() > 0 else { return }
        await setRequest(uid: p.uid, kind: "stop", on: true, stopMin: Int(n.rounded()))
    }

    /// "Save to my waypoints": the pilot's new waypoint, and the point becomes it (MapView onSaveWaypoint).
    func saveWaypoint(uid: String) async {
        guard let p = route.first(where: { $0["uid"]?.string == uid }) else { return }
        let w: JSON
        do {
            w = try await app.api.createWaypoint([
                "name": p["name"] ?? "", "lat": p["lat"] ?? 0, "lon": p["lon"] ?? 0, "notes": "",
            ])
        } catch APIError.conflict {
            message = "You already have a waypoint with this name."
            return
        } catch {
            message = "Could not save the waypoint."
            return
        }
        if let d = try? await app.api.waypoints() { try? app.store.write(d, .waypoints) }
        await model.edit { f in
            let route = (f["route"]?.array ?? []).map { q -> JSON in
                guard q["uid"]?.string == uid else { return q }
                var n = q
                n["kind"] = "waypoint"
                n["refId"] = w["id"] ?? nil
                n["name"] = w["name"] ?? q["name"] ?? ""
                return n
            }
            f["route"] = .array(route)
        }
        await model.prepareChart()
    }

    // MARK: layers

    /// The layers menu: kept with the flight (not an undo step, as on the website), the chart redrawn.
    func setLayers(_ l: MapLayers) async {
        layers = l
        layersChangedHere = true
        guard !readOnly else { return }
        let (model, manager) = (self.model, self.model.undoManager)
        model.undoManager = nil
        await model.edit { f in
            // the undo step was not registered: later edits register theirs again
            model.undoManager = manager
            var o = f["options"]?.object ?? [:]
            o["mapLayers"] = l.json
            f["options"] = .object(o)
        }
        model.undoManager = manager
        await model.prepareChart()
    }
}
