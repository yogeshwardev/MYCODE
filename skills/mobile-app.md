---
name: mobile-app
description: Build and fix mobile apps - React Native/Expo, Flutter, native iOS (Swift/SwiftUI) and Android (Kotlin/Compose) - screens, navigation, state, offline data, permissions, builds and store readiness.
triggers: mobile, react native, expo, flutter, ios, android, swiftui, kotlin, jetpack compose, app store, play store, apk, ipa, xcode, gradle
---
1. **Identify the stack and tooling** from the project (package.json with expo/react-native, pubspec.yaml, .xcodeproj, build.gradle) and follow its patterns for navigation, state management and styling.
2. **UI**: platform conventions (safe areas, back behavior on Android, dynamic type and font scaling), responsive layouts for small phones through tablets, dark mode, and accessibility labels on every interactive element.
3. **Data**: handle loading, empty, error and offline states; cache sensibly; never block the UI thread; and store tokens only in secure storage (Keychain/Keystore, `expo-secure-store`), never in plain AsyncStorage or SharedPreferences.
4. **Permissions**: request at the moment of use with a clear reason, handle denial gracefully, and declare usage strings (Info.plist) and manifest permissions.
5. **Verify**: run the type checker, linter and unit tests; build with the platform CLI (`npx expo export` or `eas build --local` when configured, `flutter build`, `./gradlew assembleDebug`, `xcodebuild`), and fix build errors before finishing. Note anything that needs a device or simulator check you couldn't do.
6. **Release readiness** when asked: versioning, app icons and splash screens, environment configs per build type, crash reporting, and store-listing requirements.
