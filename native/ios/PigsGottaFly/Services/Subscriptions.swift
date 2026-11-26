import Foundation
import StoreKit

/// The subscription bought in the app (StoreKit 2). Every purchase carries the account's appAccountToken
/// (GET /api/billing) and goes to the server, which checks Apple's signature and records it
/// (api/_lib/billing/apple.ts); only then is the transaction finished, so StoreKit hands an unrecorded one
/// back on the next launch (Transaction.updates). One subscription covers the website and the app.
@MainActor
final class Subscriptions: ObservableObject {
    /// App Store Connect product (api/_lib/billing/apple.ts APPLE_PRODUCT_ID).
    static let productID = "com.pigsgottafly.app.yearly"

    @Published private(set) var product: Product?
    @Published private(set) var billing: BillingInfo?
    @Published private(set) var busy = false
    @Published var error: String?

    private let api: API
    private let session: Session
    private var updates: Task<Void, Never>?

    init(api: API, session: Session, listen: Bool) {
        self.api = api
        self.session = session
        guard listen else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates { await self?.record(result) }
        }
    }

    deinit { updates?.cancel() }

    func load() async {
        do {
            let b = try await api.billing()
            billing = b
            session.entitlement = b.entitlement
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
        if product == nil { product = try? await Product.products(for: [Self.productID]).first }
    }

    func purchase() async {
        guard let product, let token = billing.flatMap({ UUID(uuidString: $0.appleAccountToken) }) else {
            error = "The App Store is not reachable. Try again in a moment."
            return
        }
        error = nil
        busy = true
        defer { busy = false }
        do {
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case .success(let result): await record(result)
            case .pending, .userCancelled: break
            @unknown default: break
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Restore purchases: asks the App Store for this Apple ID's subscriptions and records the current one.
    func restore() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            try await AppStore.sync()
            for await result in Transaction.currentEntitlements { await record(result) }
            await load()
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    private func record(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result, transaction.productID == Self.productID else { return }
        do {
            session.entitlement = try await api.postAppleTransaction(result.jwsRepresentation)
            await transaction.finish()
            billing = try? await api.billing()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension Entitlement {
    /// As the website says it (src/features/billing/useBilling.ts entitlementText).
    func text(now: Date = Date()) -> String {
        let day = untilDate.map { $0.formatted(.dateTime.day().month(.wide).year()) } ?? ""
        switch reason {
        case "founder": return "Founding pilot: everything is free for life."
        case "paid":
            return renews == true ? "Subscribed. Renews on \(day)." : "Subscribed until \(day). It will not renew."
        case "granted": return "Free until \(day)."
        case "trial":
            let left = max(1, Int(ceil((untilDate ?? now).timeIntervalSince(now) / 86400)))
            return "Free trial: \(left) day\(left == 1 ? "" : "s") left (until \(day))."
        default: return "Your free trial or subscription has ended. Your flights and hangar stay here to read."
        }
    }
}
