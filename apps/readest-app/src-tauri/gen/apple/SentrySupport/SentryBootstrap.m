#import <Foundation/Foundation.h>
@import Sentry;

// Provided by the Rust static library (see src-tauri/src/sentry_config.rs).
extern const char *readest_sentry_dsn(void);

// Starts sentry-cocoa at class-load time (before main), so native iOS crashes
// are captured from launch without editing the generated main.mm / Info.plist.
// The DSN comes from the Rust side (single SENTRY_DSN build-time source); a null
// or empty DSN leaves the native SDK disabled, so local and fork builds do not
// report. Crashes + errors only: no tracing, no PII.
@interface ReadestSentryBootstrap : NSObject
@end

@implementation ReadestSentryBootstrap

+ (void)load {
    const char *dsn = readest_sentry_dsn();
    if (dsn == NULL || dsn[0] == '\0') {
        return;
    }
    NSString *dsnString = [NSString stringWithUTF8String:dsn];
    [SentrySDK startWithConfigureOptions:^(SentryOptions *options) {
        options.dsn = dsnString;
        options.environment = @"production";
        options.tracesSampleRate = @0.0;
        options.sendDefaultPii = NO;
    }];
}

@end
