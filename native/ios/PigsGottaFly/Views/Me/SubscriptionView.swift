import StoreKit
import SwiftUI

/// Me → Subscription, also opened by any 402. App Store rule 3.1.2: the title, length and price of the
/// subscription and links to the Terms of Use and the Privacy Policy are shown before buying.
struct SubscriptionView: View {
    @EnvironmentObject private var subs: Subscriptions
    @EnvironmentObject private var session: Session
    @State private var managing = false

    var body: some View {
        Form {
            Section("Your plan") {
                if let e = session.entitlement {
                    Text(e.text()).accessibilityIdentifier("subscription-status")
                } else {
                    ProgressView()
                }
            }
            if paid && subs.billing?.store == "apple" {
                Section {
                    Button("Manage subscription") { managing = true }
                        .accessibilityIdentifier("subscription-manage")
                }
            } else if paid && subs.billing?.store == "paddle" {
                Section {
                    Text("Bought on the website: manage it there, under Subscription in the account menu.")
                        .foregroundStyle(.secondary)
                }
            } else if session.entitlement?.reason != "founder" {
                Section {
                    Button {
                        Task { await subs.purchase() }
                    } label: {
                        HStack {
                            if subs.busy { ProgressView() }
                            Text(subs.product.map { "Subscribe, \($0.displayPrice) / year" } ?? "Subscribe")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(subs.busy || subs.product == nil)
                    .accessibilityIdentifier("subscription-subscribe")
                } footer: {
                    Text(
                        "Pig’s Gotta Fly yearly: planning, briefing, filing and Fly mode, on the app and the website. "
                            + "Renews every year until cancelled in the App Store settings, at least 24 hours before "
                            + "the renewal date.")
                }
            }
            if let error = subs.error {
                Section { Text(error).foregroundStyle(.red) }
            }
            Section {
                Button("Restore purchases") { Task { await subs.restore() } }
                    .disabled(subs.busy)
                    .accessibilityIdentifier("subscription-restore")
                Link("Terms of Use", destination: API.site.appendingPathComponent("terms"))
                Link("Privacy Policy", destination: API.site.appendingPathComponent("privacy"))
            }
        }
        .navigationTitle("Subscription")
        .manageSubscriptionsSheet(isPresented: $managing)
        .task { await subs.load() }
        .accessibilityIdentifier("subscription")
    }

    private var paid: Bool { session.entitlement?.reason == "paid" }
}
