// jamin-boot -- does the page actually run inside the plugin's web view?
//
// It loads the built page exactly as the editor does: the real bundled
// Resources/web, served over the juce:// custom scheme, in a WKWebView with the
// same configuration. Then it interrogates the running application and reports.
//
// This exists because "the web app runs in a WKWebView" is the claim the whole
// design rests on, and a screenshot cannot tell you that a module failed to
// import or that a promise rejected on the way up. The hook below is installed
// before any of the page's own script, so nothing is missed.
//
// Exit status is the gate: 0 only if the application came up with no errors at
// all. Run by ctest against the AU bundle after every build.
//
// With --host it goes further: it installs a stand-in for the window.__JUCE__
// object the plugin injects, drives a playhead past it, and checks that the
// chart followed. That is the page half of the bridge tested against the real
// built bundle -- the half that a C++ compiler cannot check.
//
//   jamin-boot <path to Resources/web> [--host]
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *gRoot = nil;
static BOOL gHostMode = NO;

// A stand-in for what JUCE injects into the web view. The protocol is JUCE's:
// emitEvent("__juce__invoke", {name, params, resultId}) goes out, and a
// "__juce__complete" event carrying that resultId comes back.
static NSString *const kFakeHost =
  @"(() => {"
  @"  const listeners = new Map();"
  @"  const answers = {"
  @"    jaminReady: () => ({ instanceId: 'probe-instance', state: '', song: '', songGeneration: 0, shared: true }),"
  @"    jaminCompile: (a) => { window.__compiled = a[0]; window.__compiles = (window.__compiles || 0) + 1; return true; },"
  @"    jaminPublishSong: (a) => { window.__lastSong = a[0]; return 1; },"
  @"    jaminOpenUrl: (a) => { window.__opened = a[0]; return true; },"
  @"    jaminNetwork: (a) => ({ running: !!(a && a[1]), port: 7777, name: 'probe', peers: [{ id: 'p', name: 'other', host: '10.0.0.2', port: 7777 }] }),"
  @"    jaminNetOps: (a) => { window.__netOps = (window.__netOps || []).concat([a[0]]); return true; },"
  @"    jaminNetDoc: () => (window.__netLog || []),"
  @"  };"
  @"  const dispatch = (id, payload) => {"
  @"    for (const fn of (listeners.get(id) || [])) fn(payload);"
  @"  };"
  @"  try { const k = 'jamin.settings.v1';"
  @"    const s = JSON.parse(localStorage.getItem(k) || '{}');"
  @"    s.network = Object.assign({}, s.network, { enabled: true, secret: 'probe-word' });"
  @"    localStorage.setItem(k, JSON.stringify(s)); } catch (e) {}"
  @"  window.__JUCE__ = {"
  @"    initialisationData: {"
  @"      jaminInstanceId: ['probe-instance'],"
  @"      __juce__functions: Object.keys(answers),"
  @"      __juce__platform: ['mac'],"
  @"    },"
  @"    backend: {"
  @"      addEventListener: (id, fn) => {"
  @"        if (!listeners.has(id)) listeners.set(id, []);"
  @"        listeners.get(id).push(fn);"
  @"        return [id, listeners.get(id).length - 1];"
  @"      },"
  @"      removeEventListener: () => {},"
  @"      emitEvent: (id, payload) => {"
  @"        if (id !== '__juce__invoke') return;"
  @"        const answer = answers[payload.name];"
  @"        const result = answer ? answer(payload.params || []) : null;"
  @"        setTimeout(() => dispatch('__juce__complete', { promiseId: payload.resultId, result }), 0);"
  @"      },"
  @"    },"
  @"  };"
  @"  window.__hostSend = dispatch;"
  @"})();";

@interface Boot : NSObject <WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate>
@end

@implementation Boot

- (void)webView:(WKWebView *)w startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSString *path = task.request.URL.path;
    if ([path length] == 0 || [path isEqualToString:@"/"]) path = @"/index.html";
    NSString *full = [gRoot stringByAppendingPathComponent:path];
    NSData *data = [NSData dataWithContentsOfFile:full];
    if (!data) {
        NSHTTPURLResponse *r = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL statusCode:404
                                                          HTTPVersion:@"HTTP/1.1" headerFields:@{}];
        [task didReceiveResponse:r]; [task didFinish];
        printf("  404 %s\n", path.UTF8String);
        return;
    }
    NSDictionary *mimes = @{ @"html": @"text/html", @"js": @"text/javascript", @"css": @"text/css",
                             @"json": @"application/json", @"svg": @"image/svg+xml",
                             @"woff2": @"font/woff2", @"voc": @"text/plain", @"png": @"image/png" };
    NSString *mime = mimes[path.pathExtension] ?: @"application/octet-stream";
    NSURLResponse *r = [[NSURLResponse alloc] initWithURL:task.request.URL MIMEType:mime
                                    expectedContentLength:data.length textEncodingName:@"utf-8"];
    [task didReceiveResponse:r]; [task didReceiveData:data]; [task didFinish];
}
- (void)webView:(WKWebView *)w stopURLSchemeTask:(id<WKURLSchemeTask>)task {}

- (void)userContentController:(WKUserContentController *)c didReceiveScriptMessage:(WKScriptMessage *)m {
    NSString *s = [NSString stringWithFormat:@"%@", m.body];
    printf("%s\n", s.UTF8String);
    if ([s hasPrefix:@"REPORT"]) {
        BOOL clean = [s containsString:@"errors=0"]
                  && (!gHostMode || [s containsString:@"failures=0"]);
        exit(clean ? 0 : 2);
    }
}
- (void)webView:(WKWebView *)w didFailProvisionalNavigation:(WKNavigation *)n withError:(NSError *)e {
    printf("navigation failed: %s\n", e.localizedDescription.UTF8String); exit(1);
}
@end

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc < 2) { printf("usage: jamin-boot <web root> [--host]\n"); return 1; }
        gRoot = [NSString stringWithUTF8String:argv[1]];
        CGFloat width = 1200, height = 800;
        for (int i = 2; i < argc; ++i) {
            if (strcmp(argv[i], "--host") == 0) gHostMode = YES;
            else if (strcmp(argv[i], "--size") == 0 && i + 1 < argc)
                sscanf(argv[++i], "%lgx%lg", &width, &height);
        }
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        Boot *boot = [Boot new];

        WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
        [cfg setURLSchemeHandler:boot forURLScheme:@"juce"];
        [cfg.userContentController addScriptMessageHandler:boot name:@"report"];

        // Installed before any of the page's own script, so nothing is missed.
        NSString *hook =
          @"window.__errors = [];"
          @"window.onerror = (m, s, l) => { window.__errors.push('error: ' + m); };"
          @"window.onunhandledrejection = (e) => { window.__errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)); };"
          @"(() => { const e = console.error; console.error = (...a) => { window.__errors.push('console.error: ' + a.join(' ')); e(...a); }; })();";
        [cfg.userContentController addUserScript:
            [[WKUserScript alloc] initWithSource:hook injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];

        if (gHostMode)
            [cfg.userContentController addUserScript:
                [[WKUserScript alloc] initWithSource:kFakeHost injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];

        WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, width, height) configuration:cfg];
        web.navigationDelegate = boot;
        NSWindow *win = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
                                                    styleMask:NSWindowStyleMaskTitled
                                                      backing:NSBackingStoreBuffered defer:NO];
        [win setContentView:web];

        // Shown, but without activating: WebKit throttles timers in a window
        // that is not on screen, which would make every wait below a race
        // against a one-second tick. A plugin editor is visible; so is this.
        [win orderFrontRegardless];
        [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"juce://juce.backend/index.html"]]];

        // Give the app time to boot, then interrogate it.
        [NSTimer scheduledTimerWithTimeInterval:6 repeats:NO block:^(NSTimer *t) {
            NSString *hostProbe =
              @"void (async () => {"
              @"  const wait = (ms) => new Promise(r => setTimeout(r, ms));"
              @"  const lines = []; let failures = 0;"
              @"  const check = (label, got) => { if (!got) { failures++; lines.push('FAIL ' + label); } };"
              @"  const readout = () => (document.querySelector('.jamin-readout') || {}).innerText || '';"
              @"  const send = (m) => window.__hostSend('jaminTransport', m);"
              @"  check('the page found the host', typeof window.__hostSend === 'function');"
              @"  send({ playing: true, ppq: 0, bpm: 91.5, numerator: 4, denominator: 4, hasPlayhead: true });"
              @"  await wait(400);"
              @"  const atStart = readout();"
              @"  lines.push('atStart=' + JSON.stringify(atStart));"
              @"  check('it starts at the top of the chart', /bar 1\\.1/.test(atStart));"
              @"  check(\"the host's tempo is the one shown\", /bpm 91\\.5/.test(atStart));"
              @"  send({ playing: true, ppq: 4, bpm: 91.5 });"
              @"  await wait(400);"
              @"  const afterOneBar = readout();"
              @"  lines.push('afterOneBar=' + JSON.stringify(afterOneBar));"
              @"  check('a bar of playhead advanced the bar count', /bar 2\\.1/.test(afterOneBar));"
              @"  check('and the chart moved to the next chord', afterOneBar !== atStart);"
              @"  send({ playing: false, ppq: 4, bpm: 91.5 });"
              @"  await wait(400);"
              @"  const stopped = readout();"
              @"  lines.push('stopped=' + JSON.stringify(stopped));"
              @"  check('stopping is noticed', /stopped/.test(stopped));"
              @"  lines.push('compiles=' + (window.__compiles || 0));"
              @"  check('the page sent the plugin a song to compile', (window.__compiles || 0) > 0);"
              @"  let request = null;"
              @"  try { request = JSON.parse(window.__compiled); } catch (e) {}"
              @"  check('the request carries the chart', !!(request && typeof request.text === 'string' && request.text.length));"
              @"  check('and the settings', !!(request && request.settings && request.settings.midi));"
              @"  check('and a generation', !!(request && request.generation > 0));"
              @"  await wait(2500);"   // the catalogue is built off the critical path
              /* A control cut in half by the box that scrolls it. Overflowing
                 to the left does not show up in scrollWidth, so each control is
                 measured against whichever ancestor actually clips it. */
              @"  const clipper = (el) => {"
              @"    for (let n = el.parentElement; n; n = n.parentElement) {"
              @"      const s = getComputedStyle(n);"
              @"      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return n;"
              @"    }"
              @"    return null;"
              @"  };"
              /* The visible boxes only. A switch's <input> is an invisible hit
                 target parked over the ripple and routinely sits outside its own
                 control; flagging it would be crying wolf forever. And 4px of
                 slack, because sub-pixel layout puts a field's right edge a
                 pixel or two past its container as a matter of course -- the
                 fault being looked for is a control sitting a whole gutter
                 outside the box that scrolls it. */
              /* A row is the honest signal: it is laid out on whole-pixel
                 margins, so a row outside its clipper is a real fault at 4px
                 where a control's own edge is sub-pixel noise at 2. Measured
                 first, and tightly. */
              @"  const SLACK = 3;"
              @"  const clippedIn = (pane) => {"
              @"    for (const el of pane.querySelectorAll('.v-row, .v-col')) {"
              @"      const box = el.getBoundingClientRect();"
              @"      if (!box.width) continue;"
              @"      const cage = clipper(el);"
              @"      if (!cage) continue;"
              @"      const seen = cage.getBoundingClientRect();"
              @"      if (box.left < seen.left - 1 || box.right > seen.right + 1) {"
              @"        return 'row [' + Math.round(box.left) + '..' + Math.round(box.right) + '] in ['"
              @"          + Math.round(seen.left) + '..' + Math.round(seen.right) + ']';"
              @"      }"
              @"    }"
              @"    for (const el of pane.querySelectorAll('.v-btn, .v-chip, .v-field, .v-selection-control')) {"
              @"      const box = el.getBoundingClientRect();"
              @"      if (!box.width) continue;"
              @"      const cage = clipper(el);"
              @"      if (!cage) continue;"
              @"      const seen = cage.getBoundingClientRect();"
              @"      if (box.left < seen.left - SLACK || box.right > seen.right + SLACK) {"
              @"        return (el.innerText || el.className).slice(0, 30).replace(/\\s+/g, ' ')"
              @"          + ' [' + Math.round(box.left) + '..' + Math.round(box.right) + '] in ['"
              @"          + Math.round(seen.left) + '..' + Math.round(seen.right) + ']';"
              @"      }"
              @"    }"
              @"    return null;"
              @"  };"
              @"  const openBook = async (title) => {"
              @"    const button = [...document.querySelectorAll('button')].find(b => b.title === title);"
              @"    if (!button) return null;"
              @"    button.click();"
              @"    await wait(700);"
              @"    return document.querySelector('.jamin-book .v-card');"
              @"  };"
              @"  for (const title of ['Phrase book', 'Progression library']) {"
              @"    const card = await openBook(title);"
              @"    check(title + ' opens', !!card);"
              @"    if (card) {"
              @"      const box = card.getBoundingClientRect();"
              @"      lines.push(title + '=' + Math.round(box.height) + 'px in ' + window.innerHeight + 'px');"
              @"      check(title + ' fits the window', box.bottom <= window.innerHeight + 1);"
              @"      const pager = card.querySelector('.v-pagination');"
              @"      check(title + ' shows its pagination', !!pager);"
              @"      if (pager) {"
              @"        const p = pager.getBoundingClientRect();"
              @"        lines.push('  pagination bottom=' + Math.round(p.bottom));"
              @"        check(title + ' pagination is on screen', p.bottom <= window.innerHeight + 1 && p.height > 0);"
              @"      }"
              @"      const chain = ['.v-card-text', '.v-window', '.v-window__container', '.v-window-item', '.jamin-book-row', '.jamin-book-col', '.jamin-book-scroll'];"
              @"      for (const sel of chain) {"
              @"        const el = card.querySelector(sel);"
              @"        lines.push('    ' + sel + ' = ' + (el ? Math.round(el.getBoundingClientRect().height) + 'px' : 'MISSING'));"
              @"      }"
              @"      const scroller = card.querySelector('.jamin-book-scroll');"
              @"      const loading = /Loading the catalogue/.test(card.innerText);"
              @"      lines.push('  shows: ' + JSON.stringify(card.innerText.slice(0, 90).replace(/\\s+/g, ' ')));"
              @"      check(title + ' has a bounded list', !!scroller || loading);"
              @"      if (scroller) {"
              @"        const s = scroller.getBoundingClientRect();"
              @"        check(title + ' list stays inside the window', s.bottom <= window.innerHeight + 1);"
              @"      }"
              @"      const panel = card.querySelector('.jamin-book-filters .v-expansion-panel-title');"
              @"      /* genre and decade exist only once a collection carrying them is imported */"
              @"      if (/phrase/i.test(title)) check(title + ' has a filter panel', !!panel);"
              @"      if (panel) {"
              @"        check(title + ' folds its filters away', card.querySelectorAll('.jamin-book-filters .v-select').length === 0);"
              @"        panel.click(); await wait(500);"
              @"        const selects = card.querySelectorAll('.jamin-book-filters .v-select').length;"
              @"        lines.push('  filters when open: ' + selects);"
              @"        check(title + ' opens its filters', selects > 0);"
              @"        const pagerOpen = card.querySelector('.v-pagination');"
              @"        if (pagerOpen) {"
              @"          const bottom = pagerOpen.getBoundingClientRect().bottom;"
              @"          lines.push('  pagination with filters open=' + Math.round(bottom));"
              @"          const body = card.querySelector('.v-card-text');"
              @"          const reachable = bottom <= window.innerHeight + 1"
              @"            || (body && body.scrollHeight > body.clientHeight);"
              @"          check(title + ' pagination stays reachable with filters open', !!reachable);"
              @"        }"
              @"        panel.click(); await wait(400);"
              @"        check(title + ' folds them again', card.querySelectorAll('.jamin-book-filters .v-select').length === 0);"
              @"      }"
              /* Every tab, not just the one the book opens on. The card body is
                 overflow:hidden on purpose -- the catalogue tab scrolls its list
                 and its detail pane separately -- and for a long time that meant
                 every *other* tab was silently cut off at the bottom of the card
                 with no scrollbar and no way to reach the rest of it. */
              @"      for (const tab of [...card.querySelectorAll('.v-tab')]) {"
              @"        const label = (tab.textContent || '').trim().slice(0, 24);"
              @"        tab.click(); await wait(350);"
              @"        const pane = card.querySelector('.v-window-item--active');"
              @"        if (!pane) continue;"
              @"        const body = card.querySelector('.v-card-text');"
              @"        const over = (el) => el && el.scrollHeight > el.clientHeight + 2;"
              @"        const scrolls = (el) => {"
              @"          if (!el) return false;"
              @"          const y = getComputedStyle(el).overflowY;"
              @"          return y === 'auto' || y === 'scroll';"
              @"        };"
              @"        const spills = over(pane);"
              @"        const reachable = !spills || scrolls(pane) || (over(body) && scrolls(body));"
              @"        if (spills) lines.push('  ' + label + ': ' + pane.scrollHeight + 'px in ' + pane.clientHeight + 'px, overflowY=' + getComputedStyle(pane).overflowY);"
              @"        check(title + ' tab \"' + label + '\" can be read to the end', reachable);"
              /* Sideways, which nothing here used to look at. A v-window-item is
                 a scroll box, and a v-row inside it carries a -12px inline
                 margin meant to be absorbed by a padded parent -- with no
                 padding the first and last control in every row hung outside
                 the panel and was cut in half. Overflowing to the left does not
                 even show up in scrollWidth, so the controls are measured
                 against the box that clips them. */
              @"        const clipped = clippedIn(pane);"
              @"        if (clipped) lines.push('  ' + label + ' clips: ' + clipped);"
              @"        check(title + ' tab \"' + label + '\" does not clip its controls sideways', !clipped);"
              @"      }"
              @"      const sources = [...card.querySelectorAll('.v-tab')].find(t => /sources/i.test(t.textContent));"
              @"      if (sources) {"
              @"        sources.click(); await wait(500);"
              @"        const shown = card.innerText;"
              @"        const found = shown.match(/juce:\\/\\/[^\\s]+\\.voc/);"
              @"        lines.push('  voc url: ' + (found ? found[0] : 'not shown'));"
              @"        if (found) {"
              @"          try {"
              @"            const r = await fetch(found[0]);"
              @"            const body = await r.text();"
              @"            lines.push('  voc fetch: status=' + r.status + ' type=' + r.headers.get('content-type') + ' length=' + body.length);"
              @"            lines.push('  voc head: ' + JSON.stringify(body.slice(0, 90)));"
              @"          } catch (e) { lines.push('  voc fetch THREW ' + e.name + ': ' + e.message); }"
              @"        }"
              @"      }"
              @"      const close = [...card.querySelectorAll('button')].find(b => b.querySelector('.mdi-close'));"
              @"      if (close) close.click();"
              @"      await wait(400);"
              @"    }"
              @"  }"
              /* Settings is the tallest dialog and the one with the most rows
                 of controls, and it is where a row's -12px inline margin cut
                 the first and last control in every row in half. Every tab of
                 it, because the fault is per-panel. */
              @"  const cog = [...document.querySelectorAll('button')].find(b => b.title === 'Settings');"
              @"  check('settings opens', !!cog);"
              @"  if (cog) {"
              @"    cog.click(); await wait(700);"
              @"    const dialog = document.querySelector('.jamin-settings .v-card');"
              @"    check('the settings dialog is there', !!dialog);"
              @"    if (dialog) {"
              @"      for (const tab of [...dialog.querySelectorAll('.v-tab')]) {"
              @"        const label = (tab.textContent || '').trim().slice(0, 24);"
              @"        tab.click(); await wait(300);"
              @"        const pane = dialog.querySelector('.v-window-item--active');"
              @"        if (!pane) continue;"
              @"        const clipped = clippedIn(pane);"
              @"        if (clipped) lines.push('  settings ' + label + ' clips: ' + clipped);"
              @"        check('settings tab \"' + label + '\" does not clip its controls', !clipped);"
              @"      }"
              @"      const shut = [...dialog.querySelectorAll('button')].find(b => b.querySelector('.mdi-close'));"
              @"      if (shut) shut.click();"
              @"      await wait(400);"
              @"    }"
              @"  }"
              @"  /* the plugin is a node: it joined, saw a peer, and sends its edits on */"
              @"  await wait(1200);"
              @"  lines.push('netOps=' + ((window.__netOps || []).length));"
              @"  check('the plugin joined the network', (window.__netOps || []).length > 0);"
              @"  let sent = null;"
              @"  try { sent = JSON.parse((window.__netOps || [])[0]); } catch (e) {}"
              @"  check('and what it sent is an envelope of edits', !!(sent && sent.m && Array.isArray(sent.ops)));"
              @"  check('carrying the chart it already had', !!(sent && sent.ops.length > 0));"
              @"  lines.push('failures=' + failures);"
              @"  lines.push('errors=' + window.__errors.length);"
              @"  for (const e of window.__errors) lines.push('  ! ' + e);"
              @"  window.webkit.messageHandlers.report.postMessage('REPORT\\n' + lines.join('\\n'));"
              @"})()";

            NSString *probe = gHostMode ? hostProbe :
              @"(() => {"
              @"  const canvases = document.querySelectorAll('canvas');"
              @"  const gl = [...canvases].some(c => { try { return !!(c.getContext('webgl2', {}) || c.getContext('webgl')); } catch (e) { return false; } });"
              @"  const lines = [];"
              @"  lines.push('canvases=' + canvases.length);"
              @"  lines.push('textarea=' + document.querySelectorAll('textarea').length);"
              @"  lines.push('buttons=' + document.querySelectorAll('button').length);"
              @"  lines.push('vuetify=' + !!document.querySelector('.v-application'));"
              @"  lines.push('webmidi=' + (typeof navigator.requestMIDIAccess));"
              @"  lines.push('errors=' + window.__errors.length);"
              @"  for (const e of window.__errors) lines.push('  ! ' + e);"
              @"  window.webkit.messageHandlers.report.postMessage('REPORT\\n' + lines.join('\\n'));"
              @"})()";
            [web evaluateJavaScript:probe completionHandler:^(id r, NSError *e) {
                if (e) { printf("probe failed: %s\n", e.localizedDescription.UTF8String); exit(1); }
            }];
        }];
        [NSTimer scheduledTimerWithTimeInterval:25 repeats:NO block:^(NSTimer *t) {
            printf("timed out\n"); exit(1); }];
        [NSApp run];
    }
}
