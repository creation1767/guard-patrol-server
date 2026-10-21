# 4 Horseman Security — iPhone app

This folder is the Xcode project for the iPhone (and iPad) app. It is the same officer app as Android and the
website: the repository's `app/` folder is bundled inside the iPhone app at build time, so it works with no signal and
syncs with the company server when it can. Native code adds what a web page can't do well on iPhone:

| Feature | How |
|---|---|
| QR guard-tour scanning | Native camera scanner (`QRScannerViewController.swift`) |
| GPS check-ins and on-shift location | iOS location services, passed to the page (`WebViewController.swift`) |
| Report photos | Camera or photo library from the report form |
| Share, print, spreadsheet export | iOS share sheet, AirPrint, Save to Files |
| Works offline | App files are inside the app; reports queue until there is signal |

The web code talks to the phone through `window.Android.*`, the same bridge the Android app provides, so nothing in
`app/` is iPhone-specific.

## What you need

- **A Mac with Xcode 15 or newer** (free from the Mac App Store). iPhone apps can only be built on a Mac.
- **An Apple ID.** With a free Apple ID you can install the app on your own iPhone for testing (it must be
  re-installed from Xcode every 7 days).
- **The Apple Developer Program ($99 a year)** only when you want TestFlight or the App Store, so officers can
  install it themselves.

## Run it on your iPhone

1. On the Mac, download this repository (GitHub → **Code → Download ZIP**, or `git clone`), keeping the folder
   structure: the project reads `../app`.
2. Open `ios/HorsemanSecurity.xcodeproj` in Xcode.
3. Click the **HorsemanSecurity** project → target **HorsemanSecurity** → **Signing & Capabilities**:
   - **Team:** choose your Apple ID (Xcode → Settings → Accounts → + to add it).
   - **Bundle Identifier:** `com.fourhorseman.security`. If Xcode says it is taken, change it to something unique,
     e.g. `com.yourname.horseman`.
4. Plug in the iPhone, unlock it, tap **Trust**. On iOS 16+, turn on **Settings → Privacy & Security → Developer Mode**.
5. Pick the iPhone at the top of Xcode and press **Run** (▶).
6. Free Apple ID only: on the iPhone, **Settings → General → VPN & Device Management** → trust your developer
   profile, then open the app.

## Publish to TestFlight / the App Store

1. Join the Apple Developer Program, then create the app in App Store Connect with the same bundle identifier.
2. In Xcode: choose **Any iOS Device (arm64)**, then **Product → Archive** → **Distribute App** → **App Store Connect**.
3. In App Store Connect: add screenshots, the privacy policy URL (`https://<your server>/privacy`), and a **demo
   company code, badge and PIN** in *App Review Information* so Apple's reviewer can sign in.
4. Send it to **TestFlight** to share with officers right away, or submit for App Store review.

Apple sometimes rejects apps that are "just a website". This app bundles the app offline and uses the native camera
scanner and location, which helps; explain that in the review notes.

## Releasing an update

Change the web app in `app/` as usual, then in Xcode raise **Version** (e.g. 1.7.1) and **Build** (e.g. 10) under the
target's **General** tab, and archive again.

## No Mac?

Cloud Mac build services (for example Codemagic or GitHub Actions macOS runners) can build and upload this project,
but they still need the Apple Developer Program account for signing. Until then, officers can install the web app
from Safari: open `https://<your server>/app/`, tap **Share → Add to Home Screen**.

## Server

The company server must allow the app's origin `horseman://app` for API calls. Version 2.3.0 and later do this
automatically.
