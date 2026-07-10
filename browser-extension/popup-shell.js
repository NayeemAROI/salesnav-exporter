(() => {
  'use strict';

  const frame = document.getElementById('popupApp');
  let activeModal = null;
  let focusBeforeModal = null;

  function visibleFocusables(root) {
    return [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.getClientRects().length > 0);
  }

  function installStyles(doc) {
    const style = doc.createElement('style');
    style.dataset.accessibilityFixes = 'true';
    style.textContent = `
      @keyframes resurrectPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      [role="tab"]:focus-visible,
      .toggle-switch input:focus-visible + .slider,
      [role="dialog"] button:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
    `;
    doc.head.appendChild(style);
  }

  function hideFetchWebsiteControl(doc) {
    const input = doc.getElementById('companyDeepBtn');
    const item = input?.closest('.scope-item');
    if (item) item.hidden = true;

    const bar = doc.getElementById('pageScopeBar');
    if (bar) bar.style.gridTemplateColumns = '1fr';
  }

  function installTabs(doc) {
    const tabList = doc.querySelector('.tabs');
    const tabs = [...doc.querySelectorAll('.tab[data-tab]')];
    if (!tabList || !tabs.length) return;

    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Exporter tools');

    const syncTabs = () => {
      tabs.forEach((tab) => {
        const selected = tab.classList.contains('active');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
    };

    tabs.forEach((tab, index) => {
      const panelId = tab.dataset.tab;
      const panel = doc.getElementById(panelId);
      const tabId = `tab-${panelId}`;
      tab.id = tabId;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panelId);

      if (panel) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabId);
        panel.tabIndex = 0;
      }

      tab.addEventListener('click', syncTabs);
      tab.addEventListener('keydown', (event) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          tab.click();
          syncTabs();
          return;
        } else return;

        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
        syncTabs();
      });
    });

    syncTabs();
  }

  function installToggleLabels(doc) {
    doc.querySelectorAll('.scope-item').forEach((item, index) => {
      const text = item.querySelector('.scope-label');
      const input = item.querySelector('input[type="checkbox"]');
      if (!text || !input) return;
      if (!text.id) text.id = `scope-label-${index + 1}`;
      input.setAttribute('aria-labelledby', text.id);
    });
  }

  function installClearHistoryGuard(doc) {
    const clearHistory = doc.getElementById('clearHistory');
    if (!clearHistory) return;
    clearHistory.addEventListener('click', (event) => event.stopPropagation());
  }

  function closeModal(modal) {
    const cancel = modal.querySelector('[id$="CancelBtn"]');
    const okay = modal.querySelector('[id$="OkayBtn"]');
    if (cancel) cancel.click();
    else if (okay) okay.click();
    else modal.style.display = 'none';
  }

  function activateModal(doc, modal) {
    if (activeModal === modal) return;
    activeModal = modal;
    focusBeforeModal = doc.activeElement;
    const focusables = visibleFocusables(modal);
    (focusables[0] || modal).focus();
  }

  function deactivateModal() {
    if (!activeModal) return;
    activeModal = null;
    if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') focusBeforeModal.focus();
    focusBeforeModal = null;
  }

  function installModals(doc) {
    const modals = [...doc.querySelectorAll('.modal-overlay')];
    modals.forEach((modal, index) => {
      const title = modal.querySelector('.modal-title');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.tabIndex = -1;
      if (title) {
        if (!title.id) title.id = `modal-title-${index + 1}`;
        modal.setAttribute('aria-labelledby', title.id);
      }

      const observer = new MutationObserver(() => {
        const open = getComputedStyle(modal).display !== 'none';
        if (open) activateModal(doc, modal);
        else if (activeModal === modal) deactivateModal();
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
    });

    doc.addEventListener('keydown', (event) => {
      if (!activeModal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(activeModal);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = visibleFocusables(activeModal);
      if (!focusables.length) {
        event.preventDefault();
        activeModal.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    installStyles(doc);
    hideFetchWebsiteControl(doc);
    installTabs(doc);
    installToggleLabels(doc);
    installClearHistoryGuard(doc);
    installModals(doc);
  });
})();
