import AuthenticationServices
import UIKit

/// Links the pilot's autorouter account in Apple's sign-in sheet: the server's page sends the pilot
/// to autorouter and, once they approve, back as pigsgottafly://autorouter?result=connected|denied|failed.
@MainActor
final class AutorouterConnect: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// The result the server reported; "cancelled" when the pilot closed the sheet.
    func run(_ url: URL) async -> String {
        await withCheckedContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "pigsgottafly") { callback, _ in
                let result = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
                    .queryItems?.first { $0.name == "result" }?.value
                cont.resume(returning: result ?? "cancelled")
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { cont.resume(returning: "failed") }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
