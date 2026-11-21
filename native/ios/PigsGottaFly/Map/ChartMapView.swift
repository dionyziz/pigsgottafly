import CoreLocation
import MapLibre
import SwiftUI

/// The moving map: the core's chart style (PGF.chartStyle), its sources filled from PGF.chartData, the
/// symbols drawn natively, and the own aircraft with its track line on top.
struct ChartMapView: UIViewRepresentable {
    var styleURL: URL?
    var chartData: JSON?
    var symbols: [SymbolInfo]
    var route: [CLLocationCoordinate2D]
    var fix: Position?
    var trackUp: Bool
    @Binding var following: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let v = MLNMapView(frame: .zero)
        v.delegate = context.coordinator
        v.allowsTilting = false
        v.showsUserLocation = false
        v.compassView.compassVisibility = .visible
        v.accessibilityIdentifier = "fly-map"
        v.accessibilityLabel = "Chart"
        if let first = route.first { v.setCenter(first, zoomLevel: 8, animated: false) }
        context.coordinator.update(self, v)
        return v
    }

    func updateUIView(_ v: MLNMapView, context: Context) {
        context.coordinator.update(self, v)
    }

    @MainActor
    final class Coordinator: NSObject, MLNMapViewDelegate {
        static let ownSource = "pgf-own"
        static let trackSource = "pgf-own-track"

        private var parent: ChartMapView
        private var styleURL: URL?
        private var styleLoaded = false
        private var applied: JSON?
        private var framed = false
        private var lastCameraFix: Position?
        private var lastTrackUp: Bool?
        private var hasFollowed = false

        init(_ parent: ChartMapView) {
            self.parent = parent
        }

        func update(_ parent: ChartMapView, _ v: MLNMapView) {
            self.parent = parent
            if let u = parent.styleURL, u != styleURL {
                styleURL = u
                styleLoaded = false
                applied = nil
                v.styleURL = u
            }
            guard styleLoaded, let style = v.style else { return }
            applyData(style)
            updateOwnship(style)
            followCamera(v)
        }

        // MARK: MLNMapViewDelegate

        nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated {
                for info in parent.symbols {
                    style.setImage(Symbols.image(info), forName: info.name)
                }
                style.setImage(Symbols.ownshipImage(), forName: Symbols.ownship)
                // the website's leg midpoint handles are for editing the route
                style.layer(withIdentifier: "route-mid")?.isVisible = false
                addOwnshipLayers(style)
                styleLoaded = true
                applied = nil
                applyData(style)
                updateOwnship(style)
                if !framed { frameRoute(mapView) }
                followCamera(mapView)
            }
        }

        nonisolated func mapView(
            _ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool
        ) {
            guard reason.contains(.gesturePan) else { return }
            MainActor.assumeIsolated {
                if parent.following { parent.following = false }
            }
        }

        // MARK: layers

        private func applyData(_ style: MLNStyle) {
            guard let data = parent.chartData, data != applied, let sources = data.object else { return }
            applied = data
            for (id, fc) in sources {
                guard let source = style.source(withIdentifier: id) as? MLNShapeSource, let d = try? fc.data() else {
                    continue
                }
                source.shape = try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
            }
        }

        private func addOwnshipLayers(_ style: MLNStyle) {
            guard style.source(withIdentifier: Self.ownSource) == nil else { return }
            let track = MLNShapeSource(identifier: Self.trackSource, shape: nil)
            let own = MLNShapeSource(identifier: Self.ownSource, shape: nil)
            style.addSource(track)
            style.addSource(own)
            let line = MLNLineStyleLayer(identifier: "pgf-own-track", source: track)
            line.lineColor = NSExpression(forConstantValue: UIColor.black)
            line.lineWidth = NSExpression(forConstantValue: 3)
            line.lineDashPattern = NSExpression(forConstantValue: [2, 1.5])
            line.lineCap = NSExpression(forConstantValue: "round")
            style.addLayer(line)
            let icon = MLNSymbolStyleLayer(identifier: "pgf-own", source: own)
            icon.iconImageName = NSExpression(forConstantValue: Symbols.ownship)
            icon.iconRotation = NSExpression(forKeyPath: "course")
            icon.iconRotationAlignment = NSExpression(forConstantValue: "map")
            // always drawn, on top of everything, and the chart's labels (the route's waypoint names
            // among them) keep clear of it: they take another side of their point, or wait
            icon.iconAllowsOverlap = NSExpression(forConstantValue: true)
            icon.iconIgnoresPlacement = NSExpression(forConstantValue: false)
            icon.iconPadding = NSExpression(forConstantValue: 4)
            style.addLayer(icon)
        }

        private func updateOwnship(_ style: MLNStyle) {
            guard let own = style.source(withIdentifier: Self.ownSource) as? MLNShapeSource,
                let track = style.source(withIdentifier: Self.trackSource) as? MLNShapeSource
            else { return }
            guard let fix = parent.fix else {
                own.shape = nil
                track.shape = nil
                return
            }
            let c = CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lon)
            let course = fix.trackDeg ?? 0
            let point = MLNPointFeature()
            point.coordinate = c
            point.attributes = ["course": course]
            own.shape = point
            if let t = fix.trackDeg {
                // where the aircraft will be in 10 minutes (at least 5 NM ahead)
                let nm = max(5, (fix.gsKt ?? 0) / 6)
                var coords = [c, Geo.offset(c, bearing: t, nm: nm)]
                track.shape = MLNPolylineFeature(coordinates: &coords, count: 2)
            } else {
                track.shape = nil
            }
        }

        private func frameRoute(_ v: MLNMapView) {
            guard parent.fix == nil, let b = Geo.bounds(parent.route, marginNm: 3), v.bounds.width > 0 else { return }
            framed = true
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: b.minLat, longitude: b.minLon),
                ne: CLLocationCoordinate2D(latitude: b.maxLat, longitude: b.maxLon))
            v.setVisibleCoordinateBounds(
                bounds, edgePadding: UIEdgeInsets(top: 170, left: 40, bottom: 140, right: 40), animated: false,
                completionHandler: nil)
        }

        private func followCamera(_ v: MLNMapView) {
            guard parent.following, let fix = parent.fix else {
                if !parent.trackUp, lastTrackUp == true, v.direction != 0 { v.setDirection(0, animated: true) }
                lastTrackUp = parent.trackUp
                lastCameraFix = nil
                return
            }
            if fix == lastCameraFix, lastTrackUp == parent.trackUp { return }
            let first = !hasFollowed
            hasFollowed = true
            lastCameraFix = fix
            lastTrackUp = parent.trackUp
            let c = CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lon)
            let direction = parent.trackUp ? (fix.trackDeg ?? v.direction) : 0
            let zoom = first || v.zoomLevel < 7 ? 10 : v.zoomLevel
            v.setCenter(c, zoomLevel: zoom, direction: direction, animated: !first)
        }
    }
}
