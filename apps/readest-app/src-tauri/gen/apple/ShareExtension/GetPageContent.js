// NSExtensionJavaScriptPreprocessingFile for the Readest Share Extension.
//
// When the user shares a web *page* from Safari, this runs inside the
// page itself — with the user's real session — and hands the rendered
// DOM to the extension. That is the only way to capture login-walled
// articles on iOS: the app's own clip WebView has no access to Safari's
// cookies (#5262). Browsers without JS preprocessing support (Chrome,
// Firefox) share a bare URL and fall back to the in-app clip path.
var GetPageContent = function () {};

GetPageContent.prototype = {
  run: function (args) {
    var html = '';
    try {
      html = document.documentElement.outerHTML || '';
    } catch (e) {
      // Leave html empty — the extension falls back to the URL-only save.
    }
    args.completionFunction({
      url: document.URL,
      title: document.title,
      html: html,
    });
  },
};

var ExtensionPreprocessingJS = new GetPageContent();
