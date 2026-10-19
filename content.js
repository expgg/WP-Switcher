// ============================================================================
// WP Switcher - Content Script Bridge (ISOLATED World)
// 
// 1. Relays session activity, profile name, and captured avatar from inject.js
// 2. Injects solid 3px top accent bar in WhatsApp Web
// 3. Replaces default "WhatsApp" header title with App Switch Logo + Account Name
// ============================================================================

(function() {
  'use strict';

  function extractSessionId() {
    try {
      const match = window.location.href.match(/[?&]wsi=([^&#]+)/i);
      if (match && match[1]) {
        return decodeURIComponent(match[1]).trim().toLowerCase();
      }
    } catch(e) {}
    return 'main';
  }

  const currentSessionId = extractSessionId();

  // ═══════════════════════════════════════════════════════════════════════════
  // Tab Accent Color Theme & Header Replacement
  // ═══════════════════════════════════════════════════════════════════════════
  async function applyTabAccentTheme() {
    if (window.top !== window) return; // Only apply on top frame

    try {
      const data = await chrome.storage.local.get('wps_sessions');
      const sessions = Array.isArray(data.wps_sessions) ? data.wps_sessions : [];
      const session = sessions.find(s => s.id === currentSessionId);

      const color = (session && session.color) ? session.color : '#a855f7';
      const rawPhone = (session && session.phone) ? session.phone : '';
      let displayName = (session && session.name && session.name !== 'Chats') 
        ? session.name 
        : (rawPhone || (currentSessionId === 'main' ? 'Main Account' : ('Account ' + currentSessionId.replace('acc_', ''))));

      // 1. Clean flat 3px solid accent bar across top edge (no glow, no fade)
      let bar = document.getElementById('wps-tab-accent-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'wps-tab-accent-bar';
        document.documentElement.appendChild(bar);
      }
      bar.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        height: 3px !important;
        background: ${color} !important;
        box-shadow: none !important;
        filter: none !important;
        opacity: 1 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      `;

      // 2. Remove floating name/number badge pill if present
      const pill = document.getElementById('wps-tab-account-pill');
      if (pill) {
        pill.remove();
      }

      // 3. Replace default "WhatsApp" header title with Logo + Account Name
      replaceWhatsAppHeaderTitle(displayName, color);

    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Replace "WhatsApp" Header Title with WP Switcher Logo & Account Name
  // ═══════════════════════════════════════════════════════════════════════════
  function replaceWhatsAppHeaderTitle(displayName, color) {
    if (!displayName) return;

    // Search for header elements
    const headers = document.querySelectorAll('header, #side header, [data-testid="chatlist-header"]');
    let targetEl = null;

    for (const h of headers) {
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_ELEMENT, null, false);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.children.length === 0 && node.textContent.trim() === 'WhatsApp') {
          const rect = node.getBoundingClientRect();
          if (rect.top >= 0 && rect.top < 140 && rect.left >= 0 && rect.left < 500) {
            targetEl = node;
            break;
          }
        }
      }
      if (targetEl) break;
    }

    // Fallback: search all elements in top-left region
    if (!targetEl) {
      const candidates = document.querySelectorAll('h1, h2, span, div');
      for (const el of candidates) {
        if (el.children.length === 0 && el.textContent.trim() === 'WhatsApp') {
          const rect = el.getBoundingClientRect();
          if (rect.top >= 0 && rect.top < 140 && rect.left >= 0 && rect.left < 500 && rect.width > 0) {
            targetEl = el;
            break;
          }
        }
      }
    }

    if (targetEl) {
      // Avoid re-rendering if already matching current state
      if (targetEl.dataset.wpsName === displayName && targetEl.dataset.wpsColor === color) {
        return;
      }

      targetEl.dataset.wpsName = displayName;
      targetEl.dataset.wpsColor = color;
      targetEl.dataset.wpsReplaced = 'true';

      const switchLogoSvg = `
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #ffffff; border-radius: 6px; box-shadow: 0 0 10px ${color}60; flex-shrink: 0; margin-right: 8px;">
          <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; display: block;">
            <rect x="2" y="6" width="20" height="12" rx="6" fill="${color}" />
            <circle cx="16" cy="12" r="4.2" fill="#ffffff" />
            <circle cx="16" cy="12" r="1.8" fill="#ff007f" />
          </svg>
        </span>
      `;

      targetEl.innerHTML = `
        <span style="display: inline-flex; align-items: center; max-width: 250px; overflow: hidden; vertical-align: middle;">
          ${switchLogoSvg}
          <span style="font-size: 19px; font-weight: 700; color: #f8fafc; letter-spacing: -0.2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(displayName)}">
            ${escapeHtml(displayName)}
          </span>
        </span>
      `;
      targetEl.style.display = 'inline-flex';
      targetEl.style.alignItems = 'center';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Periodic check & mutation observer to handle React SPA re-renders
  setInterval(applyTabAccentTheme, 1000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTabAccentTheme);
  } else {
    applyTabAccentTheme();
  }

  const observer = new MutationObserver(() => {
    applyTabAccentTheme();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Update live if user changes name or color in popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wps_sessions) {
      applyTabAccentTheme();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Message Relay
  // ═══════════════════════════════════════════════════════════════════════════
  window.addEventListener('message', function(event) {
    if (!event.data) return;

    // 1. Live profile data update (Name, PFP, Phone)
    if (event.data.type === '__WPS_UPDATE_PROFILE') {
      try {
        chrome.runtime.sendMessage({
          type: 'UPDATE_SESSION_INFO',
          session: event.data
        });
      } catch (err) {}
    }

    // 2. Tab registration
    if (event.data.type === '__WPS_TAB_ACTIVE' || event.data.type === '__WMA_PROFILE_ACTIVE' || event.data.type === '__WSI_SESSION') {
      const sessionId = event.data.sessionId || event.data.profileId;
      if (sessionId) {
        try {
          chrome.runtime.sendMessage({
            type: 'REGISTER_TAB_SESSION',
            sessionId: sessionId,
            isMain: event.data.isMain || (sessionId === 'main')
          });
        } catch (err) {}
      }
    }
  });

})();
