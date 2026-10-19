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
  let hasLoggedInit = false;

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

      if (!hasLoggedInit) {
        hasLoggedInit = true;
        console.log(`%c[WP Switcher]%c Tab active for session: "${currentSessionId}" (Display: "${displayName}", Color: "${color}")`, 'color: #a855f7; font-weight: bold;', 'color: inherit;');
      }

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

      // 3. Attach App Switch Logo & Account Name beside the "WhatsApp" title
      attachAccountBadgeBesideTitle(displayName, color);

    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Find WhatsApp Title Element (Preserving native "WhatsApp" text)
  // ═══════════════════════════════════════════════════════════════════════════
  function findWhatsAppTitleElement() {
    const searchBox = document.querySelector('[role="search"], [data-testid="chat-list-search"], [role="combobox"]');

    // 1. Scan for element containing exactly "WhatsApp" or "Chats" in top-left
    const candidates = document.querySelectorAll('h1, h2, h3, h4, span, div, a');
    let bestEl = null;
    let smallestArea = Infinity;

    for (const el of candidates) {
      if (searchBox && searchBox.contains(el)) continue;
      if (el.id === 'wps-header-account-badge' || el.closest('#wps-header-account-badge')) continue;
      if (el.querySelector('input, [contenteditable="true"]')) continue;

      const raw = el.textContent || '';
      if (!raw || raw.length > 40) continue;

      const clean = raw.replace(/[\u2000-\u206F\uFEFF\s\r\n\t]+/g, '').toLowerCase();
      if (clean === 'whatsapp' || clean === 'chats') {
        const rect = el.getBoundingClientRect();
        // Title is strictly in top-left: top < 80, left < 260
        if (rect.top >= 0 && rect.top < 80 && rect.left >= 30 && rect.left < 260 && rect.width > 0 && rect.height > 0) {
          const area = rect.width * rect.height;
          if (area < smallestArea) {
            smallestArea = area;
            bestEl = el;
          }
        }
      }
    }
    if (bestEl) return bestEl;

    // 2. Fallback: Search by header row action button
    const actionBtn = document.querySelector('[data-icon="menu"], [aria-label*="menu" i], [data-icon="new-chat-outline"], [data-icon="chat"]');
    if (actionBtn) {
      let row = actionBtn.parentElement;
      for (let depth = 0; depth < 5 && row; depth++) {
        const rect = row.getBoundingClientRect();
        if (rect.top >= 0 && rect.top < 80 && rect.height >= 30 && rect.height <= 80 && rect.left < 200) {
          const firstChild = row.firstElementChild;
          if (firstChild && firstChild !== actionBtn && !firstChild.contains(actionBtn)) {
            return firstChild;
          }
        }
        row = row.parentElement;
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Attach App Switch Logo & Account Name Beside the "WhatsApp" Title
  // ═══════════════════════════════════════════════════════════════════════════
  function attachAccountBadgeBesideTitle(displayName, color) {
    if (!displayName) return;

    // Cleanup any erroneous element that might have been placed in the search box earlier
    const strayBrand = document.querySelectorAll('.wps-header-brand');
    for (const b of strayBrand) {
      if (b.closest('[role="search"], [data-testid="chat-list-search"], [role="combobox"], input')) {
        b.remove();
      }
    }

    const titleEl = findWhatsAppTitleElement();
    if (!titleEl) return;

    // The heading wrapper or direct title element
    const anchorEl = titleEl.closest('h1, h2, h3, [role="heading"]') || titleEl;

    // Ensure flex layout on parent so title and badge sit horizontally side-by-side
    const parent = anchorEl.parentElement;
    if (parent) {
      if (getComputedStyle(parent).display !== 'flex') {
        parent.style.display = 'flex';
        parent.style.alignItems = 'center';
      }
    }

    let badge = document.getElementById('wps-header-account-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'wps-header-account-badge';
      anchorEl.after(badge);
    } else {
      // Keep badge positioned directly after anchorEl if React re-ordered nodes
      if (badge.previousElementSibling !== anchorEl && anchorEl.parentElement) {
        anchorEl.after(badge);
      }
    }

    // Skip re-rendering innerHTML if data hasn't changed
    if (badge.dataset.wpsName === displayName && badge.dataset.wpsColor === color) {
      return;
    }

    badge.dataset.wpsName = displayName;
    badge.dataset.wpsColor = color;

    const switchLogoSvg = `
      <span style="display: inline-flex !important; align-items: center !important; justify-content: center !important; width: 18px !important; height: 18px !important; background: #ffffff !important; border-radius: 5px !important; box-shadow: 0 0 8px ${color}80 !important; flex-shrink: 0 !important;">
        <svg viewBox="0 0 24 24" style="width: 12px !important; height: 12px !important; display: block !important;">
          <rect x="2" y="6" width="20" height="12" rx="6" fill="${color}" />
          <circle cx="16" cy="12" r="4.2" fill="#ffffff" />
          <circle cx="16" cy="12" r="1.8" fill="#ff007f" />
        </svg>
      </span>
    `;

    badge.style.cssText = `
      display: inline-flex !important;
      align-items: center !important;
      gap: 7px !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid ${color}60 !important;
      box-shadow: 0 0 10px ${color}30, inset 0 0 6px ${color}15 !important;
      padding: 3px 10px 3px 6px !important;
      border-radius: 16px !important;
      margin-left: 10px !important;
      max-width: 220px !important;
      overflow: hidden !important;
      cursor: default !important;
      vertical-align: middle !important;
      user-select: none !important;
      transition: all 0.2s ease !important;
      z-index: 10 !important;
      flex-shrink: 0 !important;
    `;

    badge.innerHTML = `
      ${switchLogoSvg}
      <span style="font-size: 13px !important; font-weight: 600 !important; color: #f1f5f9 !important; letter-spacing: -0.1px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-family: inherit !important;" title="${escapeHtml(displayName)}">
        ${escapeHtml(displayName)}
      </span>
    `;

    console.log(`%c[WP Switcher]%c Badge placed beside WhatsApp title -> "${displayName}" (${color})`, 'color: #00e676; font-weight: bold;', 'color: inherit;');
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
  setInterval(applyTabAccentTheme, 500);

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
