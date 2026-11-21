import XCTest

@testable import PigsGottaFly

final class StoreTests: XCTestCase {
    func testWritesReadsAndRemoves() throws {
        let store = temporaryStore()
        XCTAssertNil(store.read(.flight("f1")))
        try store.write(Data(#"{"id":"f1"}"#.utf8), .flight("f1"))
        XCTAssertEqual(store.text(.flight("f1")), #"{"id":"f1"}"#)
        XCTAssertTrue(store.exists(.flight("f1")))
        XCTAssertNotNil(store.modified(.flight("f1")))
        try store.write(Data("{}".utf8), .flight("f1"))
        XCTAssertEqual(store.text(.flight("f1")), "{}")
        store.remove(.flight("f1"))
        XCTAssertFalse(store.exists(.flight("f1")))
    }

    func testKeepsEachFlightApartAndDecodes() throws {
        let store = temporaryStore()
        try store.write(try Fixtures.data("notams.json"), .notams("a"))
        try store.write(try Fixtures.data("flights.json"), .flights)
        XCTAssertNil(store.read(.notams("b")))
        XCTAssertEqual(store.decode(NotamBriefing.self, .notams("a"))?.notams.count, 2)
        XCTAssertEqual(store.decode([FlightListItem].self, .flights)?.count, 3)
        XCTAssertNil(store.decode([FlightListItem].self, .notams("a")))
    }

    func testIdsCannotLeaveTheFolder() {
        XCTAssertEqual(Store.safe("../../etc"), "_.._.._etc")
        XCTAssertFalse(Store.Key.flight("../x").path.contains(".." + "/"))
        XCTAssertEqual(Store.safe(""), "_")
    }

    func testClearEmptiesIt() throws {
        let store = temporaryStore()
        try store.write(Data("1".utf8), .ref)
        try store.write(Data("2".utf8), .weather("f"))
        store.clear()
        XCTAssertNil(store.read(.ref))
        XCTAssertNil(store.read(.weather("f")))
        try store.write(Data("3".utf8), .ref)
        XCTAssertEqual(store.text(.ref), "3")
    }

    func testRouteBoundsWithTheMargin() throws {
        let b = try XCTUnwrap(
            Geo.bounds(
                [.init(latitude: 38, longitude: 23), .init(latitude: 39, longitude: 24.5)], marginNm: 15))
        XCTAssertEqual(b.minLat, 37.75, accuracy: 1e-9)
        XCTAssertEqual(b.maxLat, 39.25, accuracy: 1e-9)
        XCTAssertLessThan(b.minLon, 23 - 0.25)
        XCTAssertNil(Geo.bounds([], marginNm: 15))
    }
}
