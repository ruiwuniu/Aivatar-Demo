# Automatic updates / 自动更新

Aivatar 0.5.0 introduces in-app updates for macOS and Windows. Older releases and the earlier local 0.5.0 preview packages do not contain an updater: install this release manually once to receive future updates inside the app.

0.5.0 正式版开始支持 macOS 和 Windows 应用内更新。更早的版本及此前的本地 0.5.0 测试包没有更新模块，需要手动安装本次正式版一次，之后即可在软件中获取新版。

## Using updates / 使用方法

- The installed app checks for releases once after startup. Open the room's **Settings** to check manually and read update notes.
- Downloading an update does not install it immediately. Choose **Install and restart** when you are ready.
- Before installation, every open persistent room must finish saving. If saving fails or times out, installation stops and the app remains available for retry.
- An unavailable network does not prevent normal room use. Checks and downloads can be retried later.
- In desktop companion mode, return to the room to access Settings.

- 安装后的软件每次启动后会自动检查一次新版，也可在房间的「设置」中手动检查并查看更新说明。
- 下载完成不会立即安装；准备好后点击「安装并重启」。
- 安装前，所有已打开且包含存档的窗口都必须完成保存。保存失败或超时会中止安装，保留当前软件供重试。
- 网络不可用时仍可正常使用房间，稍后再检查或下载即可。
- 在桌面伙伴模式下，先回到房间，再进入设置。

## Platform behavior / 平台行为

macOS uses a universal update archive for Apple Silicon and Intel Macs. Windows selects an update matching the NSIS or MSI installation type. Keep the application in a writable installation location and allow the operating system's ordinary installer prompts when needed. Aivatar does not disable operating-system security checks.

macOS 的更新包同时支持 Apple Silicon 和 Intel；Windows 会选择与 NSIS 或 MSI 安装方式匹配的更新包。安装位置需要具有相应写入权限，必要时由用户处理系统安装提示。Aivatar 不会关闭系统安全检查。

Update signatures authenticate packages using the public key embedded in Aivatar. These signatures are separate from Apple code signing/notarization and Windows code-signing certificates. This release includes update signatures; platform signing and notarization remain unconfigured.

更新专用签名用于确认更新包来源，与 Apple 代码签名/公证、Windows 代码签名证书是不同机制。本版本提供更新签名，系统级签名和 Apple 公证仍未配置。

## Release maintenance

The updater reads the published stable release's `latest.json` from GitHub Releases over HTTPS. The release must include every supported platform's package and signature before `latest.json` is uploaded and the draft is published.

The macOS and Windows workflows build from the same full commit SHA, validate installer metadata, and upload separate platform manifests. Their final merge must reject mismatched versions, commits, missing platforms, invalid signatures, and unexpected artifact URLs. Preview/draft releases are not advertised to installed users.

After both workflows succeed, download the draft's assets to a new empty directory and run the merge with the same full source SHA:

```sh
gh release download "v$VERSION" --repo ruiwuniu/Aivatar-Demo --dir "$ASSETS"
node scripts/aivatar-updater-release.mjs merge \
  --macos "$ASSETS/updater-macos.json" --windows "$ASSETS/updater-windows.json" \
  --assets-dir "$ASSETS" --version "$VERSION" --source "$SOURCE_SHA" \
  --repo ruiwuniu/Aivatar-Demo --config src-tauri/tauri.conf.json \
  --notes-file "docs/releases/v$VERSION.md" --output "$ASSETS/latest.json" \
  --checksums-output "$ASSETS/updater-release-checksums.json"
gh release upload "v$VERSION" "$ASSETS/latest.json" "$ASSETS/updater-release-checksums.json" --repo ruiwuniu/Aivatar-Demo
```

Set `VERSION`, `ASSETS`, and `SOURCE_SHA` for the release before running these commands. Review the merged manifest and checksum report, then publish the draft as the latest stable release. Keep the signing public key consistent with already installed versions.

The dedicated private signing key is stored outside the repository and in the repository's `TAURI_SIGNING_PRIVATE_KEY` Actions secret. It must never be committed, printed, or included in a release asset. Keep a secure backup: future updates must remain compatible with the public key already embedded in installed applications.

See [Tauri's updater documentation](https://v2.tauri.app/plugin/updater/) for the underlying package and signature format.
