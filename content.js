// ============================================================================
// WP Switcher - Content Script Bridge (ISOLATED World)
// 
// Relays session activity, profile name, and captured avatar from inject.js
// to the background worker.
// ============================================================================

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
