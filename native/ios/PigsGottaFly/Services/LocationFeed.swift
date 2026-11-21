import CoreLocation
import Foundation

/// The aircraft's position for Fly: CoreLocation (when in use), about once a second. In fixture mode a
/// launch argument `-fixturePosition lat,lon[,trackDeg,gsKt]` stands in for the GPS.
@MainActor
final class LocationFeed: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var fix: Position?
    @Published private(set) var denied = false

    private let manager = CLLocationManager()
    private var last: CLLocation?
    private var timer: Timer?
    private let simulated: Position?

    init(simulated: Position? = nil) {
        self.simulated = simulated
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .airborne
    }

    /// `-fixturePosition 38.35,23.92,32,100`
    static func simulated(from arguments: [String]) -> Position? {
        guard let i = arguments.firstIndex(of: "-fixturePosition"), arguments.indices.contains(i + 1) else {
            return nil
        }
        let p = arguments[i + 1].split(separator: ",").compactMap { Double($0) }
        guard p.count >= 2 else { return nil }
        return Position(
            lat: p[0], lon: p[1], altFt: nil, trackDeg: p.count > 2 ? p[2] : nil, gsKt: p.count > 3 ? p[3] : nil,
            time: Date())
    }

    func start() {
        if let simulated {
            fix = simulated
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, var f = self.fix else { return }
                    f.time = Date()
                    self.fix = f
                }
            }
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: denied = true
        default: break
        }
        manager.startUpdatingLocation()
        manager.startUpdatingHeading()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            denied = status == .denied || status == .restricted
            if status == .authorizedWhenInUse || status == .authorizedAlways { manager.startUpdatingLocation() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        MainActor.assumeIsolated { take(loc) }
    }

    private func take(_ loc: CLLocation) {
        var track: Double? = loc.course >= 0 && loc.courseAccuracy >= 0 ? loc.course : nil
        var gs: Double? = loc.speed >= 0 ? loc.speed * 1.943_844 : nil
        // no course from the GPS (standing still, a simulator): from the last fix when it moved
        if track == nil, let last, loc.distance(from: last) > 15 {
            track = Geo.bearing(from: last.coordinate, to: loc.coordinate)
            let dt = loc.timestamp.timeIntervalSince(last.timestamp)
            if gs == nil, dt > 0 { gs = loc.distance(from: last) / dt * 1.943_844 }
        }
        if track == nil { track = fix?.trackDeg }
        if last == nil || loc.distance(from: last!) > 15 { last = loc }
        fix = Position(
            lat: loc.coordinate.latitude, lon: loc.coordinate.longitude,
            altFt: loc.verticalAccuracy >= 0 ? loc.altitude * 3.280_84 : nil, trackDeg: track, gsKt: gs,
            time: loc.timestamp)
    }
}

enum Geo {
    static func bearing(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let r = Double.pi / 180
        let y = sin((b.longitude - a.longitude) * r) * cos(b.latitude * r)
        let x =
            cos(a.latitude * r) * sin(b.latitude * r) - sin(a.latitude * r) * cos(b.latitude * r)
            * cos((b.longitude - a.longitude) * r)
        let d = atan2(y, x) / r
        return (d + 360).truncatingRemainder(dividingBy: 360)
    }

    /// The point `nm` nautical miles from `a` on `bearing` (flat earth: a track line of a few miles).
    static func offset(_ a: CLLocationCoordinate2D, bearing: Double, nm: Double) -> CLLocationCoordinate2D {
        let r = bearing * Double.pi / 180
        let dLat = nm / 60 * cos(r)
        let dLon = nm / 60 * sin(r) / max(0.01, cos(a.latitude * Double.pi / 180))
        return CLLocationCoordinate2D(latitude: a.latitude + dLat, longitude: a.longitude + dLon)
    }

    /// [minLat, minLon, maxLat, maxLon] of the points, grown by `marginNm` on every side.
    static func bounds(_ points: [CLLocationCoordinate2D], marginNm: Double) -> (
        minLat: Double, minLon: Double, maxLat: Double, maxLon: Double
    )? {
        guard !points.isEmpty else { return nil }
        let lats = points.map(\.latitude)
        let lons = points.map(\.longitude)
        let dLat = marginNm / 60
        let midLat = (lats.min()! + lats.max()!) / 2
        let dLon = marginNm / 60 / max(0.01, cos(midLat * Double.pi / 180))
        return (lats.min()! - dLat, lons.min()! - dLon, lats.max()! + dLat, lons.max()! + dLon)
    }
}
