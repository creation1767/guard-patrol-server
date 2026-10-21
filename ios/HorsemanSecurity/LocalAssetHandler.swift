import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves the bundled web app at horseman://app/… straight from the app bundle.
/// A custom scheme (rather than file://) gives the page a stable origin, so its saved data
/// (signed-in officer, queued reports) persists, and the company server can allow it for API calls.
final class LocalAssetHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "horseman"
    static let host = "app"
    static var startURL: URL { URL(string: "\(scheme)://\(host)/index.html")! }

    private let root: URL? = Bundle.main.url(forResource: "app", withExtension: nil)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = root else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        var rel = url.path.removingPercentEncoding ?? url.path
        if rel.isEmpty || rel == "/" { rel = "/index.html" }
        let file = root.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
        // Never serve anything outside the bundled app folder.
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(r); task.didReceive(Data("Not found".utf8)); task.didFinish(); return
        }
        let headers = ["Content-Type": Self.mimeType(for: file), "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "json", "webmanifest": return "application/json"
        case "png": return "image/png"
        case "webp": return "image/webp"
        default:
            return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
