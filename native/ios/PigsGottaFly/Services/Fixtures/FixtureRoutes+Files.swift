import Foundation

/// Chunked files of aircraft, operators and the pilot: none yet.
extension FixtureTransport {
    func fileRoutes(_ r: FixtureRequest) -> (Int, String?, Data?)? {
        switch (r.method, r.first, r.count) {
        case ("GET", "pilots", 3) where r.parts[2] == "files":
            (200, nil, Data(#"{"licence":null,"medical":null}"#.utf8))
        default: nil
        }
    }
}
