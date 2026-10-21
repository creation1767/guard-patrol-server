import UIKit

/// 4 Horseman Security for iPhone.
/// The app shows the same officer app as Android and the website (the repository's `app/` folder,
/// bundled inside the iPhone app so it works with no signal) in a full-screen web view, and adds the
/// phone features the web page cannot do on its own: QR scanning with the camera, GPS, sharing,
/// printing and saving exported spreadsheets.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.backgroundColor = UIColor(red: 6 / 255, green: 8 / 255, blue: 14 / 255, alpha: 1)
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
