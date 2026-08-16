import SwiftUI

// Blocking "update required" gate.
//
// TestFlight has no forced-update mechanism: it notifies testers and shows an
// Update button, but each tester owns their own "Automatic Updates" toggle, so
// someone can stay on a build with a known-broken flow indefinitely. Builds
// 1-7 carried the profile-blank and finish-stuck-in-pending bugs for weeks for
// exactly that reason. This lets a floor be raised server-side instead.
//
// DESIGN RULE — IT FAILS OPEN, ALWAYS.
// A gate that fails closed is far worse than the bug it guards against: a
// network blip, a bad deploy, or a typo'd env var would lock every tester out
// of the whole app with no way back in. So every uncertain path here
// (request failed, no response, unparseable build number, minBuild of 0)
// results in NO gate. It blocks only on a positive, well-formed answer that
// this build is genuinely below the floor.

@MainActor
@Observable
final class UpdateGateModel {
    /// Nil until checked. Blocking only when this is a real requirement.
    var required: Requirement?

    struct Requirement: Equatable {
        let minBuild: Int
        let currentBuild: Int
        let message: String?
    }

    /// This build, from CFBundleVersion — the same integer TestFlight shows.
    static var currentBuild: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "") ?? 0
    }

    func check() async {
        struct Res: Codable {
            let ok: Bool
            let minBuild: Int
            let latestBuild: Int
            let message: String?
        }
        // Unauthenticated on purpose: a tester stuck behind a broken login
        // still needs to be told to update.
        guard let res: Res = try? await APIClient.shared.get("/api/v1/app-version", authed: false)
        else { return }                       // fail open

        let current = Self.currentBuild
        guard res.minBuild > 0, current > 0, current < res.minBuild else {
            required = nil                    // fail open
            return
        }
        required = Requirement(minBuild: res.minBuild,
                               currentBuild: current,
                               message: res.message)
    }
}

struct UpdateRequiredView: View {
    let requirement: UpdateGateModel.Requirement

    var body: some View {
        ZStack {
            AmbientBackground()
            VStack(spacing: 18) {
                Text("tbr*a")
                    .font(Theme.logo(34))
                    .foregroundStyle(Theme.logoGradient)

                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 46))
                    .foregroundStyle(Theme.accent)

                Text("Time to update")
                    .font(Theme.heading(26))
                    .foregroundStyle(Theme.foreground)

                Text(requirement.message
                     ?? "This version has a bug we've since fixed. Update in TestFlight to keep reading.")
                    .font(Theme.body(16))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                Button("Open TestFlight") {
                    // itms-beta:// opens the TestFlight app directly when it's
                    // installed; the https link is the fallback for a tester
                    // who removed it.
                    let deepLink = URL(string: "itms-beta://")!
                    let web = URL(string: "https://testflight.apple.com/join/yby6EkZu")!
                    UIApplication.shared.open(
                        UIApplication.shared.canOpenURL(deepLink) ? deepLink : web
                    )
                }
                .buttonStyle(AccentButtonStyle())
                .padding(.horizontal, 40)
                .padding(.top, 4)

                Text("You're on build \(requirement.currentBuild) · needs \(requirement.minBuild)")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
        }
    }
}

/// Attach to the app root. Renders the app normally until a positive
/// requirement arrives.
struct UpdateGate<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var model = UpdateGateModel()

    var body: some View {
        Group {
            if let requirement = model.required {
                UpdateRequiredView(requirement: requirement)
            } else {
                content
            }
        }
        .task { await model.check() }
    }
}
