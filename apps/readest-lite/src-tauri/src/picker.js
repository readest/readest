// The file picker Readest Lite draws for the dialog plugin's `open` (picker.rs). A full-page
// overlay for e-ink: black on white, 1px borders, no shadows, and pages of rows turned by
// buttons instead of scrolling (a Kindle's X server gives taps, not drags). Its controls are
// `div role=button`: Readest's e-ink mode recolours every <button> with the theme's text colour.
(() => {
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(`plugin:dialog|${cmd}`, args);
  const ROW =
    'display:block;height:52px;line-height:52px;padding:0 16px;border-bottom:1px solid #000;white-space:nowrap;overflow:hidden';
  const BUTTON =
    'flex:1;display:flex;align-items:center;justify-content:center;height:48px;margin:0 4px;border:1px solid #000;border-radius:6px;background:#fff;color:#000';
  const el = (tag, css, text) => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const control = (css, text) => {
    const e = el('div', css, text);
    e.setAttribute('role', 'button');
    return e;
  };
  // a control that does nothing when off, drawn in gray
  const enable = (e, on) => {
    e.dataset.off = on ? '' : '1';
    e.style.color = on ? '' : '#888';
  };
  const on = (e, f) => e.addEventListener('click', () => e.dataset.off || f());
  const join = (dir, name) => (dir.endsWith('/') ? dir : `${dir}/`) + name;
  const parent = (dir) => dir.replace(/\/[^/]+\/?$/, '') || '/';

  window.__litePicker = {
    open(id, { start, extensions, multiple, directory, title }) {
      const chosen = new Set();
      let dir = start,
        entries = [],
        page = 0;
      const root = el(
        'div',
        'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;display:flex;flex-direction:column;background:#fff;color:#000;font-family:sans-serif;font-size:17px',
      );
      const head = el('div', 'padding:12px 16px;border-bottom:1px solid #000');
      const heading = el(
        'div',
        'font-weight:bold;font-size:19px',
        title || (directory ? 'Select a Folder' : 'Select Files'),
      );
      const where = el('div', 'margin-top:4px;font-size:14px;white-space:nowrap;overflow:hidden');
      head.append(heading, where);
      const list = el('div', 'flex:1;overflow:hidden');
      const pager = el(
        'div',
        'display:flex;align-items:center;padding:8px 12px;border-top:1px solid #000',
      );
      const prev = control(BUTTON, 'Previous');
      const count = el('div', 'flex:1;text-align:center;font-size:14px');
      const next = control(BUTTON, 'Next');
      pager.append(prev, count, next);
      const actions = el('div', 'display:flex;padding:8px 12px 16px');
      const cancel = control(BUTTON, 'Cancel');
      const done = control(`${BUTTON};background:#000;color:#fff`);
      actions.append(cancel, done);
      root.append(head, list, pager, actions);

      const perPage = () =>
        Math.max(1, Math.floor((list.getBoundingClientRect().height || 520) / 53));
      const finish = (paths) => {
        root.remove();
        invoke('pick', { id, paths });
      };
      const render = () => {
        const n = perPage(),
          pages = Math.max(1, Math.ceil((entries.length + (dir === '/' ? 0 : 1)) / n));
        page = Math.min(page, pages - 1);
        where.textContent = dir;
        const rows = (dir === '/' ? [] : [{ up: true }])
          .concat(entries)
          .slice(page * n, page * n + n);
        list.replaceChildren(
          ...rows.map((e) => {
            if (e.up) {
              const row = control(ROW, '.. (up)');
              row.addEventListener('click', () => go(parent(dir)));
              return row;
            }
            const path = join(dir, e.name),
              picked = chosen.has(path);
            const row = control(`${ROW}${e.dir ? ';font-weight:bold' : ''}`);
            if (!e.dir)
              row.append(
                el(
                  'span',
                  `display:inline-block;width:16px;height:16px;margin-right:12px;vertical-align:-2px;border:1px solid #000;background:${picked ? '#000' : '#fff'}`,
                ),
              );
            row.append(e.dir ? `${e.name}/` : e.name);
            row.addEventListener('click', () => {
              if (e.dir) return go(path);
              if (!multiple) chosen.clear();
              if (picked) chosen.delete(path);
              else chosen.add(path);
              render();
            });
            return row;
          }),
        );
        count.textContent = `${page + 1} / ${pages}`;
        pager.style.display = pages > 1 ? 'flex' : 'none';
        enable(prev, page > 0);
        enable(next, page < pages - 1);
        done.textContent = directory ? 'Select This Folder' : `Import (${chosen.size})`;
        done.style.opacity = directory || chosen.size > 0 ? '1' : '0.4';
        done.dataset.off = directory || chosen.size > 0 ? '' : '1';
      };
      const go = async (path) => {
        try {
          entries = await invoke('list_dir', { path, extensions, directory });
          dir = path;
          page = 0;
        } catch (e) {
          where.textContent = `${path}: ${e}`;
          return;
        }
        render();
      };
      on(prev, () => {
        page--;
        render();
      });
      on(next, () => {
        page++;
        render();
      });
      on(cancel, () => finish(null));
      on(done, () => finish(directory ? [dir] : [...chosen]));
      document.body.append(root);
      go(start);
    },
  };
})();
