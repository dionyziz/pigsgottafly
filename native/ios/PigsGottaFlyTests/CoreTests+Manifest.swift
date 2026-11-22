import XCTest

@testable import PigsGottaFly

/// PGF's manifest, W&B chart and share suggestions through JavaScriptCore with the fixtures (the
/// parity with the website is tests/unit/native/manifest.test.ts).
final class CoreManifestTests: XCTestCase {
    private var core: Core!
    private var flight: JSON!
    private var aircraft: JSON!

    override func setUpWithError() throws {
        core = try Core.bundled()
        flight = try JSON.parse(try Fixtures.text("flight.json"))
        aircraft = try JSON.parse(try Fixtures.text("aircraft.json"))
    }

    private var stations: String { aircraft["massBalance"]!["stations"]!.text }

    func testSeatsAndAPassenger() throws {
        let crew = flight["crew"]!.text
        let seats = try core.manifest(crew: crew, stations: stations, .seats)
        XCTAssertEqual(seats.picSeat, "front-left")
        XCTAssertEqual(seats.errors, [])
        XCTAssertGreaterThanOrEqual(seats.seats.count, 4)
        let pax: JSON = [
            "id": "px", "fullName": "Robin Rider", "phone": "", "dateOfBirth": nil, "weightKg": 70, "idNumber": "",
            "idType": "", "nationality": "", "relation": "", "email": "robin@example.com",
        ]
        let added = try core.manifest(crew: crew, stations: stations, .addPassenger(pax))
        XCTAssertTrue(added.ok)
        XCTAssertEqual(added.crew.array?.count, 2)
        XCTAssertEqual(added.crew[1]?["passengerId"]?.string, "px")
        let swapped = try core.manifest(
            crew: added.crew.text, stations: stations, .changeSeat(index: 1, seat: "front-left"))
        XCTAssertEqual(
            swapped.crew[0]?["seat"]?.string, added.crew[1]?["seat"]?.string, "the PIC moved to the free seat")
        let noAircraft = try core.manifest(crew: crew, stations: nil, .seats)
        XCTAssertEqual(noAircraft.seats.map(\.label), ["Front left", "Front right", "Rear left", "Rear right"])
        let suggestions = try core.shareSuggestions(
            crew: added.crew.text, passengers: JSON.array([pax]).text, people: "[]")
        XCTAssertEqual(suggestions.suggestions.map(\.email), ["robin@example.com"])
    }

    func testTheWbChart() throws {
        let chart = try core.wbChart(
            massBalance: aircraft["massBalance"]!.text, points: [.init(massKg: 1000, momentKgM: 1050)])
        XCTAssertEqual(chart.envelopes.first?.label, "Normal category")
        XCTAssertGreaterThan(chart.envelopes.first?.outline.count ?? 0, 2)
        XCTAssertLessThanOrEqual(chart.domain.x0, 1050)
        XCTAssertGreaterThanOrEqual(chart.domain.y1, 1000)
        XCTAssertEqual(chart.domain.xTicks.first, chart.domain.x0)
        let cg = try core.cgToMoment(polygon: [[0.9, 600], [1.2, 600], [1.2, 1000], [0.9, 1000]])
        XCTAssertEqual(cg.moment.first, [540, 600])
    }
}
