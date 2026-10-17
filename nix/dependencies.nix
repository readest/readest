{ nss
, nspr
, at-spi2-core
, dbus
, cups
, expat
, alsa-lib
, libgbm
, libxkbcommon
, udev
, libx11
, libxcomposite
, libxdamage
, libxext
, libxfixes
, libxrandr
, libxcb
, libxcursor
, libxi
}:
{
  # Libraries named in libcef.so's DT_NEEDED entries. Declare them explicitly
  # even when GTK also makes some of them available indirectly.
  cef = [
    nss
    nspr
    at-spi2-core
    dbus
    cups
    expat
    alsa-lib
    libgbm
    libxkbcommon
    udev
    libx11
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxcb
  ];

  # X11 runtime libraries, including dlopen dependencies that autoPatchelf
  # cannot discover. The package uses runtimeDependencies; the shell uses
  # LD_LIBRARY_PATH.
  x11 = [
    libx11
    # Chromium optionally uses XcursorLibraryPath to find cursor themes.
    libxcursor
    libxi
    libxrandr
    libxkbcommon
  ];
}
