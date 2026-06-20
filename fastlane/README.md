fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### verify_paths

```sh
[bundle exec] fastlane verify_paths
```



### release_ios

```sh
[bundle exec] fastlane release_ios
```

Submit the uploaded iOS build for App Store review and to TestFlight

### release_macos

```sh
[bundle exec] fastlane release_macos
```

Submit the uploaded macOS build for App Store review and to TestFlight

----


## Android

### android upload_production

```sh
[bundle exec] fastlane android upload_production
```

Upload AAB to Google Play Production

### android upload_internal

```sh
[bundle exec] fastlane android upload_internal
```

Upload AAB to Google Play Internal Testing

### android upload_beta

```sh
[bundle exec] fastlane android upload_beta
```

Upload AAB to Google Play Beta

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
