import XCTest

@testable import PigsGottaFly

/// The hangar list's actions against the fixture server: Add aircraft (a template, a copy), the
/// registration taken, Make default, Delete and Remove from my hangar.
@MainActor
final class HangarTests: XCTestCase {
    private func makeApp(_ t: FixtureTransport) async -> AppModel {
        let app = AppModel(arguments: ["-fixtures", "-noNetwork"], api: API(transport: t), store: temporaryStore())
        await app.loadPilot()
        return app
    }

    func testAddFromATemplateBecomesTheDefaultOfAnEmptyHangar() async throws {
        let app = await makeApp(FixtureTransport.bundled(emptyAccount: true)!)
        let empty = try await app.hangar()
        XCTAssertTrue(empty.items.isEmpty)
        let made = try await app.addAircraft(
            hangar: empty.json, registration: "sx-new", source: .init(kind: "template", id: "reims-f172m"))
        XCTAssertEqual(made.toast, "Added SX-NEW as your default aircraft")
        XCTAssertEqual(app.pilot?.defaultAircraftId, made.id)
        let after = try await app.hangar()
        XCTAssertEqual(after.items.map(\.registration), ["SX-NEW"])
        XCTAssertEqual(after.items.first?.makeModel, "Reims/Cessna F172M")
        XCTAssertEqual(after.items.first?.isOwner, true)
    }

    func testAddAnotherOfThisTypeAndTheRegistrationTaken() async throws {
        let app = await makeApp(FixtureTransport.bundled()!)
        let h = try await app.hangar()
        let asv = try XCTUnwrap(h.items.first)
        XCTAssertTrue(asv.isOwner)
        let made = try await app.addAircraft(
            hangar: h.json, registration: "SX-CPY", source: .init(kind: "copy", id: asv.id))
        XCTAssertEqual(made.toast, "Added SX-CPY", "the default stays \(asv.registration)")
        let copy = try JSON.parse(try await app.api.aircraft(made.id))
        XCTAssertEqual(copy["makeModel"]?.string, asv.makeModel)
        XCTAssertEqual(copy["compassCards"], [])

        do {
            _ = try await app.addAircraft(
                hangar: h.json, registration: asv.registration.lowercased(), source: .init(kind: "blank"))
            XCTFail("the registration is taken")
        } catch {
            XCTAssertEqual(error.localizedDescription, "\(asv.registration) is already in your hangar.")
        }
        // with a list read before the copy was added, the server's 409 says the same
        do {
            _ = try await app.addAircraft(hangar: h.json, registration: "SX-CPY", source: .init(kind: "blank"))
            XCTFail("the server refuses a second SX-CPY")
        } catch {
            XCTAssertEqual(error.localizedDescription, "SX-CPY is already in your hangar.")
        }
    }

    func testMakeDefaultAndDelete() async throws {
        let app = await makeApp(FixtureTransport.bundled()!)
        let h = try await app.hangar()
        let made = try await app.addAircraft(hangar: h.json, registration: "SX-TWO", source: .init(kind: "blank"))
        try await app.setDefaultAircraft(made.id)
        XCTAssertEqual(app.pilot?.defaultAircraftId, made.id)
        let withTwo = try await app.hangar().items
        let two = try XCTUnwrap(withTwo.first { $0.id == made.id })
        try await app.deleteAircraft(two)
        XCTAssertNil(app.pilot?.defaultAircraftId, "the server drops a deleted default")
        let after = try await app.hangar().items
        XCTAssertEqual(after.map(\.id), h.items.map(\.id))
    }

    func testRemoveASharedAircraftFromMyHangar() async throws {
        let t = FixtureTransport.bundled()!
        var shared = t.aircraft[0]
        shared["id"] = "shared-1"
        shared["access"] = ["role": "view"]
        t.aircraft.append(shared)
        let app = await makeApp(t)
        let items = try await app.hangar().items
        let item = try XCTUnwrap(items.first { $0.id == "shared-1" })
        XCTAssertFalse(item.isOwner)
        do {
            try await app.deleteAircraft(item)
            XCTFail("only the owner deletes")
        } catch {}
        try await app.leaveAircraft(item)
        let left = try await app.hangar().items
        XCTAssertNil(left.first { $0.id == "shared-1" })
    }
}
