/*
    jamin-auhost — open the plugin, show its editor, throw it away. Repeatedly.

    Live crashed in JuceAU::~JuceAU() while disposing the component, and auval
    never saw it because auval does not instantiate the editor. This does what a
    host does: create the instance, ask for its Cocoa view, put the view in a
    window, let the run loop turn so the web view actually loads, then tear the
    whole thing down in the order a host tears it down.

    Any crash here is the bug, reproduced, with no DAW in the way.

      jamin-auhost [passes] [--no-view] [--seconds N]
*/
#import <Cocoa/Cocoa.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>
#import <AudioUnit/AUCocoaUIView.h>

static void spin(double seconds) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while ([until timeIntervalSinceNow] > 0)
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        int passes = 3;
        double seconds = 3.0;
        BOOL withView = YES;
        for (int i = 1; i < argc; ++i) {
            if (strcmp(argv[i], "--no-view") == 0) withView = NO;
            else if (strcmp(argv[i], "--seconds") == 0 && i + 1 < argc) seconds = atof(argv[++i]);
            else passes = atoi(argv[i]);
        }

        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

        AudioComponentDescription want = {
            .componentType = kAudioUnitType_MusicDevice,
            .componentSubType = 'Jam1',
            .componentManufacturer = 'WvCt',
        };
        AudioComponent component = AudioComponentFindNext(NULL, &want);
        if (!component) { printf("FAIL the component is not registered\n"); return 1; }

        printf("jamin-auhost\n  passes   %d\n  editor   %s\n", passes, withView ? "yes" : "no");

        for (int pass = 1; pass <= passes; ++pass) @autoreleasepool {
            printf("  pass %d: new ", pass); fflush(stdout);

            AudioUnit unit = NULL;
            OSStatus status = AudioComponentInstanceNew(component, &unit);
            if (status != noErr) { printf("\nFAIL AudioComponentInstanceNew -> %d\n", (int) status); return 1; }

            status = AudioUnitInitialize(unit);
            if (status != noErr) { printf("\nFAIL AudioUnitInitialize -> %d\n", (int) status); return 1; }
            printf("init "); fflush(stdout);

            NSWindow *window = nil;
            NSView *view = nil;

            if (withView) {
                UInt32 size = 0;
                Boolean writable = false;
                status = AudioUnitGetPropertyInfo(unit, kAudioUnitProperty_CocoaUI,
                                                  kAudioUnitScope_Global, 0, &size, &writable);
                if (status != noErr || size < sizeof(AudioUnitCocoaViewInfo)) {
                    printf("\nFAIL no Cocoa view (%d)\n", (int) status); return 1;
                }

                AudioUnitCocoaViewInfo *info = calloc(1, size);
                status = AudioUnitGetProperty(unit, kAudioUnitProperty_CocoaUI,
                                              kAudioUnitScope_Global, 0, info, &size);
                if (status != noErr) { printf("\nFAIL CocoaUI -> %d\n", (int) status); return 1; }

                // CFBridgingRelease hands the +1 from AudioUnitGetProperty to ARC.
                // A __bridge cast plus a manual CFRelease over-releases, which
                // crashes in the autorelease pool long after the mistake -- a
                // harness bug that looks exactly like a plugin bug.
                NSURL *location = CFBridgingRelease(info->mCocoaAUViewBundleLocation);
                NSString *className = CFBridgingRelease(info->mCocoaAUViewClass[0]);
                NSBundle *bundle = [NSBundle bundleWithURL:location];
                Class factoryClass = [bundle classNamed:className];
                if (!factoryClass) { printf("\nFAIL view class %s not found\n", className.UTF8String); return 1; }

                id factory = [[factoryClass alloc] init];
                view = [factory uiViewForAudioUnit:unit withSize:NSMakeSize(1100, 720)];
                if (!view) { printf("\nFAIL the factory returned no view\n"); return 1; }

                window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1100, 720)
                                                     styleMask:NSWindowStyleMaskTitled
                                                       backing:NSBackingStoreBuffered defer:NO];
                // A window made with initWithContentRect: is releasedWhenClosed
                // by default, so -close releases it and ARC releases it again.
                // The over-release surfaces later, in the autorelease pool, and
                // looks for all the world like the plugin crashing on teardown.
                window.releasedWhenClosed = NO;
                [window setContentView:view];
                [window orderFrontRegardless];   // an unshown window throttles its timers
                printf("editor "); fflush(stdout);

                free(info);
            }

            // Let it live: the page loads, the timers run, the compile happens.
            spin(seconds);

            // And down, in the order a host does it: the view goes first, then
            // the instance.
            if (window) {
                [window setContentView:[[NSView alloc] initWithFrame:NSZeroRect]];
                [window close];
                window = nil;
                view = nil;
            }
            spin(0.3);

            printf("dispose "); fflush(stdout);
            AudioUnitUninitialize(unit);
            AudioComponentInstanceDispose(unit);
            spin(0.3);
            printf("ok\n");
        }

        printf("  survived %d open/close cycles\n", passes);
        return 0;
    }
}
