// The app's web view: Capacitor's, with the app's own plugin and the back/forward swipe (an export
// opens in place of the editor; swiping right comes back).
import Capacitor
import UIKit
import WebKit

class MainViewController: CAPBridgeViewController {
    private var navigationFilter: QuietCancellations?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PgfNativePlugin())
        webView?.allowsBackForwardNavigationGestures = true
        if let web = webView, let capacitors = web.navigationDelegate {
            let filter = QuietCancellations(capacitors)
            navigationFilter = filter
            web.navigationDelegate = filter
        }
    }

    // Capacitor reads only the iPhone list; an iPad turns every way (Info.plist ~ipad).
    override open var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : super.supportedInterfaceOrientations
    }
}

/// Capacitor shows the offline page (server.errorPath, public/offline.html) whenever a load fails. A load
/// that was only cancelled (a new page started before it finished, a swipe back mid-load) or stopped by
/// policy is no failure, so it does not get there. Everything else goes to Capacitor's own handler.
private final class QuietCancellations: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?

    init(_ inner: WKNavigationDelegate) {
        self.inner = inner
    }

    private static func isQuiet(_ error: Error) -> Bool {
        let e = error as NSError
        if e.domain == NSURLErrorDomain, e.code == NSURLErrorCancelled { return true }
        // 102: frame load interrupted by a policy change; 204: a plug-in handled the load
        return e.domain == "WebKitErrorDomain" && (e.code == 102 || e.code == 204)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !Self.isQuiet(error) { inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if !Self.isQuiet(error) { inner?.webView?(webView, didFail: navigation, withError: error) }
    }

    // every other delegate method goes straight to Capacitor's handler
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (inner?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        inner?.responds(to: selector) == true ? inner : super.forwardingTarget(for: selector)
    }
}
