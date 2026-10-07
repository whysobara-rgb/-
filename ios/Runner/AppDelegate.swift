import Flutter
import NidThirdPartyLogin
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // 네이버 앱에서 돌아온 로그인 결과는 네이버 SDK가 먼저 받고,
  // 나머지(카카오·구글 등)는 Flutter 플러그인에 넘긴다.
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if NidOAuth.shared.handleURL(url) {
      return true
    }
    return super.application(app, open: url, options: options)
  }
}
