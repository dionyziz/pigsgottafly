import XCTest

@testable import PigsGottaFly

/// The bundled licenses.json decodes, and every entry's text is there.
final class LicensesTests: XCTestCase {
    func testBundledLicenses() throws {
        let licenses = try XCTUnwrap(Licenses.load())
        let names = licenses.entries.map(\.name)
        XCTAssertTrue(names.contains("MapLibre Native (iOS)"))
        XCTAssertTrue(names.contains("react"))
        XCTAssertTrue(names.contains("Homemade Apple"))
        for entry in licenses.entries {
            XCTAssertFalse(licenses.texts[entry.text, default: ""].isEmpty, entry.name)
            XCTAssertTrue(Licenses.groups.contains { $0.key == entry.group }, entry.name)
        }
    }
}
