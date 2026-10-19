// ============================================================================
// WP Switcher - Content Script Bridge (ISOLATED World)
// 
// 1. Relays session activity, profile name, and captured avatar from inject.js
// 2. Injects full-tab accent color theme & account indicator badge in WhatsApp Web
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
  // Tab Accent Color Theme (Injected into the WhatsApp Web page)
  // ═══════════════════════════════════════════════════════════════════════════
  async function applyTabAccentTheme() {
    if (window.top !== window) return; // Only apply on top frame

    try {
      const data = await chrome.storage.local.get('wps_sessions');
      const sessions = Array.isArray(data.wps_sessions) ? data.wps_sessions : [];
      const session = sessions.find(s => s.id === currentSessionId);

      const color = (session && session.color) ? session.color : '#a855f7';

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

      // 2. Remove floating name/number badge pill
      const pill = document.getElementById('wps-tab-account-pill');
      if (pill) {
        pill.remove();
      }
    } catch (e) {}
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

  // Apply on start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTabAccentTheme);
  } else {
    applyTabAccentTheme();
  }

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
