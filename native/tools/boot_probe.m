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
//   jamin-boot <path to Resources/web>
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *gRoot = nil;

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
    if ([s hasPrefix:@"REPORT"]) exit([s containsString:@"errors=0"] ? 0 : 2);
}
- (void)webView:(WKWebView *)w didFailProvisionalNavigation:(WKNavigation *)n withError:(NSError *)e {
    printf("navigation failed: %s\n", e.localizedDescription.UTF8String); exit(1);
}
@end

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc < 2) { printf("usage: boot <web root>\n"); return 1; }
        gRoot = [NSString stringWithUTF8String:argv[1]];
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

        WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1200, 800) configuration:cfg];
        web.navigationDelegate = boot;
        NSWindow *win = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1200, 800)
                                                    styleMask:NSWindowStyleMaskTitled
                                                      backing:NSBackingStoreBuffered defer:NO];
        [win setContentView:web];
        [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"juce://juce.backend/index.html"]]];

        // Give the app time to boot, then interrogate it.
        [NSTimer scheduledTimerWithTimeInterval:6 repeats:NO block:^(NSTimer *t) {
            NSString *probe =
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
