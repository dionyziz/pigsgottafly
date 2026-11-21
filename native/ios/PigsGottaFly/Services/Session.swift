import AuthenticationServices
import Foundation
import UIKit

/// Sign-in (NATIVE.md "Account"): Apple's sign-in sheet on /app-login, where the website signs the
/// pilot in (Google or Apple ID) and hands back pigsgottafly://signed-in?code=…; the code is exchanged
/// with GET /api/app-session?code=… (302 + Set-Cookie), the cookie kept in HTTPCookieStorage.shared;
/// GET /api/session then confirms `authed`.
@MainActor
final class Session: NSObject, ObservableObject {
    enum State: Equatable {
        case unknown
        case signedOut
        case signedIn
    }

    @Published private(set) var state: State = .unknown
    @Published private(set) var pilot: SessionResponse.PilotInfo?
    @Published var error: String?
    @Published private(set) var busy = false

    private let api: API
    private let store: Store
    private let fixtures: Bool
    private var authSession: ASWebAuthenticationSession?
    private static let signedInKey = "pgf.signedIn"

    init(api: API, store: Store, fixtures: Bool) {
        self.api = api
        self.store = store
        self.fixtures = fixtures
    }

    /// Asks the server; offline, trusts the last answer (Fly works with no connection).
    func check() async {
        do {
            let s = try await api.session()
            pilot = s.pilot
            set(signedIn: s.authed)
        } catch APIError.unauthorized {
            set(signedIn: false)
        } catch {
            state = UserDefaults.standard.bool(forKey: Session.signedInKey) || fixtures ? .signedIn : .signedOut
        }
    }

    private func set(signedIn: Bool) {
        UserDefaults.standard.set(signedIn, forKey: Session.signedInKey)
        state = signedIn ? .signedIn : .signedOut
    }

    /// The API said 401 somewhere: back to the sign-in screen.
    func lost() {
        guard !fixtures else { return }
        set(signedIn: false)
    }

    func signIn() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            let code = try await webSignIn()
            try await exchange(code: code)
            await check()
            if state != .signedIn { error = "The sign-in did not complete. Please try again." }
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            return
        } catch {
            if !isCancellation(error) { self.error = error.localizedDescription }
        }
    }

    func signOut() async {
        try? await api.logout()
        ended()
    }

    /// Deletes the account (DELETE /api/me with its e-mail typed as the confirmation), then forgets
    /// everything here as a sign-out does.
    func deleteAccount(confirm: String) async throws {
        try await api.deleteAccount(confirm: confirm)
        ended()
    }

    /// Signed out: the cookie, the cache and the saved map packs go.
    private func ended() {
        for c in HTTPCookieStorage.shared.cookies(for: API.site) ?? [] { HTTPCookieStorage.shared.deleteCookie(c) }
        store.clear()
        OfflineMaps.removeAll()
        pilot = nil
        set(signedIn: false)
    }

    // MARK: steps

    private func webSignIn() async throws -> String {
        let url = API.site.appendingPathComponent("app-login")
        return try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "pigsgottafly") { callback, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                let code = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
                    .queryItems?.first { $0.name == "code" }?.value
                if let code, !code.isEmpty {
                    cont.resume(returning: code)
                } else {
                    cont.resume(throwing: APIError.http(0, "The sign-in page returned no code."))
                }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            authSession = s
            if !s.start() { cont.resume(throwing: APIError.http(0, "The sign-in sheet could not open.")) }
        }
    }

    /// GET /api/app-session?code=… answers 302 to "/" with the session cookie: the redirect is not
    /// followed (its page is the website), and the cookie is stored from the 302 itself.
    func exchange(code: String) async throws {
        var comps = URLComponents(url: api.url("app-session"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "code", value: code)]
        let url = comps.url!
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (_, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0, "No answer") }
        Session.storeCookies(from: http, url: url)
        let location = http.value(forHTTPHeaderField: "Location") ?? ""
        if location.contains("signin=failed") {
            throw APIError.http(http.statusCode, "The sign-in code was not accepted.")
        }
        if http.statusCode >= 400 { throw APIError.http(http.statusCode, "The sign-in failed.") }
    }

    /// Stores every Set-Cookie of a response in the shared cookie storage.
    nonisolated static func storeCookies(from response: HTTPURLResponse, url: URL) {
        var headers: [String: String] = [:]
        for (k, v) in response.allHeaderFields {
            if let k = k as? String, let v = v as? String { headers[k] = v }
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        HTTPCookieStorage.shared.setCookies(cookies, for: url, mainDocumentURL: nil)
    }
}

extension Session: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}

/// Stops URLSession from following a redirect: the caller reads the 3xx itself.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        if let url = response.url { Session.storeCookies(from: response, url: url) }
        completionHandler(nil)
    }
}
