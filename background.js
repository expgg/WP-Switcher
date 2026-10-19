// ============================================================================
// WP Switcher - Background Service Worker
// 
// 1. Manages real saved user profiles (NO dummy demo sessions)
// 2. Automatically records and locks in logged-in accounts (Name + PFP)
// 3. Spawns and focuses new accounts for instant QR scanning
// 4. Handles 1-click tab switching
// ============================================================================

const STORAGE_KEY_SESSIONS = 'wps_sessions';

// In-memory mapping of tabId -> sessionId
const activeTabSessions = new Map();

// Helper to extract wsi parameter from URL
function extractSessionFromUrl(url) {
  if (!url) return 'main';
  const match = url.match(/[?&]wsi=([^&#]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).trim().toLowerCase();
    } catch (e) {
      return match[1].trim().toLowerCase();
    }
  }
  return 'main';
}

// Helper to clean raw phone number (strip quotes, country codes, +, etc.)
function cleanPhoneNumber(raw) {
  if (!raw) return '';
  const clean = String(raw).replace(/['"\s]/g, '').replace(/[@:].*$/, '');
  let digits = clean.replace(/\D/g, '');
  if (digits.startsWith('880')) {
    digits = '0' + digits.slice(3);
  } else if (digits.length > 10 && digits.startsWith('1')) {
    digits = digits.slice(1);
  } else if (digits.length > 10 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length > 10 && digits.startsWith('44')) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

// Fetch saved sessions & sanitize legacy format
async function getSavedSessions() {
  const data = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
  const sessions = Array.isArray(data[STORAGE_KEY_SESSIONS]) ? data[STORAGE_KEY_SESSIONS] : [];
  
  let modified = false;
  sessions.forEach(s => {
    if (s.phone) {
      const cleaned = cleanPhoneNumber(s.phone);
      if (cleaned !== s.phone) {
        s.phone = cleaned;
        modified = true;
      }
    }
    // Clean up generic "Chats" or "WhatsApp Account" legacy titles
    if (!s.hasCustomName && (s.name === 'Chats' || s.name === 'WhatsApp Account')) {
      s.name = s.phone || (s.isMain ? 'Main Account' : ('Account ' + s.id.replace('acc_', '')));
      modified = true;
    }
  });

  if (modified) {
    await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
  }

  return sessions;
}

// Save sessions
async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
}

// Query live WhatsApp tabs
async function getLiveTabsState() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const savedSessions = await getSavedSessions();
  const liveTabs = [];

  for (const tab of tabs) {
    const rawSessionId = activeTabSessions.get(tab.id) || extractSessionFromUrl(tab.url) || 'main';
    const matched = savedSessions.find(s => s.id === rawSessionId);

    liveTabs.push({
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title || 'WhatsApp Web',
      sessionId: rawSessionId,
      name: matched ? matched.name : (rawSessionId === 'main' ? 'Main Account' : rawSessionId),
      pfp: matched ? matched.pfp : null,
      active: tab.active
    });
  }

  return liveTabs;
}

// Storage wipe helper
async function wipeStorageInPage(prefix, isMain) {
  try {
    if (isMain) {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !k.includes('::')) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      if (window.indexedDB && window.indexedDB.databases) {
        const dbs = await window.indexedDB.databases();
        for (const db of (dbs || [])) {
          if (db.name && !db.name.includes('::')) {
            window.indexedDB.deleteDatabase(db.name);
          }
        }
      }
      return { success: true };
    }

    const lsKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) lsKeys.push(k);
    }
    lsKeys.forEach(k => localStorage.removeItem(k));

    const ssKeys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) ssKeys.push(k);
    }
    ssKeys.forEach(k => sessionStorage.removeItem(k));

    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of (dbs || [])) {
        if (db.name && db.name.startsWith(prefix)) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function wipeSessionData(sessionId) {
  const isMain = (sessionId === 'main');
  const prefix = isMain ? '' : (sessionId + '::');
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });

  if (tabs.length > 0) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        func: wipeStorageInPage,
        args: [prefix, isMain]
      });
      return;
    } catch (e) {}
  }
}

// Tab cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabSessions.delete(tabId);
});

// Runtime Messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 1. Tab registered active session
  if (message.type === 'REGISTER_TAB_SESSION') {
    if (sender.tab && sender.tab.id && message.sessionId) {
      activeTabSessions.set(sender.tab.id, message.sessionId);
    }
    return false;
  }

  // 2. Auto-Captured Profile Update (Name & PFP from WhatsApp)
  if (message.type === 'UPDATE_SESSION_INFO') {
    (async () => {
      const { session } = message;
      if (!session || !session.sessionId) return;

      const sessions = await getSavedSessions();
      const existingIdx = sessions.findIndex(s => s.id === session.sessionId);

      if (existingIdx >= 0) {
        const existing = sessions[existingIdx];
        sessions[existingIdx] = {
          ...existing,
          name: existing.hasCustomName ? existing.name : (session.name || existing.name),
          pfp: existing.hasCustomPfp ? existing.pfp : (session.pfp || existing.pfp),
          phone: existing.hasCustomPhone ? existing.phone : (cleanPhoneNumber(session.phone) || existing.phone || ''),
          isMain: session.isMain || existing.isMain || false,
          lastActive: Date.now()
        };
      } else {
        sessions.push({
          id: session.sessionId,
          name: session.name || (session.isMain ? 'Main Account' : ('Account ' + session.sessionId)),
          pfp: session.pfp || null,
          phone: session.phone || '',
          isMain: !!session.isMain,
          createdAt: Date.now(),
          lastActive: Date.now()
        });
      }

      // Keep Main Account at the very top of the list
      sessions.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));

      await saveSessions(sessions);
      sendResponse({ success: true });
    })();
    return true;
  }

  // 3. Popup requests state
  if (message.type === 'GET_STATE') {
    (async () => {
      const sessions = await getSavedSessions();
      const liveTabs = await getLiveTabsState();
      sendResponse({ sessions, liveTabs });
    })();
    return true;
  }

  // 4. Add New Account: Immediately opens new tab & focuses it!
  if (message.type === 'ADD_NEW_ACCOUNT') {
    (async () => {
      const newSessionId = 'acc_' + Math.random().toString(36).substring(2, 7) + Date.now().toString(36).substring(4);
      const url = `https://web.whatsapp.com/?wsi=${encodeURIComponent(newSessionId)}`;

      const newTab = await chrome.tabs.create({ url, active: true });
      await chrome.windows.update(newTab.windowId, { focused: true });
      activeTabSessions.set(newTab.id, newSessionId);

      // Add placeholder session so user sees it right away
      const sessions = await getSavedSessions();
      sessions.push({
        id: newSessionId,
        name: 'New Account (Scanning...)',
        pfp: null,
        isMain: false,
        createdAt: Date.now()
      });
      await saveSessions(sessions);

      sendResponse({ success: true, tabId: newTab.id, sessionId: newSessionId });
    })();
    return true;
  }

  // 5. 1-Click Switch / Open Session
  if (message.type === 'SWITCH_TO_SESSION') {
    (async () => {
      const { sessionId } = message;
      const liveTabs = await getLiveTabsState();

      const existing = liveTabs.find(t => t.sessionId === sessionId);

      if (existing) {
        await chrome.tabs.update(existing.tabId, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        sendResponse({ success: true, focused: true, tabId: existing.tabId });
      } else {
        const url = (sessionId === 'main') 
          ? 'https://web.whatsapp.com/' 
          : `https://web.whatsapp.com/?wsi=${encodeURIComponent(sessionId)}`;

        const newTab = await chrome.tabs.create({ url, active: true });
        await chrome.windows.update(newTab.windowId, { focused: true });
        activeTabSessions.set(newTab.id, sessionId);
        sendResponse({ success: true, opened: true, tabId: newTab.id });
      }
    })();
    return true;
  }

  // 6. Delete Session (Allows deleting ANY session, including 'main'!)
  if (message.type === 'DELETE_SESSION') {
    (async () => {
      const { sessionId } = message;
      if (!sessionId) {
        sendResponse({ success: false, error: 'Missing sessionId' });
        return;
      }

      // Close open tabs for this session
      const liveTabs = await getLiveTabsState();
      const matching = liveTabs.filter(t => t.sessionId === sessionId);
      for (const t of matching) {
        chrome.tabs.remove(t.tabId).catch(() => {});
        activeTabSessions.delete(t.tabId);
      }

      // Wipe storage namespace
      await wipeSessionData(sessionId);

      // Remove from saved sessions
      const sessions = await getSavedSessions();
      const filtered = sessions.filter(s => s.id !== sessionId);
      await saveSessions(filtered);

      sendResponse({ success: true, sessions: filtered });
    })();
    return true;
  }

  // 7. Reset Session
  if (message.type === 'RESET_SESSION') {
    (async () => {
      const { sessionId } = message;
      if (!sessionId) return;

      await wipeSessionData(sessionId);

      const liveTabs = await getLiveTabsState();
      const matching = liveTabs.filter(t => t.sessionId === sessionId);
      for (const t of matching) {
        chrome.tabs.reload(t.tabId).catch(() => {});
      }

      sendResponse({ success: true });
    })();
    return true;
  }

  // 8. Fresh Start / Reset All Data
  if (message.type === 'RESET_ALL_DATA') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      for (const t of tabs) {
        chrome.tabs.remove(t.id).catch(() => {});
      }
      activeTabSessions.clear();

      await chrome.storage.local.clear();
      await saveSessions([]);

      sendResponse({ success: true, sessions: [] });
    })();
    return true;
  }

  // 9. Update Account Details (Manual name edit, phone, custom avatar & theme color)
  if (message.type === 'UPDATE_ACCOUNT_DETAILS') {
    (async () => {
      const { sessionId, name, phone, color, pfp, resetPfp } = message;
      if (!sessionId) {
        sendResponse({ success: false, error: 'Missing sessionId' });
        return;
      }
      const sessions = await getSavedSessions();
      const idx = sessions.findIndex(s => s.id === sessionId);
      if (idx >= 0) {
        if (name && name.trim()) {
          sessions[idx].name = name.trim();
          sessions[idx].hasCustomName = true;
        }
        if (phone !== undefined) {
          sessions[idx].phone = cleanPhoneNumber(phone);
          sessions[idx].hasCustomPhone = true;
        }
        if (color) {
          sessions[idx].color = color;
        }
        if (pfp) {
          sessions[idx].pfp = pfp;
          sessions[idx].hasCustomPfp = true;
        } else if (resetPfp) {
          sessions[idx].pfp = null;
          sessions[idx].hasCustomPfp = false;
        }
        await saveSessions(sessions);
        sendResponse({ success: true, session: sessions[idx] });
      } else {
        sendResponse({ success: false, error: 'Account not found' });
      }
    })();
    return true;
  }

  return false;
});
