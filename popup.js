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

function rowsToCsv(rows, mode) {
  if (!rows || !rows.length) return '';

  const header = mode === 'company'
    ? ['company_name', 'linkedin_profile_url', 'industry', 'employees']
    : [
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
    const key = r.linkedin_profile_url || r.full_name || r.company_name || JSON.stringify(r);
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  return [header.join(',')]
    .concat(dedupedRows.map((r) => header.map((h) => esc(r[h])).join(',')))
    .join('\n');
}

let _previewLimit = 20;

function renderPreview(rows, mode) {
  const table = document.getElementById('previewTable');
  const body = document.getElementById('previewBody');
  const empty = document.getElementById('previewEmpty');
  const count = document.getElementById('previewCount');
  const copyBtn = document.getElementById('copyBtn');
  const actionsContainer = document.getElementById('previewActions');

  count.textContent = (rows || []).length;
  copyBtn.disabled = !rows || rows.length === 0;

  // Dynamically update thead based on mode
  const thead = table.querySelector('thead');
  if (thead) {
    thead.innerHTML = mode === 'company'
      ? '<tr><th>Company</th><th>Industry</th><th>Employees</th><th>LinkedIn URL</th></tr>'
      : '<tr><th>Name</th><th>Title</th><th>Company</th><th>Industry</th><th>Location</th><th>Employees</th></tr>';
  }

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

  if (mode === 'company') {
    body.innerHTML = rows
      .slice(-itemsToRender)
      .reverse()
      .map(
        (r) => `
      <tr>
        <td title="${escHtml(r.company_name)}">${escHtml(r.company_name)}</td>
        <td title="${escHtml(r.industry)}">${escHtml(r.industry)}</td>
        <td title="${escHtml(r.employees)}">${escHtml(r.employees)}</td>
        <td title="${escHtml(r.linkedin_profile_url)}" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><a href="${escHtml(r.linkedin_profile_url)}" target="_blank" style="color:var(--neon-blue);text-decoration:none;">Link</a></td>
      </tr>
    `
      )
      .join('');
  } else {
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
  }

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
    renderPreview(_lastRows, _lastMode);
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

async function copyData(rows, mode) {
  const csv = rowsToCsv(rows, mode);
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
let _lastMode = 'people';
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
  _lastMode = s.mode || 'people';

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

  renderPreview(rows, s.mode);

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
    const h = Math.floor(etaSec / 3600);
    const m = Math.floor((etaSec % 3600) / 60);
    const sRem = etaSec % 60;
    if (etaSec === 0) {
      etaEl.textContent = 'any moment';
    } else if (h > 0) {
      etaEl.textContent = `${h}h ${m}m`;
    } else if (m > 0) {
      etaEl.textContent = `${m}m ${sRem}s`;
    } else {
      etaEl.textContent = `${etaSec}s`;
    }
  } else if (s.scanStatus === 'done' && (!s.scanFailed || s.scanFailed.length === 0)) {
    etaEl.textContent = 'Done';
  } else {
    etaEl.textContent = '\u2014';
  }
  
  const elapsedEl = document.getElementById('scannerElapsed');
  if (s.scanGlobalStartedAt && s.scanStatus && s.scanStatus !== 'Ready') {
    let endMs;
    if (s.scanRunning) {
      // Scan is actively running — use live time
      endMs = Date.now();
    } else if (s.scanEndedAt) {
      // Scan finished — freeze at the recorded end time
      endMs = s.scanEndedAt;
    } else {
      // Fallback: scan stopped but no endedAt was saved — freeze at now and stop updating
      endMs = Date.now();
    }
    const elapsedSecAll = Math.max(0, Math.floor((endMs - s.scanGlobalStartedAt) / 1000));
    const h = Math.floor(elapsedSecAll / 3600);
    const m = Math.floor((elapsedSecAll % 3600) / 60);
    const sRem = elapsedSecAll % 60;
    if (elapsedEl) {
      if (h > 0) {
        elapsedEl.textContent = `${h}h ${m}m`;
      } else if (m > 0) {
        elapsedEl.textContent = `${m}m ${sRem}s`;
      } else {
        elapsedEl.textContent = `${sRem}s`;
      }
    }
  } else {
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
  await copyData(_lastRows, _lastMode);
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
      document.getElementById('batchLimitModal').style.display = 'flex';
      
      await new Promise((resolve) => {
          document.getElementById('batchLimitOkayBtn').onclick = () => {
              document.getElementById('batchLimitModal').style.display = 'none';
              resolve();
          };
      });
      return;
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

// ═══════════════════════════════════════════════════════════════
// ════ COMPANY SCANNER TAB LOGIC ══════════════════════════════
// ═══════════════════════════════════════════════════════════════

let compPreviewLimit = 10;

async function refreshCompanyScanner() {
  let s = {};
  try {
    const statusRes = await send({ type: 'GET_COMP_SCAN_STATUS' });
    if (statusRes?.ok) s = statusRes;
    else return;
  } catch(e) { return; }

  // Status text
  const statusEl = document.getElementById('compScannerStatus');
  if (statusEl) statusEl.textContent = s.compScanStatus || 'Ready';

  // Status dot
  const dot = document.getElementById('compScannerStatusDot');
  if (dot) dot.className = 'status-dot' + (s.compScanRunning ? ' active' : '');

  // Stats
  const totalInQueue = (s.compScanQueue || []).length;
  const scannedCount = s.compScanIndex || 0;
  const queued = Math.max(0, totalInQueue - scannedCount);

  const scannedEl = document.getElementById('compScannedCount');
  if (scannedEl) scannedEl.textContent = scannedCount;

  const queueEl = document.getElementById('compQueueCount');
  if (queueEl) queueEl.textContent = queued;

  // Progress bar
  const pct = totalInQueue > 0 ? Math.min(100, (scannedCount / totalInQueue) * 100) : 0;
  const progressFill = document.getElementById('compScannerProgressFill');
  if (progressFill) progressFill.style.width = pct.toFixed(1) + '%';

  const progressPct = document.getElementById('compScannerProgressPercent');
  if (progressPct) progressPct.textContent = pct.toFixed(1) + '%';

  const progressText = document.getElementById('compScannerProgressText');
  if (progressText) progressText.textContent = `${scannedCount} / ${totalInQueue}`;

  // ETA
  const etaEl = document.getElementById('compScannerEta');
  if (s.compScanRunning && s.compScanStartedAt && totalInQueue > 0) {
    const qCount = Math.max(0, totalInQueue - scannedCount);
    const totalEstimateSec = qCount * 30; // ~30s per company (simpler than profiles)
    const elapsedSec = Math.floor((Date.now() - s.compScanStartedAt) / 1000);
    const etaSec = Math.max(0, totalEstimateSec - elapsedSec);
    const h = Math.floor(etaSec / 3600);
    const m = Math.floor((etaSec % 3600) / 60);
    const sRem = etaSec % 60;
    if (etaSec === 0) {
      etaEl.textContent = 'any moment';
    } else if (h > 0) {
      etaEl.textContent = `${h}h ${m}m`;
    } else if (m > 0) {
      etaEl.textContent = `${m}m ${sRem}s`;
    } else {
      etaEl.textContent = `${etaSec}s`;
    }
  } else if (s.compScanStatus === 'done') {
    etaEl.textContent = 'Done';
  } else {
    etaEl.textContent = '\u2014';
  }

  // Elapsed
  const elapsedEl = document.getElementById('compScannerElapsed');
  if (s.compScanGlobalStartedAt && s.compScanStatus && s.compScanStatus !== 'Ready') {
    let endMs;
    if (s.compScanRunning) {
      endMs = Date.now();
    } else if (s.compScanEndedAt) {
      endMs = s.compScanEndedAt;
    } else {
      endMs = Date.now();
    }
    const elapsedSecAll = Math.max(0, Math.floor((endMs - s.compScanGlobalStartedAt) / 1000));
    const h = Math.floor(elapsedSecAll / 3600);
    const m = Math.floor((elapsedSecAll % 3600) / 60);
    const sRem = elapsedSecAll % 60;
    if (elapsedEl) {
      if (h > 0) {
        elapsedEl.textContent = `${h}h ${m}m`;
      } else if (m > 0) {
        elapsedEl.textContent = `${m}m ${sRem}s`;
      } else {
        elapsedEl.textContent = `${sRem}s`;
      }
    }
  } else {
    if (elapsedEl) elapsedEl.textContent = '0s';
  }

  // Preview table
  const results = s.compScanResults || [];
  const previewBody = document.getElementById('compScannerPreviewBody');
  const previewTable = document.getElementById('compScannerPreviewTable');
  const previewEmpty = document.getElementById('compScannerPreviewEmpty');
  const previewCount = document.getElementById('compScannerPreviewCount');
  const previewActions = document.getElementById('compScannerPreviewActions');

  if (previewCount) previewCount.textContent = results.length;

  if (results.length > 0 && previewBody && previewTable) {
    previewTable.style.display = 'table';
    if (previewEmpty) previewEmpty.style.display = 'none';

    previewBody.innerHTML = '';
    const show = results.slice(0, compPreviewLimit);
    for (const r of show) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.companyName || ''}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.website || ''}</td>
        <td>${r.industry || ''}</td>
        <td>${r.companySize || ''}</td>
        <td>${r.headquarters || ''}</td>
        <td>${r.founded || ''}</td>
      `;
      previewBody.appendChild(tr);
    }

    if (previewActions) {
      previewActions.style.display = results.length > compPreviewLimit ? 'block' : 'none';
    }
  } else {
    if (previewTable) previewTable.style.display = 'none';
    if (previewEmpty) previewEmpty.style.display = 'flex';
    if (previewActions) previewActions.style.display = 'none';
  }

  // Download button
  const dlBtn = document.getElementById('downloadCompScanner');
  if (dlBtn) dlBtn.disabled = results.length === 0;
}

// Show more preview
document.getElementById('showMoreCompScannerPreviewBtn')?.addEventListener('click', () => {
  compPreviewLimit += 10;
  refreshCompanyScanner();
});

// Preview toggle
document.getElementById('compScannerPreviewToggle')?.addEventListener('click', function() {
  this.classList.toggle('collapsed');
  document.getElementById('compScannerPreviewContent')?.classList.toggle('collapsed');
});

// Start Company Scanner
document.getElementById('startCompScanner').onclick = async function() {
  const urlsRaw = document.getElementById('compScannerUrls').value.trim();
  if (!urlsRaw) {
    showErrorToast('Please paste company URLs first');
    return;
  }

  const urls = urlsRaw.split('\n')
    .map(u => u.trim())
    .filter(u => u && (u.includes('linkedin.com/company/') || u.includes('linkedin.com/sales/company/')));

  if (urls.length === 0) {
    showErrorToast('No valid LinkedIn company URLs found');
    return;
  }

  if (urls.length > 50) {
    // Show batch limit modal
    const modal = document.getElementById('batchLimitModal');
    if (modal) {
      modal.style.display = 'flex';
      await new Promise(resolve => {
        document.getElementById('batchLimitOkayBtn').onclick = () => {
          modal.style.display = 'none';
          resolve();
        };
      });
    }
    return;
  }

  const res = await send({ type: 'START_COMPANY_SCAN', urls });
  if (res && !res.ok && res.error) {
    showErrorToast(res.error);
  }
  await refreshCompanyScanner();
};

// Pause
document.getElementById('pauseCompScanner').onclick = async function() {
  await send({ type: 'PAUSE_COMPANY_SCAN' });
  await refreshCompanyScanner();
};

// Stop
document.getElementById('stopCompScanner').onclick = async function() {
  await send({ type: 'STOP_COMPANY_SCAN' });
  await refreshCompanyScanner();
};

// Reset
let compResetConfirmTimer;
document.getElementById('resetCompScanner').onclick = async function() {
  const btn = this;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="material-icons-round" style="font-size:15px;">warning</span> Confirm Wipe`;
    btn.style.boxShadow = '0 0 8px var(--neon-red)';
    compResetConfirmTimer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.innerHTML = btn.dataset.originalHtml;
      btn.style.boxShadow = '';
    }, 3000);
    return;
  }
  clearTimeout(compResetConfirmTimer);
  btn.classList.remove('confirming');
  btn.innerHTML = btn.dataset.originalHtml;
  btn.style.boxShadow = '';
  document.getElementById('compScannerUrls').value = '';
  await send({ type: 'RESET_COMPANY_SCAN' });
  await refreshCompanyScanner();
};

// Download / Export
document.getElementById('downloadCompScanner').onclick = async function() {
  const res = await send({ type: 'DOWNLOAD_COMPANY_SCAN' });
  if (res && !res.ok && res.error) {
    showErrorToast(res.error);
  }
};

refresh();
setInterval(() => {
  refresh();
  refreshCompanyScanner();
}, 800);