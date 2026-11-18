// Конструктор Untitled Session — программа для Mac (партнёр 18.11: «давай конструктор отдельной простой программой без
// этих плясок с терминалом»). Собирается на самом Mac из mac/install.mjs (npm run constructor:app): своё окно с
// конструктором, без браузера и без Терминала.
//
// Оболочка ничего не знает о конструкторе. Она запускает node tools/constructor/app.mjs (тот забирает свежее с GitHub, ставит
// пакеты, собирает страницу и поднимает сервер), показывает его строки STATUS, открывает страницу по READY, показывает FAIL
// и гасит его при выходе. Всё, что может поменяться, живёт в app.mjs и обновляется само; оболочку пересобирает тоже он.
// Метки __…__ подставляет install.mjs.
import Cocoa
import WebKit

let projectRoot = "__ROOT__"
let nodeCandidates = ["__NODE__", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
let shellVersion = "__SHELL_VERSION__"
/// Самопроверка на CI (constructor-mac.yml): открыть конструктор, убедиться, что полка заполнилась, и выйти с ответом.
let selfTest = ProcessInfo.processInfo.environment["CONSTRUCTOR_SELFTEST"] == "1"

func say(_ text: String) {
    print(text)
    fflush(stdout)
}

/// Текст в HTML.
func esc(_ s: String) -> String {
    return s.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
}

/// Страница оболочки: пока конструктор собирается или если он не открылся. Цвета — как у конструктора.
func shellPage(_ title: String, _ body: String) -> String {
    return """
    <!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#121417;color:#e8e6e0;font:15px -apple-system,system-ui,sans-serif}
    main{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;height:100%;max-width:680px;margin:0 auto;padding:0 32px}
    h1{font-size:20px;font-weight:600;margin:0 0 12px}
    p{color:#9aa1a9;margin:0 0 10px;line-height:1.45}
    pre{white-space:pre-wrap;font:12px ui-monospace,Menlo,monospace;color:#9aa1a9;background:#191c20;border:1px solid #2c3138;border-radius:8px;padding:12px;max-height:45vh;overflow:auto;margin:0 0 10px}
    </style></head><body><main><h1>\(title)</h1>\(body)</main></body></html>
    """
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var proc: Process?
    var toNode: Pipe?
    var buffer = Data()
    var tail: [String] = []
    var pageURL: URL?
    var quitting = false
    var restarts = 0
    var testTries = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        web = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        web.uiDelegate = self
        web.navigationDelegate = self
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Конструктор"
        if #available(macOS 11.0, *) { window.subtitle = "Untitled Session" }
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 900, height: 600)
        if !window.setFrameUsingName("constructor.window") { window.center() }
        window.setFrameAutosaveName("constructor.window")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        showStatus("Запускаю…")
        startNode()
        if selfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 300) { self.finishTest(false, "время вышло") }
        }
    }

    // MARK: меню — без него в Mac не работают ⌘C/⌘V, ⌘Q и ⌘W

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Скрыть Конструктор", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Выйти из Конструктора", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Правка")
        edit.addItem(withTitle: "Отменить", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Повторить", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(NSMenuItem.separator())
        edit.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Скопировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Выбрать всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "Вид")
        view.addItem(withTitle: "Обновить окно", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        view.addItem(withTitle: "Открыть в браузере", action: #selector(openInBrowser(_:)), keyEquivalent: "")
        viewItem.submenu = view

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let win = NSMenu(title: "Окно")
        win.addItem(withTitle: "Свернуть", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Закрыть", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win

        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    @objc func reloadPage(_ sender: Any?) {
        if let url = pageURL { web.load(URLRequest(url: url)) }
    }

    @objc func openInBrowser(_ sender: Any?) {
        if let url = pageURL { NSWorkspace.shared.open(url) }
    }

    // MARK: node — app.mjs

    func nodePath() -> String? {
        for path in nodeCandidates where !path.isEmpty && !path.hasPrefix("__") {
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }

    func startNode() {
        guard let node = nodePath() else {
            fail("Не нашёл Node.js.", "Поставь его с nodejs.org (кнопка LTS) и открой программу снова.")
            return
        }
        let script = projectRoot + "/tools/constructor/app.mjs"
        guard FileManager.default.fileExists(atPath: script) else {
            fail("Не нашёл проект.", "Ждал его здесь: \(projectRoot). Если папку перенесли, программу нужно поставить заново.")
            return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [script]
        p.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (node as NSString).deletingLastPathComponent
        env["PATH"] = [nodeDir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].joined(separator: ":")
        env["CONSTRUCTOR_SHELL"] = shellVersion
        env["CONSTRUCTOR_BUNDLE"] = Bundle.main.bundlePath
        p.environment = env
        let fromNode = Pipe()
        let input = Pipe()
        p.standardOutput = fromNode
        p.standardError = fromNode
        p.standardInput = input
        // Оболочка живёт, пока открыта программа, поэтому self — без weak (weak-переменная в таких замыканиях — ошибка
        // компиляции у новых версий Swift).
        fromNode.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            DispatchQueue.main.async { self.received(data) }
        }
        p.terminationHandler = { finished in
            let code = finished.terminationStatus
            DispatchQueue.main.async { self.ended(code) }
        }
        do {
            try p.run()
            proc = p
            toNode = input
        } catch {
            fail("Не смог запустить Node.js.", error.localizedDescription)
        }
    }

    /// Вывод node приходит кусками; строки — по переводу строки (русские буквы не рвутся посередине).
    func received(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = String(decoding: buffer[buffer.startIndex..<newline], as: UTF8.self)
            buffer.removeSubrange(buffer.startIndex...newline)
            handle(line)
        }
    }

    func handle(_ line: String) {
        tail.append(line)
        if tail.count > 40 { tail.removeFirst(tail.count - 40) }
        if selfTest { say("node: \(line)") }
        if line.hasPrefix("STATUS ") {
            if pageURL == nil { showStatus(String(line.dropFirst(7))) }
        } else if line.hasPrefix("READY ") {
            let text = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            if let url = URL(string: text) {
                pageURL = url
                web.load(URLRequest(url: url))
            }
        } else if line.hasPrefix("FAIL ") {
            fail("Конструктор не открылся.", String(line.dropFirst(5)))
        }
    }

    func ended(_ code: Int32) {
        proc = nil
        toNode = nil
        if quitting { return }
        if code == 75 && restarts < 3 {
            // app.mjs просит перезапуск (обновился сам).
            restarts += 1
            pageURL = nil
            showStatus("Обновляюсь…")
            startNode()
            return
        }
        fail("Конструктор остановился.", "Код \(code).")
    }

    // MARK: страницы оболочки

    func showStatus(_ text: String) {
        web.loadHTMLString(shellPage("Конструктор открывается…", "<p>\(esc(text))</p>"), baseURL: nil)
    }

    func fail(_ title: String, _ text: String) {
        pageURL = nil
        var body = "<p>\(esc(text))</p>"
        let log = tail.suffix(25).joined(separator: "\n")
        if !log.isEmpty { body += "<pre>\(esc(log))</pre>" }
        body += "<p>Закрой программу и открой снова. Не помогло — пришли снимок этого окна основной модели.</p>"
        web.loadHTMLString(shellPage(esc(title), body), baseURL: nil)
        if selfTest { finishTest(false, title + " " + text) }
    }

    // MARK: выход — node уходит вместе с окном

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopNode()
    }

    func stopNode() {
        quitting = true
        guard let p = proc, p.isRunning else { return }
        p.terminate()
        let deadline = Date().addingTimeInterval(2)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
    }

    // MARK: ссылки наружу — в браузер; окно остаётся конструктором

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if selfTest, pageURL != nil, webView.url == pageURL { probe() }
    }

    // MARK: самопроверка на CI

    /// Страница пришла от сервера конструктора и ожила: заголовок, кнопка «Залить в игру», полка. Без WebGL (на CI бывает)
    /// конструктор не рисует сцену, тогда хватает заголовка и кнопки — оболочка своё дело сделала.
    func probe() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let js = "JSON.stringify({ title: document.title, hasPush: !!document.getElementById('push'), push: !!document.getElementById('push') && !document.getElementById('push').hidden, shelf: document.querySelectorAll('#shelf > *').length, gl: !!document.createElement('canvas').getContext('webgl2') })"
            self.web.evaluateJavaScript(js) { result, error in
                let text = (result as? String) ?? String(describing: error)
                var info: [String: Any] = [:]
                if let data = text.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    info = parsed
                }
                let title = info["title"] as? String ?? ""
                let hasPush = info["hasPush"] as? Bool ?? false
                let push = info["push"] as? Bool ?? false
                let shelf = info["shelf"] as? Int ?? 0
                let gl = info["gl"] as? Bool ?? false
                if title == "Конструктор" && hasPush && (!gl || (shelf > 0 && push)) {
                    self.finishTest(true, text)
                } else {
                    self.testTries += 1
                    if self.testTries < 40 { self.probe() } else { self.finishTest(false, text) }
                }
            }
        }
    }

    func finishTest(_ ok: Bool, _ text: String) {
        say("SELFTEST \(ok ? "ok" : "fail") \(text)")
        stopNode()
        exit(ok ? 0 : 1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
