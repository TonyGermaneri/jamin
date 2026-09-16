/*
    jamin-auhost — open the plugin, show its editor, throw it away. Repeatedly.

    Live crashed in JuceAU::~JuceAU() while disposing the component, and auval
    never saw it because auval does not instantiate the editor. This does what a
    host does: create the instance, ask for its Cocoa view, put the view in a
    window, let the run loop turn so the web view actually loads, then tear the
    whole thing down in the order a host tears it down.

    Any crash here is the bug, reproduced, with no DAW in the way.

      jamin-auhost [passes] [--no-view] [--seconds N] [--render] [--midi N]

    --render drives processBlock the way a host does: a rolling playhead and
    real render calls. --midi additionally injects that many notes per second
    of incoming MIDI, which is the case a track under jamin's control that is
    also being played from a keyboard. That combination is what a DAW reported
    crashing on, and it is the one auval never performs -- auval renders, but
    it does not render with a transport and it does not send notes in.
*/
#import <Cocoa/Cocoa.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>
#import <AudioUnit/AUCocoaUIView.h>
#import <CoreMIDI/CoreMIDI.h>

/* What the plugin sent out. Counted rather than inspected: the point is that a
   sequence really is being performed, so a run that emits nothing is a run that
   proved nothing. */
static int gEmitted = 0;

static OSStatus midiOutput(void *userData, const AudioTimeStamp *timeStamp, UInt32 midiOutNum,
                           const struct MIDIPacketList *packetList) {
    (void) userData; (void) timeStamp; (void) midiOutNum;
    if (!packetList) return noErr;
    const MIDIPacket *packet = &packetList->packet[0];
    for (UInt32 i = 0; i < packetList->numPackets; ++i) {
        gEmitted += (int) packet->length;
        packet = MIDIPacketNext(packet);
    }
    return noErr;
}

/* A playhead for the plugin to read: rolling, 120 bpm, 4/4. */
static Float64 gBeat = 0.0;
static Float64 gSampleTime = 0.0;
static const Float64 kSampleRate = 48000.0;

static OSStatus beatAndTempo(void *inHostUserData, Float64 *outCurrentBeat, Float64 *outCurrentTempo) {
    (void) inHostUserData;
    if (outCurrentBeat) *outCurrentBeat = gBeat;
    if (outCurrentTempo) *outCurrentTempo = 120.0;
    return noErr;
}

static OSStatus transportState(void *inHostUserData, Boolean *outIsPlaying, Boolean *outTransportStateChanged,
                               Float64 *outCurrentSampleInTimeLine, Boolean *outIsCycling,
                               Float64 *outCycleStartBeat, Float64 *outCycleEndBeat) {
    (void) inHostUserData;
    if (outIsPlaying) *outIsPlaying = true;
    if (outTransportStateChanged) *outTransportStateChanged = false;
    if (outCurrentSampleInTimeLine) *outCurrentSampleInTimeLine = gSampleTime;
    if (outIsCycling) *outIsCycling = false;
    if (outCycleStartBeat) *outCycleStartBeat = 0;
    if (outCycleEndBeat) *outCycleEndBeat = 0;
    return noErr;
}

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
        BOOL render = NO;
        int notesPerSecond = 0;
        for (int i = 1; i < argc; ++i) {
            if (strcmp(argv[i], "--no-view") == 0) withView = NO;
            else if (strcmp(argv[i], "--render") == 0) render = YES;
            else if (strcmp(argv[i], "--seconds") == 0 && i + 1 < argc) seconds = atof(argv[++i]);
            else if (strcmp(argv[i], "--midi") == 0 && i + 1 < argc) { notesPerSecond = atoi(argv[++i]); render = YES; }
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

            if (render && withView) {
                /* The page has to load and compile before there is a sequence to
                   perform; without this the render loop would prove nothing. */
                spin(4.0);
            }

            if (render) {
                /* Set the stream format and hand the plugin a playhead, then
                   render it the way a host does. */
                AudioStreamBasicDescription format = {0};
                format.mSampleRate = kSampleRate;
                format.mFormatID = kAudioFormatLinearPCM;
                format.mFormatFlags = kAudioFormatFlagsNativeFloatPacked | kAudioFormatFlagIsNonInterleaved;
                format.mBytesPerPacket = 4; format.mFramesPerPacket = 1; format.mBytesPerFrame = 4;
                format.mChannelsPerFrame = 2; format.mBitsPerChannel = 32;
                AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0,
                                     &format, sizeof(format));

                AUMIDIOutputCallbackStruct midiOut = {0};
                midiOut.midiOutputCallback = midiOutput;
                midiOut.userData = NULL;
                AudioUnitSetProperty(unit, kAudioUnitProperty_MIDIOutputCallback, kAudioUnitScope_Global, 0,
                                     &midiOut, sizeof(midiOut));

                HostCallbackInfo callbacks = {0};
                callbacks.beatAndTempoProc = beatAndTempo;
                callbacks.transportStateProc2 = NULL;
                callbacks.transportStateProc = transportState;
                AudioUnitSetProperty(unit, kAudioUnitProperty_HostCallbacks, kAudioUnitScope_Global, 0,
                                     &callbacks, sizeof(callbacks));

                const UInt32 frames = 512;
                AudioUnitSetProperty(unit, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0,
                                     &frames, sizeof(frames));
                AudioUnitReset(unit, kAudioUnitScope_Global, 0);

                float left[512], right[512];
                AudioBufferList *list = calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer));
                list->mNumberBuffers = 2;
                list->mBuffers[0].mNumberChannels = 1;
                list->mBuffers[0].mDataByteSize = frames * 4;
                list->mBuffers[0].mData = left;
                list->mBuffers[1].mNumberChannels = 1;
                list->mBuffers[1].mDataByteSize = frames * 4;
                list->mBuffers[1].mData = right;

                const int blocks = (int) (seconds * kSampleRate / frames);
                const double notesPerBlock = notesPerSecond * (frames / kSampleRate);
                double owed = 0;
                int sent = 0, held = -1;

                printf("render(%d blocks, %d notes/s) ", blocks, notesPerSecond); fflush(stdout);

                for (int block = 0; block < blocks; ++block) {
                    /* Incoming MIDI, as another device playing the same track. */
                    owed += notesPerBlock;
                    while (owed >= 1.0) {
                        owed -= 1.0;
                        if (held >= 0) { MusicDeviceMIDIEvent(unit, 0x80, (UInt32) held, 0, 0); held = -1; }
                        const int note = 48 + (sent % 25);
                        MusicDeviceMIDIEvent(unit, 0x90, (UInt32) note, 100, (UInt32) (sent % (int) frames));
                        held = note;
                        ++sent;
                        /* An MPE controller sends a stream of these per note. */
                        MusicDeviceMIDIEvent(unit, 0xE0, 0, 64, 0);
                        MusicDeviceMIDIEvent(unit, 0xD0, 80, 0, 0);
                    }

                    AudioUnitRenderActionFlags flags = 0;
                    AudioTimeStamp when = {0};
                    when.mFlags = kAudioTimeStampSampleTimeValid;
                    when.mSampleTime = gSampleTime;

                    const OSStatus r = AudioUnitRender(unit, &flags, &when, 0, frames, list);
                    if (r != noErr) { printf("\nFAIL AudioUnitRender -> %d\n", (int) r); return 1; }

                    gSampleTime += frames;
                    gBeat += (frames / kSampleRate) * (120.0 / 60.0);

                    /* Let the message thread breathe: the compile lands there. */
                    if ((block % 32) == 0) spin(0.001);
                }
                if (held >= 0) MusicDeviceMIDIEvent(unit, 0x80, (UInt32) held, 0, 0);
                printf("in %d, out %d bytes ", sent, gEmitted); fflush(stdout);
                if (withView && gEmitted == 0) {
                    printf("\nFAIL the plugin emitted nothing -- nothing was under test\n");
                    return 1;
                }
                gEmitted = 0;
                free(list);
            } else {
                /* Let it live: the page loads, the timers run, the compile happens. */
                spin(seconds);
            }

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

        /*
            And what a DAW can actually reach.

            A parameter is the only thing a host can bind to a knob, and a
            parameter that is not published is a feature nobody outside this
            window can use. Listed rather than asserted by name: the list is
            what it is, and printing it is how somebody sees that the drum
            switches arrived without opening a DAW to look.

            Required to be non-empty, because an empty parameter list is not a
            plausible state for this plugin and would mean the automation had
            silently gone.
        */
        {
            AudioComponent found = AudioComponentFindNext(NULL, &want);
            AudioUnit unit = NULL;
            if (found != NULL && AudioComponentInstanceNew(found, &unit) == noErr && unit != NULL)
            {
                UInt32 size = 0;
                Boolean writable = false;
                if (AudioUnitGetPropertyInfo(unit, kAudioUnitProperty_ParameterList,
                                             kAudioUnitScope_Global, 0, &size, &writable) == noErr
                    && size > 0)
                {
                    const int count = (int) (size / sizeof(AudioUnitParameterID));
                    AudioUnitParameterID* ids = (AudioUnitParameterID*) malloc(size);
                    if (AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterList,
                                             kAudioUnitScope_Global, 0, ids, &size) == noErr)
                    {
                        printf("  %d host parameters:", count);
                        for (int at = 0; at < count; at++)
                        {
                            AudioUnitParameterInfo info;
                            UInt32 infoSize = sizeof(info);
                            if (AudioUnitGetProperty(unit, kAudioUnitProperty_ParameterInfo,
                                                     kAudioUnitScope_Global, ids[at],
                                                     &info, &infoSize) != noErr)
                                continue;
                            if (info.cfNameString != NULL)
                            {
                                char name[128] = { 0 };
                                CFStringGetCString(info.cfNameString, name, sizeof(name),
                                                   kCFStringEncodingUTF8);
                                printf("%s %s", at ? "," : "", name);
                            }
                        }
                        printf("\n");
                    }
                    free(ids);
                    if (count <= 0)
                    {
                        printf("FAIL the plugin publishes no parameters -- nothing to automate\n");
                        AudioComponentInstanceDispose(unit);
                        return 1;
                    }
                }
                AudioComponentInstanceDispose(unit);
            }
        }

        return 0;
    }
}
