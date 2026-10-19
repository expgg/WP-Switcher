// ============================================================================
// WP Switcher - Main World Isolation & Auto-Profile Capture Engine
// 
// 1. Preserves existing logged-in main account (zero-prefix for main)
// 2. Isolates secondary accounts per-session (prefixed storage & locks)
// 3. Robust IndexedDB and Locks handling to ensure smooth QR pairing
// 4. Automatically grabs user's WhatsApp Name & PFP once logged in
// ============================================================================
(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0: Native API references
  // ═══════════════════════════════════════════════════════════════════════════
  const REAL_LS        = window.localStorage;
  const REAL_SS        = window.sessionStorage;
  const REAL_IDB_OPEN  = IDBFactory.prototype.open;
  const REAL_IDB_DEL   = IDBFactory.prototype.deleteDatabase;
  const REAL_IDB_DBS   = IDBFactory.prototype.databases;
  const REAL_BC        = window.BroadcastChannel;
  const REAL_LOCKS_REQ = navigator.locks ? navigator.locks.request.bind(navigator.locks) : null;
  const REAL_LOCKS_QRY = navigator.locks ? navigator.locks.query.bind(navigator.locks) : null;
  const REAL_WIN_AEL   = window.addEventListener.bind(window);
  const REAL_PUSH_STATE    = history.pushState.bind(history);
  const REAL_REPLACE_STATE = history.replaceState.bind(history);

  const SID_KEY = '__wps_session_id';

  function cleanId(raw) {
    if (!raw) return null;
    try { raw = decodeURIComponent(raw); } catch (e) {}
    var s = String(raw).trim().replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    return s || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Determine Session ID
  // ═══════════════════════════════════════════════════════════════════════════
  let sessionId = null;

  // 1. URL param ?wsi=...
  const urlMatch = window.location.search.match(/[?&]wsi=([^&#]+)/i);
  if (urlMatch && urlMatch[1]) {
    sessionId = cleanId(urlMatch[1]);
  }

  // 2. Tab sessionStorage
  if (!sessionId) {
    sessionId = cleanId(REAL_SS.getItem(SID_KEY));
  }

  // 3. window.name fallback
  if (!sessionId) {
    const wnMatch = window.name.match(/__wps=([^;]+)/i);
    if (wnMatch && wnMatch[1]) {
      sessionId = cleanId(wnMatch[1]);
    }
  }

  // 4. Fallback: Main Account (native storage, preserves pre-existing login!)
  if (!sessionId) {
    sessionId = 'main';
  }

  REAL_SS.setItem(SID_KEY, sessionId);

  // Maintain window.name tag
  if (!window.name.includes('__wps=' + sessionId)) {
    window.name = window.name.replace(/__wps=[^;]*(;|$)/g, '');
    window.name = (window.name ? window.name + ';' : '') + '__wps=' + sessionId;
  }

  const isMain = (sessionId === 'main');
  const P = isMain ? '' : (sessionId + '::');

  // Keep ?wsi= attached across SPA navigations (if secondary account)
  if (!isMain) {
    function withWsi(url) {
      try {
        var u = new URL(url == null ? window.location.href : url, window.location.href);
        if (u.origin !== window.location.origin) return url;
        u.searchParams.set('wsi', sessionId);
        return u.pathname + u.search + u.hash;
      } catch (e) {
        return url;
      }
    }

    history.pushState = function(state, title, url) {
      return REAL_PUSH_STATE(state, title, withWsi(url));
    };
    history.replaceState = function(state, title, url) {
      return REAL_REPLACE_STATE(state, title, withWsi(url));
    };

    if (!window.location.search.toLowerCase().includes('wsi=' + sessionId)) {
      try {
        REAL_REPLACE_STATE(history.state, '', withWsi(window.location.href));
      } catch (e) {}
    }
  }

  console.log(`%c[WP Switcher] Session active: ${sessionId} (prefix: "${P}")`, 'color: #a855f7; font-weight: bold;');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Storage Isolation (Only for secondary accounts)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMain) {
    function createStorageProxy(realStorage) {
      return new Proxy(realStorage, {
        get(target, prop) {
          if (prop === 'getItem') {
            return function getItem(key) {
              return target.getItem(P + key);
            };
          }
          if (prop === 'setItem') {
            return function setItem(key, value) {
              target.setItem(P + key, String(value));
            };
          }
          if (prop === 'removeItem') {
            return function removeItem(key) {
              target.removeItem(P + key);
            };
          }
          if (prop === 'clear') {
            return function clear() {
              const toRemove = [];
              for (let i = 0; i < target.length; i++) {
                const k = target.key(i);
                if (k && k.startsWith(P)) toRemove.push(k);
              }
              toRemove.forEach(k => target.removeItem(k));
            };
          }
          if (prop === 'length') {
            let count = 0;
            for (let i = 0; i < target.length; i++) {
              const k = target.key(i);
              if (k && k.startsWith(P)) count++;
            }
            return count;
          }
          if (prop === 'key') {
            return function key(index) {
              let count = 0;
              for (let i = 0; i < target.length; i++) {
                const k = target.key(i);
                if (k && k.startsWith(P)) {
                  if (count === index) return k.substring(P.length);
                  count++;
                }
              }
              return null;
            };
          }
          if (typeof prop === 'string') {
            if (prop in target && typeof target[prop] === 'function') {
              return target[prop].bind(target);
            }
            const stored = target.getItem(P + prop);
            if (stored !== null) return stored;
            return undefined;
          }
          return target[prop];
        },
        set(target, prop, value) {
          if (typeof prop === 'string') {
            target.setItem(P + prop, String(value));
            return true;
          }
          return Reflect.set(target, prop, value);
        },
        deleteProperty(target, prop) {
          if (typeof prop === 'string') {
            target.removeItem(P + prop);
            return true;
          }
          return true;
        },
        has(target, prop) {
          if (typeof prop === 'string') {
            if (prop in target) return true;
            return target.getItem(P + prop) !== null;
          }
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          const keys = [];
          for (let i = 0; i < target.length; i++) {
            const k = target.key(i);
            if (k && k.startsWith(P)) keys.push(k.substring(P.length));
          }
          return keys;
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === 'string') {
            if (prop in target && typeof target[prop] === 'function') {
              return Reflect.getOwnPropertyDescriptor(target, prop);
            }
            const val = target.getItem(P + prop);
            if (val !== null) {
              return { value: val, writable: true, enumerable: true, configurable: true };
            }
          }
          return undefined;
        }
      });
    }

    const lsProxy = createStorageProxy(REAL_LS);
    const ssProxy = createStorageProxy(REAL_SS);

    Object.defineProperty(window, 'localStorage', { get: () => lsProxy, configurable: true });
    Object.defineProperty(window, 'sessionStorage', { get: () => ssProxy, configurable: true });

    // Cookie isolation for secondary sessions
    const COOKIE_KEY = P + 'cookies';
    Object.defineProperty(document, 'cookie', {
      get() { return REAL_LS.getItem(COOKIE_KEY) || ''; },
      set(value) {
        const nameValue = value.split(';')[0];
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx < 0) return;
        const name = nameValue.substring(0, eqIdx).trim();
        const val  = nameValue.substring(eqIdx + 1).trim();
        let current = REAL_LS.getItem(COOKIE_KEY) || '';
        let cookies = current ? current.split('; ') : [];
        cookies = cookies.filter(c => !c.startsWith(name + '='));
        
        const lower = value.toLowerCase();
        const isDelete = lower.includes('max-age=0') || 
                         lower.includes('max-age=-') || 
                         lower.includes('expires=thu, 01 jan 1970') ||
                         lower.includes('expires=1970');
        if (!isDelete) {
          cookies.push(name + '=' + val);
        }
        REAL_LS.setItem(COOKIE_KEY, cookies.join('; '));
      },
      configurable: true
    });

    // ═════════════════════════════════════════════════════════════════════════
    // IndexedDB Partitioning (FIX: Only pass version if explicitly provided!)
    // ═════════════════════════════════════════════════════════════════════════
    IDBFactory.prototype.open = function(name, version) {
      const dbName = P + name;
      if (arguments.length > 1 && version !== undefined) {
        return REAL_IDB_OPEN.call(this, dbName, version);
      }
      return REAL_IDB_OPEN.call(this, dbName);
    };

    IDBFactory.prototype.deleteDatabase = function(name) {
      return REAL_IDB_DEL.call(this, P + name);
    };

    if (REAL_IDB_DBS) {
      IDBFactory.prototype.databases = function() {
        return REAL_IDB_DBS.call(this).then(function(dbs) {
          return (dbs || [])
            .filter(db => db.name && db.name.startsWith(P))
            .map(db => ({ name: db.name.substring(P.length), version: db.version }));
        });
      };
    }

    // BroadcastChannel Partitioning
    window.BroadcastChannel = function BroadcastChannel(name) {
      const bc = new REAL_BC(P + name);
      try {
        Object.defineProperty(bc, 'name', { get: () => name, configurable: true });
      } catch(e) {}
      return bc;
    };
    window.BroadcastChannel.prototype = REAL_BC.prototype;

    // Web Locks API Partitioning
    if (REAL_LOCKS_REQ) {
      navigator.locks.request = function(name) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = P + name;
        return REAL_LOCKS_REQ.apply(navigator.locks, args);
      };
    }

    if (REAL_LOCKS_QRY) {
      navigator.locks.query = function() {
        return REAL_LOCKS_QRY.call(navigator.locks).then(function(state) {
          if (!state) return state;
          return {
            held: (state.held || [])
              .filter(l => l.name && l.name.startsWith(P))
              .map(l => ({ ...l, name: l.name.substring(P.length) })),
            pending: (state.pending || [])
              .filter(l => l.name && l.name.startsWith(P))
              .map(l => ({ ...l, name: l.name.substring(P.length) }))
          };
        });
      };
    }

    // Block background workers safely without deadlocking async ready promises
    Object.defineProperty(navigator, 'serviceWorker', {
      get: () => ({
        register: () => Promise.reject(new DOMException('SecurityError')),
        getRegistration: () => Promise.resolve(undefined),
        getRegistrations: () => Promise.resolve([]),
        addEventListener: () => {},
        removeEventListener: () => {},
        controller: null,
        ready: Promise.resolve({
          active: null,
          scope: 'https://web.whatsapp.com/',
          unregister: () => Promise.resolve(true),
          update: () => Promise.resolve()
        })
      }),
      configurable: true
    });
    window.SharedWorker = function() { throw new DOMException('SecurityError'); };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Auto-Grab Name, Phone, and PFP the moment user logs in
  // ═══════════════════════════════════════════════════════════════════════════
  let lastReportedData = '';

  function detectAndReportProfile() {
    try {
      const qrCanvas = document.querySelector('canvas[aria-label], [data-ref], [data-testid="qrcode"]');
      const paneSide = document.getElementById('pane-side');
      const chatList = document.querySelector('[data-testid="chat-list"]');
      const header = document.querySelector('header');
      const rawWid = REAL_LS.getItem(P + 'last-wid-md') || REAL_LS.getItem(P + 'last-wid');

      // If QR canvas is in DOM, definitely still scanning
      if (qrCanvas) return;

      // Logged in if chat list / pane-side is present OR rawWid exists with header
      const isLoggedIn = !!(paneSide || chatList || (rawWid && header));
      if (!isLoggedIn) return;

      // Extract Phone
      let phone = '';
      if (rawWid) {
        phone = rawWid.replace(/[@:].*$/, '');
        if (!phone.startsWith('+')) phone = '+' + phone;
      }

      // Extract Name
      let name = '';
      const pushnameRaw = REAL_LS.getItem(P + 'pushname');
      if (pushnameRaw) {
        try {
          const parsed = JSON.parse(pushnameRaw);
          if (typeof parsed === 'string' && parsed.trim()) name = parsed.trim();
        } catch(e) {
          if (pushnameRaw.trim()) name = pushnameRaw.trim();
        }
      }

      if (!name && window.Store && window.Store.Conn && window.Store.Conn.pushname) {
        name = window.Store.Conn.pushname.trim();
      }

      if (!name && header) {
        const btn = header.querySelector('[role="button"], button');
        if (btn) {
          const t = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
          if (t && !t.toLowerCase().includes('profile') && !t.toLowerCase().includes('photo')) {
            name = t.trim();
          }
        }
      }

      // Extract PFP (Profile Picture as Base64 Data URL)
      let pfp = null;
      const avatarImg = document.querySelector('header img, [data-testid="header-user-avatar"] img, img[alt*="Profile"], img[alt*="profile"]');
      if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
        try {
          const canvas = document.createElement('canvas');
          const dim = Math.min(avatarImg.naturalWidth, 120);
          canvas.width = dim;
          canvas.height = dim;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(avatarImg, 0, 0, dim, dim);
          pfp = canvas.toDataURL('image/jpeg', 0.85);
        } catch (e) {}
      }

      const finalName = name || phone || (isMain ? 'Main Account' : 'WhatsApp Account');
      const reportKey = `${sessionId}::${finalName}::${phone}::${pfp ? pfp.length : 0}`;

      if (reportKey !== lastReportedData) {
        lastReportedData = reportKey;
        window.postMessage({
          type: '__WPS_UPDATE_PROFILE',
          sessionId: sessionId,
          isMain: isMain,
          name: finalName,
          phone: phone,
          pfp: pfp,
          isLoggedIn: true
        }, '*');
      }
    } catch (e) {}
  }

  // Periodic poll + mutation observer to catch login instantaneously
  setInterval(detectAndReportProfile, 1000);

  const observer = new MutationObserver(() => {
    detectAndReportProfile();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial registration of active tab
  window.postMessage({
    type: '__WPS_TAB_ACTIVE',
    sessionId: sessionId,
    isMain: isMain
  }, '*');

})();
