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
                ProgressView().controlSize(.large)
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
    }
}

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 16) {
            Text("tbr*a").font(.largeTitle.bold())
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
            SecureField("Password", text: $password)
                .textContentType(.password)
            if let err = auth.loginError {
                Text(err).font(.footnote).foregroundStyle(.red)
            }
            Button {
                Task { busy = true; await auth.login(email: email, password: password); busy = false }
            } label: {
                Text("Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || email.isEmpty || password.isEmpty)
        }
        .textFieldStyle(.roundedBorder)
        .padding()
    }
}
