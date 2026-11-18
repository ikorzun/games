// Конструктор Untitled Session — программа для Mac (партнёр 18.11: «давай конструктор отдельной простой программой без
// этих плясок с терминалом»). Собирается на самом Mac из mac/install.mjs (npm run constructor:app): своё окно с
// конструктором, без браузера и без Терминала.
//
// Оболочка запускает node tools/constructor/app.mjs (тот забирает свежее с GitHub, ставит пакеты, собирает страницу и
// поднимает сервер), показывает его строки STATUS, открывает страницу по READY, показывает FAIL и гасит его при выходе.
// Всё, что может поменяться, живёт в app.mjs и обновляется само; оболочку пересобирает тоже он.
//
// Версия 2 (партнёр 18.11, 22:36: «Перестрой весь интерфейс конструктора следуя четким правилам Apple HIG и на нативных
// элементах macos»): настоящая панель окна macOS — место, помещение и вариант (всплывающие меню), «Двигать / Крутить»
// (сегменты), «Отменить», «Копия», «Удалить», «Залить в игру», показать и скрыть полку и инспектор; меню с сочетаниями
// клавиш; полупрозрачный фон боковой панели под полкой. Страница шлёт оболочке, что показать (канал ctor), оболочка ей —
// команды (window.__ctorNative.cmd). Метки __…__ подставляет install.mjs.
import Cocoa
import WebKit

let projectRoot = "__ROOT__"
let nodeCandidates = ["__NODE__", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
let shellVersion = "__SHELL_VERSION__"
/// Самопроверка на CI (constructor-mac.yml): открыть конструктор, убедиться, что он ожил и панель окна заполнилась, и выйти
/// с ответом. CONSTRUCTOR_SHOT — куда положить снимки окна (CI показывает их основной модели).
let selfTest = ProcessInfo.processInfo.environment["CONSTRUCTOR_SELFTEST"] == "1"
let shotPath = ProcessInfo.processInfo.environment["CONSTRUCTOR_SHOT"] ?? ""

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

/// Страница оболочки: пока конструктор собирается или если он не открылся. Системные шрифт и цвета, светлая и тёмная тема.
func shellPage(_ title: String, _ body: String) -> String {
    return """
    <!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
    html,body{margin:0;height:100%;background:Canvas;color:CanvasText;font:13px -apple-system,system-ui,sans-serif;-webkit-user-select:none;cursor:default}
    main{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;height:100%;max-width:620px;margin:0 auto;padding:0 32px}
    h1{font-size:15px;font-weight:600;margin:0 0 8px}
    p{color:-apple-system-secondary-label;margin:0 0 8px;line-height:1.45}
    pre{white-space:pre-wrap;-webkit-user-select:text;font:11px ui-monospace,Menlo,monospace;color:-apple-system-secondary-label;border:1px solid -apple-system-separator;border-radius:8px;padding:10px 12px;max-height:45vh;overflow:auto;margin:0 0 8px}
    </style></head><body><main><h1>\(title)</h1>\(body)</main></body></html>
    """
}

/// Что показать в панели окна — шлёт страница (tools/constructor/main.ts, nativeState).
struct Option: Decodable {
    let id: String
    let label: String
}

struct PanelState: Decodable {
    let worlds: [Option]
    let world: String
    let rooms: [Option]
    let room: String
    let pick: Int
    let picks: Int
    let own: Bool
    let tool: String
    let canUndo: Bool
    let sel: Bool
    let save: String
    let saveState: String
    let pushing: Bool
    let lib: Bool
    let insp: Bool
}

extension NSToolbarItem.Identifier {
    static let library = NSToolbarItem.Identifier("ctor.library")
    static let place = NSToolbarItem.Identifier("ctor.place")
    static let room = NSToolbarItem.Identifier("ctor.room")
    static let variant = NSToolbarItem.Identifier("ctor.variant")
    static let tool = NSToolbarItem.Identifier("ctor.tool")
    static let undo = NSToolbarItem.Identifier("ctor.undo")
    static let duplicate = NSToolbarItem.Identifier("ctor.duplicate")
    static let remove = NSToolbarItem.Identifier("ctor.remove")
    static let save = NSToolbarItem.Identifier("ctor.save")
    static let push = NSToolbarItem.Identifier("ctor.push")
    static let inspector = NSToolbarItem.Identifier("ctor.inspector")
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSToolbarDelegate, NSToolbarItemValidation, NSMenuItemValidation {
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
    var state: PanelState?
    let placePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    let roomPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    let variantPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    let saveLabel = NSTextField(labelWithString: "")
    var toolGroup: NSToolbarItemGroup?
    var pushButton: NSButton?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let look = ProcessInfo.processInfo.environment["CONSTRUCTOR_APPEARANCE"] {
            NSApp.appearance = NSAppearance(named: look == "dark" ? .darkAqua : .aqua)
        }
        buildMenu()
        let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "ctor")
        web = WKWebView(frame: frame, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        // Страница прозрачна там, где ей нечего рисовать (полка): под ней — полупрозрачный фон боковой панели macOS.
        if web.responds(to: NSSelectorFromString("setDrawsBackground:")) { web.setValue(false, forKey: "drawsBackground") }
        let glass = NSVisualEffectView(frame: frame)
        glass.material = .sidebar
        glass.blendingMode = .behindWindow
        glass.state = .followsWindowActiveState
        web.frame = glass.bounds
        glass.addSubview(web)

        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Конструктор"
        if #available(macOS 11.0, *) {
            window.subtitle = "Untitled Session"
            window.toolbarStyle = .unified
        }
        window.titleVisibility = .hidden
        window.contentView = glass
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 980, height: 600)
        let toolbar = NSToolbar(identifier: "constructor.toolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        if !window.setFrameUsingName("constructor.window") { window.center() }
        window.setFrameAutosaveName("constructor.window")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        syncPanel()
        showStatus("Запускаю…")
        startNode()
        if selfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 300) { self.finishTest(false, "время вышло") }
        }
    }

    // MARK: меню — по HIG: всё, что есть в панели окна, есть и в меню, с сочетаниями клавиш

    func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
        it.keyEquivalentModifierMask = mods
        it.target = target
        return it
    }

    func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(item("О программе «Конструктор»", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(item("Скрыть Конструктор", #selector(NSApplication.hide(_:)), "h"))
        appMenu.addItem(item("Скрыть остальные", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        appMenu.addItem(item("Показать все", #selector(NSApplication.unhideAllApplications(_:))))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(item("Выйти из Конструктора", #selector(NSApplication.terminate(_:)), "q"))
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        main.addItem(appItem)

        let file = NSMenu(title: "Файл")
        file.addItem(item("Залить в игру…", #selector(push(_:)), target: self))
        file.addItem(NSMenuItem.separator())
        file.addItem(item("Закрыть", #selector(NSWindow.performClose(_:)), "w"))
        let fileItem = NSMenuItem()
        fileItem.submenu = file
        main.addItem(fileItem)

        let edit = NSMenu(title: "Правка")
        // Отмена — сначала странице (вещи); в поле ввода — тексту.
        edit.addItem(item("Отменить", Selector(("undo:")), "z"))
        edit.addItem(item("Повторить", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(NSMenuItem.separator())
        edit.addItem(item("Вырезать", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Скопировать", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Вставить", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Выбрать всё", #selector(NSText.selectAll(_:)), "a"))
        edit.addItem(NSMenuItem.separator())
        edit.addItem(item("Копия вещи", #selector(duplicateSel(_:)), "d", target: self))
        edit.addItem(item("Удалить вещь", #selector(deleteSel(_:)), "\u{8}", target: self))
        let editItem = NSMenuItem()
        editItem.submenu = edit
        main.addItem(editItem)

        let view = NSMenu(title: "Вид")
        view.addItem(item("Полка", #selector(toggleLibrary(_:)), "s", [.command, .control], target: self))
        view.addItem(item("Инспектор", #selector(toggleInspector(_:)), "i", [.command, .option], target: self))
        view.addItem(NSMenuItem.separator())
        view.addItem(item("Двигать", #selector(toolMove(_:)), target: self))
        view.addItem(item("Крутить", #selector(toolRotate(_:)), target: self))
        view.addItem(NSMenuItem.separator())
        view.addItem(item("Обновить окно", #selector(reloadPage(_:)), "r", target: self))
        view.addItem(item("Открыть в браузере", #selector(openInBrowser(_:)), target: self))
        view.addItem(NSMenuItem.separator())
        view.addItem(item("Во весь экран", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        let viewItem = NSMenuItem()
        viewItem.submenu = view
        main.addItem(viewItem)

        let win = NSMenu(title: "Окно")
        win.addItem(item("Свернуть", #selector(NSWindow.performMiniaturize(_:)), "m"))
        win.addItem(item("Масштаб", #selector(NSWindow.performZoom(_:))))
        let winItem = NSMenuItem()
        winItem.submenu = win
        main.addItem(winItem)

        let help = NSMenu(title: "Справка")
        help.addItem(item("Клавиши конструктора", #selector(showKeys(_:)), "?", target: self))
        let helpItem = NSMenuItem()
        helpItem.submenu = help
        main.addItem(helpItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = win
        NSApp.helpMenu = help
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        let s = state
        guard let action = menuItem.action else { return true }
        switch action {
        case #selector(duplicateSel(_:)), #selector(deleteSel(_:)): return s?.sel ?? false
        case #selector(push(_:)): return s != nil && !(s?.pushing ?? true)
        case #selector(toggleLibrary(_:)):
            menuItem.state = (s?.lib ?? true) ? .on : .off
            return s != nil
        case #selector(toggleInspector(_:)):
            menuItem.state = (s?.insp ?? true) ? .on : .off
            return s != nil
        case #selector(toolMove(_:)):
            menuItem.state = s?.tool == "move" ? .on : .off
            return s != nil
        case #selector(toolRotate(_:)):
            menuItem.state = s?.tool == "rotate" ? .on : .off
            return s != nil
        case #selector(reloadPage(_:)), #selector(openInBrowser(_:)), #selector(showKeys(_:)): return pageURL != nil
        default: return true
        }
    }

    // MARK: панель окна

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return [.library, .place, .room, .variant, .flexibleSpace, .tool, .space, .undo, .duplicate, .remove, .flexibleSpace, .save, .push, .inspector]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return toolbarDefaultItemIdentifiers(toolbar)
    }

    func symbol(_ name: String, _ label: String) -> NSImage {
        return NSImage(systemSymbolName: name, accessibilityDescription: label) ?? NSImage(size: NSSize(width: 16, height: 16))
    }

    func button(_ id: NSToolbarItem.Identifier, _ sym: String, _ label: String, _ tip: String, _ action: Selector) -> NSToolbarItem {
        let it = NSToolbarItem(itemIdentifier: id)
        it.image = symbol(sym, label)
        it.label = label
        it.paletteLabel = label
        it.toolTip = tip
        it.target = self
        it.action = action
        it.isBordered = true
        return it
    }

    func popupItem(_ id: NSToolbarItem.Identifier, _ popup: NSPopUpButton, _ label: String, _ action: Selector, width: CGFloat) -> NSToolbarItem {
        let it = NSToolbarItem(itemIdentifier: id)
        popup.target = self
        popup.action = action
        popup.isEnabled = false
        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.widthAnchor.constraint(equalToConstant: width).isActive = true
        (popup.cell as? NSPopUpButtonCell)?.lineBreakMode = .byTruncatingTail
        it.visibilityPriority = .high
        it.view = popup
        it.label = label
        it.paletteLabel = label
        it.toolTip = label
        return it
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        switch itemIdentifier {
        case .library:
            let it = button(itemIdentifier, "sidebar.left", "Полка", "Показать или скрыть полку (⌃⌘S)", #selector(toggleLibrary(_:)))
            it.visibilityPriority = .high
            return it
        case .place:
            return popupItem(itemIdentifier, placePopup, "Место", #selector(placeChosen(_:)), width: 136)
        case .room:
            return popupItem(itemIdentifier, roomPopup, "Помещение", #selector(roomChosen(_:)), width: 160)
        case .variant:
            let it = popupItem(itemIdentifier, variantPopup, "Вариант", #selector(variantChosen(_:)), width: 150)
            it.toolTip = "Другое помещение того же типа — у каждого своя расстановка; в игре помещение берёт один из вариантов по жребию"
            return it
        case .tool:
            let group = NSToolbarItemGroup(itemIdentifier: itemIdentifier, images: [symbol("arrow.up.and.down.and.arrow.left.and.right", "Двигать"), symbol("rotate.3d", "Крутить")], selectionMode: .selectOne, labels: ["Двигать", "Крутить"], target: self, action: #selector(toolChosen(_:)))
            group.label = "Инструмент"
            group.paletteLabel = "Инструмент"
            group.toolTip = "Двигать (G) — тянуть вещь по полу; Крутить (R) — кольца по трём осям, ⇧ — без шага 15°"
            group.selectedIndex = 0
            group.controlRepresentation = .expanded
            group.visibilityPriority = .high
            toolGroup = group
            return group
        case .undo:
            return button(itemIdentifier, "arrow.uturn.backward", "Отменить", "Отменить (⌘Z)", #selector(undoStep(_:)))
        case .duplicate:
            return button(itemIdentifier, "plus.square.on.square", "Копия", "Копия выбранного (⌘D)", #selector(duplicateSel(_:)))
        case .remove:
            return button(itemIdentifier, "trash", "Удалить", "Удалить выбранное (⌘⌫)", #selector(deleteSel(_:)))
        case .save:
            let it = NSToolbarItem(itemIdentifier: itemIdentifier)
            saveLabel.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
            saveLabel.textColor = .secondaryLabelColor
            saveLabel.alignment = .right
            saveLabel.lineBreakMode = .byTruncatingTail
            saveLabel.translatesAutoresizingMaskIntoConstraints = false
            saveLabel.widthAnchor.constraint(equalToConstant: 104).isActive = true
            it.view = saveLabel
            it.label = "Сохранение"
            it.paletteLabel = "Сохранение"
            it.visibilityPriority = .low
            return it
        case .push:
            let it = NSToolbarItem(itemIdentifier: itemIdentifier)
            let b = NSButton(title: "Залить в игру", target: self, action: #selector(push(_:)))
            b.bezelStyle = .texturedRounded
            b.image = symbol("arrow.up.circle", "Залить в игру")
            b.imagePosition = .imageLeading
            b.isEnabled = false
            pushButton = b
            it.view = b
            it.label = "Залить в игру"
            it.paletteLabel = "Залить в игру"
            it.toolTip = "Проверить правилами игры и отправить сделанное в игру (на GitHub)"
            it.visibilityPriority = .user
            return it
        case .inspector:
            let it = button(itemIdentifier, "sidebar.right", "Инспектор", "Показать или скрыть инспектор (⌥⌘I)", #selector(toggleInspector(_:)))
            it.visibilityPriority = .user
            return it
        default:
            return nil
        }
    }

    func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
        guard let s = state else { return false }
        switch item.itemIdentifier {
        case .undo: return s.canUndo
        case .duplicate, .remove: return s.sel
        default: return true
        }
    }

    /// Пункты всплывающего меню; пересобирать, только если поменялись.
    func fill(_ popup: NSPopUpButton, _ opts: [Option], _ selected: String) {
        if (popup.itemArray.compactMap { $0.representedObject as? String }) != opts.map({ $0.id }) {
            popup.removeAllItems()
            for o in opts {
                let it = NSMenuItem(title: o.label, action: nil, keyEquivalent: "")
                it.representedObject = o.id
                popup.menu?.addItem(it)
            }
        }
        if let i = opts.firstIndex(where: { $0.id == selected }) { popup.selectItem(at: i) }
    }

    /// Панель окна — по состоянию страницы (до него всё недоступно).
    func syncPanel() {
        let on = state != nil && pageURL != nil
        for p in [placePopup, roomPopup, variantPopup] { p.isEnabled = on }
        pushButton?.isEnabled = on && !(state?.pushing ?? true)
        guard let s = state else {
            saveLabel.stringValue = ""
            return
        }
        fill(placePopup, s.worlds, s.world)
        fill(roomPopup, s.rooms, s.room)
        let n = max(s.picks, 1)
        let variants = (0..<n).map { i in Option(id: String(i), label: "Вариант \(i + 1)/\(n)" + (i == s.pick && s.own ? " · свой" : "")) }
        if variantPopup.itemTitles != variants.map({ $0.label }) {
            variantPopup.removeAllItems()
            variantPopup.addItems(withTitles: variants.map { $0.label })
        }
        variantPopup.selectItem(at: min(s.pick, n - 1))
        variantPopup.isEnabled = on && n > 1
        toolGroup?.selectedIndex = s.tool == "rotate" ? 1 : 0
        saveLabel.stringValue = s.save.prefix(1).uppercased() + s.save.dropFirst()
        saveLabel.toolTip = s.save
        saveLabel.textColor = s.saveState == "bad" ? .systemRed : .secondaryLabelColor
        window.toolbar?.validateVisibleItems()
    }

    // MARK: страница ↔ оболочка

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "ctor", let text = message.body as? String, let data = text.data(using: .utf8) else { return }
        guard let s = try? JSONDecoder().decode(PanelState.self, from: data) else { return }
        state = s
        syncPanel()
    }

    /// Команда странице: window.__ctorNative.cmd(имя, значение).
    func cmd(_ name: String, _ arg: Any? = nil) {
        guard pageURL != nil else { return }
        var payload: [Any] = [name]
        if let a = arg { payload.append(a) }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__ctorNative && window.__ctorNative.cmd.apply(null, \(json))", completionHandler: nil)
    }

    @objc func placeChosen(_ sender: NSPopUpButton) {
        if let id = sender.selectedItem?.representedObject as? String { cmd("world", id) }
    }

    @objc func roomChosen(_ sender: NSPopUpButton) {
        if let id = sender.selectedItem?.representedObject as? String { cmd("room", id) }
    }

    @objc func variantChosen(_ sender: NSPopUpButton) {
        cmd("pick", sender.indexOfSelectedItem)
    }

    @objc func toolChosen(_ sender: Any?) {
        cmd("tool", (toolGroup?.selectedIndex ?? 0) == 1 ? "rotate" : "move")
    }

    @objc func toolMove(_ sender: Any?) { cmd("tool", "move") }
    @objc func toolRotate(_ sender: Any?) { cmd("tool", "rotate") }
    @objc func undoStep(_ sender: Any?) { cmd("undo") }
    @objc func duplicateSel(_ sender: Any?) { cmd("duplicate") }
    @objc func deleteSel(_ sender: Any?) { cmd("delete") }
    @objc func push(_ sender: Any?) { cmd("push") }
    @objc func toggleLibrary(_ sender: Any?) { cmd("library") }
    @objc func toggleInspector(_ sender: Any?) { cmd("inspector") }
    @objc func showKeys(_ sender: Any?) { cmd("help") }

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
            state = nil
            syncPanel()
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
        state = nil
        syncPanel()
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

    /// Страница пришла от сервера конструктора и ожила: заголовок, вид программы (html.native), полка; панель окна получила
    /// места. Без WebGL (на CI бывает) конструктор не рисует сцену, тогда полку не ждём — оболочка своё дело сделала.
    func probe() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let js = "JSON.stringify({ title: document.title, native: document.documentElement.classList.contains('native'), shelf: document.querySelectorAll('#shelf > *').length, gl: !!document.createElement('canvas').getContext('webgl2'), frames: window.__ctorFrames || 0, visible: document.visibilityState })"
            self.web.evaluateJavaScript(js) { result, error in
                let text = (result as? String) ?? String(describing: error)
                var info: [String: Any] = [:]
                if let data = text.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    info = parsed
                }
                let title = info["title"] as? String ?? ""
                let native = info["native"] as? Bool ?? false
                let shelf = info["shelf"] as? Int ?? 0
                let gl = info["gl"] as? Bool ?? false
                let places = self.placePopup.numberOfItems
                let rooms = self.roomPopup.numberOfItems
                let report = "\(text) places=\(places) rooms=\(rooms) room=\(self.roomPopup.titleOfSelectedItem ?? "-") save=\(self.saveLabel.stringValue)"
                if title == "Конструктор" && native && places > 0 && rooms > 0 && (!gl || shelf > 0) {
                    self.finishTest(true, report)
                } else {
                    self.testTries += 1
                    if self.testTries < 40 { self.probe() } else { self.finishTest(false, report) }
                }
            }
        }
    }

    func finishTest(_ ok: Bool, _ text: String) {
        // Кадров к снимку — побольше: снимок через 3 с, и в журнал — сколько их было к тому времени.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            self.web.evaluateJavaScript("String(window.__ctorFrames || 0) + ' ' + document.visibilityState") { result, _ in
                say("SELFTEST \(ok ? "ok" : "fail") \(text) frames3s=\((result as? String) ?? "-")")
                self.snapshot {
                    self.stopNode()
                    exit(ok ? 0 : 1)
                }
            }
        }
    }

    /// Снимки для CI: страница (WebKit сам) и всё окно с панелью (screencapture — если машине разрешено снимать экран).
    func snapshot(_ done: @escaping () -> Void) {
        guard !shotPath.isEmpty else {
            done()
            return
        }
        web.takeSnapshot(with: WKSnapshotConfiguration()) { image, _ in
            if let img = image, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: shotPath + "-page.png"))
            }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", String(self.window.windowNumber), shotPath + "-window.png"]
            try? p.run()
            p.waitUntilExit()
            done()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
