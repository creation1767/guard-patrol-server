import UIKit
import WebKit
import CoreLocation
import AudioToolbox

/// Hosts the officer app and answers its calls to `window.Android.*` (the same bridge the Android app
/// provides, so the web code needs no iPhone-specific branches) plus `navigator.geolocation`.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, CLLocationManagerDelegate {
    private var webView: WKWebView!
    private let location = CLLocationManager()
    /// Location requests from the page: id → true if it wants a single reading, false for a running watch.
    private var geoRequests: [Int: Bool] = [:]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(LocalAssetHandler(), forURLScheme: LocalAssetHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(WeakMessageHandler(self), name: "horseman")
        config.userContentController = content

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 6 / 255, green: 8 / 255, blue: 14 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page handles the notch itself (safe-area CSS)
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyBest
        webView.load(URLRequest(url: LocalAssetHandler.startURL))
    }

    // MARK: Links

    /// Pages of the bundled app stay inside; everything else (website, Stripe, maps, email, phone) opens in Safari or its own app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == LocalAssetHandler.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    /// target="_blank" links.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // Page dialogs (confirm/alert/prompt) as native alerts.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }

    /// If iOS ends the web content process (low memory), reload instead of showing a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let cmd = m["cmd"] as? String else { return }
        switch cmd {
        case "scanQR":
            let prompt = (m["prompt"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Scan checkpoint QR code"
            present(QRScannerViewController(prompt: prompt) { [weak self] code in
                guard let code = code else { return }
                self?.js("window.GP&&GP.onScan(\(Self.jsString(code)))")
            }, animated: true)
        case "share":
            let text = m["text"] as? String ?? ""
            presentShare([text])
        case "print":
            let p = UIPrintInteractionController.shared
            let info = UIPrintInfo.printInfo(); info.jobName = "4 Horseman Security"; info.outputType = .general
            p.printInfo = info
            p.printFormatter = webView.viewPrintFormatter()
            p.present(animated: true)
        case "saveFile":
            saveFile(name: m["name"] as? String ?? "export", base64: m["data"] as? String ?? "")
        case "vibrate":
            let ms = m["ms"] as? Double ?? 50
            if ms >= 150 { AudioServicesPlaySystemSound(kSystemSoundID_Vibrate) }
            else { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
        case "geo":
            guard let id = m["id"] as? Int else { return }
            geoRequests[id] = (m["once"] as? Bool) ?? true
            startLocation()
        case "geoClear":
            if let id = m["id"] as? Int { geoRequests[id] = nil }
            if geoRequests.isEmpty { location.stopUpdatingLocation() }
        default:
            break
        }
    }

    private func presentShare(_ items: [Any]) {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
        present(vc, animated: true)
    }

    /// Exported spreadsheets: written to a temporary file and offered to Save to Files, Mail, Excel…
    private func saveFile(name: String, base64: String) {
        let safe = name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|")).joined(separator: "_")
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "export" : safe)
        do { try data.write(to: url, options: .atomic); presentShare([url]) }
        catch { js("window.alert && alert('Could not save the file.')") }
    }

    // MARK: Location (navigator.geolocation for the page)

    private func startLocation() {
        switch location.authorizationStatus {
        case .notDetermined: location.requestWhenInUseAuthorization()
        case .denied, .restricted: failGeo(code: 1, "Location permission is off for 4 Horseman. Turn it on in Settings.")
        default: location.startUpdatingLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !geoRequests.isEmpty else { return }
        startLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last, !geoRequests.isEmpty else { return }
        var p: [String: Any] = ["lat": l.coordinate.latitude, "lng": l.coordinate.longitude,
                                "acc": l.horizontalAccuracy, "t": l.timestamp.timeIntervalSince1970 * 1000]
        if l.verticalAccuracy >= 0 { p["alt"] = l.altitude }
        if l.course >= 0 { p["hdg"] = l.course }
        if l.speed >= 0 { p["spd"] = l.speed }
        let json = (try? JSONSerialization.data(withJSONObject: p)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        for (id, once) in geoRequests {
            js("window.__hmGeo&&__hmGeo.pos(\(id),\(json))")
            if once { geoRequests[id] = nil }
        }
        if geoRequests.isEmpty { location.stopUpdatingLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        failGeo(code: denied ? 1 : 2, denied ? "Location permission denied" : "Location unavailable")
    }

    private func failGeo(code: Int, _ message: String) {
        for (id, once) in geoRequests {
            js("window.__hmGeo&&__hmGeo.err(\(id),\(code),\(Self.jsString(message)))")
            if once { geoRequests[id] = nil }
        }
        if geoRequests.isEmpty { location.stopUpdatingLocation() }
    }

    // MARK: Helpers

    private func js(_ code: String) {
        DispatchQueue.main.async { self.webView.evaluateJavaScript(code, completionHandler: nil) }
    }

    static func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())   // the JSON string literal without the surrounding [ ]
    }

    /// Injected before the page loads: the window.Android bridge and a navigator.geolocation backed by iOS location.
    static let bridgeScript = """
    (() => {
      const post = m => window.webkit.messageHandlers.horseman.postMessage(m);
      window.Android = {
        scanQR: p => post({ cmd: 'scanQR', prompt: String(p || '') }),
        share: (t, x) => post({ cmd: 'share', title: String(t || ''), text: String(x || '') }),
        print: () => post({ cmd: 'print' }),
        saveFile: (n, m, b) => post({ cmd: 'saveFile', name: String(n || 'export'), mime: String(m || ''), data: String(b || '') }),
        vibrate: ms => post({ cmd: 'vibrate', ms: +ms || 50 })
      };
      const cbs = {}; let seq = 0;
      const add = (ok, err, opts, once) => {
        const id = ++seq; cbs[id] = { ok, err, once };
        if (once && opts && opts.timeout > 0 && opts.timeout < 1e9) setTimeout(() => { if (cbs[id]) window.__hmGeo.err(id, 3, 'Timeout'); }, opts.timeout);
        post({ cmd: 'geo', id, once });
        return id;
      };
      const geo = {
        getCurrentPosition(ok, err, opts) { add(ok, err, opts, true); },
        watchPosition(ok, err, opts) { return add(ok, err, opts, false); },
        clearWatch(id) { delete cbs[id]; post({ cmd: 'geoClear', id }); }
      };
      window.__hmGeo = {
        pos(id, p) {
          const c = cbs[id]; if (!c) return; if (c.once) delete cbs[id];
          try { c.ok && c.ok({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc, altitude: p.alt ?? null, altitudeAccuracy: null, heading: p.hdg ?? null, speed: p.spd ?? null }, timestamp: p.t }); } catch (e) { }
        },
        err(id, code, message) {
          const c = cbs[id]; if (!c) return; if (c.once) delete cbs[id]; else return;
          try { c.err && c.err({ code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (e) { }
        }
      };
      try { Object.defineProperty(Navigator.prototype, 'geolocation', { get: () => geo, configurable: true }); } catch (e) { }
    })();
    """
}

/// Avoids a retain cycle between the web view's content controller and the view controller.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
