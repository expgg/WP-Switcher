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

      // 3. Replace default "WhatsApp" header title with Logo + Account Name
      replaceWhatsAppHeaderTitle(displayName, color);

    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Multi-Strategy WhatsApp Header / Logo Element Detector
  // ═══════════════════════════════════════════════════════════════════════════
  function findWhatsAppHeaderElement() {
    // 0. If already replaced and still alive in DOM, return our element
    const existing = document.querySelector('[data-wps-replaced="true"]');
    if (existing && document.contains(existing)) {
      return existing;
    }

    // Strategy 1: Normalized Text Content Match (handles unicode directional marks \u200E, \u200F, \u202A, etc.)
    const textCandidates = document.querySelectorAll('h1, h2, h3, h4, span, div, a, p');
    let bestTextEl = null;
    let smallestArea = Infinity;

    for (const el of textCandidates) {
      const raw = el.textContent || '';
      if (!raw || raw.length > 50) continue;

      // Strip all whitespace, directional marks (\u2000-\u206F), and invisible unicode characters
      const clean = raw.replace(/[\u2000-\u206F\uFEFF\s\r\n\t]+/g, '').toLowerCase();
      if (clean === 'whatsapp' || clean === 'chats') {
        const rect = el.getBoundingClientRect();
        if (rect.top >= 0 && rect.top < 140 && rect.left >= 30 && rect.left < 550 && rect.width > 0 && rect.height > 0) {
          const area = rect.width * rect.height;
          if (area < smallestArea) {
            smallestArea = area;
            bestTextEl = el;
          }
        }
      }
    }
    if (bestTextEl) {
      const heading = bestTextEl.closest('h1, h2, h3, [role="heading"]');
      return heading || bestTextEl;
    }

    // Strategy 2: Data-icon / SVG brand logo
    const iconCandidates = document.querySelectorAll(
      '[data-icon="whatsapp"], [data-icon="whatsapp-logo"], [data-icon="whatsapp-wordmark"], [data-icon*="whatsapp"], [data-testid*="whatsapp-logo"], [data-testid="chatlist-header"]'
    );
    for (const el of iconCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 140 && rect.left >= 30 && rect.left < 550 && rect.width > 0) {
        return el;
      }
    }

    // Strategy 3: Aria-label or title or alt matching "WhatsApp" (case-insensitive)
    const ariaCandidates = document.querySelectorAll(
      '[aria-label*="whatsapp" i], [title*="whatsapp" i], img[alt*="whatsapp" i]'
    );
    for (const el of ariaCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 140 && rect.left >= 30 && rect.left < 550 && rect.width > 0 && rect.width < 400) {
        return el;
      }
    }

    // Strategy 4: Structural layout - Container to the left of action buttons (Menu, New Chat)
    const actionBtn = document.querySelector(
      '[data-icon="menu"], [aria-label*="menu" i], [data-icon="new-chat-outline"], [data-icon="chat"], [aria-label*="new chat" i]'
    );
    if (actionBtn) {
      let row = actionBtn.parentElement;
      for (let depth = 0; depth < 5 && row; depth++) {
        const rect = row.getBoundingClientRect();
        if (rect.top >= 0 && rect.top < 140 && rect.height >= 30 && rect.height <= 90 && rect.left < 300) {
          const firstChild = row.firstElementChild;
          if (firstChild && firstChild !== actionBtn && !firstChild.contains(actionBtn)) {
            const fcRect = firstChild.getBoundingClientRect();
            if (fcRect.left >= 30 && fcRect.left < 400 && fcRect.width > 0) {
              return firstChild;
            }
          }
        }
        row = row.parentElement;
      }
    }

    // Strategy 5: Any SVG in top-left chatlist header quadrant
    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.top >= 5 && rect.top < 100 && rect.left >= 45 && rect.left < 350 && rect.width >= 15 && rect.height >= 15) {
        const parentBtn = svg.closest('button, [role="button"]');
        const aria = parentBtn ? (parentBtn.getAttribute('aria-label') || '') : '';
        if (!/search|menu|chat|new|status|channel|community|settings/i.test(aria)) {
          return svg.closest('span, div') || svg.parentElement || svg;
        }
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Replace "WhatsApp" Header Title with WP Switcher Logo & Account Name
  // ═══════════════════════════════════════════════════════════════════════════
  function replaceWhatsAppHeaderTitle(displayName, color) {
    if (!displayName) return;

    let targetEl = findWhatsAppHeaderElement();
    if (!targetEl) return;

    // If target is SVG or path, climb up to a container element
    if (targetEl.tagName && (targetEl.tagName.toLowerCase() === 'svg' || targetEl.tagName.toLowerCase() === 'path')) {
      targetEl = targetEl.closest('span, div, a, h1, h2, h3') || targetEl.parentElement;
    }
    if (!targetEl) return;

    // Avoid re-rendering if already matching current state
    if (targetEl.dataset.wpsName === displayName && targetEl.dataset.wpsColor === color) {
      return;
    }

    targetEl.dataset.wpsName = displayName;
    targetEl.dataset.wpsColor = color;
    targetEl.dataset.wpsReplaced = 'true';

    const switchLogoSvg = `
      <span style="display: inline-flex !important; align-items: center !important; justify-content: center !important; width: 22px !important; height: 22px !important; background: #ffffff !important; border-radius: 6px !important; box-shadow: 0 0 10px ${color}80 !important; flex-shrink: 0 !important; margin-right: 8px !important;">
        <svg viewBox="0 0 24 24" style="width: 15px !important; height: 15px !important; display: block !important;">
          <rect x="2" y="6" width="20" height="12" rx="6" fill="${color}" />
          <circle cx="16" cy="12" r="4.2" fill="#ffffff" />
          <circle cx="16" cy="12" r="1.8" fill="#ff007f" />
        </svg>
      </span>
    `;

    targetEl.innerHTML = `
      <span class="wps-header-brand" style="display: inline-flex !important; align-items: center !important; max-width: 260px !important; overflow: hidden !important; vertical-align: middle !important; line-height: 1 !important; user-select: none !important;">
        ${switchLogoSvg}
        <span style="font-size: 19px !important; font-weight: 700 !important; color: #f8fafc !important; letter-spacing: -0.2px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-family: inherit !important;" title="${escapeHtml(displayName)}">
          ${escapeHtml(displayName)}
        </span>
      </span>
    `;
    targetEl.style.display = 'inline-flex';
    targetEl.style.alignItems = 'center';

    console.log(`%c[WP Switcher]%c Header replaced -> "${displayName}" (${color})`, 'color: #00e676; font-weight: bold;', 'color: inherit;');
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
