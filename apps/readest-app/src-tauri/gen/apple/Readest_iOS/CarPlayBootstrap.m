#import <CarPlay/CarPlay.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// Tao 0.37 assigns TaoSceneDelegate to every newly connecting scene, including
// CarPlay. Restore the manifest's CarPlay configuration before UIKit connects
// the scene; leave ordinary windows and their lifecycle with Tao.
@interface ReadestCarPlayBootstrap : NSObject
@end

@implementation ReadestCarPlayBootstrap
+ (void)load {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
        object:nil queue:nil usingBlock:^(__unused NSNotification *notification) {
            // Playback does not survive process termination.
            [NSUserDefaults.standardUserDefaults setBool:NO forKey:@"readest.carplay.active"];
            Class delegateClass = [UIApplication.sharedApplication.delegate class];
            SEL selector = @selector(application:configurationForConnectingSceneSession:options:);
            Method method = class_getInstanceMethod(delegateClass, selector);
            if (!method) return;

            // Install this at launch as well as choosing the configuration:
            // UIKit can restore an existing car session without asking for one.
            Class runtimeDelegateClass = NSClassFromString(@"TaoSceneDelegate");
            UISceneConfiguration *carConfiguration = [[UISceneConfiguration alloc]
                initWithName:@"CarPlay" sessionRole:CPTemplateApplicationSceneSessionRoleApplication];
            SEL connect = @selector(scene:willConnectToSession:options:);
            Method runtimeConnect = class_getInstanceMethod(runtimeDelegateClass, connect);
            IMP connectRuntime = imp_implementationWithBlock(^(
                __unused id carDelegate, UIScene *scene, UISceneSession *session,
                UISceneConnectionOptions *options) {
                // A car-only launch must initialize Tauri's WebView and plugins.
                // Forward the actual connection; CarPlay keeps its own delegate.
                id<UISceneDelegate> runtimeDelegate = [[runtimeDelegateClass alloc] init];
                [runtimeDelegate scene:scene willConnectToSession:session options:options];
            });
            if (!class_addMethod(carConfiguration.delegateClass, connect, connectRuntime,
                                 method_getTypeEncoding(runtimeConnect))) {
                imp_removeBlock(connectRuntime);
            }

            typedef UISceneConfiguration *(*ConfigurationIMP)(id, SEL, UIApplication *,
                                                              UISceneSession *, UISceneConnectionOptions *);
            ConfigurationIMP original = (ConfigurationIMP)method_getImplementation(method);
            IMP replacement = imp_implementationWithBlock(^UISceneConfiguration *(
                id delegate, UIApplication *application, UISceneSession *session,
                UISceneConnectionOptions *options) {
                if ([session.role isEqualToString:CPTemplateApplicationSceneSessionRoleApplication]) {
                    return [[UISceneConfiguration alloc] initWithName:@"CarPlay"
                                                         sessionRole:session.role];
                }
                return original(delegate, selector, application, session, options);
            });
            class_replaceMethod(delegateClass, selector, replacement, method_getTypeEncoding(method));
        }];
}
@end
