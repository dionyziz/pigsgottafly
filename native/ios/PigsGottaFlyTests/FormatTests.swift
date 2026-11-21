import XCTest

@testable import PigsGottaFly

/// The Fly strips' formatting.
final class FormatTests: XCTestCase {
    func testDegrees() {
        XCTAssertEqual(Fmt.degrees(0), "360°")
        XCTAssertEqual(Fmt.degrees(359.6), "360°")
        XCTAssertEqual(Fmt.degrees(5.4), "005°")
        XCTAssertEqual(Fmt.degrees(32), "032°")
        XCTAssertEqual(Fmt.degrees(271.5), "272°")
        XCTAssertEqual(Fmt.degrees(nil), "–")
        XCTAssertEqual(Fmt.degrees(.nan), "–")
    }

    func testDistanceDurationAndUnits() {
        XCTAssertEqual(Fmt.distance(8.44), "8.4 NM")
        XCTAssertEqual(Fmt.distance(23.6), "24 NM")
        XCTAssertEqual(Fmt.distance(-0.1), "0.0 NM")
        XCTAssertEqual(Fmt.duration(13.4), "13 min")
        XCTAssertEqual(Fmt.duration(65), "1:05 h")
        XCTAssertEqual(Fmt.duration(-1), "–")
        XCTAssertEqual(Fmt.altitude(5500), "5500 ft")
        XCTAssertEqual(Fmt.speed(104.6), "105 kt")
        XCTAssertEqual(Fmt.litres(26.5), "27 L")
        XCTAssertEqual(Fmt.crossTrack(0.34), "0.3 NM R")
        XCTAssertEqual(Fmt.crossTrack(-1.25), "1.2 NM L")
    }

    func testClockTimes() {
        XCTAssertEqual(Fmt.clock(minutes: 525), "08:45")
        XCTAssertEqual(Fmt.clock(minutes: 1445), "00:05")
        XCTAssertEqual(Fmt.zulu(Date(timeIntervalSince1970: 1_795_338_217.6)), "09:03Z")
        XCTAssertEqual(Fmt.zulu(nil), "–")
        let d = Fmt.date(day: "2026-11-22", clock: "08:30")
        XCTAssertEqual(Fmt.clock(d), "08:30")
        XCTAssertEqual(Fmt.isoDay(from: d), "2026-11-22")
    }

    func testFrequencies() {
        let athinai: JSON = [
            "callsign": "ATHINAI INFORMATION", "service": "INFO", "primary": "130.925", "backups": ["130.700"],
            "group": "FIS",
        ]
        XCTAssertEqual(
            Frequency(athinai),
            Frequency(callsign: "ATHINAI INFORMATION", service: "INFO", primary: "130.925", backups: ["130.700"]))
        XCTAssertNil(Frequency(["callsign": "X", "primary": ""]), "a row without a frequency")
        XCTAssertNil(Frequency(.null))
        XCTAssertNil(Frequency(nil))
        XCTAssertEqual(Fmt.frequency(Frequency(athinai)), "ATHINAI INFORMATION 130.925")
        XCTAssertEqual(Fmt.frequency(Frequency(callsign: "", primary: "130.925")), "130.925")
        XCTAssertEqual(Fmt.frequency(nil), "–")
    }

    /// PGF.progress's answer between KALAMO and KIMI (src/native/progress.ts Progress).
    private static let midLeg: JSON = [
        "legIndex": 1,
        "toWaypoint": ["index": 2, "name": "KIMI", "lat": 38.64556, "lon": 24.15472, "uid": "p3"],
        "distNm": 12.94, "bearingDeg": 37.0, "bearingMagDeg": 31.8, "crossTrackNm": 0.35, "legFraction": 0.48,
        "gsKt": 104.7, "gsSource": "gps", "eteMin": 7.4, "eta": 1_795_338_217_584.2, "remainingNm": 37.6,
        "eteDestMin": 23.4, "etaDest": 1_795_339_118_989.4, "plannedAltFt": 5500, "plannedHdg": 28, "plannedCh": 29,
        "freq": [
            "callsign": "ATHINAI INFORMATION", "service": "INFO", "primary": "130.925", "backups": ["130.700"],
            "group": "FIS",
        ],
        "nextFreq": nil, "offRoute": false, "arrived": false,
    ]

    func testStripFromAProgressAnswer() throws {
        let p = try XCTUnwrap(Progress(Self.midLeg))
        let t = StripText(progress: p, groundspeedKt: 104.7, destination: "LGSY")
        XCTAssertEqual(t.waypoint, "KIMI")
        XCTAssertEqual(t.distance, "13 NM")
        XCTAssertEqual(t.bearing, "032°", "magnetic")
        XCTAssertEqual(t.ete, "7 min")
        XCTAssertEqual(t.eta, "09:03Z")
        XCTAssertEqual(t.groundspeed, "105 kt")
        XCTAssertEqual(t.plannedAltitude, "5500 ft")
        XCTAssertEqual(t.plannedHeading, "028°")
        XCTAssertEqual(t.frequency, "ATHINAI INFORMATION 130.925")
        XCTAssertEqual(t.nextFrequency, "–")
        XCTAssertEqual(t.destination, "LGSY · 38 NM · 23 min · 09:18Z")
        XCTAssertFalse(t.offRoute)
        XCTAssertFalse(t.arrived)
        XCTAssertEqual(
            t.accessibilityTop,
            "Next waypoint KIMI, distance 13 nautical miles, magnetic bearing 032 degrees, time to go 7 minutes, "
                + "arriving 09:03 UTC, ground speed 105 knots, planned altitude 5500 feet, planned heading 028 degrees")
        XCTAssertEqual(t.accessibilityBottom, "Frequency ATHINAI INFORMATION 130.925. Next frequency unknown.")
        XCTAssertEqual(
            t.accessibilityDestination, "To LGSY: 38 nautical miles, 23 minutes, arriving 09:18 UTC")
    }

    func testOffRouteIsSpoken() throws {
        var j = Self.midLeg
        j["crossTrackNm"] = -2.6
        j["offRoute"] = true
        j["eta"] = nil
        let p = try XCTUnwrap(Progress(j))
        let t = StripText(progress: p, groundspeedKt: nil, destination: "LGSY")
        XCTAssertTrue(t.offRoute)
        XCTAssertEqual(t.crossTrack, "2.6 NM L")
        XCTAssertTrue(t.accessibilityTop.hasSuffix("off route, 2.6 nautical miles left"))
        XCTAssertEqual(t.groundspeed, "–")
        XCTAssertEqual(t.eta, "–")
    }

    func testArrived() throws {
        var j = Self.midLeg
        j["legIndex"] = 2
        j["toWaypoint"] = ["index": 3, "name": "LGSY", "lat": 38.9675, "lon": 24.4875]
        j["distNm"] = 0.4
        j["offRoute"] = true
        j["arrived"] = true
        let t = StripText(progress: try XCTUnwrap(Progress(j)), groundspeedKt: 12, destination: "LGSY")
        XCTAssertTrue(t.arrived)
        XCTAssertFalse(t.offRoute, "past the end is not off the route")
        XCTAssertEqual(t.destination, "Arrived at LGSY")
        XCTAssertEqual(
            t.accessibilityTop, "Arrived at LGSY, distance 0.4 nautical miles, ground speed 12 knots")
    }

    func testNoProgressWithoutALeg() {
        XCTAssertNil(Progress(.null))
        XCTAssertNil(Progress(["legIndex": nil, "toWaypoint": nil, "offRoute": false, "arrived": false]))
    }
}
