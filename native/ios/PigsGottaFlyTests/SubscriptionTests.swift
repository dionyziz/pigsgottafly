import XCTest

@testable import PigsGottaFly

final class SubscriptionTests: XCTestCase {
    func testDecodesBillingAndSaysTheEntitlementLikeTheWebsite() throws {
        let b = try JSONDecoder().decode(BillingInfo.self, from: try Fixtures.data("billing.json"))
        XCTAssertEqual(b.entitlement.reason, "trial")
        XCTAssertNotNil(UUID(uuidString: b.appleAccountToken))
        let now = Date(timeIntervalSince1970: 1_798_761_600 - 3 * 86400 + 60)
        XCTAssertTrue(b.entitlement.text(now: now).hasPrefix("Free trial: 3 days left"))
        XCTAssertEqual(
            Entitlement(active: true, reason: "founder", until: nil).text(),
            "Founding pilot: everything is free for life.")
        XCTAssertTrue(
            Entitlement(active: false, reason: "expired", until: 0).text().hasPrefix("Your free trial or subscription"))
    }

    func testA402IsSubscriptionRequired() async throws {
        let api = API(transport: FakeTransport { _ in (402, Data(#"{"error":"subscription_required"}"#.utf8), [:]) })
        let seen = expectation(forNotification: .subscriptionRequired, object: nil)
        do {
            _ = try await api.request("POST", "flights", body: Data("{}".utf8))
            XCTFail("expected 402")
        } catch let e as APIError {
            XCTAssertEqual(e, .subscriptionRequired)
        }
        await fulfillment(of: [seen], timeout: 2)
    }
}
