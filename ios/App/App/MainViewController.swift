// The app's web view: Capacitor's, with the app's own plugin and the back/forward swipe (an export
// opens in place of the editor; swiping right comes back).
import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PgfNativePlugin())
        webView?.allowsBackForwardNavigationGestures = true
    }
}
