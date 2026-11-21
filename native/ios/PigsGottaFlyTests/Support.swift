import Foundation
import XCTest

@testable import PigsGottaFly

/// The bundled fixtures (the app's Fixtures folder: the unit tests run inside the app).
enum Fixtures {
    static var directory: URL {
        Bundle.main.url(forResource: "Fixtures", withExtension: nil)!
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name))
    }

    static func text(_ name: String) throws -> String {
        String(decoding: try data(name), as: UTF8.self)
    }
}

/// A transport answering from a closure, recording the requests.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = (URLRequest) throws -> (Int, Data, [String: String])
    private let lock = NSLock()
    private var handler: Handler
    private(set) var requests: [URLRequest] = []

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        requests.append(request)
        let h = handler
        lock.unlock()
        let (status, data, headers) = try h(request)
        return (
            data,
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        )
    }
}

func temporaryStore() -> Store {
    Store(root: FileManager.default.temporaryDirectory.appendingPathComponent("pgf-test-\(UUID().uuidString)"))
}
