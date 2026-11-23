import XCTest

@testable import PigsGottaFly

/// Sharing a flight and an operator through the core and the fixture server (which knows one other
/// account, copilot@example.com, and sends nothing): tests/e2e/share.e2e.test.mjs's behaviours.
@MainActor
final class RecordSharingTests: XCTestCase {
    private let flightId = "fixture-lgtt-lgsk"

    private func makeApp(_ t: FixtureTransport = FixtureTransport.bundled()!) async -> (AppModel, Core) {
        let app = AppModel(arguments: ["-fixtures", "-noNetwork"], api: API(transport: t), store: temporaryStore())
        await app.loadPilot()
        return (app, try! Core.bundled())
    }

    func testShareAFlightBeforeTheOtherPilotHasAnAccountThenMakeThemAnEditor() async throws {
        let (app, core) = await makeApp()
        let me = try XCTUnwrap(app.pilot?.id)
        let flight = ShareTarget(kind: .flight, id: flightId, name: "LGTT → LGSK")
        var v = try core.sharing(try await app.sharingOf(flight), myId: me, kind: "flight")
        XCTAssertEqual(v.rows.map(\.control), ["owner"])

        // an address no account uses: a pending invite to the flight
        v = try core.sharing(
            try await app.addShare(flight, ShareInput(email: "bob@example.com", role: .view)), myId: me,
            kind: "flight")
        XCTAssertEqual(v.rows.map(\.role), ["owner", "view"])
        XCTAssertTrue(v.rows[1].pending)
        XCTAssertEqual(v.rows[1].note, "Invited · has access once they sign in with this address")

        v = try core.sharing(
            try await app.setShareRole(flight, key: v.rows[1].key, role: .edit), myId: me, kind: "flight")
        XCTAssertEqual(v.rows[1].roleLabel, "Editor")

        // an account: shared at once; the same address again is refused with the server's words
        v = try core.sharing(
            try await app.addShare(flight, ShareInput(email: "copilot@example.com", role: .view)), myId: me,
            kind: "flight")
        XCTAssertEqual(v.rows.last?.name, "Chris Copilot")
        do {
            _ = try await app.addShare(flight, ShareInput(email: "copilot@example.com", role: .view))
            XCTFail("already has access")
        } catch {
            XCTAssertEqual(error.localizedDescription, "copilot@example.com already has access")
        }

        let after = try await app.removeShare(flight, key: "bob@example.com")
        let rows = try core.sharing(try XCTUnwrap(after), myId: me, kind: "flight").rows
        XCTAssertEqual(rows.map(\.name), ["FIXTURE PILOT", "Chris Copilot"])
    }

    func testTheFlightsPassengersAreOfferedAndRemovingOneAsksToStopSharing() async throws {
        let (app, core) = await makeApp()
        let me = try XCTUnwrap(app.pilot?.id)
        let passengers: JSON = try await app.api.passengers()
        let crew: JSON = [
            ["role": "PIC", "passengerId": nil, "seat": "front-left", "snapshot": ["fullName": "FIXTURE PILOT"]],
            ["role": "PAX", "passengerId": "pax-anna", "seat": "front-right", "snapshot": ["fullName": "Anna P."]],
            ["role": "PAX", "passengerId": "pax-nikos", "seat": "rear-left", "snapshot": ["fullName": "Nikos G."]],
        ]
        let contacts = try core.shareSuggestions(crew: crew.text, passengers: passengers.text, people: nil).contacts
        XCTAssertEqual(contacts.map(\.email), ["anna@example.com", "nikos@example.com"])
        let flight = ShareTarget(kind: .flight, id: flightId, name: "LGTT → LGSK", passengers: Core.text(contacts))

        var v = try core.sharing(
            try await app.sharingOf(flight), myId: me, kind: "flight", passengers: flight.passengers)
        XCTAssertEqual(v.suggestions.map(\.name), ["Anna P.", "Nikos G."])
        // "Share (view)" adds Anna as a viewer; she is no longer offered
        let shared = try await app.addShare(flight, ShareInput(email: "anna@example.com", role: .view))
        v = try core.sharing(shared, myId: me, kind: "flight", passengers: flight.passengers)
        XCTAssertEqual(v.suggestions.map(\.email), ["nikos@example.com"])
        XCTAssertEqual(v.rows.last?.role, "view")

        // removing Anna from the manifest asks; Nikos (not shared) and someone without an e-mail do not
        let offer = try XCTUnwrap(
            try core.unshareOffer(sharing: shared, email: "Anna@Example.com", myId: me, name: "Anna P."))
        XCTAssertEqual(offer.name, "Anna P.")
        XCTAssertEqual(offer.key, "anna@example.com")
        XCTAssertNil(try core.unshareOffer(sharing: shared, email: "nikos@example.com", myId: me, name: "Nikos G."))
        XCTAssertNil(try core.unshareOffer(sharing: shared, email: "", myId: me, name: "Eve"))
        // "Stop sharing"
        let afterStop = try await app.removeShare(flight, key: offer.key)
        let stopped = try XCTUnwrap(afterStop)
        XCTAssertEqual(try core.sharing(stopped, myId: me, kind: "flight").rows.count, 1)
    }

    func testAViewerOfASharedFlightSeesTheChipAndLeaves() async throws {
        let (app, core) = await makeApp()
        let me = try XCTUnwrap(app.pilot?.id)
        let flight = ShareTarget(kind: .flight, id: "fixture-shared", name: "Shared")
        let v = try core.sharing(try await app.sharingOf(flight), myId: me, kind: "flight")
        XCTAssertFalse(v.canManage)
        XCTAssertEqual(v.rows.map(\.control), ["owner", "readOnly"])
        XCTAssertEqual(v.rows.last?.removeLabel, "Remove my access")
        let access: JSON = [
            "role": "view", "owner": ["pilotId": "p-other", "name": "Another Pilot", "email": "other@example.com"],
        ]
        XCTAssertEqual(try core.sharedChip(access: access.text, kind: "flight"), "View only · shared by Another Pilot")

        await app.loadFlights()
        XCTAssertTrue(app.flights.contains { $0.id == "fixture-shared" })
        let left = try await app.removeShare(flight, key: me)
        XCTAssertNil(left)
        XCTAssertFalse(app.flights.contains { $0.id == "fixture-shared" }, "the list follows")
    }

    func testShareAnOperatorWithAnAccountOnly() async throws {
        let (app, core) = await makeApp()
        let me = try XCTUnwrap(app.pilot?.id)
        let op = ShareTarget(kind: .operator, id: "op-1", name: "Aeroclub")
        var v = try core.sharing(try await app.sharingOf(op), myId: me, kind: "operator")
        XCTAssertTrue(v.canManage)
        XCTAssertEqual(v.rows.map(\.control), ["owner"])
        do {
            _ = try await app.addShare(op, ShareInput(email: "nobody@example.com", role: .view))
            XCTFail("an operator is shared with accounts only")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "No Pig’s Gotta Fly account uses nobody@example.com. They need to sign in once before you can share with them."
            )
        }
        v = try core.sharing(
            try await app.addShare(op, ShareInput(email: "copilot@example.com", role: .edit)), myId: me,
            kind: "operator")
        XCTAssertEqual(v.rows.map(\.control), ["owner", "manage"])
        XCTAssertEqual(v.rows.last?.roleLabel, "Editor")
        let after = try await app.removeShare(op, key: "fixture-copilot")
        XCTAssertEqual(try core.sharing(try XCTUnwrap(after), myId: me, kind: "operator").rows.count, 1)
    }
}
