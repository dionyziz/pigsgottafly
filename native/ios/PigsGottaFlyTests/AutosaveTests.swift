import XCTest

@testable import PigsGottaFly

/// Autosave: one PUT per pause, the version carried, the unsaved changes re-applied over a 409's copy.
@MainActor
final class AutosaveTests: XCTestCase {
    /// What the fake server received.
    final class Server {
        var puts: [(JSON, Int)] = []
        var answers: [Autosave<JSON>.Outcome] = []
    }

    private func autosave(_ server: Server, delay: Duration = .milliseconds(50)) -> Autosave<JSON> {
        Autosave(["name": "A", "seats": 4], version: 3, delay: delay) { value, version in
            server.puts.append((value, version))
            return server.answers.isEmpty ? .saved(version: version + 1) : server.answers.removeFirst()
        }
    }

    private func waitUntil(_ condition: () -> Bool, timeout: TimeInterval = 3) async {
        let end = Date().addingTimeInterval(timeout)
        while !condition() && Date() < end { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testChangesInOnePauseAreOnePut() async {
        let server = Server()
        let a = autosave(server)
        a.update { $0["name"] = "B" }
        a.update { $0["name"] = "C" }
        a.update { $0["seats"] = 2 }
        XCTAssertEqual(a.value["name"], "C", "shown at once")
        XCTAssertTrue(server.puts.isEmpty, "nothing sent before the pause")
        await waitUntil { a.version == 4 }
        try? await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(server.puts.count, 1)
        XCTAssertEqual(server.puts.first?.0, ["name": "C", "seats": 2])
        XCTAssertEqual(server.puts.first?.1, 3, "the version it was read at")
        XCTAssertEqual(a.version, 4)
        XCTAssertFalse(a.hasPending)
    }

    func testAChangeAfterThePauseIsASecondPutWithTheNewVersion() async {
        let server = Server()
        let a = autosave(server)
        a.update { $0["name"] = "B" }
        await a.flush()
        a.update { $0["name"] = "C" }
        await a.flush()
        XCTAssertEqual(server.puts.map(\.1), [3, 4])
        XCTAssertEqual(a.version, 5)
    }

    func testAConflictReappliesTheUnsavedChangesOnTheServersCopy() async {
        let server = Server()
        server.answers = [.conflict(server: ["name": "A", "seats": 4, "colour": "red"], version: 9)]
        let a = autosave(server)
        var conflicts = 0
        a.onConflict = { conflicts += 1 }
        a.update { $0["seats"] = 2 }
        await a.flush()
        XCTAssertEqual(server.puts.count, 2)
        XCTAssertEqual(server.puts[1].1, 9, "sent again with the server's version")
        XCTAssertEqual(server.puts[1].0, ["name": "A", "seats": 2, "colour": "red"], "both sides kept")
        XCTAssertEqual(a.value, ["name": "A", "seats": 2, "colour": "red"])
        XCTAssertEqual(a.version, 10)
        XCTAssertEqual(conflicts, 1)
    }

    func testOfflineKeepsTheChangesForTheNextSave() async {
        var online = false
        var sent: [JSON] = []
        let a = Autosave<JSON>(["n": 1], version: 1, delay: .milliseconds(10)) { value, version in
            guard online else { throw APIError.offline }
            sent.append(value)
            return .saved(version: version + 1)
        }
        a.update { $0["n"] = 2 }
        await a.flush()
        XCTAssertTrue(a.offline)
        XCTAssertTrue(a.hasPending)
        online = true
        await a.flush()
        XCTAssertEqual(sent, [["n": 2]])
        XCTAssertFalse(a.offline)
        XCTAssertFalse(a.hasPending)
    }

    func testDecodesAConflictBody() {
        let body = Data(#"{"id":"x","version":12,"title":"T"}"#.utf8)
        guard case .conflict(let server, let v)? = Autosave<JSON>.conflictDecoding(body) else {
            return XCTFail("not a conflict")
        }
        XCTAssertEqual(v, 12)
        XCTAssertEqual(server["title"], "T")
    }
}
