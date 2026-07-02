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
        guard Keychain.accessToken != nil || Keychain.refreshToken != nil else {
            phase = .signedOut
            return
        }
        do {
            let user = try await APIClient.shared.me()
            phase = .signedIn(user)
        } catch {
            Keychain.clear()
            phase = .signedOut
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
                MainTabView()
            }
        }
        .environment(auth)
        .task { await auth.restore() }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            Tab("Up Next", systemImage: "books.vertical") { UpNextView() }
            Tab("Shelves", systemImage: "square.stack") { ShelvesView() }
        }
        // Active tab is neon purple on the web (bottom-tabs.tsx: text-neon-purple);
        // lime is reserved for the center "+" action button there.
        .tint(Theme.neonPurple)
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

                Spacer()
                Spacer()
            }
            .padding(.horizontal, 28)
        }
    }
}
