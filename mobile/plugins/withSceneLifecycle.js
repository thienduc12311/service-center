// iOS 27 asserts at launch (EXC_BREAKPOINT in
// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`) unless the
// app adopts the UIScene life cycle. Expo ships the scene delegate
// (`EXExpoAppSceneDelegate`, expo >= 57.0.33) but the prebuild template still
// generates an app-delegate-only app, so this plugin opts in:
//
// 1. Info.plist: declare a scene manifest whose window scene uses Expo's
//    scene delegate.
// 2. AppDelegate.swift: conform to `ExpoReactNativeFactoryProvider` (so the
//    scene delegate can reach the React Native factory) and stop creating the
//    window / starting React Native there — the scene delegate now does both
//    when the scene connects.
//
// Only the main app target is touched; the widget extension has no scenes.

const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';
const PROVIDER_PROTOCOL = 'ExpoReactNativeFactoryProvider';

const CLASS_DECLARATION = /class AppDelegate: ExpoAppDelegate \{/;
const WINDOW_STARTUP_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

/**
 * @param {string} contents AppDelegate.swift source
 * @returns {string}
 */
function adoptSceneLifecycleInAppDelegate(contents) {
  if (contents.includes(PROVIDER_PROTOCOL)) {
    return contents;
  }
  if (!CLASS_DECLARATION.test(contents) || !WINDOW_STARTUP_BLOCK.test(contents)) {
    throw new Error(
      'withSceneLifecycle: AppDelegate.swift does not match the expected Expo template; ' +
        'update plugins/withSceneLifecycle.js for the new template.',
    );
  }
  return contents
    .replace(CLASS_DECLARATION, `class AppDelegate: ExpoAppDelegate, ${PROVIDER_PROTOCOL} {`)
    .replace(
      WINDOW_STARTUP_BLOCK,
      '\n    // The window is created and React Native started by EXExpoAppSceneDelegate\n' +
        '    // when the scene connects (see plugins/withSceneLifecycle.js).\n',
    );
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return cfg;
  });

  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: only a Swift AppDelegate is supported.');
    }
    cfg.modResults.contents = adoptSceneLifecycleInAppDelegate(cfg.modResults.contents);
    return cfg;
  });
};

module.exports = withSceneLifecycle;
