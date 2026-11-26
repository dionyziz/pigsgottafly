import SwiftUI
import UIKit

@main
struct PigsGottaFlyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(app.session)
                .environmentObject(app.subscriptions)
        }
    }
}

/// iPhone: portrait, and landscape too while Fly is shown. iPad: every orientation.
final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var orientations: UIInterfaceOrientationMask = .portrait

    func application(
        _ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated {
            UIDevice.current.userInterfaceIdiom == .pad ? .all : AppDelegate.orientations
        }
    }
}

@MainActor
enum Orientation {
    static func allow(_ mask: UIInterfaceOrientationMask) {
        guard UIDevice.current.userInterfaceIdiom == .phone, AppDelegate.orientations != mask else { return }
        AppDelegate.orientations = mask
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            if mask == .portrait { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) }
        }
    }

    /// Turns the screen (launch argument `-orientation landscape`: screenshots of Fly in landscape).
    static func rotate(to mask: UIInterfaceOrientationMask) {
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        }
    }
}
