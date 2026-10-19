// ============================================================================
// WP Switcher - Popup Controller
// 
// 1. One-click Add Account (launches & focuses fresh isolated tab instantly)
// 2. Real-time display of auto-captured WhatsApp Name, Phone & Profile Picture
// 3. User customization: Edit account display name, raw phone, & custom avatar upload
// 4. Reliable 1-click tab switching
// 5. GitHub Update Checker & Release Downloader
// ============================================================================

(function() {
  'use strict';

  // Helper to clean raw phone number (strip quotes, country codes, +, etc.)
  function formatRawPhone(phone) {
    if (!phone) return '';
    const clean = String(phone).replace(/['"\s]/g, '').replace(/[@:].*$/, '');
    let digits = clean.replace(/\D/g, '');
    if (digits.startsWith('880')) digits = '0' + digits.slice(3);
    else if (digits.length > 10 && digits.startsWith('1')) digits = digits.slice(1);
    else if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length > 10 && digits.startsWith('44')) digits = '0' + digits.slice(2);
    return digits;
  }

  // DOM Elements - Main UI
  const activeTabsBadgeEl    = document.getElementById('activeTabsBadge');
  const activeTabsCountEl    = document.getElementById('activeTabsCount');
  const addNewAccountBtnEl   = document.getElementById('addNewAccountBtn');
  const emptyAddBtnEl        = document.getElementById('emptyAddBtn');
  const accountsListEl       = document.getElementById('accountsList');
  const emptyStateEl         = document.getElementById('emptyState');
  const accountsCountLabelEl = document.getElementById('accountsCountLabel');

  // DOM Elements - Edit Account Modal
  const editModalEl          = document.getElementById('editModal');
  const editAccountFormEl    = document.getElementById('editAccountForm');
  const editAccountNameInput = document.getElementById('editAccountNameInput');
  const editAccountPhoneInput= document.getElementById('editAccountPhoneInput');
  const editColorChipsGroup  = document.getElementById('editColorChipsGroup');
  const closeEditModalBtnEl  = document.getElementById('closeEditModalBtn');
  const cancelEditModalBtnEl = document.getElementById('cancelEditModalBtn');

  // Avatar Upload Elements
  const editAvatarPreviewEl  = document.getElementById('editAvatarPreview');
  const editAvatarInitialEl  = document.getElementById('editAvatarInitial');
  const editAvatarImgEl      = document.getElementById('editAvatarImg');
  const uploadAvatarBtnEl    = document.getElementById('uploadAvatarBtn');
  const resetAvatarBtnEl     = document.getElementById('resetAvatarBtn');
  const avatarFileInputEl    = document.getElementById('avatarFileInput');

  // DOM Elements - Check for Updates
  const checkUpdateBtnEl     = document.getElementById('checkUpdateBtn');
  const updateBtnTextEl      = document.getElementById('updateBtnText');
  const updateModalEl        = document.getElementById('updateModal');
  const updateModalTitleEl   = document.getElementById('updateModalTitle');
  const updateModalMessageEl = document.getElementById('updateModalMessage');
  const updateNotesBoxEl     = document.getElementById('updateNotesBox');
  const closeUpdateModalBtnEl= document.getElementById('closeUpdateModalBtn');
  const closeUpdateActionBtn = document.getElementById('closeUpdateActionBtn');
  const downloadUpdateBtnEl  = document.getElementById('downloadUpdateBtn');

  // DOM Elements - Confirm Modal (Delete)
  const confirmModalEl       = document.getElementById('confirmModal');
  const confirmTitleEl       = document.getElementById('confirmTitle');
  const confirmMessageEl     = document.getElementById('confirmMessage');
  const closeConfirmBtnEl    = document.getElementById('closeConfirmBtn');
  const cancelConfirmBtnEl   = document.getElementById('cancelConfirmBtn');
  const executeConfirmBtnEl  = document.getElementById('executeConfirmBtn');

  // DOM Elements - Toast
  const toastEl              = document.getElementById('toast');
  const toastMessageEl       = document.getElementById('toastMessage');

  // State
  let state = {
    sessions: [],
    liveTabs: [],
    pendingDeleteId: null,
    editingSessionId: null,
    editingColor: '#a855f7',
    editingPfp: null,
    resetPfp: false
  };

  let toastTimer = null;

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessageEl.textContent = msg;
    toastEl.style.display = 'inline-flex';
    toastTimer = setTimeout(() => {
      toastEl.style.display = 'none';
    }, 2200);
  }

  // Load state from background service worker
  async function loadState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        if (response) {
          state.sessions = response.sessions || [];
          state.liveTabs = response.liveTabs || [];
          render();
        }
        resolve();
      });
    });
  }

  // Render accounts list
  function render() {
    const totalLive = state.liveTabs.length;

    // 1. Update active tabs counter badge
    activeTabsCountEl.textContent = `${totalLive} Active`;
    if (totalLive > 0) {
      activeTabsBadgeEl.classList.remove('offline');
      activeTabsBadgeEl.classList.add('online');
    } else {
      activeTabsBadgeEl.classList.remove('online');
      activeTabsBadgeEl.classList.add('offline');
    }

    // 2. Render accounts
    const totalAccounts = state.sessions.length;
    accountsCountLabelEl.textContent = `${totalAccounts} ${totalAccounts === 1 ? 'account' : 'accounts'}`;

    if (totalAccounts === 0) {
      accountsListEl.style.display = 'none';
      emptyStateEl.style.display = 'flex';
    } else {
      emptyStateEl.style.display = 'none';
      accountsListEl.style.display = 'flex';
      accountsListEl.innerHTML = '';

      state.sessions.forEach(session => {
        const matchingTab = state.liveTabs.find(t => t.sessionId === session.id);
        const isLive = !!matchingTab;
        const card = createAccountCard(session, isLive);
        accountsListEl.appendChild(card);
      });
    }
  }

  // Create single account card
  function createAccountCard(session, isLive) {
    const card = document.createElement('div');
    card.className = `account-card ${isLive ? 'active-tab' : ''}`;

    const rawPhone = formatRawPhone(session.phone);
    let displayName = session.name;
    if (!displayName || displayName === 'Chats' || displayName === 'WhatsApp Account') {
      displayName = rawPhone || (session.isMain ? 'Main Account' : ('Account ' + session.id.replace('acc_', '')));
    }

    const initial = displayName.charAt(0).toUpperCase();
    const accentColor = session.color || '#a855f7';

    // Theme the entire account card by its chosen accent color
    card.style.setProperty('--card-accent', accentColor);

    // Avatar HTML: use real/custom PFP if set, else initial letter
    let avatarInner = `<span style="color: ${accentColor};">${initial}</span>`;
    if (session.pfp) {
      avatarInner = `<img src="${session.pfp}" alt="${escapeHtml(displayName)}">`;
    }

    card.innerHTML = `
      <div class="account-left">
        <div class="avatar-wrap">
          ${avatarInner}
          ${isLive ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="account-info">
          <div class="account-name-row">
            <span class="account-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
            ${session.isMain ? '<span class="main-badge">Main</span>' : ''}
          </div>
          <div class="account-status-desc ${isLive ? 'is-live' : ''}">
            ${isLive ? '● Online in Tab' : (rawPhone ? escapeHtml(rawPhone) : 'Offline')}
          </div>
        </div>
      </div>
      <div class="account-actions">
        ${isLive 
          ? `<button class="btn btn-switch" data-action="switch" data-id="${session.id}">Switch</button>`
          : `<button class="btn btn-open" data-action="switch" data-id="${session.id}">Open</button>`
        }
        <button class="btn-icon edit" data-action="edit" data-id="${session.id}" title="Edit name, phone & avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
        <button class="btn-icon delete" data-action="delete" data-id="${session.id}" title="Remove account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    return card;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Add New Account: Opens tab immediately & brings it to front
  // ═══════════════════════════════════════════════════════════════════════════
  function handleAddNewAccount() {
    addNewAccountBtnEl.disabled = true;
    showToast('Opening tab... Scan QR with your phone!');

    chrome.runtime.sendMessage({ type: 'ADD_NEW_ACCOUNT' }, (res) => {
      addNewAccountBtnEl.disabled = false;
      if (res && res.success) {
        setTimeout(() => {
          window.close();
        }, 300);
      }
    });
  }

  addNewAccountBtnEl.addEventListener('click', handleAddNewAccount);
  if (emptyAddBtnEl) {
    emptyAddBtnEl.addEventListener('click', handleAddNewAccount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Card Actions: Switch / Edit / Delete
  // ═══════════════════════════════════════════════════════════════════════════
  accountsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const sessionId = btn.dataset.id;
    if (!action || !sessionId) return;

    if (action === 'switch') {
      chrome.runtime.sendMessage({
        type: 'SWITCH_TO_SESSION',
        sessionId: sessionId
      }, (res) => {
        if (res && res.success) {
          window.close();
        }
      });
    }

    if (action === 'edit') {
      const session = state.sessions.find(s => s.id === sessionId);
      if (session) {
        openEditModal(session);
      }
    }

    if (action === 'delete') {
      const session = state.sessions.find(s => s.id === sessionId);
      promptDelete(session || { id: sessionId, name: sessionId });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Account Modal (Name, Phone, Theme Color, Avatar Upload)
  // ═══════════════════════════════════════════════════════════════════════════
  function openEditModal(session) {
    state.editingSessionId = session.id;
    state.editingColor = session.color || '#a855f7';
    state.editingPfp = session.pfp || null;
    state.resetPfp = false;

    const rawPhone = formatRawPhone(session.phone);
    let displayName = session.name;
    if (!displayName || displayName === 'Chats' || displayName === 'WhatsApp Account') {
      displayName = rawPhone || (session.isMain ? 'Main Account' : ('Account ' + session.id.replace('acc_', '')));
    }

    editAccountNameInput.value = displayName;
    editAccountPhoneInput.value = rawPhone;

    // Avatar preview setup
    updateAvatarModalPreview(state.editingPfp, displayName, state.editingColor);

    // Highlight matching chip
    const chips = editColorChipsGroup.querySelectorAll('.color-chip');
    chips.forEach(chip => {
      if (chip.dataset.color.toLowerCase() === state.editingColor.toLowerCase()) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    editModalEl.style.display = 'flex';
    setTimeout(() => {
      editAccountNameInput.focus();
      editAccountNameInput.select();
    }, 50);
  }

  function updateAvatarModalPreview(pfp, name, color) {
    editAvatarPreviewEl.style.borderColor = color || '#a855f7';
    if (pfp) {
      editAvatarImgEl.src = pfp;
      editAvatarImgEl.style.display = 'block';
      editAvatarInitialEl.style.display = 'none';
    } else {
      editAvatarImgEl.style.display = 'none';
      editAvatarInitialEl.style.display = 'block';
      editAvatarInitialEl.style.color = color || '#a855f7';
      editAvatarInitialEl.textContent = (name || 'W').charAt(0).toUpperCase();
    }
  }

  function closeEditModal() {
    editModalEl.style.display = 'none';
    state.editingSessionId = null;
    state.editingPfp = null;
    state.resetPfp = false;
  }

  if (closeEditModalBtnEl) closeEditModalBtnEl.addEventListener('click', closeEditModal);
  if (cancelEditModalBtnEl) cancelEditModalBtnEl.addEventListener('click', closeEditModal);

  // Avatar Upload Handlers
  if (uploadAvatarBtnEl && avatarFileInputEl) {
    uploadAvatarBtnEl.addEventListener('click', () => {
      avatarFileInputEl.click();
    });

    avatarFileInputEl.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const dim = 128;
          canvas.width = dim;
          canvas.height = dim;
          const ctx = canvas.getContext('2d');

          // Center crop to square
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, dim, dim);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          state.editingPfp = dataUrl;
          state.resetPfp = false;

          updateAvatarModalPreview(dataUrl, editAccountNameInput.value, state.editingColor);
          showToast('Avatar selected!');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      avatarFileInputEl.value = '';
    });
  }

  // Reset Avatar Handler
  if (resetAvatarBtnEl) {
    resetAvatarBtnEl.addEventListener('click', () => {
      state.editingPfp = null;
      state.resetPfp = true;
      updateAvatarModalPreview(null, editAccountNameInput.value, state.editingColor);
      showToast('Avatar reset to default.');
    });
  }

  // Color chip selection
  if (editColorChipsGroup) {
    editColorChipsGroup.addEventListener('click', (e) => {
      const chip = e.target.closest('.color-chip');
      if (!chip) return;

      const chips = editColorChipsGroup.querySelectorAll('.color-chip');
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.editingColor = chip.dataset.color;
      updateAvatarModalPreview(state.editingPfp, editAccountNameInput.value, state.editingColor);
    });
  }

  // Save changes form
  if (editAccountFormEl) {
    editAccountFormEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const newName = editAccountNameInput.value.trim();
      const newPhone = editAccountPhoneInput.value.trim();
      if (!newName || !state.editingSessionId) return;

      chrome.runtime.sendMessage({
        type: 'UPDATE_ACCOUNT_DETAILS',
        sessionId: state.editingSessionId,
        name: newName,
        phone: newPhone,
        color: state.editingColor,
        pfp: state.editingPfp,
        resetPfp: state.resetPfp
      }, (res) => {
        closeEditModal();
        if (res && res.success) {
          showToast('Account details updated!');
          loadState();
        } else {
          showToast('Failed to update account.');
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Delete Prompt
  // ═══════════════════════════════════════════════════════════════════════════
  function promptDelete(session) {
    state.pendingDeleteId = session.id;
    confirmTitleEl.textContent = `Delete "${session.name}"`;
    confirmMessageEl.textContent = `Are you sure you want to remove this account?`;
    confirmModalEl.style.display = 'flex';
  }

  function closeConfirmModal() {
    confirmModalEl.style.display = 'none';
    state.pendingDeleteId = null;
    executeConfirmBtnEl.disabled = false;
  }

  closeConfirmBtnEl.addEventListener('click', closeConfirmModal);
  cancelConfirmBtnEl.addEventListener('click', closeConfirmModal);

  executeConfirmBtnEl.addEventListener('click', () => {
    executeConfirmBtnEl.disabled = true;
    if (!state.pendingDeleteId) return;

    const sessionId = state.pendingDeleteId;
    chrome.runtime.sendMessage({ type: 'DELETE_SESSION', sessionId }, () => {
      closeConfirmModal();
      showToast('Account removed.');
      loadState();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Check for Updates (GitHub Releases / Repository)
  // ═══════════════════════════════════════════════════════════════════════════
  async function checkForUpdates() {
    const currentVersion = chrome.runtime.getManifest().version;
    updateBtnTextEl.textContent = 'Checking...';
    checkUpdateBtnEl.disabled = true;

    try {
      const response = await fetch('https://api.github.com/repos/expgg/WP-Switcher/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (response.ok) {
        const release = await response.json();
        const rawTag = release.tag_name || release.name || '';
        const remoteVersion = rawTag.replace(/^v/i, '').trim();

        if (isVersionGreater(remoteVersion, currentVersion)) {
          updateModalTitleEl.textContent = `Update Available (v${remoteVersion})`;
          updateModalMessageEl.textContent = `A newer release of WP Switcher is ready on GitHub. You are running v${currentVersion}.`;
          
          if (release.body) {
            updateNotesBoxEl.innerHTML = `<strong>What's New in v${remoteVersion}:</strong><br>` + 
              escapeHtml(release.body).replace(/\n/g, '<br>');
            updateNotesBoxEl.style.display = 'block';
          } else {
            updateNotesBoxEl.style.display = 'none';
          }

          downloadUpdateBtnEl.href = release.zipball_url || `https://github.com/expgg/WP-Switcher/releases/tag/${rawTag}`;
          downloadUpdateBtnEl.textContent = `Download v${remoteVersion} (.zip)`;
          downloadUpdateBtnEl.style.display = 'inline-flex';
          updateModalEl.style.display = 'flex';
        } else {
          updateModalTitleEl.textContent = 'You are Up to Date!';
          updateModalMessageEl.textContent = `WP Switcher v${currentVersion} is currently the latest release. All features and session engines are running the latest code.`;
          updateNotesBoxEl.style.display = 'none';
          downloadUpdateBtnEl.style.display = 'none';
          updateModalEl.style.display = 'flex';
        }
      } else {
        const rawManifestRes = await fetch('https://raw.githubusercontent.com/expgg/WP-Switcher/main/manifest.json');
        if (rawManifestRes.ok) {
          const remoteManifest = await rawManifestRes.json();
          const remoteVersion = remoteManifest.version;

          if (isVersionGreater(remoteVersion, currentVersion)) {
            updateModalTitleEl.textContent = `Update Available (v${remoteVersion})`;
            updateModalMessageEl.textContent = `A new update (v${remoteVersion}) is available on GitHub. You are running v${currentVersion}.`;
            updateNotesBoxEl.innerHTML = `Get the latest version directly from GitHub by downloading the repository zip or pulling the latest commits.`;
            updateNotesBoxEl.style.display = 'block';
            downloadUpdateBtnEl.href = 'https://github.com/expgg/WP-Switcher/archive/refs/heads/main.zip';
            downloadUpdateBtnEl.textContent = 'Download Latest (.zip)';
            downloadUpdateBtnEl.style.display = 'inline-flex';
            updateModalEl.style.display = 'flex';
          } else {
            updateModalTitleEl.textContent = 'You are Up to Date!';
            updateModalMessageEl.textContent = `WP Switcher v${currentVersion} is up to date with the main branch on GitHub.`;
            updateNotesBoxEl.style.display = 'none';
            downloadUpdateBtnEl.style.display = 'none';
            updateModalEl.style.display = 'flex';
          }
        } else {
          updateModalTitleEl.textContent = 'Up to Date (v' + currentVersion + ')';
          updateModalMessageEl.textContent = `You are on release v${currentVersion}. Visit the GitHub repository to star or check for upcoming builds.`;
          updateNotesBoxEl.style.display = 'none';
          downloadUpdateBtnEl.href = 'https://github.com/expgg/WP-Switcher';
          downloadUpdateBtnEl.textContent = 'Open GitHub Repo';
          downloadUpdateBtnEl.style.display = 'inline-flex';
          updateModalEl.style.display = 'flex';
        }
      }
    } catch (err) {
      updateModalTitleEl.textContent = 'GitHub Connectivity';
      updateModalMessageEl.textContent = `Unable to connect to GitHub API right now. Please check your internet connection.`;
      updateNotesBoxEl.style.display = 'none';
      downloadUpdateBtnEl.href = 'https://github.com/expgg/WP-Switcher';
      downloadUpdateBtnEl.textContent = 'View on GitHub';
      downloadUpdateBtnEl.style.display = 'inline-flex';
      updateModalEl.style.display = 'flex';
    } finally {
      updateBtnTextEl.textContent = 'Check for Updates';
      checkUpdateBtnEl.disabled = false;
    }
  }

  function isVersionGreater(remote, current) {
    if (!remote) return false;
    const rParts = remote.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = current.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
      const r = rParts[i] || 0;
      const c = cParts[i] || 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }

  function closeUpdateModal() {
    updateModalEl.style.display = 'none';
  }

  if (checkUpdateBtnEl) checkUpdateBtnEl.addEventListener('click', checkForUpdates);
  if (closeUpdateModalBtnEl) closeUpdateModalBtnEl.addEventListener('click', closeUpdateModal);
  if (closeUpdateActionBtn) closeUpdateActionBtn.addEventListener('click', closeUpdateModal);

  // Global Escape & Backdrop Handlers
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmModalEl && confirmModalEl.style.display === 'flex') closeConfirmModal();
      if (editModalEl && editModalEl.style.display === 'flex') closeEditModal();
      if (updateModalEl && updateModalEl.style.display === 'flex') closeUpdateModal();
    }
  });

  // Initial load & poll for live profile updates
  loadState();
  setInterval(loadState, 1500);

})();
