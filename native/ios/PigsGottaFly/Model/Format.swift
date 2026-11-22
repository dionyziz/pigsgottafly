import Foundation

/// How numbers read on the screens (cockpit style: UTC, whole degrees, NM, ft, kt).
enum Fmt {
    static let dash = "–"

    private static let utc = TimeZone(identifier: "UTC")!

    /// 'HH:MM' from minutes after 00:00 UTC (wraps past midnight).
    static func clock(minutes: Double) -> String {
        let m = ((Int(minutes.rounded()) % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    /// '08:57Z'
    static func zulu(_ date: Date?) -> String {
        guard let date else { return dash }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02dZ", c.hour ?? 0, c.minute ?? 0)
    }

    /// A magnetic or true direction, three digits: 360 for north.
    static func degrees(_ d: Double?) -> String {
        guard let d, d.isFinite else { return dash }
        var v = Int(d.rounded()) % 360
        if v <= 0 { v += 360 }
        return String(format: "%03d°", v)
    }

    /// '8.4 NM' under 10 NM, '23 NM' above.
    static func distance(_ nm: Double?) -> String {
        guard let nm, nm.isFinite else { return dash }
        return nm < 10 ? String(format: "%.1f NM", max(0, nm)) : "\(Int(nm.rounded())) NM"
    }

    /// '13 min', '1:05 h'
    static func duration(_ min: Double?) -> String {
        guard let min, min.isFinite, min >= 0 else { return dash }
        let m = Int(min.rounded())
        return m < 60 ? "\(m) min" : String(format: "%d:%02d h", m / 60, m % 60)
    }

    /// '5500 ft'
    static func altitude(_ ft: Double?) -> String {
        guard let ft, ft.isFinite else { return dash }
        return "\(Int(ft.rounded())) ft"
    }

    /// '102 kt'
    static func speed(_ kt: Double?) -> String {
        guard let kt, kt.isFinite else { return dash }
        return "\(Int(kt.rounded())) kt"
    }

    /// '27 L'
    static func litres(_ l: Double?) -> String {
        guard let l, l.isFinite else { return dash }
        return "\(Int(l.rounded())) L"
    }

    /// 'ATHINAI INFORMATION 130.925'
    static func frequency(_ f: Frequency?) -> String {
        guard let f else { return dash }
        return f.callsign.isEmpty ? f.primary : "\(f.callsign) \(f.primary)"
    }

    /// Cross-track: '0.3 NM R' (right of the course), '1.2 NM L'.
    static func crossTrack(_ nm: Double?) -> String {
        guard let nm, nm.isFinite else { return dash }
        let side = nm >= 0 ? "R" : "L"
        return String(format: "%.1f NM %@", abs(nm), side)
    }

    /// '22 Nov 2026' from 'YYYY-MM-DD'.
    static func day(_ iso: String) -> String {
        guard let d = isoDay(iso) else { return iso.isEmpty ? "No date" : iso }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = utc
        f.dateFormat = "EEE d MMM yyyy"
        return f.string(from: d)
    }

    static func isoDay(_ iso: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: iso)
    }

    static func isoDay(from date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// 'HH:MM' UTC of a date.
    static func clock(_ date: Date) -> String {
        String(zulu(date).dropLast())
    }

    /// A date at 'HH:MM' UTC on `day` ('YYYY-MM-DD'); today when either is missing.
    static func date(day: String, clock: String) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = utc
        // the clock is UTC, so the day it is added to must start at 00:00Z too, not the device's midnight
        let base = isoDay(day) ?? cal.startOfDay(for: Date())
        let p = clock.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return base.addingTimeInterval(12 * 3600) }
        return base.addingTimeInterval(TimeInterval(p[0] * 3600 + p[1] * 60))
    }
}

/// The Fly strips' texts from a progress answer (and what VoiceOver reads).
struct StripText: Equatable {
    var waypoint: String
    var distance: String
    /// Magnetic, as the pilot flies it.
    var bearing: String
    var ete: String
    var eta: String
    var groundspeed: String
    var plannedAltitude: String
    var plannedHeading: String
    var frequency: String
    var nextFrequency: String
    var crossTrack: String
    var offRoute: Bool
    /// Past the last waypoint.
    var arrived: Bool
    /// To the destination along the route: 'LGSY 37 NM · 24 min · 09:18Z'.
    var destination: String

    /// `groundspeedKt`: the GPS's (nil: not moving or not known).
    init(progress p: Progress, groundspeedKt: Double?, destination name: String?) {
        waypoint = p.toWaypoint
        distance = Fmt.distance(p.distNm)
        bearing = Fmt.degrees(p.bearingMagDeg)
        ete = Fmt.duration(p.eteMin)
        eta = Fmt.zulu(p.eta)
        groundspeed = Fmt.speed(groundspeedKt)
        plannedAltitude = Fmt.altitude(p.plannedAltFt)
        plannedHeading = Fmt.degrees(p.plannedHdg)
        frequency = Fmt.frequency(p.freq)
        nextFrequency = Fmt.frequency(p.nextFreq)
        crossTrack = Fmt.crossTrack(p.crossTrackNm)
        offRoute = p.offRoute && !p.arrived
        arrived = p.arrived
        let dest = name ?? p.toWaypoint
        destination =
            p.arrived
            ? "Arrived at \(dest)"
            : [dest, Fmt.distance(p.remainingNm), Fmt.duration(p.eteDestMin), Fmt.zulu(p.etaDest)].joined(
                separator: " · ")
    }

    /// The top strip for VoiceOver: units spelt out.
    var accessibilityTop: String {
        if arrived { return "\(destination), distance \(spoken(distance)), ground speed \(spoken(groundspeed))" }
        var parts = ["Next waypoint \(waypoint)"]
        parts.append("distance \(spoken(distance))")
        parts.append("magnetic bearing \(spoken(bearing))")
        parts.append("time to go \(spoken(ete))")
        parts.append("arriving \(spoken(eta))")
        parts.append("ground speed \(spoken(groundspeed))")
        parts.append("planned altitude \(spoken(plannedAltitude))")
        parts.append("planned heading \(spoken(plannedHeading))")
        if offRoute { parts.append("off route, \(spoken(crossTrack))") }
        return parts.joined(separator: ", ")
    }

    var accessibilityDestination: String {
        if arrived { return destination }
        let parts = destination.components(separatedBy: " · ")
        guard parts.count == 4 else { return destination }
        return "To \(parts[0]): \(spoken(parts[1])), \(spoken(parts[2])), arriving \(spoken(parts[3]))"
    }

    var accessibilityBottom: String {
        "Frequency \(spoken(frequency)). Next frequency \(spoken(nextFrequency))."
    }

    private func spoken(_ s: String) -> String {
        if s == Fmt.dash { return "unknown" }
        if s.count == 6, s.hasSuffix("Z"), s.dropLast().contains(":") { return "\(s.dropLast()) UTC" }
        return
            s
            .replacingOccurrences(of: " NM R", with: " nautical miles right")
            .replacingOccurrences(of: " NM L", with: " nautical miles left")
            .replacingOccurrences(of: " NM", with: " nautical miles")
            .replacingOccurrences(of: " kt", with: " knots")
            .replacingOccurrences(of: " ft", with: " feet")
            .replacingOccurrences(of: " min", with: " minutes")
            .replacingOccurrences(of: "°", with: " degrees")
    }
}
