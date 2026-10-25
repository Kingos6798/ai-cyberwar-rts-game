# Mobile / Android port

This fork adds a phone version of the game: touch controls, a phone layout, an installable web app, and an Android app built with [Capacitor](https://capacitorjs.com). The desktop game is unchanged: mouse and keyboard work exactly as before, and phones are detected automatically (`?mobile` forces the phone layout on a desktop, `?desktop` turns it off).

## Playing on a phone

| Gesture | Does |
|---|---|
| Tap your unit or building | Select it |
| Tap ground, an enemy or a site | Order the selection there (the desktop right click) |
| Double-tap a unit | Select every unit of that type on screen |
| Press and hold | Explain what's there |
| One-finger drag | Pan the map (draws a selection box when **⬚ Box** is on) |
| Two fingers | Pan and pinch-zoom |

Drag from a selected unit to a target to order it there (a dashed line shows where).

Toolbar on the right: pause, speed, ⬚ Box select, 👷 next idle engineer, ⚔ select army, ✕ deselect, ⤢ show the whole map, ⚙ settings. Tap the "Getting started" checklist to fold it away. Tap an alert ("▸ show") to jump to it; the minimap under the toolbar centers the camera where you tap.

Settings (⚙): view (top-down, isometric, 3D), map, opponent (including the cloud AI General with your own API key), standard or quick match, vibration, and battery saver (30 fps). The app pauses itself when you leave it and offers to resume a match after Android closes it (scripted opponents only: see `src/harness/resume.ts`).

The playable web link can't reach the cloud General (the host blocks outside connections); the APK can.

## Building the Android app (APK)

Needs Node, a JDK 21 and the Android SDK (platform 36). Gradle 8.14 doesn't run on newer Java, so point `JAVA_HOME` at a JDK 21.

```sh
npm run android:sync                       # build the web game and copy it into android/
cd android
./gradlew assembleDebug                    # Windows: gradlew.bat assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`android/local.properties` (not committed) holds `sdk.dir=` your SDK path. `npm run icons` redraws the app icons, including the Android launcher icons.

## Files

- `src/render/touch.ts`: gesture recognizer (pure, tested in `tests/touch.test.ts`)
- `src/render/mobile.ts`: phone detection, toolbar, rotate hint, touch wording
- `index.html`: `body.touch` phone layout CSS
- `public/manifest.webmanifest`, `public/sw.js`, `public/icon-*.png`: installable web app with offline cache
- `capacitor.config.json`, `android/`: the Android app (landscape, dark background)
