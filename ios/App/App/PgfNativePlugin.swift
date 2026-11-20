// The app's native parts, called from the web app (src/app/native.ts):
//   signIn({ url })   opens url in Apple's sign-in sheet (Safari's cookies, where Google sign-in
//                     works) and resolves with the pigsgottafly:// URL the page ends on;
//   print({ title })  prints the page with AirPrint (iOS web views ignore window.print()).
import AuthenticationServices
import Capacitor
import UIKit

@objc(PgfNativePlugin)
public class PgfNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "PgfNativePlugin"
    public let jsName = "PgfNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]

    /** The scheme the sign-in page hands the code back on (Info.plist registers it too). */
    static let callbackScheme = "pigsgottafly"
    private var session: ASWebAuthenticationSession?

    @objc func signIn(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("a sign-in URL is required")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { [weak self] back, error in
                self?.session = nil
                if let back {
                    call.resolve(["url": back.absoluteString])
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    call.reject("Sign-in cancelled", "cancelled")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed")
                }
            }
            session.presentationContextProvider = self
            // share Safari's cookies: already signed in to Google there means one tap
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Sign-in could not start")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else {
                call.reject("no page to print")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("title") ?? "Pig's Gotta Fly"
            let printer = UIPrintInteractionController.shared
            printer.printInfo = info
            printer.printFormatter = web.viewPrintFormatter()
            let done: UIPrintInteractionController.CompletionHandler = { _, printed, error in
                if let error { call.reject(error.localizedDescription) } else { call.resolve(["printed": printed]) }
            }
            // an iPad shows the print options as a popover from the top of the page
            if UIDevice.current.userInterfaceIdiom == .pad, let view = self.bridge?.viewController?.view {
                printer.present(from: CGRect(x: view.bounds.midX, y: view.safeAreaInsets.top + 8, width: 1, height: 1), in: view, animated: true, completionHandler: done)
            } else {
                printer.present(animated: true, completionHandler: done)
            }
        }
    }
}
