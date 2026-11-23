import CoreLocation
import MapLibre
import SwiftUI

/// The planning chart of the Map tab: the core's chart style and data as Fly's ChartMapView draws
/// them, the route's own sources from the editor (they follow a drag or an edit at once), the flight's
/// layers and base map switched in place, and the gestures of the website's RouteMap: a tap, a press
/// and hold on a route point or a leg's middle dot to drag it, a pointer drag, a secondary click and
/// hover on iPad.
struct EditableChartMap: UIViewRepresentable {
    var styleURL: URL?
    var chartData: JSON?
    /// The route's sources (PGF.routeFeatures) and the drawing's band and snap mark, over chartData's.
    var routeData: JSON?
    var drawData: JSON?
    var symbols: [SymbolInfo]
    var layers: MapLayers
    /// The style's layer ids by layer toggle (PGF.layerGroups).
    var layerGroups: [String: [String]]
    /// Where to look first when the route has no points (the pilot's home aerodrome).
    var home: CLLocationCoordinate2D?
    var fitRequest: Int
    let editor: RouteEditor

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let v = MLNMapView(frame: .zero)
        v.delegate = context.coordinator
        v.allowsTilting = false
        v.allowsRotating = false
        // north stays up (as on the website), and the compass would sit under the map's tools
        v.compassView.compassVisibility = .hidden
        // even hidden it takes touches: out from under the tools
        v.compassViewPosition = .bottomLeft
        v.showsUserLocation = false
        // the map's middle is the view's (the bars float over the map; a tap's place is where it shows)
        v.automaticallyAdjustsContentInset = false
        v.minimumZoomLevel = 4
        v.maximumZoomLevel = 14
        v.accessibilityIdentifier = "map"
        v.accessibilityLabel = "Route map"
        context.coordinator.attach(v)
        context.coordinator.update(self, v)
        return v
    }

    func updateUIView(_ v: MLNMapView, context: Context) {
        context.coordinator.update(self, v)
    }

    @MainActor
    final class Coordinator: NSObject, MLNMapViewDelegate, UIGestureRecognizerDelegate, MapProjecting {
        private var parent: EditableChartMap
        private weak var mapView: MLNMapView?
        private var styleURL: URL?
        private var styleLoaded = false
        private var applied: JSON?
        private var appliedRoute: JSON?
        private var appliedDraw: JSON?
        private var appliedLayers: MapLayers?
        private var framed = false
        private var lastFit = 0
        /// The base map's vector layers that the vector style itself shows (some it hides).
        private var vectorShown: Set<String> = []
        private var dragging = false

        init(_ parent: EditableChartMap) {
            self.parent = parent
            lastFit = parent.fitRequest
        }

        // MARK: MapProjecting

        func point(for c: CLLocationCoordinate2D) -> CGPoint {
            mapView?.convert(c, toPointTo: mapView) ?? .zero
        }

        func coordinate(for p: CGPoint) -> CLLocationCoordinate2D {
            mapView?.convert(p, toCoordinateFrom: mapView) ?? CLLocationCoordinate2D()
        }

        var zoom: Double { mapView?.zoomLevel ?? 8 }

        // MARK: setting up

        func attach(_ v: MLNMapView) {
            mapView = v
            parent.editor.projection = self
            frameInitial(v)

            let tap = UITapGestureRecognizer(target: self, action: #selector(onTap(_:)))
            // the map's double-tap zoom comes first: a single tap waits for it to fail
            for g in v.gestureRecognizers ?? [] {
                if let t = g as? UITapGestureRecognizer, t.numberOfTapsRequired == 2 { tap.require(toFail: t) }
            }
            v.addGestureRecognizer(tap)

            let press = UILongPressGestureRecognizer(target: self, action: #selector(onDrag(_:)))
            press.minimumPressDuration = 0.35
            press.delegate = self
            v.addGestureRecognizer(press)

            // a pointer drags a point at once, as the website's mouse does
            let pointerDrag = UIPanGestureRecognizer(target: self, action: #selector(onDrag(_:)))
            pointerDrag.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
            pointerDrag.delegate = self
            v.addGestureRecognizer(pointerDrag)

            let secondary = UITapGestureRecognizer(target: self, action: #selector(onSecondary(_:)))
            secondary.buttonMaskRequired = .secondary
            // a button mask alone does not keep a finger's tap out
            secondary.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
            v.addGestureRecognizer(secondary)

            v.addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(onHover(_:))))
        }

        private func frameInitial(_ v: MLNMapView) {
            if let c = LaunchArgs.value("-mapCamera")?.split(separator: ",").compactMap({ Double($0) }), c.count == 3 {
                framed = true
                v.setCenter(CLLocationCoordinate2D(latitude: c[0], longitude: c[1]), zoomLevel: c[2], animated: false)
                return
            }
            let route = parent.editor.model.routeCoordinates
            if let first = route.first {
                v.setCenter(first, zoomLevel: 9, animated: false)
            } else if let home = parent.home {
                v.setCenter(home, zoomLevel: 8.5, animated: false)
            } else {
                // the LGGG FIR (style.ts LGGG_BOUNDS)
                v.setVisibleCoordinateBounds(
                    MLNCoordinateBounds(
                        sw: CLLocationCoordinate2D(latitude: 34.5, longitude: 19.2),
                        ne: CLLocationCoordinate2D(latitude: 41.9, longitude: 29.8)),
                    animated: false)
            }
        }

        func update(_ parent: EditableChartMap, _ v: MLNMapView) {
            self.parent = parent
            parent.editor.projection = self
            if let u = parent.styleURL, u != styleURL {
                styleURL = u
                styleLoaded = false
                applied = nil
                v.styleURL = u
            }
            if !framed, parent.editor.model.routeCoordinates.count >= 2, v.bounds.width > 0 {
                framed = true
                frame(v, maxZoom: 10, animated: false)
            }
            if parent.fitRequest != lastFit {
                lastFit = parent.fitRequest
                fit(v)
            }
            guard styleLoaded, let style = v.style else { return }
            applyData(style)
            applyLayers(style)
        }

        // MARK: MLNMapViewDelegate

        nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated {
                for info in parent.symbols {
                    style.setImage(Symbols.image(info), forName: info.name)
                }
                vectorShown = Set(
                    style.layers.filter { $0.identifier.hasPrefix("vb-") && $0.isVisible }.map(\.identifier))
                styleLoaded = true
                applied = nil
                appliedRoute = nil
                appliedDraw = nil
                appliedLayers = nil
                applyData(style)
                applyLayers(style)
            }
        }

        // MARK: the chart

        private func setSource(_ style: MLNStyle, _ id: String, _ fc: JSON) {
            guard let source = style.source(withIdentifier: id) as? MLNShapeSource, let d = try? fc.data() else {
                return
            }
            source.shape = try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
        }

        private func applyData(_ style: MLNStyle) {
            let routeKeys = Set(parent.routeData?.object?.keys.map { $0 } ?? [])
            if let data = parent.chartData, data != applied, let sources = data.object {
                applied = data
                for (id, fc) in sources where !routeKeys.contains(id) { setSource(style, id, fc) }
                appliedRoute = nil
            }
            if let r = parent.routeData, r != appliedRoute, let sources = r.object {
                appliedRoute = r
                for (id, fc) in sources { setSource(style, id, fc) }
            }
            let draw =
                parent.drawData ?? [
                    "route-band": .object(["type": "FeatureCollection", "features": []]),
                    "snap": .object(["type": "FeatureCollection", "features": []]),
                ]
            if draw != appliedDraw, let sources = draw.object {
                appliedDraw = draw
                for (id, fc) in sources { setSource(style, id, fc) }
            }
        }

        /// The layer toggles and the base map, switched in place as the website's map does.
        private func applyLayers(_ style: MLNStyle) {
            let l = parent.layers
            guard l != appliedLayers else { return }
            appliedLayers = l
            for (key, ids) in parent.layerGroups {
                for id in ids { style.layer(withIdentifier: id)?.isVisible = l.shows(key) }
            }
            style.layer(withIdentifier: "ofm")?.isVisible = l.ofm
            for layer in style.layers {
                let id = layer.identifier
                for b in ["light", "terrain", "street"] {
                    if id.hasPrefix("vb-\(b):") {
                        layer.isVisible = b == l.base && vectorShown.contains(id)
                    } else if id == "base-\(b)" {
                        layer.isVisible = b == l.base
                    }
                }
            }
        }

        // MARK: the camera

        private func frame(_ v: MLNMapView, maxZoom: Double, animated: Bool) {
            let route = parent.editor.route.compactMap { p -> CLLocationCoordinate2D? in
                guard let lat = p["lat"]?.double, let lon = p["lon"]?.double else { return nil }
                return CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
            if route.count == 1 {
                v.setCenter(route[0], zoomLevel: max(v.zoomLevel, 9), animated: animated)
                return
            }
            guard let b = Geo.bounds(route, marginNm: 0) else { return }
            let cam = v.cameraThatFitsCoordinateBounds(
                MLNCoordinateBounds(
                    sw: CLLocationCoordinate2D(latitude: b.minLat, longitude: b.minLon),
                    ne: CLLocationCoordinate2D(latitude: b.maxLat, longitude: b.maxLon)),
                edgePadding: UIEdgeInsets(
                    top: 90 + v.safeAreaInsets.top, left: 90 + v.safeAreaInsets.left,
                    bottom: 90 + v.safeAreaInsets.bottom, right: 90 + v.safeAreaInsets.right))
            let zoom = min(
                MLNZoomLevelForAltitude(cam.altitude, cam.pitch, cam.centerCoordinate.latitude, v.frame.size), maxZoom)
            v.setCenter(cam.centerCoordinate, zoomLevel: zoom, animated: animated)
        }

        /// "Zoom to the route".
        private func fit(_ v: MLNMapView) {
            frame(v, maxZoom: 11, animated: true)
        }

        // MARK: gestures

        @objc private func onTap(_ g: UITapGestureRecognizer) {
            guard g.state == .ended, let v = mapView else { return }
            parent.editor.tap(at: g.location(in: v))
        }

        @objc private func onSecondary(_ g: UITapGestureRecognizer) {
            guard g.state == .ended, let v = mapView else { return }
            parent.editor.secondaryClick(at: g.location(in: v))
        }

        @objc private func onHover(_ g: UIHoverGestureRecognizer) {
            guard let v = mapView else { return }
            switch g.state {
            case .began, .changed: parent.editor.hover(at: g.location(in: v))
            default: parent.editor.hover(at: nil)
            }
        }

        @objc private func onDrag(_ g: UIGestureRecognizer) {
            guard let v = mapView else { return }
            let p = g.location(in: v)
            switch g.state {
            case .began:
                dragging = parent.editor.pressBegan(at: p)
                // the map holds still while a point moves
                if dragging { v.isScrollEnabled = false }
            case .changed:
                if dragging { parent.editor.pressMoved(to: p) }
            case .ended:
                if dragging { parent.editor.pressEnded(at: p) }
                endDrag(v)
            case .cancelled, .failed:
                if dragging { parent.editor.pressCancelled() }
                endDrag(v)
            default: break
            }
        }

        private func endDrag(_ v: MLNMapView) {
            dragging = false
            v.isScrollEnabled = true
        }

        nonisolated func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            MainActor.assumeIsolated {
                guard let v = mapView else { return false }
                return parent.editor.canPress(at: g.location(in: v))
            }
        }
    }
}
