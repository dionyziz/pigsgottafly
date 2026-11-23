import XCTest

@testable import PigsGottaFly

/// The fixture server, with the requests it was sent.
private final class RecordingTransport: HTTPTransport, @unchecked Sendable {
    let inner = FixtureTransport.bundled()!
    private let lock = NSLock()
    private var sent: [URLRequest] = []

    var requests: [URLRequest] { lock.withLock { sent } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { sent.append(request) }
        return try await inner.send(request)
    }

    /// The JSON bodies of the requests `method` to a path ending in `suffix`.
    func bodies(_ method: String, _ suffix: String) -> [JSON] {
        requests.filter { $0.httpMethod == method && ($0.url?.path ?? "").hasSuffix(suffix) }
            .compactMap { $0.httpBody.flatMap { try? JSON.parse($0) } }
    }
}

/// The Manifest section's edits against the fixture server: each one's PUT carries the crew as the
/// website's ManifestSection makes it.
@MainActor
final class ManifestTests: XCTestCase {
    private var transport: RecordingTransport!
    private var model: FlightModel!
    private var manifest: ManifestModel!

    override func setUp() async throws {
        transport = RecordingTransport()
        let app = AppModel(
            arguments: ["-fixtures", "-noNetwork"], api: API(transport: transport), store: temporaryStore())
        model = FlightModel(id: "fixture-lgtt-lgsy", app: app)
        await model.open()
        manifest = ManifestModel(flight: model)
        await manifest.load()
    }

    private var lastCrew: [JSON] {
        transport.bodies("PUT", "/flights/fixture-lgtt-lgsy").last?["flight"]?["crew"]?.array ?? []
    }

    private func pax(_ id: String) -> JSON { manifest.passengers.first { $0["id"]?.string == id }! }

    func testAddsAPassengerToTheFirstFreeSeat() async throws {
        XCTAssertEqual(manifest.passengers.count, 3)
        XCTAssertEqual(manifest.candidates("ann").map { $0["id"]?.string }, ["pax-anna"])
        let version = model.version
        let massBefore = try XCTUnwrap(model.wbSummary?.takeoff.massKg)
        await manifest.add(pax("pax-anna"))
        let crew = lastCrew
        XCTAssertEqual(crew.count, 2)
        XCTAssertEqual(crew[1]["role"], "PAX")
        XCTAssertEqual(crew[1]["passengerId"], "pax-anna")
        XCTAssertEqual(crew[1]["seat"], "front-right")
        XCTAssertEqual(
            crew[1]["snapshot"],
            [
                "fullName": "ANNA PAPADOPOULOU", "phone": "+30 690 0000001", "dateOfBirth": "1990-02-03",
                "weightKg": 62, "idNumber": "AK100200", "idType": "ID", "nationality": "GREEK", "relation": "FRIEND",
            ])
        XCTAssertEqual(transport.bodies("PUT", "/flights/fixture-lgtt-lgsy").last?["version"]?.int, version)
        XCTAssertFalse(manifest.candidates("").contains { $0["id"] == "pax-anna" }, "on board: not offered again")

        // the W&B follows: 62 kg more at take-off
        XCTAssertEqual(model.wbSummary?.status, .ok)
        XCTAssertEqual(try XCTUnwrap(model.wbSummary?.takeoff.massKg), massBefore + 62, accuracy: 0.01)
    }

    func testSeatsSwapAndEveryPersonKeepsOne() async throws {
        await manifest.add(pax("pax-anna"))
        await manifest.changeSeat(1, to: "front-left")
        XCTAssertEqual(lastCrew.map { $0["seat"]?.string }, ["front-right", "front-left"])
        XCTAssertEqual(model.manifestState(aircraft: manifest.aircraft)?.errors, [])
        let seats = model.manifestState(aircraft: manifest.aircraft)?.seats.map(\.label)
        XCTAssertEqual(seats, ["Front left", "Front right", "Rear left", "Rear right"])
    }

    func testAnEditedFieldStopsFollowingUntilReset() async throws {
        await manifest.add(pax("pax-anna"))
        await manifest.editField(1, .weightKg, 65)
        XCTAssertEqual(lastCrew[1]["snapshot"]?["weightKg"], 65)
        XCTAssertEqual(lastCrew[1]["overrides"], ["weightKg"])

        // the record changes: the edited weight stays, the phone follows
        var form = CrewPersonForm(pax("pax-anna"))
        form.weightKg = 64
        form.phone = "+30 690 0000009"
        try await manifest.update(passengerId: "pax-anna", form)
        let put = transport.bodies("PUT", "/passengers/pax-anna").last
        XCTAssertEqual(put?["weightKg"], 64)
        XCTAssertEqual(put?["email"], "anna@example.com")
        XCTAssertEqual(lastCrew[1]["snapshot"]?["weightKg"], 65)
        XCTAssertEqual(lastCrew[1]["snapshot"]?["phone"], "+30 690 0000009")

        await manifest.reset(1)
        XCTAssertNil(lastCrew[1]["overrides"])
        XCTAssertEqual(lastCrew[1]["snapshot"]?["weightKg"], 64)
    }

    func testEverySeatTakenAndTheCrewErrors() async throws {
        let people = ["pax-anna", "pax-nikos", "pax-maria", "pax-anna"].map(pax)
        let seats = ["front-left", "front-right", "rear-left", "rear-right"]
        var rows: [JSON] = []
        for (i, p) in people.enumerated() {
            let snapshot: JSON = ["fullName": p["fullName"]!, "weightKg": p["weightKg"]!]
            let id: JSON = i == 3 ? .null : p["id"]!
            rows.append(["role": "PAX", "passengerId": id, "seat": .string(seats[i]), "snapshot": snapshot])
        }
        let crew = JSON.array(rows)
        await model.edit { $0["crew"] = crew }
        let state = model.manifestState(aircraft: manifest.aircraft)
        XCTAssertEqual(state?.full, true)
        XCTAssertEqual(state?.errors, ["exactly one PIC is required (found 0)"])
        XCTAssertEqual(model.previewManifest(.addPic(pilot: manifest.pilot!), aircraft: manifest.aircraft)?.ok, false)
        let before = transport.requests.count
        await manifest.addPic()
        XCTAssertEqual(transport.requests.count, before, "nothing to save")

        // a free seat: the PIC goes to front left, its passenger moves
        await manifest.remove(3)
        await manifest.addPic()
        XCTAssertEqual(lastCrew.first?["role"], "PIC")
        XCTAssertEqual(lastCrew.first?["seat"], "front-left")
        XCTAssertEqual(manifest.picNote, "ANNA PAPADOPOULOU moved to rear right to free the PIC seat.")
        XCTAssertEqual(model.manifestState(aircraft: manifest.aircraft)?.errors, [])
        XCTAssertEqual(model.wbSummary?.missingWeights, ["NIKOS GEORGIOU"])
        XCTAssertEqual(model.wbSummary?.status, .incomplete)
    }

    func testBaggageAndItsLimits() async throws {
        let put = { self.transport.bodies("PUT", "/flights/fixture-lgtt-lgsy").last?["flight"] }
        await model.setBaggage(station: "bag2", kg: 20)
        XCTAssertEqual(put()?["baggageKg"], ["bag1": 5, "bag2": 20])
        XCTAssertEqual(model.wbSummary?.loadBreaches, [])
        await model.setBaggage(station: "bag1", kg: 0)
        XCTAssertEqual(put()?["baggageKg"], ["bag2": 20])
        await model.setBaggage(station: "bag1", kg: 40)
        XCTAssertFalse(model.wbSummary?.loadBreaches.isEmpty ?? true, "bag1 + bag2 over the combined 54 kg")
        XCTAssertEqual(model.wbSummary?.status, .out)

        await model.setCategory("utility")
        XCTAssertEqual(put()?["options"]?["category"], "utility")
    }

    func testRemovingASharedPassengerOffersToStopSharing() async throws {
        await manifest.add(pax("pax-anna"))
        await manifest.remove(1)
        XCTAssertEqual(lastCrew.count, 1)
        XCTAssertEqual(manifest.unshare, ManifestModel.Unshare(name: "ANNA PAPADOPOULOU", key: "pilot-anna"))
        await manifest.stopSharing(manifest.unshare!)
        XCTAssertTrue(
            transport.requests.contains {
                $0.httpMethod == "DELETE"
                    && $0.url?.path.hasSuffix("/flights/fixture-lgtt-lgsy/shares/pilot-anna") == true
            })

        // a passenger the flight is not shared with: nothing to offer
        manifest.unshare = nil
        await manifest.add(pax("pax-maria"))
        await manifest.remove(1)
        XCTAssertNil(manifest.unshare)
    }

    func testCreatesAPassengerAsTheWebsiteSendsIt() async throws {
        var form = CrewPersonForm(initialName: "  Eleni   Dimou ")
        XCTAssertEqual(manifest.check(form, pilot: false)?.issues.map(\.message), ["Enter the e-mail address"])
        form.email = "eleni@example.com"
        form.weightKg = 58
        form.nationality = "greek"
        try await manifest.create(form)
        let body = try XCTUnwrap(transport.bodies("POST", "/passengers").last)
        XCTAssertEqual(
            body,
            [
                "fullName": "Eleni Dimou", "phone": "", "dateOfBirth": nil, "weightKg": 58, "idType": "",
                "idNumber": "",
                "nationality": "GREEK", "relation": "", "email": "eleni@example.com", "notes": "",
            ])
        XCTAssertEqual(lastCrew.last?["snapshot"]?["fullName"], "Eleni Dimou")
        XCTAssertEqual(lastCrew.last?["seat"], "front-right")
        XCTAssertEqual(manifest.passengers.count, 4)
    }

    func testThePilotsDetails() async throws {
        var form = CrewPersonForm(manifest.pilot!)
        form.email = nil
        form.licenceNo = "EL.FCL.0001"
        form.weightKg = 82
        try await manifest.updatePilot(form)
        let body = try XCTUnwrap(transport.bodies("PUT", "/me").last)
        XCTAssertEqual(body["licenceNo"], "EL.FCL.0001")
        XCTAssertNil(body["email"])
        XCTAssertNil(body["notes"])
        XCTAssertEqual(lastCrew.first?["snapshot"]?["weightKg"], 82)
    }

    func testTheChartHoldsTheEnvelopesAndThePoints() async throws {
        let wb = try XCTUnwrap(model.wbSummary)
        let chart = try XCTUnwrap(model.wbChart(aircraft: manifest.aircraft, points: [wb.takeoff, wb.landing]))
        XCTAssertEqual(chart.envelopes.map(\.category), ["normal", "utility"])
        for p in [wb.takeoff, wb.landing] {
            XCTAssertTrue((chart.domain.x0...chart.domain.x1).contains(p.momentKgM))
            XCTAssertTrue((chart.domain.y0...chart.domain.y1).contains(p.massKg))
        }
        XCTAssertFalse(chart.domain.xTicks.isEmpty)
    }
}
