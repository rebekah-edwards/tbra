import SwiftUI
import Observation

/// App-wide session state. On launch it tries to restore a session from the
/// stored token (validated via /auth/me, which auto-refreshes on 401).
@MainActor
@Observable
final class AuthStore {
    enum Phase { case loading, signedOut, signedIn(PublicUser) }

    var phase: Phase = .loading
    var loginError: String?

    func restore() async {
        #if DEBUG
        // Headless-verification hook: seed a session on a FRESH simulator
        // (whose keychain has never held tokens) via
        // SIMCTL_CHILD_TBRA_DEBUG_TOKEN / _REFRESH. Debug builds only.
        let env = ProcessInfo.processInfo.environment
        if Keychain.accessToken == nil, let t = env["TBRA_DEBUG_TOKEN"] {
            Keychain.accessToken = t
            Keychain.refreshToken = env["TBRA_DEBUG_REFRESH"]
        }
        #endif
        guard Keychain.accessToken != nil || Keychain.refreshToken != nil else {
            phase = .signedOut
            return
        }
        // Retry transient failures (the dev server may be briefly unreachable —
        // especially on the physical phone over Tailscale). Only an explicit
        // 401 chain may clear the stored session; a network hiccup must NEVER
        // log the user out.
        for attempt in 0..<3 {
            do {
                let user = try await APIClient.shared.me()
                phase = .signedIn(user)
                return
            } catch APIError.unauthorized {
                Keychain.clear()
                phase = .signedOut
                return
            } catch {
                if attempt < 2 {
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
        // Server unreachable: keep the tokens, show login as a fallback UI.
        // The session resumes untouched on the next launch/retry.
        phase = .signedOut
    }

    func register(email: String, password: String, referralCode: String?) async {
        loginError = nil
        do {
            let res = try await APIClient.shared.register(email: email, password: password, referralCode: referralCode)
            Keychain.accessToken = res.token
            Keychain.refreshToken = res.refreshToken
            phase = .signedIn(res.user)
        } catch {
            loginError = (error as? APIError)?.errorDescription ?? "Sign-up failed."
        }
    }

    func login(email: String, password: String) async {
        loginError = nil
        do {
            let res = try await APIClient.shared.login(email: email, password: password)
            phase = .signedIn(res.user)
        } catch {
            loginError = (error as? APIError)?.errorDescription ?? "Sign-in failed."
        }
    }

    func logout() async {
        await APIClient.shared.logout()
        phase = .signedOut
    }
}

struct RootView: View {
    @State private var auth = AuthStore()
    /// Lives HERE (a View) not in TbraApp: @AppStorage inside an App body
    /// doesn't reliably re-evaluate the Scene, which left the theme toggle
    /// dead on device.
    @AppStorage("themeOverride") private var themeOverride = "dark"
    /// First-launch onboarding: shown once per install, before the login
    /// screen. Signing out later goes straight to LoginView.
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
    /// Set when onboarding ends via "Create account" so LoginView opens
    /// with the signup sheet already presented.
    @State private var wantsSignup = false

    var body: some View {
        Group {
            switch auth.phase {
            case .loading:
                ZStack {
                    AmbientBackground()
                    ProgressView().controlSize(.large).tint(Theme.accent)
                }
            case .signedOut:
                if hasSeenOnboarding {
                    LoginView(startWithSignup: wantsSignup)
                } else {
                    OnboardingView { startSignup in
                        wantsSignup = startSignup
                        hasSeenOnboarding = true
                    }
                }
            case .signedIn:
                AppShell()
            }
        }
        // Theme via the UIKit window override, not .preferredColorScheme:
        // the SwiftUI preference was applied at two levels (Scene + here)
        // and the stale Scene copy won whenever they disagreed — dark→light
        // only took effect after killing the app. The window override hits
        // every presentation (sheets, covers, alerts) in one place.
        .onAppear { applyTheme() }
        .onChange(of: themeOverride) { applyTheme() }
        .environment(auth)
        .task {
            #if DEBUG && targetEnvironment(simulator)
            // Headless onboarding verification: force the carousel (skips the
            // sim auto-login below). TBRA_DEBUG_ONBOARDING_PAGE jumps to a page.
            if ProcessInfo.processInfo.environment["TBRA_DEBUG_ONBOARDING"] != nil {
                hasSeenOnboarding = false
                auth.phase = .signedOut
                return
            }
            #endif
            await auth.restore()
            #if DEBUG && targetEnvironment(simulator)
            // Simulator-only dev convenience: the Simulator's hardware-keyboard
            // bridge is unreliable for automated typing, so signed-out sim runs
            // auto-login with the test account. NEVER compiled for device builds.
            if case .signedOut = auth.phase {
                await auth.login(email: "clankerinfrastructure@gmail.com", password: "testview123")
            }
            #endif
        }
    }

    /// Push the chosen theme onto every window — the one place the theme is
    /// applied (see the note on the modifier chain above).
    private func applyTheme() {
        let style: UIUserInterfaceStyle =
            themeOverride == "light" ? .light :
            themeOverride == "system" ? .unspecified : .dark
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows {
                window.overrideUserInterfaceStyle = style
            }
        }
    }
}

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    /// Onboarding hands off here with the signup sheet pre-opened when the
    /// user tapped "Create account" on the final page.
    init(startWithSignup: Bool = false) {
        _signupOpen = State(initialValue: startWithSignup)
    }

    var body: some View {
        ZStack {
            AmbientBackground()
            VStack(spacing: 16) {
                Spacer()

                // The wordmark — Space Grotesk with the lime→blue→purple
                // .logo-gradient. The ONLY gradient text in the app.
                Text("tbr*a")
                    .font(Theme.logo(44))
                    .foregroundStyle(Theme.logoGradient)
                    .padding(.bottom, 4)
                Text("Know what's in a book before you read it")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .padding(.bottom, 20)

                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .brandedField()
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .brandedField()

                if let err = auth.loginError {
                    Text(err).font(Theme.body(13)).foregroundStyle(Theme.destructive)
                }

                Button {
                    Task { busy = true; await auth.login(email: email, password: password); busy = false }
                } label: {
                    if busy {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Sign in")
                    }
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty)
                .padding(.top, 4)

                HStack(spacing: 18) {
                    Button("Create account") { signupOpen = true }
                    Button("Forgot password?") { forgotOpen = true }
                }
                .font(Theme.body(14, .medium))
                .foregroundStyle(Theme.neonBlue)
                .padding(.top, 8)

                Spacer()
                Spacer()
            }
            .padding(.horizontal, 28)
        }
        .sheet(isPresented: $signupOpen) {
            SignupSheet()
                .presentationDetents([.large])
                .presentationBackground(Theme.bg)
        }
        .sheet(isPresented: $forgotOpen) {
            ForgotPasswordSheet()
                .presentationDetents([.medium])
                .presentationBackground(Theme.bg)
        }
    }

    @State private var signupOpen = false
    @State private var forgotOpen = false
}

// ── Signup — mirrors /signup (referral code optional) ──
struct SignupSheet: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var referralCode = ""
    @State private var busy = false
    @State private var localError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Text("Create your account")
                    .font(Theme.heading(22, .bold))
                    .foregroundStyle(Theme.foreground)
                    .padding(.top, 26)
                Text("Know what's in a book before you read it")
                    .font(Theme.body(13))
                    .foregroundStyle(Theme.muted)

                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .brandedField()
                SecureField("Password (8+ characters)", text: $password)
                    .textContentType(.newPassword)
                    .brandedField()
                SecureField("Confirm password", text: $confirm)
                    .textContentType(.newPassword)
                    .brandedField()
                TextField("Referral code (optional)", text: $referralCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .brandedField()

                if let err = localError ?? auth.loginError {
                    Text(err).font(Theme.body(13)).foregroundStyle(Theme.destructive)
                }

                Button {
                    guard password == confirm else { localError = "Passwords do not match."; return }
                    localError = nil
                    Task {
                        busy = true
                        await auth.register(email: email, password: password,
                                            referralCode: referralCode.isEmpty ? nil : referralCode)
                        busy = false
                        if case .signedIn = auth.phase { dismiss() }
                    }
                } label: {
                    if busy { ProgressView().tint(Theme.onAccent) } else { Text("Create account") }
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty || confirm.isEmpty)
                .padding(.top, 4)

                Text("We'll email you a verification link.")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 30)
        }
        .background(Theme.bg)
    }
}

// ── Forgot password — mirrors /forgot-password ──
struct ForgotPasswordSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var busy = false
    @State private var sent = false

    var body: some View {
        VStack(spacing: 14) {
            Text("Reset your password")
                .font(Theme.heading(20, .bold))
                .foregroundStyle(Theme.foreground)
                .padding(.top, 26)
            Text("Enter your email and we'll send a reset link.")
                .font(Theme.body(13))
                .foregroundStyle(Theme.muted)

            TextField("Email", text: $email)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .brandedField()

            Button {
                busy = true
                Task {
                    struct Body: Codable, Sendable { let email: String }
                    struct Ok: Codable { let ok: Bool }
                    let _: Ok? = try? await APIClient.shared.postPublic("/api/v1/auth/forgot-password", json: Body(email: email))
                    busy = false
                    sent = true
                    try? await Task.sleep(for: .seconds(1.6))
                    dismiss()
                }
            } label: {
                if busy { ProgressView().tint(Theme.onAccent) }
                else if sent { Text("Check your email ✓") }
                else { Text("Send reset link") }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(busy || sent || email.isEmpty)

            Spacer()
        }
        .padding(.horizontal, 28)
        .background(Theme.bg)
    }
}

// ── First-launch onboarding ─────────────────────────────────────────────
// Shown once per install (hasSeenOnboarding), before LoginView. Pages walk
// the three pillars: content ratings, tracking, discovery/social. The web
// app gets a mirrored flow (docs/native-parity.md).

struct OnboardingView: View {
    /// Called exactly once; `startSignup` is true when the user chose
    /// "Create account" (LoginView then opens with the signup sheet up).
    let onFinish: (_ startSignup: Bool) -> Void

    @State private var page: Int

    init(onFinish: @escaping (_ startSignup: Bool) -> Void) {
        self.onFinish = onFinish
        var initial = 0
        #if DEBUG && targetEnvironment(simulator)
        if let p = ProcessInfo.processInfo.environment["TBRA_DEBUG_ONBOARDING_PAGE"],
           let n = Int(p) { initial = n }
        #endif
        _page = State(initialValue: initial)
    }

    private static let pageCount = 4

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Skip — goes straight to sign-in, still one-shot.
                HStack {
                    Spacer()
                    if page < Self.pageCount - 1 {
                        Button("Skip") { onFinish(false) }
                            .font(Theme.body(15, .medium))
                            .foregroundStyle(Theme.muted)
                            .padding(.trailing, 24)
                            .padding(.top, 10)
                    } else {
                        // Reserve the row so the layout doesn't jump.
                        Text("Skip").font(Theme.body(15, .medium)).opacity(0)
                            .padding(.trailing, 24).padding(.top, 10)
                    }
                }

                TabView(selection: $page) {
                    welcomePage.tag(0)
                    contentPage.tag(1)
                    trackPage.tag(2)
                    discoverPage.tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut(duration: 0.25), value: page)

                // Custom page dots — lime for the active page.
                HStack(spacing: 8) {
                    ForEach(0..<Self.pageCount, id: \.self) { i in
                        Capsule()
                            .fill(i == page ? Theme.accent : Theme.muted.opacity(0.35))
                            .frame(width: i == page ? 22 : 7, height: 7)
                            .animation(.spring(duration: 0.3), value: page)
                    }
                }
                .padding(.bottom, 18)

                // Bottom CTA area
                VStack(spacing: 10) {
                    if page < Self.pageCount - 1 {
                        Button { page += 1 } label: {
                            Text("Continue")
                        }
                        .buttonStyle(AccentButtonStyle())
                    } else {
                        Button { onFinish(true) } label: {
                            Text("Create account")
                        }
                        .buttonStyle(AccentButtonStyle())
                        Button("I already have an account") { onFinish(false) }
                            .font(Theme.body(15, .medium))
                            .foregroundStyle(Theme.neonBlue)
                            .padding(.top, 2)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 34)
            }
        }
    }

    // ── Pages ──

    private var welcomePage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 10) {
                        Text("tbr*a")
                            .font(Theme.logo(56))
                            .foregroundStyle(Theme.logoGradient)
                        Text("The Based Reader App")
                            .font(Theme.body(15, .medium))
                            .foregroundStyle(Theme.muted)
                    }
                )
            },
            headline: "Know what's in a book\nbefore you read it",
            copy: "Track your reading, get honest content information, and find books that actually fit you — all in one place."
        )
    }

    private var contentPage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 12) {
                        Image(systemName: "shield.lefthalf.filled")
                            .font(.system(size: 64, weight: .medium))
                            .foregroundStyle(Theme.accent)
                        // Mini content-rating chips, echoing the What's Inside section
                        HStack(spacing: 8) {
                            OnboardChip(label: "Violence · Mild", tint: Theme.accent)
                            OnboardChip(label: "Language · None", tint: Theme.neonBlue)
                        }
                        OnboardChip(label: "Romance / Sex · Moderate", tint: Color(red: 0.75, green: 0.55, blue: 0.95))
                    }
                )
            },
            headline: "See What's Inside",
            copy: "Every book gets detailed content ratings — violence, language, romance, and more. Set your comfort zone once and we'll flag anything that crosses it."
        )
    }

    private var trackPage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 12) {
                        Image(systemName: "books.vertical.fill")
                            .font(.system(size: 64, weight: .medium))
                            .foregroundStyle(Theme.neonBlue)
                        HStack(spacing: 8) {
                            OnboardChip(label: "Reading Now", tint: Theme.accent)
                            OnboardChip(label: "TBR", tint: Theme.neonBlue)
                            OnboardChip(label: "Finished ✓", tint: Color(red: 0.75, green: 0.55, blue: 0.95))
                        }
                    }
                )
            },
            headline: "Your Library, Your Story",
            copy: "Log what you're reading in any format — print, ebook, or audio. Reading goals, streaks, stats, and re-reads all tracked automatically."
        )
    }

    private var discoverPage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 64, weight: .medium))
                            .foregroundStyle(Color(red: 0.75, green: 0.55, blue: 0.95))
                        HStack(spacing: 8) {
                            OnboardChip(label: "🕯️ Cozy", tint: Theme.accent)
                            OnboardChip(label: "⚡ Thrilling", tint: Theme.neonBlue)
                            OnboardChip(label: "🐉 Fantastical", tint: Color(red: 0.75, green: 0.55, blue: 0.95))
                        }
                    }
                )
            },
            headline: "Find Your Next Read",
            copy: "Tell Discover your mood and we'll match books to your taste — plus custom shelves, buddy reads, and friends' reviews when you want them."
        )
    }
}

/// One onboarding page: centered art block + headline + body copy.
private struct OnboardPage: View {
    let art: () -> AnyView
    let headline: String
    let copy: String

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            art()
                .frame(height: 190)
            Spacer().frame(height: 34)
            Text(headline)
                .font(Theme.heading(28, .bold))
                .foregroundStyle(Theme.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text(copy)
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
                .padding(.horizontal, 8)
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
    }
}

/// Translucent brand chip used in onboarding art (never a solid fill —
/// pill/badge styles are translucent per BRANDING.md).
private struct OnboardChip: View {
    let label: String
    let tint: Color

    var body: some View {
        Text(label)
            .font(Theme.body(13, .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(tint.opacity(0.14))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(tint.opacity(0.35), lineWidth: 1))
    }
}
