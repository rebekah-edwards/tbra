import SwiftUI
import Observation
import AuthenticationServices

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

    /// Google Sign-In via the web OAuth flow in an ASWebAuthenticationSession.
    /// The backend (?native=1) returns the token pair on tbra://google-auth
    /// instead of setting the web cookie — all account linking/creation logic
    /// stays server-side (api/auth/google/callback).
    func signInWithGoogle() async {
        loginError = nil
        var comps = URLComponents(url: APIClient.baseURL.appending(path: "api/auth/google"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "native", value: "1")]
        do {
            let callback = try await GoogleAuthSession.run(url: comps.url!)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func item(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }
            if let err = item("error") {
                loginError = "Google sign-in failed (\(err.replacingOccurrences(of: "google_", with: "")))."
                return
            }
            guard let token = item("token"), let refresh = item("refresh") else {
                loginError = "Google sign-in failed."
                return
            }
            Keychain.accessToken = token
            Keychain.refreshToken = refresh
            let user = try await APIClient.shared.me()
            phase = .signedIn(user)
        } catch let err as ASWebAuthenticationSessionError where err.code == .canceledLogin {
            // User closed the sheet — not an error.
        } catch {
            loginError = "Google sign-in failed."
        }
    }
}

/// One-shot ASWebAuthenticationSession wrapper (presentation anchor + async).
@MainActor
private final class GoogleAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private static var current: GoogleAuthSession?
    private var session: ASWebAuthenticationSession?

    static func run(url: URL) async throws -> URL {
        let helper = GoogleAuthSession()
        current = helper
        defer { current = nil }
        return try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "tbra") { cb, err in
                if let cb { cont.resume(returning: cb) }
                else { cont.resume(throwing: err ?? URLError(.userCancelledAuthentication)) }
            }
            s.presentationContextProvider = helper
            // Share Safari's cookie jar so an existing Google session is offered.
            s.prefersEphemeralWebBrowserSession = false
            helper.session = s
            s.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }
}

/// White "Continue with Google" button (web GoogleButton parity: official G
/// mark, white field, black label — identical in both themes).
struct GoogleSignInButton: View {
    var label = "Continue with Google"
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image("GoogleG")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 18, height: 18)
                Text(label)
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(.black)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.12), lineWidth: 1))
        }
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
            // TBRA_DEBUG_NO_AUTOLOGIN=1 keeps the login screen up so the
            // signed-out UI itself can be verified headlessly.
            if case .signedOut = auth.phase,
               ProcessInfo.processInfo.environment["TBRA_DEBUG_NO_AUTOLOGIN"] == nil {
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

                HStack(spacing: 12) {
                    Rectangle().fill(Theme.border).frame(height: 1)
                    Text("or").font(Theme.body(12)).foregroundStyle(Theme.muted)
                    Rectangle().fill(Theme.border).frame(height: 1)
                }
                .padding(.vertical, 2)

                GoogleSignInButton {
                    Task { busy = true; await auth.signInWithGoogle(); busy = false }
                }
                .disabled(busy)

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

                GoogleSignInButton(label: "Sign up with Google") {
                    Task {
                        busy = true
                        await auth.signInWithGoogle()
                        busy = false
                        if case .signedIn = auth.phase { dismiss() }
                    }
                }
                .disabled(busy)

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
                    premiumPage.tag(3)
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
                    // Equal 36pt gaps: logo→definition here, definition→headline
                    // via gap below (artHeight 0 = natural height, no frame slack).
                    VStack(spacing: 36) {
                        Text("tbr*a")
                            .font(Theme.logo(40))
                            .foregroundStyle(Theme.logoGradient)
                        // Dictionary-entry card defining the brand.
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("based")
                                    .font(Theme.heading(24, .bold))
                                    .foregroundStyle(Theme.foreground)
                                Text("/beɪst/")
                                    .font(Theme.body(14))
                                    .foregroundStyle(Theme.muted)
                                Text("adj.")
                                    .font(Theme.body(14).italic())
                                    .foregroundStyle(Theme.muted)
                            }
                            Rectangle().fill(Theme.border).frame(height: 1)
                            Text("being authentically yourself, unapologetic, and confident in your beliefs, regardless of what others think")
                                .font(Theme.body(14).italic())
                                .foregroundStyle(Theme.foreground.opacity(0.85))
                                .lineSpacing(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(16)
                        .background(Theme.surface.opacity(0.75))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                    }
                )
            },
            headline: "Know what's in a book\nbefore you read it",
            copy: "Decide exactly what you do (and don't) want to read. Track your reading, manage your owned library, and see reviews from other based readers — all in one place.",
            artHeight: 0,
            gap: 36
        )
    }

    private var contentPage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 12) {
                        Image(systemName: "shield.lefthalf.filled")
                            .font(.system(size: 56, weight: .medium))
                            .foregroundStyle(Theme.accent)
                        // Mini content-rating chips, echoing the What's Inside section
                        HStack(spacing: 8) {
                            OnboardChip(label: "Violence · Mild", tint: Theme.accent, textTint: Theme.accentText)
                            OnboardChip(label: "Language · None", tint: Theme.neonBlue)
                        }
                        OnboardChip(label: "Sexual Content · Moderate", tint: Theme.neonPurple)
                        // Genre fine-tuning: what you DO want, not just what to avoid
                        HStack(spacing: 8) {
                            OnboardChip(label: "Fantasy", systemImage: "heart.fill", tint: Theme.accent, textTint: Theme.accentText)
                            OnboardChip(label: "Horror", systemImage: "hand.thumbsdown.fill", tint: Theme.neonBlue)
                        }
                    }
                )
            },
            headline: "See What's Inside",
            copy: "Every book gets detailed content ratings — violence, language, sexual content, and more. Set your comfort zone once and we'll flag anything that crosses it. Then fine-tune what you DO want: heart the genres you love and dismiss the ones you don't."
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
                            OnboardChip(label: "Reading Now", tint: Theme.accent, textTint: Theme.accentText)
                            OnboardChip(label: "TBR", tint: Theme.neonBlue)
                            OnboardChip(label: "Finished ✓", tint: Theme.neonPurple)
                        }
                    }
                )
            },
            headline: "Know Your Library",
            copy: "Log what you're reading in any format — hardcover, paperback, eBook, or audio. Your reading goals, streaks, stats, re-reads, and owned library are all tracked automatically."
        )
    }

    private var premiumPage: some View {
        OnboardPage(
            art: {
                AnyView(
                    VStack(spacing: 12) {
                        Image(systemName: "star.circle.fill")
                            .font(.system(size: 56, weight: .medium))
                            .foregroundStyle(Theme.neonPurple)
                        Text("BASED READER PREMIUM")
                            .font(Theme.body(12, .bold))
                            .kerning(1.2)
                            .foregroundStyle(Theme.neonPurple)
                        HStack(spacing: 8) {
                            OnboardChip(label: "Custom Shelves", systemImage: "books.vertical", tint: Theme.neonPurple)
                            OnboardChip(label: "Notes to Self", systemImage: "note.text", tint: Theme.neonBlue)
                        }
                        HStack(spacing: 8) {
                            OnboardChip(label: "Buddy Reads", systemImage: "person.2.fill", tint: Theme.accent, textTint: Theme.accentText)
                            OnboardChip(label: "Discover", systemImage: "sparkles", tint: Theme.neonPurple)
                        }
                    }
                )
            },
            headline: "Make It Yours",
            copy: "Go premium to organize books any way you like with custom shelves, keep private notes on your TBR, and read together with buddy reads. Then let Discover match books to your exact taste — so every recommendation actually fits.",
            artHeight: 230
        )
    }
}

/// One onboarding page: centered art block + headline + body copy.
private struct OnboardPage: View {
    let art: () -> AnyView
    let headline: String
    let copy: String
    /// Welcome page overrides these — artHeight 0 lets the art size itself
    /// (logo + definition card) so the art→headline gap is exact.
    var artHeight: CGFloat = 190
    var gap: CGFloat = 34

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            if artHeight > 0 {
                art().frame(height: artHeight)
            } else {
                art()
            }
            Spacer().frame(height: gap)
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
/// pill/badge styles are translucent per BRANDING.md). Accent-tinted chips
/// MUST pass textTint: Theme.accentText — lime text on a light background is
/// unreadable, so light mode flips it to near-black (same as the web's
/// global text-accent override).
private struct OnboardChip: View {
    let label: String
    var systemImage: String? = nil
    let tint: Color
    var textTint: Color? = nil

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 11, weight: .semibold))
            }
            Text(label)
        }
        .font(Theme.body(13, .semibold))
        .foregroundStyle(textTint ?? tint)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(tint.opacity(0.14))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.35), lineWidth: 1))
    }
}
