// Shared desktop / mobile image picker. Ordinary browsing remains available
// until selection is armed. Remote pages never receive Tauri IPC permissions.
(function (OPTIONS) {
  if (!OPTIONS.selectImage || window.top !== window) return;
  if (document.getElementById('__readest_browser_image_selection__')) return;

  function install() {
    if (!document.documentElement) return;
    var labels = OPTIONS.labels || {};
    var bg = OPTIONS.background || '#1f2024';
    var fg = OPTIONS.foreground || '#f5f5f7';
    var host = document.createElement('div');
    host.id = '__readest_browser_image_selection__';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    var bottom = document.getElementById('__readest_browser_chrome__') ? 72 : 16;
    style.textContent =
      ':host{all:initial;position:fixed;z-index:2147483647;left:16px;right:16px;' +
      'bottom:calc(' +
      bottom +
      'px + env(safe-area-inset-bottom,0px));pointer-events:none;}' +
      '.picker{display:flex;align-items:center;gap:12px;max-width:600px;margin-inline:auto;padding:12px;' +
      'border:1px solid ' +
      fg +
      ';border-radius:8px;background:' +
      bg +
      ';color:' +
      fg +
      ';pointer-events:auto;' +
      'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;direction:' +
      (OPTIONS.direction === 'rtl' ? 'rtl' : 'ltr') +
      ';}' +
      '.copy{flex:1;min-width:0;}.heading{font-weight:600;}.hint{margin-block-start:2px;font-size:13px;opacity:.75;}' +
      '.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      'button{font:inherit;min-height:44px;padding:8px 14px;border:1px solid transparent;border-radius:8px;cursor:pointer;color:' +
      fg +
      ';background:transparent;}' +
      'button:focus-visible{outline:2px solid ' +
      fg +
      ';outline-offset:2px;}' +
      '.primary{color:' +
      bg +
      ';background:' +
      fg +
      ';}' +
      (OPTIONS.isEink ? 'button{border-color:' + fg + ';}' : '') +
      '.preview{width:40px;height:56px;object-fit:contain;background:' +
      bg +
      ';border:1px solid ' +
      fg +
      ';border-radius:4px;}' +
      '@media(max-width:480px){.picker{flex-wrap:wrap;}.copy{min-width:150px;}.actions{width:100%;justify-content:flex-end;}button{flex:1;}}' +
      '.shield{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;}' +
      '.picker{position:relative;}' +
      '.outline{position:fixed;pointer-events:none;border:3px solid ' +
      fg +
      ';outline:2px solid ' +
      bg +
      ';box-sizing:border-box;}' +
      '[hidden]{display:none;}';
    var picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'region');
    picker.setAttribute('aria-label', labels.bookCover || 'Book cover');
    var copy = document.createElement('div');
    copy.className = 'copy';
    var heading = document.createElement('div');
    heading.className = 'heading';
    heading.textContent = labels.bookCover || 'Book cover';
    var actions = document.createElement('div');
    actions.className = 'actions';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = labels.selectImage || 'Choose cover';
    button.className = 'primary';
    button.setAttribute('aria-pressed', 'false');
    var hint = document.createElement('span');
    var selectionHint = labels.imageSelectionHint || 'Choose an image on this page.';
    var browseHint = labels.imageBrowseHint || 'Browse for a cover, then choose it here.';
    hint.className = 'hint';
    hint.textContent = selectionHint;
    hint.setAttribute('role', 'status');
    hint.textContent = browseHint;
    var preview = document.createElement('img');
    preview.className = 'preview';
    preview.alt = '';
    preview.hidden = true;
    var use = document.createElement('button');
    use.type = 'button';
    use.className = 'use primary';
    use.textContent = labels.useImage || 'Use this cover';
    use.hidden = true;
    var shield = document.createElement('div');
    shield.className = 'shield';
    shield.hidden = true;
    var outline = document.createElement('div');
    outline.className = 'outline';
    outline.hidden = true;
    var armed = false;
    var selected = null;

    function setArmed(value) {
      armed = value;
      shield.hidden = !armed;
      selected = null;
      button.setAttribute('aria-pressed', String(armed));
      button.textContent = armed ? labels.cancel || 'Cancel' : labels.selectImage || 'Choose cover';
      button.className = armed ? '' : 'primary';
      heading.textContent = armed
        ? labels.selectImage || 'Choose cover'
        : labels.bookCover || 'Book cover';
      preview.hidden = true;
      preview.removeAttribute('src');
      use.hidden = true;
      outline.hidden = true;
      hint.textContent = armed ? selectionHint : browseHint;
      hint.hidden = false;
    }
    function showOutline(image) {
      outline.hidden = !image;
      if (!image) return;
      var rect = image.getBoundingClientRect();
      var left = rect.left;
      var top = rect.top;
      var view = image.ownerDocument.defaultView;
      while (view && view.frameElement) {
        var frameRect = view.frameElement.getBoundingClientRect();
        left += frameRect.left + view.frameElement.clientLeft;
        top += frameRect.top + view.frameElement.clientTop;
        view = view.parent;
      }
      outline.style.left = left + 'px';
      outline.style.top = top + 'px';
      outline.style.width = rect.width + 'px';
      outline.style.height = rect.height + 'px';
    }
    function imageIn(doc, x, y, depth) {
      if (!doc.elementsFromPoint || depth > 8) return null;
      var elements = doc.elementsFromPoint(x, y);
      for (var i = 0; i < elements.length; i++) {
        var node = elements[i];
        if (node.tagName === 'IMG') return node;
        if (node.tagName === 'IFRAME') {
          try {
            var rect = node.getBoundingClientRect();
            // A frame obscures everything underneath it, even when inaccessible.
            return node.contentDocument
              ? imageIn(
                  node.contentDocument,
                  x - rect.left - node.clientLeft,
                  y - rect.top - node.clientTop,
                  depth + 1,
                )
              : null;
          } catch (_) {
            return null;
          }
        }
      }
      return null;
    }
    function imageAt(event) {
      var path = event.composedPath ? event.composedPath() : [event.target];
      if (path.indexOf(host) !== -1 && path.indexOf(shield) === -1) return null;
      if (
        path.some(function (node) {
          return node.id === '__readest_browser_chrome__';
        })
      )
        return null;
      if (event.target && event.target.tagName === 'IMG') return event.target;
      // The shield prevents preview-frame navigation. Ignore it while hit testing.
      var previous = shield.style.pointerEvents;
      shield.style.pointerEvents = 'none';
      try {
        return imageIn(document, event.clientX, event.clientY, 0);
      } finally {
        shield.style.pointerEvents = previous;
      }
    }
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setArmed(!armed);
    });
    use.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!selected) return;
      var result = new URL('https://readest-browser.invalid/image');
      result.searchParams.set('url', selected.url);
      result.searchParams.set('pageUrl', selected.pageUrl);
      location.href = result.href;
    });
    copy.appendChild(heading);
    copy.appendChild(hint);
    actions.appendChild(button);
    actions.appendChild(use);
    picker.appendChild(preview);
    picker.appendChild(copy);
    picker.appendChild(actions);
    root.appendChild(style);
    root.appendChild(shield);
    root.appendChild(outline);
    root.appendChild(picker);
    (document.body || document.documentElement).appendChild(host);

    // Capture at window level, before a site's document handlers. Suppress its
    // pointer-down action too, so the preview does not navigate before click.
    window.addEventListener(
      'pointerdown',
      function (event) {
        if (!armed || !host.isConnected) return;
        var path = event.composedPath ? event.composedPath() : [];
        if (path.indexOf(shield) !== -1 && document.elementsFromPoint) {
          shield.style.pointerEvents = 'none';
          var targets = document.elementsFromPoint(event.clientX, event.clientY);
          shield.style.pointerEvents = '';
          var input = null;
          for (var i = 0; i < targets.length; i++) {
            input = targets[i].closest('input,textarea,[contenteditable="true"]');
            if (input || targets[i].tagName === 'IFRAME') break;
          }
          if (input && !input.disabled && !input.readOnly) {
            setArmed(false);
            event.preventDefault();
            event.stopImmediatePropagation();
            input.focus();
            return;
          }
        }
        if (!imageAt(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      function (event) {
        if (armed && host.isConnected) showOutline(imageAt(event));
      },
      true,
    );
    window.addEventListener(
      'scroll',
      function () {
        outline.hidden = true;
      },
      true,
    );
    window.addEventListener(
      'click',
      function (event) {
        if (!armed || !host.isConnected) return;
        var image = imageAt(event);
        if (!image) return;
        var source = image.currentSrc || image.getAttribute('src');
        if (!source) return;
        try {
          var url = new URL(source, image.ownerDocument.baseURI);
          var page = new URL(location.href);
          if (!/^https?:$/.test(url.protocol) || !/^https?:$/.test(page.protocol)) {
            setArmed(false);
            hint.textContent =
              labels.imageSelectionUnavailable ||
              'Open the full-size image preview, then tap Select Image to choose it.';
            hint.hidden = false;
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          setArmed(false);
          selected = { url: url.href, pageUrl: page.href };
          heading.textContent = labels.imageSelected || 'Cover selected';
          hint.textContent = labels.imageConfirmHint || 'Use this image as the book cover?';
          button.textContent = labels.chooseAnother || 'Choose another';
          button.className = '';
          preview.src = url.href;
          preview.hidden = false;
          use.hidden = false;
          showOutline(image);
        } catch (_) {
          // A malformed source leaves selection available for another image.
        }
      },
      true,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(__READEST_BROWSER_OPTIONS__);
