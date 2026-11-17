import StoreKit
import SwiftUI

// ── Based Reader subscriptions (StoreKit 2) ─────────────────────────────
// Premium on iOS is sold through Apple In-App Purchase (Rebekah's decision,
// 2026-11-16). App Review rejects an external checkout, so the Stripe sheet
// this replaced is gone from the app; Stripe still serves the website.
//
// The products live in App Store Connect, subscription group "Based Reader":
//   app.tbra.ios.basedreader.monthly   $4.99 / month
//   app.tbra.ios.basedreader.yearly    $39.99 / year
// Prices on screen always come from StoreKit (`displayPrice`), never from a
// string in the app — Apple localises them per storefront.
//
// The SERVER decides who is premium. After any verified transaction the app
// posts its signed JWS to POST /api/v1/iap/sync; the server verifies Apple's
// signature, updates the account, and the app re-reads the user. Renewals,
// expiry and refunds reach the server directly from Apple (App Store Server
// Notifications), so the web and the app always agree.

@MainActor
@Observable
final class StoreModel {
    static let shared = StoreModel()

    static let monthlyID = "app.tbra.ios.basedreader.monthly"
    static let yearlyID = "app.tbra.ios.basedreader.yearly"

    private(set) var monthly: Product?
    private(set) var yearly: Product?
    /// True once a product request has finished (successfully or not).
    private(set) var loaded = false
    /// The product the reader is currently entitled to, per StoreKit on this device.
    private(set) var activeProductID: String?
    /// Product id being purchased, "restore" while restoring, else nil.
    private(set) var working: String?
    var error: String?

    private var updates: Task<Void, Never>?

    /// Begin listening for transactions that arrive outside a purchase call:
    /// renewals, Ask to Buy approvals, purchases made on another device.
    /// Safe to call repeatedly.
    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.deliver(result)
            }
        }
        Task { await refreshEntitlement() }
    }

    func loadProducts() async {
        defer { loaded = true }
        guard let products = try? await Product.products(for: [Self.monthlyID, Self.yearlyID]) else { return }
        monthly = products.first { $0.id == Self.monthlyID }
        yearly = products.first { $0.id == Self.yearlyID }
    }

    /// Whole-percent saving of a year over twelve months, when both loaded.
    var yearlySavingsPercent: Int? {
        guard let monthly, let yearly, monthly.price > 0 else { return nil }
        let twelve = monthly.price * 12
        let saving = (twelve - yearly.price) / twelve * 100
        let pct = NSDecimalNumber(decimal: saving).intValue
        return pct > 0 ? pct : nil
    }

    /// Buy `product` for the signed-in reader. `userId` rides along as the
    /// appAccountToken so Apple's server notifications can be matched to the
    /// account even if this app never hears about the renewal.
    /// Returns true when the account is premium afterwards.
    @discardableResult
    func purchase(_ product: Product, userId: String) async -> Bool {
        guard working == nil else { return false }
        working = product.id; defer { working = nil }
        error = nil
        do {
            var options: Set<Product.PurchaseOption> = []
            if let token = UUID(uuidString: userId) { options.insert(.appAccountToken(token)) }
            switch try await product.purchase(options: options) {
            case .success(let verification):
                return await deliver(verification)
            case .pending:
                error = "Your purchase is waiting for approval. Based Reader unlocks as soon as it's approved."
                return false
            case .userCancelled:
                return false
            @unknown default:
                return false
            }
        } catch {
            self.error = "The purchase didn't go through. You haven't been charged."
            return false
        }
    }

    /// Restore Purchases: re-sync with the App Store, then hand any current
    /// entitlement to the server. Returns true when the account is premium.
    @discardableResult
    func restore() async -> Bool {
        guard working == nil else { return false }
        working = "restore"; defer { working = nil }
        error = nil
        try? await AppStore.sync()
        var restored = false
        for await result in Transaction.currentEntitlements {
            if await deliver(result) { restored = true }
        }
        if !restored { error = "No active Based Reader subscription was found for this Apple Account." }
        return restored
    }

    func refreshEntitlement() async {
        var active: String?
        for await result in Transaction.currentEntitlements {
            if case .verified(let tx) = result, tx.revocationDate == nil,
               [Self.monthlyID, Self.yearlyID].contains(tx.productID) {
                active = tx.productID
            }
        }
        activeProductID = active
    }

    /// Verify locally, tell the server, finish the transaction.
    /// A transaction is only finished after the server has accepted it, so a
    /// failed sync is retried the next time StoreKit hands it back.
    @discardableResult
    private func deliver(_ result: VerificationResult<StoreKit.Transaction>) async -> Bool {
        guard case .verified(let tx) = result else {
            error = "Apple couldn't verify that purchase."
            return false
        }
        struct Body: Codable, Sendable { let signedTransaction: String }
        struct Res: Codable { let ok: Bool; let active: Bool; let accountType: String? }
        do {
            let res: Res = try await APIClient.shared.request(
                "/api/v1/iap/sync", method: "POST", json: Body(signedTransaction: result.jwsRepresentation))
            await tx.finish()
            await refreshEntitlement()
            return res.active
        } catch {
            self.error = (error as? APIError)?.errorDescription
                ?? "Your purchase went through, but we couldn't reach tbr*a to unlock it. Tap Restore Purchases in a moment."
            return false
        }
    }
}
