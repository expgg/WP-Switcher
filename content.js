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
      const name = (session && session.name && session.name !== 'Chats') 
        ? session.name 
        : (currentSessionId === 'main' ? 'Main Account' : ('Account ' + currentSessionId.replace('acc_', '')));

      // 1. Sleek 4px accent line across the entire top edge of the tab
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
        height: 4px !important;
        background: ${color} !important;
        box-shadow: 0 0 12px ${color}, 0 0 20px ${color}80 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
      `;

      // 2. Floating account pill badge at top-right of WhatsApp Web
      let pill = document.getElementById('wps-tab-account-pill');
      if (!pill) {
        pill = document.createElement('div');
        pill.id = 'wps-tab-account-pill';
        document.documentElement.appendChild(pill);
      }
      pill.innerHTML = `
        <span style="width: 7px; height: 7px; border-radius: 50%; background: ${color}; box-shadow: 0 0 6px ${color}; flex-shrink: 0;"></span>
        <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
      `;
      pill.style.cssText = `
        position: fixed !important;
        top: 9px !important;
        right: 80px !important;
        z-index: 2147483646 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: rgba(14, 10, 26, 0.88) !important;
        backdrop-filter: blur(8px) !important;
        border: 1px solid ${color}60 !important;
        border-radius: 9999px !important;
        padding: 3px 10px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5), 0 0 10px ${color}30 !important;
        pointer-events: none !important;
        user-select: none !important;
        transition: all 0.2s ease !important;
      `;
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
