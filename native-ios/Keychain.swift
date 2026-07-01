import Foundation
import Security

/// Minimal Keychain wrapper for the access + refresh tokens. The Keychain is
/// encrypted by the OS at the hardware level, so raw tokens never sit in plain
/// UserDefaults. `kSecAttrAccessibleAfterFirstUnlock` keeps them readable for
/// background refreshes while still protected at rest.
enum Keychain {
    private static let service = "app.tbra.tokens"

    static func set(_ value: String?, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)

        guard let value, let data = value.data(using: .utf8) else { return }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else { return nil }
        return string
    }

    // Convenience accessors
    static var accessToken: String? {
        get { get("accessToken") }
        set { set(newValue, for: "accessToken") }
    }
    static var refreshToken: String? {
        get { get("refreshToken") }
        set { set(newValue, for: "refreshToken") }
    }

    static func clear() {
        accessToken = nil
        refreshToken = nil
    }
}
