// Send to Readest — popup. Posts the current tab to /api/send/inbox; the
// captured URL lands in the user's inbox and a Readest client converts it to
// EPUB on next sync.
const INBOX_ENDPOINT = 'https://web.readest.com/api/send/inbox';
const LOGIN_URL = 'https://web.readest.com/';

const urlEl = document.getElementById('url');
const sendEl = document.getElementById('send');
const statusEl = document.getElementById('status');

let currentTab = null;

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || '';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getToken() {
  const { readestAccessToken } = await chrome.storage.local.get('readestAccessToken');
  return readestAccessToken || null;
}

async function init() {
  currentTab = await getActiveTab();
  if (!currentTab || !/^https?:/i.test(currentTab.url || '')) {
    urlEl.textContent = 'This page cannot be sent.';
    return;
  }
  urlEl.textContent = currentTab.url;
  sendEl.disabled = false;
}

sendEl.addEventListener('click', async () => {
  sendEl.disabled = true;
  setStatus('Sending…');

  const token = await getToken();
  if (!token) {
    setStatus('Sign in to Readest first.', 'err');
    chrome.tabs.create({ url: LOGIN_URL });
    return;
  }

  try {
    const res = await fetch(INBOX_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: currentTab.url, title: currentTab.title }),
    });
    if (res.ok) {
      setStatus('Sent — it will appear in your library shortly.', 'ok');
    } else if (res.status === 403) {
      setStatus('Session expired. Open Readest to sign in again.', 'err');
      chrome.tabs.create({ url: LOGIN_URL });
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(data.error || `Failed (${res.status})`, 'err');
      sendEl.disabled = false;
    }
  } catch {
    setStatus('Network error — try again.', 'err');
    sendEl.disabled = false;
  }
});

init();
