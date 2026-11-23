import CoreLocation
import XCTest

@testable import PigsGottaFly

/// MapLibre's Web Mercator at a fixed zoom, as the map projects (512-point tiles), around a centre.
@MainActor
private final class FakeProjection: MapProjecting {
    let zoom: Double
    let center: CLLocationCoordinate2D
    init(center: CLLocationCoordinate2D, zoom: Double = 10) {
        self.center = center
        self.zoom = zoom
    }

    private var world: Double { 512 * pow(2, zoom) }
    private func raw(_ c: CLLocationCoordinate2D) -> CGPoint {
        let s = sin(c.latitude * .pi / 180)
        return CGPoint(x: (c.longitude + 180) / 360 * world, y: (0.5 - log((1 + s) / (1 - s)) / (4 * .pi)) * world)
    }
    func point(for c: CLLocationCoordinate2D) -> CGPoint {
        let p = raw(c)
        let o = raw(center)
        return CGPoint(x: p.x - o.x + 200, y: p.y - o.y + 400)
    }
    func coordinate(for p: CGPoint) -> CLLocationCoordinate2D {
        let o = raw(center)
        let x = p.x - 200 + o.x
        let y = p.y - 400 + o.y
        return CLLocationCoordinate2D(
            latitude: atan(sinh(.pi * (1 - 2 * y / world))) * 180 / .pi, longitude: x / world * 360 - 180)
    }
}

/// The Map tab's editing (RouteEditor) on the fixture flight LGTT → KALAMO → KIMI → LGSY, saved to the
/// fixture server; and the core's map functions it uses (parity: tests/unit/native/map.test.ts).
@MainActor
final class RouteEditorTests: XCTestCase {
    private var transport: FixtureTransport!
    private var model: FlightModel!
    private var editor: RouteEditor!
    private var undo: UndoManager!
    private var projection: FakeProjection?
    private let aliveri = CLLocationCoordinate2D(latitude: 38.4075, longitude: 24.04194)
    private let id = "fixture-lgtt-lgsy"

    override func setUp() async throws {
        transport = FixtureTransport.bundled()!
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        model = FlightModel(id: id, app: app)
        await model.open()
        undo = UndoManager()
        undo.groupsByEvent = false
        editor = RouteEditor(model: model, app: app)
        await editor.start()
    }

    private func names(_ route: [JSON]) -> [String] { route.compactMap { $0["name"]?.string } }
    private var saved: [String] { names(transport.flights[id]?["route"]?.array ?? []) }
    private func project(_ c: CLLocationCoordinate2D, around center: CLLocationCoordinate2D) -> (
        FakeProjection, CGPoint
    ) {
        let p = FakeProjection(center: center)
        // the editor holds it weakly, as it holds the map
        projection = p
        editor.projection = p
        return (p, p.point(for: c))
    }

    private func waitUntil(_ condition: () -> Bool, timeout: TimeInterval = 5) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition() && Date() < end { try? await Task.sleep(for: .milliseconds(20)) }
    }

    func testDrawingSnapsAddsAndUndoes() async throws {
        XCTAssertEqual(editor.mode, .idle, "a planned route opens to look at")
        let (_, at) = project(aliveri, around: aliveri)
        editor.setMode(.draw)
        model.undoManager = undo
        undo.beginUndoGrouping()
        await editor.handleTap(CGPoint(x: at.x + 4, y: at.y - 3))
        await editor.settle()
        undo.endUndoGrouping()
        XCTAssertEqual(names(model.route), ["LGTT", "KALAMO", "KIMI", "LGSY", "ALIVERI"])
        XCTAssertEqual(model.route.last?["kind"]?.string, "vfr")
        XCTAssertEqual(model.route.last?["refId"]?.string, "LGTG/ALIVERI")
        // the PUT the server got
        XCTAssertEqual(saved, ["LGTT", "KALAMO", "KIMI", "LGSY", "ALIVERI"])
        XCTAssertEqual(transport.flights[id]?["legOverrides"]?["p2>p3"]?["altFt"]?.int, 5500, "overrides kept")

        // tapping the point drawn last ends the drawing
        await editor.handleTap(at)
        XCTAssertEqual(editor.mode, .idle)

        undo.undo()
        await waitUntil { model.route.count == 4 && !model.saving }
        XCTAssertEqual(names(model.route), ["LGTT", "KALAMO", "KIMI", "LGSY"])
    }

    func testACustomPointIsNamed() async throws {
        let sea = CLLocationCoordinate2D(latitude: 38.0, longitude: 24.6)
        let (_, at) = project(sea, around: sea)
        editor.setMode(.custom)
        let tap = Task { await editor.handleTap(at) }
        await waitUntil { editor.namePrompt != nil }
        XCTAssertEqual(editor.namePrompt?.value, "WP1")
        editor.confirmName("bad!")
        await waitUntil { editor.namePrompt?.invalid == true }
        editor.confirmName(" my point ")
        await tap.value
        await editor.settle()
        let last = try XCTUnwrap(model.route.last)
        XCTAssertEqual(last["name"]?.string, "MY POINT")
        XCTAssertEqual(last["kind"]?.string, "custom")
        XCTAssertEqual(last["lat"]?.double ?? 0, 38.0, accuracy: 1e-5)
        XCTAssertEqual(saved.last, "MY POINT")
    }

    func testDraggingAMiddleDotInsertsAndAPointMoves() async throws {
        let kalamo = CLLocationCoordinate2D(latitude: 38.29194, longitude: 23.86361)
        let kimi = CLLocationCoordinate2D(latitude: 38.64556, longitude: 24.15472)
        let (p, _) = project(kalamo, around: kalamo)
        let mid = p.point(for: RouteEditor.mercatorMid(kalamo, kimi))
        XCTAssertTrue(editor.pressBegan(at: mid))
        editor.pressMoved(to: p.point(for: aliveri))
        await editor.release(at: p.point(for: aliveri))
        await editor.settle()
        XCTAssertEqual(names(model.route), ["LGTT", "KALAMO", "ALIVERI", "KIMI", "LGSY"])

        // a held point that does not move: its menu
        let k = p.point(for: kalamo)
        XCTAssertTrue(editor.pressBegan(at: k))
        await editor.release(at: k)
        XCTAssertEqual(editor.menu?.value.name, "KALAMO")
        XCTAssertEqual(editor.menu?.value.kindLabel, "VFR reporting point")
        XCTAssertFalse(editor.menu?.value.charts.isEmpty ?? true, "the chart KALAMO is printed on")

        // the map elsewhere is the map's
        XCTAssertFalse(editor.canPress(at: CGPoint(x: -500, y: -500)))
    }

    func testPointMenuRequestsAndRemove() async throws {
        let lgsy = try XCTUnwrap(model.route.last)
        let uid = try XCTUnwrap(lgsy["uid"]?.string)
        await editor.openMenu(uid: uid, at: .zero)
        let m = try XCTUnwrap(editor.menu?.value)
        XCTAssertEqual(m.end, "destination")
        XCTAssertEqual(m.aerodromeId, "LGSY")
        XCTAssertTrue(m.last)

        await editor.setRequest(uid: uid, kind: "touch-and-go", on: true)
        let requests = transport.flights[id]?["options"]?["aerodromeRequests"]?.array ?? []
        XCTAssertTrue(requests.contains { $0["pointUid"]?.string == uid && $0["kind"]?.string == "touch-and-go" })

        editor.askStop(m)
        XCTAssertEqual(editor.stopPrompt?.title, "Full stop at LGSY: minutes on the ground")
        await editor.confirmStop("45")
        let stop = (transport.flights[id]?["options"]?["aerodromeRequests"]?.array ?? []).first {
            $0["kind"]?.string == "stop"
        }
        XCTAssertEqual(stop?["stopMin"]?.int, 45)

        await editor.openAerodrome("LGSY", at: .zero)
        XCTAssertEqual(editor.info?.value.aerodrome?.icao, "LGSY")
        XCTAssertFalse(editor.info?.value.aerodrome?.hoursLine.isEmpty ?? true)

        let kimi = try XCTUnwrap(model.route[2]["uid"]?.string)
        await editor.remove(uid: kimi)
        await editor.settle()
        XCTAssertEqual(saved, ["LGTT", "KALAMO", "LGSY"])
    }

    func testTapShowsTheDetailsAndLayersAreKeptWithTheFlight() async throws {
        let tt = CLLocationCoordinate2D(latitude: 38.10861, longitude: 23.78333)
        let (_, _) = project(tt, around: tt)
        // beside LGTT (not on the route point): the airspaces there
        await editor.openInfo(at: CGPoint(x: 260, y: 400))
        XCTAssertFalse(editor.info?.value.airspaces.isEmpty ?? true)

        model.undoManager = undo
        var l = editor.layers
        XCTAssertTrue(l.tma)
        l.tma = false
        l.base = "terrain"
        await editor.setLayers(l)
        XCTAssertEqual(transport.flights[id]?["options"]?["mapLayers"]?["tma"]?.bool, false)
        XCTAssertEqual(transport.flights[id]?["options"]?["mapLayers"]?["base"]?.string, "terrain")
        XCTAssertFalse(undo.canUndo, "the layers are not an undo step")
        editor.refreshLayers()
        XCTAssertEqual(editor.layers.base, "terrain")
        XCTAssertGreaterThan(editor.counts["prd"] ?? 0, 0)
    }

    func testSavingAWaypointPostsWhatTheWebsiteSends() async throws {
        var posted: JSON?
        let fake = FakeTransport { req in
            if req.httpMethod == "POST", req.url?.path.hasSuffix("/waypoints") == true {
                posted = try JSON.parse(req.httpBody ?? Data())
                return (201, Data(#"{"id":"w9","name":"MY POINT","lat":38,"lon":24.6,"notes":""}"#.utf8), [:])
            }
            if req.httpMethod == "POST" { return (409, Data(#"{"error":"exists"}"#.utf8), [:]) }
            return (200, Data("[]".utf8), [:])
        }
        let app = AppModel(arguments: ["-noNetwork"], api: API(transport: fake), store: temporaryStore())
        let editor = RouteEditor(model: model, app: app)
        let custom = RouteEditor.customPoint(
            uid: "c1", name: "MY POINT", CLLocationCoordinate2D(latitude: 38, longitude: 24.6))
        await model.edit { f in f["route"] = .array((f["route"]?.array ?? []) + [custom]) }
        await editor.saveWaypoint(uid: "c1")
        XCTAssertEqual(posted, ["name": "MY POINT", "lat": 38, "lon": 24.6, "notes": ""])
        XCTAssertEqual(model.route.last?["kind"]?.string, "waypoint")
        XCTAssertEqual(model.route.last?["refId"]?.string, "w9")
    }

    func testCoreMapFunctions() throws {
        let core = try Core.bundled()
        let ref = try Fixtures.text("ref.json")
        let route = try JSON.parse(try Fixtures.text("flight.json"))["route"]!.text
        let i = try core.mapInfo(
            ref: ref, lat: 38.10861, lon: 23.78333, zoom: 10, layers: nil, notams: nil, date: "2026-11-22", route: route
        )
        XCTAssertEqual(i.aerodrome?.icao, "LGTT")
        XCTAssertNil(try core.pointMenu(ref: nil, route: route, options: nil, uid: "nope"))
        XCTAssertEqual(try core.pointMenu(ref: nil, route: route, options: nil, uid: "p1")?.end, "departure")
        let f = try core.routeFeatures(route: route, selected: "p2", handles: false)
        XCTAssertEqual(f["route-points"]?["features"]?.array?.count, 4)
        XCTAssertEqual(f["route-mid"]?["features"]?.array?.count, 0)
        let band = try core.drawBand(route: route, toEnd: false, lat: 38.5, lon: 24.6, date: "2026-11-22")
        XCTAssertEqual(band.band?["geometry"]?["coordinates"]?.array?.count, 2)
        XCTAssertTrue(band.readout?.hasSuffix("NM") ?? false)
        XCTAssertEqual(try core.waypointName(" ab c "), "AB C")
        XCTAssertEqual(
            try core.mapLayers(ref: nil, flight: nil, pilot: #"{"tma":false}"#, notams: nil).layers.tma, false)
    }
}
