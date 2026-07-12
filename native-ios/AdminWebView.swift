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
        // Non-persistent store: the only credential in here is the session
        // cookie the bridge route sets, refreshed on every open.
        config.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear

        // Authenticate through the server-side bridge: it verifies the app's
        // bearer token, sets the tbra-session cookie via Set-Cookie, and
        // redirects to the target page. (Injecting the cookie with
        // WKHTTPCookieStore silently failed on-device where the backend host
        // is a raw Tailscale IP — the webview loaded pages signed out.)
        var target = "/" + path
        if let query { target += "?" + query }

        var comps = URLComponents(url: APIClient.baseURL.appending(path: "api/v1/auth/web-session"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "token", value: Keychain.accessToken ?? ""),
            URLQueryItem(name: "next", value: target),
        ]
        webView.load(URLRequest(url: comps.url!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
