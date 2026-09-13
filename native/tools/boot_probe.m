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
  @"  };"
  @"  const dispatch = (id, payload) => {"
  @"    for (const fn of (listeners.get(id) || [])) fn(payload);"
  @"  };"
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
        for (int i = 2; i < argc; ++i)
            if (strcmp(argv[i], "--host") == 0) gHostMode = YES;
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

        WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1200, 800) configuration:cfg];
        web.navigationDelegate = boot;
        NSWindow *win = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1200, 800)
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
