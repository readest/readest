// Evaluated in the displayed browser on every platform after the user clips.
// Clone the DOM so removing Readest's chrome does not disturb the live page.
(function () {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  var page = document.documentElement.cloneNode(true);
  var chrome = page.querySelector('#__readest_browser_chrome__');
  if (chrome) chrome.remove();
  return { url: location.href, html: page.outerHTML };
})();
