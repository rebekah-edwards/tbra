import SwiftUI
import WebKit

// ── Admin — authenticated in-app browser for the web /admin section ──
//
// The admin dashboards (covers, issues, ARC reviews, users, landing…) are
// large, admin-only, and change often — rebuilding them natively would just
// create drift. Instead the app opens the REAL admin pages against the same
// backend it already talks to, authenticated by injecting the Keychain
// access token as the `tbra-session` cookie: the bearer token and the web
// session cookie are the same jose JWT, verified by the same
// verifySessionToken() on the server, so the web pages simply see a
// signed-in admin session.
//
// Data note: like everything in the app, these pages operate on the local
// database and changes ride the existing sync to the live site.

struct AdminSheet: View {
    @Environment(\.dismiss) private var dismiss
    /// Sheet title; the web page underneath supplies its own heading too.
    var title: String = "Admin"
    /// Path on the app's backend to open (no leading slash).
    var path: String = "admin"
    /// Optional raw query string (e.g. "editCover=1").
    var query: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title)
                    .font(Theme.heading(17, .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .font(Theme.body(15, .semibold))
                        .foregroundStyle(Theme.neonBlue)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Theme.bg)

            Divider().background(Theme.border.opacity(0.6))

            AdminWebView(path: path, query: query)
                .ignoresSafeArea(edges: .bottom)
        }
        .background(Theme.bg)
    }
}

private struct AdminWebView: UIViewRepresentable {
    var path: String = "admin"
    var query: String? = nil

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Non-persistent store: the only credential in here is the injected
        // session cookie, refreshed from the Keychain on every open.
        config.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear

        var adminURL = APIClient.baseURL.appending(path: path)
        if let query, var comps = URLComponents(url: adminURL, resolvingAgainstBaseURL: false) {
            comps.percentEncodedQuery = query
            adminURL = comps.url ?? adminURL
        }
        guard let host = APIClient.baseURL.host,
              let token = Keychain.accessToken,
              let cookie = HTTPCookie(properties: [
                  .name: "tbra-session",
                  .value: token,
                  .domain: host,
                  .path: "/",
              ]) else {
            webView.load(URLRequest(url: adminURL))
            return webView
        }

        // Set the cookie first, THEN load — otherwise the first request
        // races the cookie store and lands signed-out.
        config.websiteDataStore.httpCookieStore.setCookie(cookie) {
            webView.load(URLRequest(url: adminURL))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
