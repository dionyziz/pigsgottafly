import UIKit
import WebKit

/// The website's printed sheets, made on the device with no network: Resources/pdf/sheets.html (the
/// web's PDF page, src/pdf/main.tsx, inlined by `npm run native:pdf`) is drawn in an off-screen
/// WKWebView from a snapshot of the content, and once it says data-pdf-ready its print layout is cut
/// into A4 pages by UIPrintPageRenderer. The server prints the same page with Chromium
/// (api/_lib/sheetPdf.ts), so an e-mailed navlog and a shared one match.
@MainActor
enum SheetRenderer {
    /// The page's snapshot kinds (src/pdf/main.tsx SheetsSnapshot).
    enum Kind: String, Sendable {
        case navlog, briefing, fplform, wbperf, fplfax, form731, gendec

        /// UIPrintPageRenderer has one paper size per job, so each kind takes its sheets' @page: the
        /// navlog's md42 (A4 landscape, 5 mm), Form 731's f731 (A4 landscape, no margin), the others'
        /// xp / fpl / gendec (A4 portrait, no margin).
        var landscape: Bool { self == .navlog || self == .form731 }
        var marginMM: CGFloat { self == .navlog ? 5 : 0 }
    }

    enum RenderError: LocalizedError {
        case missingPage
        case notDrawn(String)
        case empty

        var errorDescription: String? {
            switch self {
            case .missingPage: "The PDF page is not in the app."
            case .notDrawn(let why): "The sheets did not render: \(why)"
            case .empty: "The sheets printed no page."
            }
        }
    }

    static let a4 = CGSize(width: 595.2756, height: 841.8898)

    /// WebKit does not cut a flex container between its items when it paginates (Chromium does), so a
    /// long briefing would split a NOTAM across two pages: in print its sheet is a block, the flex gap
    /// becoming margins (added to the heading's own: a flex item's margin does not collapse). And WebKit takes the app's `ui-monospace` as SF Mono, which Chromium skips for
    /// Menlo: Menlo (pdf.css: DejaVu Sans Mono, the same metrics, where iOS has none) keeps the
    /// navlog's fitted figures as wide as in the server's PDF. Outside print: the navlog fits its text
    /// before printing.
    static let webKitPrintCSS = """
        :root { --mono: Menlo, monospace; }
        @media print {
          .xp-sheet.brief-sheet { display: block; }
          .xp-sheet.brief-sheet > * + * { margin-top: 2.6mm; }
          .xp-sheet.brief-sheet > .brief-h { margin-top: 4.6mm; }
          .brief-notam { display: block; }
          .brief-notam > * + * { margin-top: 0.8mm; }
        }
        """

    /// The PDF of one snapshot: `extra` holds the kind's other fields (wbperf's `signature`).
    static func pdf(_ kind: Kind, content: JSON, extra: [String: JSON] = [:], timeout: TimeInterval = 20)
        async throws -> Data
    {
        var snap = extra
        snap["kind"] = .string(kind.rawValue)
        snap["content"] = content
        return try await pdf(snapshot: .object(snap), kind: kind, timeout: timeout)
    }

    private static var pageHTML: String?

    static func page(_ bundle: Bundle = .main) throws -> String {
        if let pageHTML { return pageHTML }
        guard let url = bundle.url(forResource: "sheets", withExtension: "html"),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else { throw RenderError.missingPage }
        pageHTML = text
        return text
    }

    static func pdf(snapshot: JSON, kind: Kind, timeout: TimeInterval) async throws -> Data {
        let html = try page()
        let job = Job(snapshot: snapshot)
        defer { job.close() }
        try await job.load(html, timeout: timeout)
        let data = job.paginate(kind)
        guard !data.isEmpty else { throw RenderError.empty }
        return data
    }

    /// One web view, used once.
    private final class Job: NSObject, WKNavigationDelegate {
        let web: WKWebView
        private var loaded: CheckedContinuation<Void, Error>?

        init(snapshot: JSON) {
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            config.suppressesIncrementalRendering = true
            let scripts = config.userContentController
            // The snapshot goes in as a JSON string parsed by the page, never spliced in as code.
            let literal = JSON.string(snapshot.text).text
            scripts.addUserScript(
                WKUserScript(
                    source: """
                        window.__PGF_SHEETS__ = JSON.parse(\(literal));
                        window.__PGF_ERRORS__ = [];
                        window.addEventListener('error', function (e) { window.__PGF_ERRORS__.push(String(e.message)); });
                        window.addEventListener('unhandledrejection', function (e) { window.__PGF_ERRORS__.push(String(e.reason)); });
                        // a web view outside the screen gets no animation frames, which the page waits for
                        window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
                        """,
                    injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let style = JSON.string(SheetRenderer.webKitPrintCSS).text
            scripts.addUserScript(
                WKUserScript(
                    source:
                        "var s = document.createElement('style'); s.textContent = \(style); document.head.appendChild(s);",
                    injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1200, height: 900), configuration: config)
            super.init()
            web.navigationDelegate = self
            web.isUserInteractionEnabled = false
        }

        func load(_ html: String, timeout: TimeInterval) async throws {
            // in a window, off its visible area: WebKit lays out and decodes fonts as for a shown page
            if let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows).first(where: \.isKeyWindow)
            {
                web.frame.origin = CGPoint(x: -web.frame.width - 100, y: 0)
                window.insertSubview(web, at: 0)
            }
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                loaded = c
                web.loadHTMLString(html, baseURL: nil)
            }
            let deadline = Date().addingTimeInterval(timeout)
            while true {
                let state =
                    try? await web.evaluateJavaScript("document.documentElement.dataset.pdfReady || ''") as? String
                if state == "true" { return }
                if state == "empty" { throw RenderError.notDrawn("no content") }
                if Date() > deadline {
                    let errors =
                        (try? await web.evaluateJavaScript("(window.__PGF_ERRORS__ || []).slice(0, 3).join('; ')")
                            as? String) ?? ""
                    throw RenderError.notDrawn(errors.isEmpty ? "timed out" : errors)
                }
                try await Task.sleep(nanoseconds: 30_000_000)
            }
        }

        /// WebKit lays a print out 1.25 times as wide as the paper in points (PrintContext's
        /// printingMinimumShrinkFactor), so a CSS px prints as 0.8 pt where Chromium prints 0.75 pt (96
        /// px to the inch). WebKit is given a paper larger by 1/scale and its pages are drawn shrunk by
        /// `scale`: the sheets come out at their CSS size (mm), cut where Chromium cuts them.
        static let scale: CGFloat = 0.75 * 1.25

        func paginate(_ kind: Kind) -> Data {
            let size = kind.landscape ? CGSize(width: a4.height, height: a4.width) : a4
            let paper = CGRect(origin: .zero, size: size)
            let k = Self.scale
            let inset = kind.marginMM * 72 / 25.4 / k
            // a sheet exactly one page high (297 mm) ends a hair below the page in WebKit's layout units,
            // which would add a blank page: the pages are cut a quarter of a CSS px lower
            let virtual = CGRect(x: 0, y: 0, width: size.width / k, height: size.height / k + 0.2)
            let r = A4Renderer(paper: virtual, printable: virtual.insetBy(dx: inset, dy: inset))
            r.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paper, nil)
            let pages = r.numberOfPages
            r.prepare(forDrawingPages: NSRange(location: 0, length: pages))
            for i in 0..<pages {
                UIGraphicsBeginPDFPage()
                guard let ctx = UIGraphicsGetCurrentContext() else { continue }
                ctx.saveGState()
                ctx.scaleBy(x: k, y: k)
                r.drawPage(at: i, in: virtual)
                ctx.restoreGState()
            }
            UIGraphicsEndPDFContext()
            return pages > 0 ? data as Data : Data()
        }

        func close() {
            web.stopLoading()
            web.removeFromSuperview()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded?.resume()
            loaded = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loaded?.resume(throwing: error)
            loaded = nil
        }

        func webView(
            _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
        ) {
            loaded?.resume(throwing: error)
            loaded = nil
        }

        /// The page loads nothing: everything it needs is inlined (data: URLs only).
        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            let scheme = action.request.url?.scheme ?? ""
            decisionHandler(scheme == "about" || scheme == "data" || action.request.url == nil ? .allow : .cancel)
        }
    }

    private final class A4Renderer: UIPrintPageRenderer {
        private let paper: CGRect
        private let printable: CGRect

        init(paper: CGRect, printable: CGRect) {
            self.paper = paper
            self.printable = printable
        }

        override var paperRect: CGRect { paper }
        override var printableRect: CGRect { printable }
    }
}

/// What the core needs to build a flight's documents (PGF.navlogContent, fplMessage, wbPerfContent…),
/// as cached on the device: the documents work offline.
struct SheetInputs: Sendable {
    var flight: String
    var aircraft: String?
    var pilot: String?
    var ref: String?
    var weather: String
    var notams: String?

    @MainActor
    init?(app: AppModel, model: FlightModel) {
        guard let f = model.flight else { return nil }
        flight = f.text
        aircraft = f["aircraftId"]?.string.flatMap { app.store.text(.aircraft($0)) }
        pilot = app.store.text(.pilot)
        ref = model.refText
        weather = app.store.text(.weather(model.id)) ?? "{}"
        notams = app.store.text(.notams(model.id))
    }
}

/// One document shown as a PDF: made again whenever what it is drawn from changes, the last one
/// staying on screen meanwhile.
@MainActor
final class SheetExport: ObservableObject {
    @Published private(set) var file: PDFFile?
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    private var signature: String?
    private var task: Task<Void, Never>?

    /// `key`: what the content is drawn from; the same key makes no new PDF. `extra`: the kind's other
    /// fields (the signatures).
    func update(
        key: String, name: String, _ kind: SheetRenderer.Kind, extra: [String: JSON] = [:],
        content: @escaping @MainActor () async throws -> JSON
    ) {
        guard key != signature else { return }
        signature = key
        task?.cancel()
        busy = true
        task = Task {
            do {
                let c = try await content()
                let data = try await SheetRenderer.pdf(kind, content: c, extra: extra)
                try Task.checkCancellation()
                file = try PDFFile.write(data, name: name)
                error = nil
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
                signature = nil
            }
            busy = false
        }
    }
}
