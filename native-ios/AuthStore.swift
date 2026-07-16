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

    var body: some View {
        Group {
            switch auth.phase {
            case .loading:
                ZStack {
                    AmbientBackground()
                    ProgressView().controlSize(.large).tint(Theme.accent)
                }
            case .signedOut:
                LoginView()
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
