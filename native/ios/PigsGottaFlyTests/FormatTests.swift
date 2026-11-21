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
        XCTAssertEqual(Fmt.parseEta("09:03", day: Fmt.isoDay("2026-11-22")), Date(timeIntervalSince1970: 1_795_338_180))
    }

    func testFrequencies() {
        XCTAssertEqual(
            Frequency(["callsign": "SKIROS TOWER", "mhz": "123.200"]),
            Frequency(callsign: "SKIROS TOWER", mhz: "123.200"))
        XCTAssertEqual(Frequency(["callsign": "X", "primary": "118.500"])?.mhz, "118.500")
        XCTAssertEqual(Frequency("130.925")?.mhz, "130.925")
        XCTAssertNil(Frequency(.null))
        XCTAssertNil(Frequency(nil))
        XCTAssertEqual(
            Fmt.frequency(Frequency(callsign: "ATHINAI INFORMATION", mhz: "130.925")), "ATHINAI INFORMATION 130.925")
        XCTAssertEqual(Fmt.frequency(Frequency(callsign: "", mhz: "130.925")), "130.925")
        XCTAssertEqual(Fmt.frequency(nil), "–")
    }

    func testStripFromAProgressAnswer() throws {
        let j: JSON = [
            "legIndex": 1, "toWaypoint": "KIMI", "distNm": 12.94, "bearingDeg": 31.8, "crossTrackNm": 0.35,
            "eteMin": 7.4, "eta": 1_795_338_217_584.2, "plannedAltFt": 5500, "plannedHdg": 28,
            "freq": ["callsign": "ATHINAI INFORMATION", "mhz": "130.925"], "nextFreq": nil, "offRoute": false,
        ]
        let p = try XCTUnwrap(Progress(j))
        let t = StripText(progress: p, groundspeedKt: 104.7)
        XCTAssertEqual(t.waypoint, "KIMI")
        XCTAssertEqual(t.distance, "13 NM")
        XCTAssertEqual(t.bearing, "032°")
        XCTAssertEqual(t.ete, "7 min")
        XCTAssertEqual(t.eta, "09:03Z")
        XCTAssertEqual(t.groundspeed, "105 kt")
        XCTAssertEqual(t.plannedAltitude, "5500 ft")
        XCTAssertEqual(t.plannedHeading, "028°")
        XCTAssertEqual(t.frequency, "ATHINAI INFORMATION 130.925")
        XCTAssertEqual(t.nextFrequency, "–")
        XCTAssertFalse(t.offRoute)
        XCTAssertEqual(
            t.accessibilityTop,
            "Next waypoint KIMI, distance 13 nautical miles, bearing 032 degrees, time to go 7 minutes, "
                + "arriving 09:03 UTC, ground speed 105 knots, planned altitude 5500 feet, planned heading 028 degrees")
        XCTAssertEqual(t.accessibilityBottom, "Frequency ATHINAI INFORMATION 130.925. Next frequency unknown.")
    }

    func testOffRouteIsSpoken() throws {
        let p = try XCTUnwrap(Progress(["toWaypoint": "LGSY", "crossTrackNm": -2.6, "offRoute": true, "eta": "10:15"]))
        let t = StripText(progress: p, groundspeedKt: nil)
        XCTAssertTrue(t.offRoute)
        XCTAssertEqual(t.crossTrack, "2.6 NM L")
        XCTAssertTrue(t.accessibilityTop.hasSuffix("off route, 2.6 nautical miles left"))
        XCTAssertEqual(t.groundspeed, "–")
        XCTAssertEqual(t.eta, "10:15Z")
        XCTAssertNil(Progress(.null))
    }
}
