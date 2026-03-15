async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function escHtml(s) {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowsToCsv(rows) {
  if (!rows || !rows.length) return '';

  const header = [
    'first_name',
    'last_name',
    'full_name',
    'linkedin_profile_url',
    'title',
    'company_name',
    'industry',
    'profile_location',
    'employees'
  ];

  const esc = (v) => {
    const s = (v ?? '').toString();
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const seenKeys = new Set();
  const dedupedRows = rows.filter((r) => {
    const key = r.linkedin_profile_url || r.full_name || JSON.stringify(r);
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  return [header.join(',')]
    .concat(dedupedRows.map((r) => header.map((h) => esc(r[h])).join(',')))
    .join('\n');
}

let _previewLimit = 20;

function renderPreview(rows) {
  const table = document.getElementById('previewTable');
  const body = document.getElementById('previewBody');
  const empty = document.getElementById('previewEmpty');
  const count = document.getElementById('previewCount');
  const copyBtn = document.getElementById('copyBtn');
  const actionsContainer = document.getElementById('previewActions');

  count.textContent = (rows || []).length;
  copyBtn.disabled = !rows || rows.length === 0;

  if (!rows || rows.length === 0) {
    body.innerHTML = '';
    table.style.display = 'none';
    actionsContainer.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  const itemsToRender = Math.min(rows.length, _previewLimit);
  
  table.style.display = 'table';
  empty.style.display = 'none';
  body.innerHTML = rows
    .slice(-itemsToRender)
    .reverse()
    .map(
      (r) => `
    <tr>
      <td title="${escHtml(r.full_name)}">${escHtml(r.full_name)}</td>
      <td title="${escHtml(r.title)}">${escHtml(r.title)}</td>
      <td title="${escHtml(r.company_name)}">${escHtml(r.company_name)}</td>
      <td title="${escHtml(r.industry)}">${escHtml(r.industry)}</td>
      <td title="${escHtml(r.profile_location)}">${escHtml(r.profile_location)}</td>
      <td title="${escHtml(r.employees)}">${escHtml(r.employees)}</td>
    </tr>
  `
    )
    .join('');

  if (rows.length > _previewLimit && _previewLimit < 100) {
    actionsContainer.style.display = 'block';
  } else {
    actionsContainer.style.display = 'none';
  }
}

document.getElementById('showMorePreviewBtn').onclick = () => {
  if (_previewLimit < 100) {
    _previewLimit += 20;
    if (_previewLimit > 100) _previewLimit = 100;
    renderPreview(_lastRows);
  }
};

let _scannerPreviewLimit = 5;
function renderScannerPreview(results) {
  const table = document.getElementById('scannerPreviewTable');
  const tbody = document.getElementById('scannerPreviewBody');
  const empty = document.getElementById('scannerPreviewEmpty');
  const countSpan = document.getElementById('scannerPreviewCount');
  const actionsContainer = document.getElementById('scannerPreviewActions');

  if (!results || results.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    actionsContainer.style.display = 'none';
    countSpan.textContent = '0';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';
  countSpan.textContent = results.length;

  const displayResults = results.slice(0, _scannerPreviewLimit);
  tbody.innerHTML = displayResults.map(r => {
    let statusHtml;
    if (r.status === 'Skipped') {
      statusHtml = `<span style="color:var(--neon-amber)">Skipped</span>`;
    } else if (r.status === 'active') {
      statusHtml = `<span style="color:var(--neon-green)">Active</span>`;
    } else {
      statusHtml = `<span style="color:var(--neon-red)">Inactive</span>`;
    }
      
    let premiumHtml;
    if (r.is_premium === 'Skipped') {
      premiumHtml = `<span style="color:var(--neon-amber)">-</span>`;
    } else if (r.is_premium === 'Yes') {
      premiumHtml = `<span style="color:#FFD700; text-shadow:0 0 6px rgba(255,215,0,0.5);">Yes</span>`;
    } else {
      premiumHtml = `<span style="color:var(--text-faint)">No</span>`;
    }
       
    return `<tr>
      <td title="${escHtml(r.name)}">${escHtml(r.name)}</td>
      <td title="${escHtml(r.profile_url)}"><a href="${r.profile_url}" target="_blank" style="color:var(--neon-blue); text-decoration:none;">Link</a></td>
      <td>${statusHtml}</td>
      <td>${premiumHtml}</td>
      <td>${escHtml(r.connection_count || '0')}</td>
      <td title="${escHtml(r.last_activity || 'No activity')}">${escHtml(r.last_activity || 'No activity')}</td>
    </tr>`;
  }).join('');

  if (results.length > _scannerPreviewLimit) {
    actionsContainer.style.display = 'block';
  } else {
    actionsContainer.style.display = 'none';
  }
}

document.getElementById('showMoreScannerPreviewBtn').onclick = () => {
  if (_scannerPreviewLimit < 100) {
    _scannerPreviewLimit += 20;
    if (_scannerPreviewLimit > 100) _scannerPreviewLimit = 100;
    // We need state to re-render, so just trigger a refresh
    refresh();
  }
};

async function copyData(rows) {
  const csv = rowsToCsv(rows);
  if (!csv) return;

  try {
    await navigator.clipboard.writeText(csv);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = csv;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  const toast = document.getElementById('copyToast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1600);
}

let _lastRows = [];
let _initialTabSet = false;
let _dailyCount = 0;

async function refresh() {
  const [statusRes, histRes] = await Promise.all([send({ type: 'STATUS' }), send({ type: 'HISTORY' })]);

  if (!statusRes?.ok) {
    document.getElementById('status').textContent = statusRes?.error || 'no response';
  }

  const s = statusRes?.state || {};
  const rows = s.rows || [];
  _lastRows = rows;

  if (!_initialTabSet) {
      _initialTabSet = true;
      let targetTab = localStorage.getItem('salesnavActiveTab') || 'searchScraperTab';
      if (s.running) targetTab = 'searchScraperTab';
      if (s.scanRunning) targetTab = 'profileScannerTab';
      activateTab(targetTab);
  }

  if (statusRes?.ok) {
    document.getElementById('status').textContent = s.status || 'idle';
  }

  document.getElementById('rowCount').textContent = rows.length;
  document.getElementById('pageCount').textContent = s.pagesDone || 0;
  document.getElementById('lockedCount').textContent = s.skippedLocked || 0;

  // Mode badge
  const modeBadge = document.getElementById('modeBadge');
  modeBadge.textContent = s.mode ? s.mode.toUpperCase() : '—';

  // Run badge + status dot (global logic)
  const isAnythingRunning = s.running || s.scanRunning;
  const runBadge = document.getElementById('runBadge');
  runBadge.textContent = isAnythingRunning ? 'Running' : 'Stopped';
  runBadge.className = 'chip ' + (isAnythingRunning ? 'running' : 'stopped');

  const dot = document.getElementById('statusDot');
  if (dot) dot.className = 'status-dot' + (s.running ? ' active' : '');

  const history = histRes?.ok ? histRes.history || [] : [];



  const urlInput = document.getElementById('url').value.trim();
  document.getElementById('openStart').disabled = s.running || !urlInput;
  document.getElementById('start').disabled = s.running;
  document.getElementById('pause').disabled = !s.running;
  document.getElementById('downloadFinal').disabled = !(
    s.status === 'done_no_next' || 
    s.status === 'done_reached_max_profiles' || 
    s.status === 'done_current_page_only'
  );
  document.getElementById('downloadNow').disabled = rows.length === 0;
  document.getElementById('downloadJsonBtn').disabled = rows.length === 0;

  renderPreview(rows);

  // ─── Scanner UI Updates ───
  // Daily remaining counter
  const dailyTotal = statusRes?.dailyCount || 0;
  _dailyCount = dailyTotal;
  const remaining = Math.max(0, 100 - dailyTotal);
  document.getElementById('dailyRemaining').textContent = `Remaining: ${remaining}/100`;

  const scanResults = s.scanResults || [];
  renderScannerPreview(scanResults);
  const scanned = (s.scanResults || []).length;
  document.getElementById('scannedCount').textContent = scanned;
  
  const totalInQueue = (s.scanQueue || []).length;
  const qCount = Math.max(0, totalInQueue - (s.scanIndex || 0));
  document.getElementById('queueCount').textContent = qCount;
  
  // Progress Bar updates
  const progressFill = document.getElementById('scannerProgressFill');
  const progressPercent = document.getElementById('scannerProgressPercent');
  const progressText = document.getElementById('scannerProgressText');
  
  if (totalInQueue > 0) {
      let processed = s.scanIndex || 0;
      let effectiveProcessed = processed;
      if (s.scanRunning && s.scanStartedAt && qCount > 0) {
          const elapsedSec = Math.floor((Date.now() - s.scanStartedAt) / 1000);
          const partialProfile = Math.max(0, Math.min(1, elapsedSec / 90));
          effectiveProcessed += partialProfile;
      }
      const pct = Math.min(100, (effectiveProcessed / totalInQueue) * 100);
      progressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct.toFixed(1)}%`;
      progressText.textContent = `${processed} / ${totalInQueue}`;
  } else {
      progressFill.style.width = `0%`;
      progressPercent.textContent = `0%`;
      progressText.textContent = `0 / 0`;
  }

  // ETA countdown timer — total estimate minus elapsed time
  const etaEl = document.getElementById('scannerEta');
  if (s.scanRunning && s.scanStartedAt && totalInQueue > 0) {
    const qCount = Math.max(0, totalInQueue - (s.scanIndex || 0));
    const totalEstimateSec = qCount * 90;
    const elapsedSec = Math.floor((Date.now() - s.scanStartedAt) / 1000);
    const etaSec = Math.max(0, totalEstimateSec - elapsedSec);
    const etaMin = Math.floor(etaSec / 60);
    const etaSecRem = etaSec % 60;
    if (etaSec === 0) {
      etaEl.textContent = 'any moment';
    } else if (etaMin > 0) {
      etaEl.textContent = `${etaMin}m ${etaSecRem}s`;
    } else {
      etaEl.textContent = `${etaSec}s`;
    }
  } else if (s.scanStatus === 'done' && (!s.scanFailed || s.scanFailed.length === 0)) {
    etaEl.textContent = 'Done';
  } else {
    etaEl.textContent = '\u2014';
  }
  
  const elapsedEl = document.getElementById('scannerElapsed');
  if (s.scanGlobalStartedAt && s.scanRunning && s.scanStatus !== 'Ready' && s.scanStatus) {
    let endMs = s.scanEndedAt || Date.now();
    const elapsedSecAll = Math.max(0, Math.floor((endMs - s.scanGlobalStartedAt) / 1000));
    const elMin = Math.floor(elapsedSecAll / 60);
    const elSec = elapsedSecAll % 60;
    if (elapsedEl) {
      elapsedEl.textContent = `${elMin > 0 ? elMin + 'm ' : ''}${elSec}s`;
    }
  } else {
    // Reset timer when scan finishes or isn't running
    if (elapsedEl) elapsedEl.textContent = '0s';
  }
  
  
  const scannerDot = document.getElementById('scannerStatusDot');
  if (scannerDot) scannerDot.className = 'status-dot' + (s.scanRunning ? ' active' : '');
  
  if (statusRes?.ok) {
    document.getElementById('scannerStatus').textContent = s.scanStatus || 'Ready';
  }

  // A scan is only running if scanRunning is strictly true and not paused/done
  const isScanRunning = s.scanRunning === true && s.scanStatus !== 'paused' && s.scanStatus !== 'done';
  const isScanStopped = s.scanStatus === 'Ready' || !s.scanStatus || s.scanStatus === 'Stopped' || s.scanStatus === 'done';
  
  // Disable start button if running or if input field is empty
  const urlInputVal = document.getElementById('scannerUrls').value.trim();
  document.getElementById('startScanner').disabled = isScanRunning || urlInputVal.length === 0;
  
  document.getElementById('pauseScanner').disabled = isScanStopped || !isScanRunning;
  document.getElementById('stopScanner').disabled = isScanStopped;
  document.getElementById('downloadScanner').disabled = !(s.scanResults && s.scanResults.length > 0);

  // Retry Failed button: enabled only when not scanning and there are failed profiles
  const failedProfiles = s.scanFailed || [];
  document.getElementById('failedCount').textContent = failedProfiles.length;
  document.getElementById('retryFailed').disabled = isScanRunning || failedProfiles.length === 0;

  // Reset button: Always active so it can be clicked anytime
  document.getElementById('resetScanner').disabled = false;

  // Show Resurrect button when the scanner appears stuck:
  // Either it's been on the same profile for a while (tracked via a counter in the status text)
  // or the scanRunning flag is true but status hasn't changed in 30s.
  const resurrectRow = document.getElementById('resurrectRow');
  const scanIsActive = s.scanRunning === true;
  const scanStatusText = (s.scanStatus || '').toLowerCase();
  // Show resurrect if: scan is running AND status suggests we're mid-profile (not just between profiles)
  const looksStuck = scanIsActive && (
    scanStatusText.includes('scanning profile') ||
    scanStatusText.includes('loading profile') ||
    scanStatusText.includes('timeout') ||
    scanStatusText.includes('attempt')
  );
  const resurrectBtn = document.getElementById('resurrectScanner');
  resurrectBtn.disabled = !looksStuck;
  resurrectBtn.style.animation = looksStuck ? 'resurrectPulse 2s infinite' : 'none';
  
  // Disable configuration fields while there's an active incomplete queue
  const hasIncompleteQueue = s.scanQueue && s.scanQueue.length > 0 && s.scanStatus !== 'done';
  const disableInputs = isScanRunning || hasIncompleteQueue;
  document.getElementById('scannerUrls').disabled = disableInputs;
  document.getElementById('minConnections').disabled = disableInputs;
  document.getElementById('minActivityMonths').disabled = disableInputs;

  const host = document.getElementById('history');
  if (!history.length) {
    host.innerHTML =
      '<div style="padding:16px; text-align:center; color:#999; font-size:12px;">No history yet</div>';
  } else {
    host.innerHTML = history
      .slice(0, 20)
      .map((h) => {
        const kindLabel = h.kind === 'auto' ? 'session' : h.kind || 'export';
        const title = `${kindLabel} · ${h.mode || ''} · ${h.rows || 0} rows`;
        const meta = fmtTime(h.ts) + (h.filename ? ` · ${h.filename}` : '');
        const showBtn =
          typeof h.downloadId === 'number'
            ? `<button data-show="${h.downloadId}" style="padding:3px 8px; font-size:11px; border-radius:4px;">Show</button>`
            : '';

        return `
        <div class="history-item">
          <div>
            <div style="font-weight:500">${escHtml(title)}</div>
            <div class="history-meta">${escHtml(meta)}</div>
          </div>
          ${showBtn}
        </div>
      `;
      })
      .join('');

    host.querySelectorAll('button[data-show]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await send({ type: 'DOWNLOAD_SHOW', downloadId: Number(btn.getAttribute('data-show')) });
      });
    });
  }
}

function getStartOptions() {
  const m = parseInt(document.getElementById('maxProfiles').value, 10);
  const speed = document.getElementById('scrollSpeed').value || 'fast';
  const currentOnly = document.getElementById('currentPageOnly').checked;
  const deepF = document.getElementById('deepFetchBtn').checked;
  return { 
    maxProfiles: m > 0 ? m : null, 
    scrollSpeed: speed,
    currentPageOnly: currentOnly,
    deepFetch: deepF
  };
}

function getFormat() {
  return document.getElementById('exportFormat').value || 'csv';
}

document.getElementById('settingsToggle').onclick = () => {
  const panel = document.getElementById('settingsPanel');
  const btn = document.getElementById('settingsToggle');
  panel.classList.toggle('open');
  btn.classList.toggle('active');
};

// Collapsible sections
function setupCollapsible(toggleId, contentId) {
  document.getElementById(toggleId).onclick = (e) => {
    if (e.target.closest('#clearHistory')) return; // don't collapse when clicking Clear
    document.getElementById(toggleId).classList.toggle('collapsed');
    document.getElementById(contentId).classList.toggle('collapsed');
  };
}
setupCollapsible('previewToggle', 'previewContent');
setupCollapsible('historyToggle', 'historyContent');
setupCollapsible('scannerPreviewToggle', 'scannerPreviewContent');

document.getElementById('url').addEventListener('input', () => {
  const url = document.getElementById('url').value.trim();
  const btn = document.getElementById('openStart');
  if (!url) {
    btn.disabled = true;
    return;
  }
  refresh();
});

document.getElementById('openStart').onclick = async () => {
  const url = document.getElementById('url').value.trim();
  if (!url) return;
  const opts = getStartOptions();
  await send({ type: 'OPEN_AND_START', url, ...opts });
  await refresh();
};

document.getElementById('start').onclick = async () => {
  const opts = getStartOptions();
  await send({ type: 'START', ...opts });
  await refresh();
};

document.getElementById('pause').onclick = async () => {
  await send({ type: 'PAUSE' });
  await refresh();
};

document.getElementById('downloadFinal').onclick = async () => {
  await send({ type: 'DOWNLOAD_FINAL', format: getFormat() });
  await refresh();
};

document.getElementById('downloadNow').onclick = async () => {
  await send({ type: 'DOWNLOAD_PARTIAL', format: getFormat() });
  await refresh();
};

document.getElementById('downloadJsonBtn').onclick = async () => {
  await send({ type: 'DOWNLOAD_PARTIAL', format: 'json' });
  await refresh();
};

document.getElementById('copyBtn').onclick = async () => {
  await copyData(_lastRows);
};

document.getElementById('reset').onclick = async () => {
  _lastRows = [];
  await send({ type: 'RESET' });
  await refresh();
};

document.getElementById('clearHistory').onclick = async () => {
  await send({ type: 'HISTORY_CLEAR' });
  await refresh();
};

let errorToastTimer;
function showErrorToast(msg) {
  const t = document.getElementById('errorToast');
  if (!t) return;
  document.getElementById('errorToastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── Scanner Controls ───
document.getElementById('startScanner').onclick = async () => {
  const text = document.getElementById('scannerUrls').value;
  const allUrls = text.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith('http'));
  
  // Validate: only allow linkedin.com/in/ URLs
  const invalidUrls = allUrls.filter(u => !u.includes('linkedin.com/in/'));
  let urls = allUrls.filter(u => u.includes('linkedin.com/in/'));
  
  if (invalidUrls.length > 0) {
      showErrorToast(`${invalidUrls.length} URL(s) excluded (must contain "linkedin.com/in/")`);
  }
  
  if (urls.length === 0) {
      showErrorToast('No valid LinkedIn profile URLs found.');
      return;
  }
  
  if (urls.length > 50) {
      showErrorToast("Deep Scanner is limited to 50 profiles per launch. List truncated.");
      urls = urls.slice(0, 50);
  }

  const minConn = parseInt(document.getElementById('minConnections').value, 10) || 0;
  const minMonths = parseInt(document.getElementById('minActivityMonths').value, 10) || 3;
  
  // Update UI to disabled while spinning up
  document.getElementById('startScanner').disabled = true;

  let force = false;
  if (_dailyCount + urls.length > 100) {
      document.getElementById('limitModal').style.display = 'flex';
      
      const userChoice = await new Promise((resolve) => {
          document.getElementById('limitCancelBtn').onclick = () => {
              document.getElementById('limitModal').style.display = 'none';
              resolve(false);
          };
          document.getElementById('limitConfirmBtn').onclick = () => {
              document.getElementById('limitModal').style.display = 'none';
              resolve(true);
          };
      });
      
      if (!userChoice) {
          document.getElementById('startScanner').disabled = false;
          return;
      }
      force = true;
  }
  
  const res = await send({ type: 'START_SCAN', urls, minConnections: minConn, minActivityMonths: minMonths, force });
  if (res && !res.ok && res.error) {
      showErrorToast(res.error);
  }
  await refresh();
};

document.getElementById('pauseScanner').onclick = async () => {
  await send({ type: 'PAUSE_SCAN' });
  await refresh();
};

document.getElementById('stopScanner').onclick = async () => {
  await send({ type: 'STOP_SCAN' });
  await refresh();
};

document.getElementById('resurrectScanner').onclick = async () => {
  const res = await send({ type: 'SKIP_SCAN' });
  if (res && !res.ok && res.error) {
    alert('Could not skip: ' + res.error);
  }
  await refresh();
};

document.getElementById('downloadScanner').onclick = async () => {
  await send({ type: 'DOWNLOAD_SCAN' });
  await refresh();
};

document.getElementById('retryFailed').onclick = async () => {
  const res = await send({ type: 'RETRY_FAILED' });
  if (res && !res.ok && res.error) {
    alert(res.error);
  }
  await refresh();
};

let resetConfirmTimer;
document.getElementById('resetScanner').onclick = async function() {
  const btn = this;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="material-icons-round" style="font-size:15px;">warning</span> Confirm Wipe`;
    btn.style.boxShadow = '0 0 8px var(--neon-red)';
    resetConfirmTimer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.innerHTML = btn.dataset.originalHtml;
      btn.style.boxShadow = '';
    }, 3000);
    return;
  }

  clearTimeout(resetConfirmTimer);
  btn.classList.remove('confirming');
  btn.innerHTML = btn.dataset.originalHtml;
  btn.style.boxShadow = '';
  
  // Clear the input text explicitly to return to initial stage
  document.getElementById('scannerUrls').value = '';
  
  const res = await send({ type: 'RESET_SCAN' });
  if (res && !res.ok && res.error) {
    alert(res.error);
  }
  await refresh();
};

// --- Tab Switching ---
function activateTab(targetId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const tabEl = document.querySelector(`.tab[data-tab="${targetId}"]`);
    if (tabEl) tabEl.classList.add('active');
    
    const contentEl = document.getElementById(targetId);
    if (contentEl) contentEl.classList.add('active');
    
    localStorage.setItem('salesnavActiveTab', targetId);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.getAttribute('data-tab');
    activateTab(targetId);
  });
});

document.getElementById('scannerUrls').addEventListener('input', refresh);

refresh();
setInterval(refresh, 800);