const STATE_KEY = "salesnav_export_state";
const HISTORY_KEY = "salesnav_export_history";
const SCAN_DAILY_KEY = "salesnav_scan_daily";

// Notification icon. chrome.notifications.create({type:'basic'}) requires an
// iconUrl, and omitting it throws on some Chrome versions. We ship a tiny
// inline data: URL so notifications always render and never depend on a
// packaged icon file being present.
const NOTIF_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// --- Daily Scan Counter ---
async function getDailyScannedCount() {
  const data = await chrome.storage.local.get(SCAN_DAILY_KEY);
  const record = data[SCAN_DAILY_KEY] || { date: '', count: 0 };
  const today = new Date().toISOString().split('T')[0];
  if (record.date !== today) return 0;
  return record.count || 0;
}

async function incrementDailyScanned(count) {
  const data = await chrome.storage.local.get(SCAN_DAILY_KEY);
  const record = data[SCAN_DAILY_KEY] || { date: '', count: 0 };
  const today = new Date().toISOString().split('T')[0];
  if (record.date !== today) {
    await chrome.storage.local.set({ [SCAN_DAILY_KEY]: { date: today, count: count } });
  } else {
    await chrome.storage.local.set({ [SCAN_DAILY_KEY]: { date: today, count: (record.count || 0) + count } });
  }
}

// Concurrency lock — prevents multiple stepOnce() from running in parallel
let _stepping = false;

function log(...args) {
  try { console.log('[SalesNavExporter]', ...args); } catch { }
}

async function getState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  return (
    data[STATE_KEY] || {
      running: false,
      rows: [],
      seen: {},
      pagesDone: 0,
      status: "idle",
      mode: null,
      maxProfiles: null,
      tabId: null,
      scrollSpeed: 'fast'
    }
  );
}

async function setState(patch) {
  const s = await getState();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });

  try {
    const count = (next.rows || []).length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {}

  return next;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randPageDelayMs(speed) {
  switch (speed) {
    case 'safe': return 8000 + Math.floor(Math.random() * 10000); // 8-18s
    case 'medium': return 4000 + Math.floor(Math.random() * 6000); // 4-10s
    case 'fast':
    default: return 1500 + Math.floor(Math.random() * 1000); // ~2s (1.5-2.5s, small jitter)
  }
}

function detectModeFromUrl(url) {
  if (url.includes("linkedin.com/sales/search/company?")) return "company";
  if (url.includes("linkedin.com/sales/search/people?")) return "people";
  if (url.includes("/sales/search/company")) return "company";
  return "people";
}

function filenameFromMode(mode) {
  return mode === "company" ? "salesnav_company.csv" : "salesnav_lead.csv";
}

async function inferModeFromTab(tab) {
  const url = tab?.url || '';
  if (url.includes("linkedin.com/sales/search/company?")) return "company";
  if (url.includes("linkedin.com/sales/search/people?")) return "people";
  if (url.includes('/sales/search/company') || url.includes('/sales/lists/accounts') || url.includes('/sales/lists/companies')) return 'company';
  return 'people';
}

async function ensureContentScript(tab) {
  if (!tab?.id) return;
  // Scanner calls pass { id } only (no url), so re-fetch the tab to read its
  // live URL. Without this we'd fall back to 'people' and inject the wrong
  // content script onto a /in/ profile page during a retry.
  let liveUrl = tab.url || '';
  try { liveUrl = (await chrome.tabs.get(tab.id))?.url || liveUrl; } catch (e) {}

  let file;
  if (/linkedin\.com\/in\//.test(liveUrl)) {
    file = 'content_profile.js'; // deep-scanner profile page
  } else if ((await inferModeFromTab({ url: liveUrl })) === 'company') {
    file = 'content_company.js';
  } else {
    file = 'content_people.js';
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [file]
    });
    log('injected', file, 'into tab', tab.id);
  } catch (e) {
    // If injection fails, we will surface the original sendMessage error.
    log('inject failed', String(e));
  }
}

async function sendToTab(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    const err = String(e);
    // If the receiving end does not exist, inject and retry once.
    if (/Receiving end does not exist|Could not establish connection/i.test(err)) {
      await ensureContentScript(tab);
      // retry
      return await chrome.tabs.sendMessage(tab.id, msg);
    }
    throw new Error(`sendToTab failed: ${err}`);
  }
}

function toCsv(rows, mode) {
  const header =
    mode === "company"
      ? ["company_name", "linkedin_profile_url", "industry", "country", "website", "employees"]
      : [
        "first_name",
        "last_name",
        "full_name",
        "linkedin_profile_url",
        "title",
        "company_name",
        "industry",
        "profile_location"
      ];

  const esc = (v) => {
    const s = (v ?? "").toString();
    if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const seenKeys = new Set();
  const dedupedRows = rows.filter(r => {
    const key = r.linkedin_profile_url || r.full_name || JSON.stringify(r);
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const lines = [header.join(",")].concat(
    dedupedRows.map((r) => header.map((h) => esc(r[h])).join(","))
  );
  return lines.join("\n");
}

async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

async function pushHistory(entry) {
  const h = await getHistory();
  h.unshift(entry);
  // Keep last 100
  const trimmed = h.slice(0, 100);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  log('history+', entry);
}

// ═════════════════════════════════════
// DOWNLOADS — Blob URLs via an offscreen document
//
// MV3 service workers do not expose URL.createObjectURL, so the old path
// shipped each export as a data: URL. Chrome caps data: URLs (~2MB in
// practice), so large scrapes silently truncated or failed to download.
// We now hand the payload to an offscreen document, which builds a Blob and
// returns a blob: URL (no practical size cap). If the offscreen document is
// unavailable for any reason, we fall back to the legacy data: URL.
// ═════════════════════════════════════
const OFFSCREEN_PATH = 'offscreen.html';
let _creatingOffscreen = null;

async function hasOffscreenDocument() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
      });
      return contexts.length > 0;
    }
  } catch (e) {}
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  // Guard against concurrent createDocument calls (Chrome throws if two race).
  if (_creatingOffscreen) { await _creatingOffscreen; return; }
  _creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: 'Create Blob URLs for large CSV/JSON exports (data: URLs are size-limited).'
  });
  try { await _creatingOffscreen; } finally { _creatingOffscreen = null; }
}

// Download a string as a file. Prefers a blob: URL minted by the offscreen
// document; falls back to a data: URL if that path is unavailable.
async function downloadBlob(content, mimeType, filename, saveAs = false) {
  let url = '';
  try {
    await ensureOffscreenDocument();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen-blob', mimeType, content });
    if (res && res.ok && res.url) url = res.url;
  } catch (e) {
    log('offscreen blob url failed, using data: URL fallback', String(e));
  }

  if (!url) {
    // Legacy fallback — size-limited but works when offscreen is unavailable.
    url = `data:${mimeType},${encodeURIComponent(content)}`;
  }

  const downloadId = await chrome.downloads.download({ url, filename, saveAs });

  // Revoke the blob: URL once the download settles so we don't leak memory.
  if (url.startsWith('blob:')) {
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        chrome.runtime.sendMessage({ target: 'offscreen-revoke', url }).catch(() => {});
        chrome.downloads.onChanged.removeListener(onChanged);
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
  }

  return downloadId;
}

async function downloadData(rows, format, mode, filename, kind) {
  let content = '';
  let mimeType = '';

  if (format === 'json') {
    content = JSON.stringify(rows || [], null, 2);
    mimeType = 'application/json';
    if (!filename.endsWith('.json')) filename = filename.replace(/\.csv$/i, '.json');
  } else {
    content = toCsv(rows || [], mode || "people");
    mimeType = 'text/csv;charset=utf-8';
    if (!filename.endsWith('.csv')) filename = filename.replace(/\.json$/i, '.csv');
  }

  const downloadId = await downloadBlob(content, mimeType, filename, false);

  await pushHistory({
    ts: Date.now(),
    kind: kind || "export",
    mode: mode || "people",
    filename,
    rows: (rows || []).length,
    downloadId
  });

  return downloadId;
}

function formatTs(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function downloadFinalData(format) {
  const s = await getState();
  const ext = format === 'json' ? '.json' : '.csv';
  const base = filenameFromMode(s.mode || "people").replace(/\.csv$/i, "");
  return await downloadData(
    s.rows || [],
    format,
    s.mode || "people",
    `${base}${ext}`,
    "final"
  );
}

async function downloadPartialData(format) {
  const s = await getState();
  const ext = format === 'json' ? '.json' : '.csv';
  const base = filenameFromMode(s.mode || "people").replace(/\.csv$/i, "");
  return await downloadData(
    s.rows || [],
    format,
    s.mode || "people",
    `${base}_partial_${formatTs(Date.now())}${ext}`,
    "partial"
  );
}

/** Re-read state to check if we should keep going (user may have paused). */
async function isStillRunning() {
  const s = await getState();
  return !!s.running;
}

async function stepOnce() {
  // Concurrency guard — only one stepOnce at a time
  if (_stepping) return;
  _stepping = true;

  try {
    await _stepOnceInner();
  } finally {
    _stepping = false;
  }
}

async function _stepOnceInner() {
  const state = await getState();
  if (!state.running) return;

  if (!state.tabId) {
    await setState({ status: "paused_no_tab", running: false });
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(state.tabId);
  } catch (e) {
    await setState({ status: "paused_tab_closed", running: false });
    return;
  }

  // Check before extraction (the slow part)
  if (!await isStillRunning()) return;

  let extracted;
  try {
    extracted = await sendToTab(tab, { type: "EXTRACT_PAGE", options: { deepFetch: state.deepFetch, companyDeep: state.companyDeep, page: (state.pagesDone || 0) + 1 } });
  } catch (e) {
    await setState({ status: `paused_error: ${String(e)}`, running: false });
    return;
  }

  if (!extracted?.ok) {
    await setState({ status: `paused_error: ${extracted?.error || 'extract failed'}`, running: false });
    return;
  }

  // Check after extraction
  if (!await isStillRunning()) return;

  // Stop if there's nothing to scrape on this page (no visible cards)
  const cardsOnPage = extracted?.meta?.cards;
  if (typeof cardsOnPage === 'number' && cardsOnPage === 0) {
    const cur = await getState();
    if ((cur.rows || []).length > 0) {
      await pushHistory({ ts: Date.now(), kind: 'auto', mode: cur.mode || 'people', rows: cur.rows.length });
    }
    await setState({ running: false, status: "done_no_profiles_on_page" });
    return;
  }

  // Re-read latest state to get up-to-date rows/seen (avoid overwriting pause)
  const latest = await getState();
  if (!latest.running) return;
  let { rows, seen } = latest;
  let added = 0;

  // Current page number (1-based)
  const currentPage = latest.pagesDone + 1;
  const maxProfiles = latest.maxProfiles || null;

  let reachedLimit = false;

  for (const r of extracted.rows || []) {
    // If we have a limit and we've reached it, stop adding rows
    if (maxProfiles && rows.length >= maxProfiles) {
      reachedLimit = true;
      break;
    }

    const key = r.linkedin_profile_url || r.full_name || JSON.stringify(r);
    if (!key) continue;
    if (seen[key]) continue;

    seen[key] = true;
    rows.push(r);
    added++;
  }

  // Determine if we should stop because of the limit OR because of "Current Page Only"
  if (reachedLimit || (maxProfiles && rows.length >= maxProfiles) || latest.currentPageOnly) {
    await setState({ rows, seen, status: `running (page ${currentPage}, +${added}, total ${rows.length})` });
    if (rows.length > 0) {
      await pushHistory({ ts: Date.now(), kind: 'auto', mode: latest.mode || 'people', rows: rows.length });
    }

    let stopStatus = latest.currentPageOnly ? "done_current_page_only" : "done_reached_max_profiles";
    await setState({ running: false, status: stopStatus });
    return;
  }

  await setState({ rows, seen, status: `running (page ${currentPage}, +${added}, total ${rows.length})` });

  // Check before navigating
  if (!await isStillRunning()) return;

  let nxt;
  try {
    nxt = await sendToTab(tab, { type: "HAS_NEXT" });
  } catch (e) {
    await setState({ running: false, status: `done_error_checking_next: ${String(e)}` });
    return;
  }

  if (!nxt?.ok || !nxt.hasNext) {
    const cur = await getState();
    if ((cur.rows || []).length > 0) {
      await pushHistory({ ts: Date.now(), kind: 'auto', mode: cur.mode || 'people', rows: cur.rows.length });
    }
    await setState({ running: false, status: "done_no_next" });
    return;
  }

  // Check before clicking next
  if (!await isStillRunning()) return;

  await setState({ status: "running (navigating to next page)" });
  const speed = latest.scrollSpeed || 'fast';
  await sleep(randPageDelayMs(speed));

  let clicked;
  try {
    clicked = await sendToTab(tab, { type: "CLICK_NEXT" });
  } catch (e) {
    await setState({ running: false, status: `done_error_clicking_next: ${String(e)}` });
    return;
  }

  if (!clicked?.ok || !clicked.clicked) {
    await setState({ running: false, status: "done_no_next" });
    return;
  }

  const pageLoadDelay = speed === 'safe' ? 7000 : speed === 'medium' ? 5000 : 2000;
  await setState({ pagesDone: latest.pagesDone + 1, status: "running (waiting for next page to load)" });
  await sleep(pageLoadDelay);

  // Check before scheduling next iteration
  if (!await isStillRunning()) return;

  // Continue loop immediately instead of waiting for alarm
  scheduleNextStep();
}

/** Schedule the next stepOnce() call. Uses setTimeout to avoid blocking the service worker. */
// ═════════════════════════════════════
// DEEP PROFILE SCANNER LOGIC
// ═════════════════════════════════════
let _scanning = false;
let _cancelCurrentScan = null;

async function scanNext() {
  if (_scanning) return;
  _scanning = true;
  try {
    await _scanNextInner();
  } finally {
    _scanning = false;
  }
}

// Convert activity time string to days for granular comparison
function timeStringToDays(t) {
  if (!t || t === 'N/A') return Infinity; if (t === 'now') return 0;
  const num = parseInt(t) || 0;
  const lower = t.toLowerCase();
  if (lower.includes('minute')) return 0;
  if (lower.includes('hour')) return 0;
  if (lower.includes('day')) return num;
  if (lower.includes('week')) return num * 7;
  if (lower.includes('month')) return num * 30;
  if (lower.includes('year')) return num * 365;
  return Infinity;
}

function getNameForUrl(url, rows) {
  if (!url || !rows || !Array.isArray(rows)) return 'Unknown';

  let match = rows.find(r => r.linkedin_profile_url === url);
  if (match && match.full_name) return match.full_name;

  // Try matching by lead ID or public ID
  const leadId = url.match(/\/sales\/lead\/([^,/?#]+)/)?.[1];
  const publicId = url.match(/\/in\/([^/?#]+)/)?.[1];

  if (leadId || publicId) {
    match = rows.find(r => {
      if (!r.linkedin_profile_url) return false;
      return r.linkedin_profile_url.includes(leadId || publicId);
    });
  }

  return (match && match.full_name) ? match.full_name : '';
}

// Parse a person's name out of a LinkedIn tab title, e.g. "(20) John Smith | LinkedIn"
function nameFromTitle(title) {
  if (!title) return '';
  const t = title.replace(/^\(\d+\)\s*/, '').split('|')[0].trim();
  return /^linkedin$/i.test(t) ? '' : t;
}

function upsertResult(resultsList, newResult) {
  const list = resultsList || [];
  // Use original_url to prevent duplicates across retries
  const queryUrl = newResult.original_url || newResult.profile_url;
  const idx = list.findIndex(r => (r.original_url || r.profile_url) === queryUrl);
  if (idx >= 0) list[idx] = newResult;
  else list.push(newResult);
  return list;
}

async function _scanNextInner() {
  const state = await getState();
  if (!state.scanRunning) return;

  if (state.scanIndex >= (state.scanQueue || []).length) {
    if (state.scanTabId) {
      // We no longer close the tab automatically so the user can see the final page
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIF_ICON,
      title: 'Deep Profile Scanner',
      message: 'Scanner has finished processing all profiles in the queue.'
    });

    await setState({ scanRunning: false, scanStatus: "done", scanTabId: null, scanEndedAt: Date.now() });
    return;
  }

  const url = state.scanQueue[state.scanIndex];
  let skipDelay = false;
  await setState({
    scanStatus: `Scanning profile ${state.scanIndex + 1} of ${state.scanQueue.length}`
  });

  // 90-second overall timeout per profile — auto-skip if not fully processed
  const PROFILE_TIMEOUT_MS = 90000;
  let profileTimedOut = false;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    _cancelCurrentScan = () => { reject(new Error('PROFILE_MANUAL_SKIP')); };
    timeoutId = setTimeout(() => {
      profileTimedOut = true;
      reject(new Error('PROFILE_TIMEOUT'));
    }, PROFILE_TIMEOUT_MS);
  });

  let currentName = getNameForUrl(url, state.rows);
  let currentLink = url;

  try {
    await Promise.race([timeoutPromise, (async () => {
      // 0. Parse the actual base profile URL from the given string
      const profileUrlMatch = url.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/in\/[^/?]+)/);
      const baseProfileUrl = profileUrlMatch ? profileUrlMatch[1] + '/' : url.split('?')[0];

      // 1. Get or Create a dedicated Scanner Tab
      let scanTab = null;
      if (state.scanTabId) {
        try { scanTab = await chrome.tabs.get(state.scanTabId); } catch (e) {}
      }

      if (!scanTab) {
        scanTab = await chrome.tabs.create({ url: baseProfileUrl, active: false });
        await setState({ scanTabId: scanTab.id });
      } else {
        await chrome.tabs.update(scanTab.id, { url: baseProfileUrl });
      }

      const tabId = scanTab.id;

      async function isContentLoaded(tId, loadType) {
        try {
          // For main profile, check for headline. For activity, check for the feed container or empty state msg.
          const selector = loadType === 'activity'
            ? '.profile-creator-shared-feed-update__container, .feed-shared-update-v2, .occludable-update, .artdeco-empty-state'
            : 'h1.text-heading-xlarge, .ph5 h1, .pv-top-card h1, main h1';

          const res = await chrome.scripting.executeScript({
            target: { tabId: tId },
            func: (sel) => !!document.querySelector(sel) || document.body.innerText.includes("hasn't posted"),
            args: [selector]
          });
          return res[0]?.result === true;
        } catch(e) { return false; }
      }

      // Helper: wait up to maxWaitMs for the specific content to become visible
      async function waitForLoad(maxWaitMs, loadType) {
        for (let i = 0; i < maxWaitMs / 500; i++) {
          await sleep(500);
          try {
            const t = await chrome.tabs.get(tabId);
            if (await isContentLoaded(tabId, loadType)) return true;
            if (t.status === 'complete') return true;
          } catch (e) { return false; /* Tab closed */ }
        }
        return false;
      }

      // Helper: hard reload (bypass cache = Ctrl+Shift+R equivalent) then wait
      async function hardReloadAndWait(maxWaitMs, loadType) {
        try { await chrome.tabs.reload(tabId, { bypassCache: true }); } catch(e){}
        return await waitForLoad(maxWaitMs, loadType);
      }

      await setState({ scanStatus: `Loading profile ${state.scanIndex + 1} of ${state.scanQueue.length}` });
      let loaded = await waitForLoad(15000, 'main'); // 15s first attempt

      if (!loaded) {
        // Hard reload (bypass cache) at 15s mark
        await setState({ scanStatus: `Slow load — hard reloading profile ${state.scanIndex + 1} (cache cleared)...` });
        loaded = await hardReloadAndWait(15000, 'main'); // 15s second attempt = 30s total

        if (!loaded) {
          // Still stuck after 30s: auto-skip this profile instead of pausing the whole scan
          throw new Error('AUTO_SKIP_LOAD_FAIL');
        }
      }

      await setState({ scanStatus: `Scanning profile ${state.scanIndex + 1} of ${state.scanQueue.length}` });

      // Poll tab URL to wait for LinkedIn's Single Page App router to redirect UID -> Public Name
      let finalUrl = baseProfileUrl;
      for (let i = 0; i < 20; i++) { // Max wait 10 seconds
        await sleep(500);
        try {
          const loadedTab = await chrome.tabs.get(tabId);
          // Grab the name from the tab title as soon as it's available — survives
          // URN URLs (/in/<leadId>) and manual-paste scans where state.rows is empty.
          const tn = nameFromTitle(loadedTab?.title);
          if (tn && !currentName) currentName = tn;
          if (loadedTab && loadedTab.url && loadedTab.url !== baseProfileUrl && !loadedTab.url.includes('linkedin.com/feed')) {
            finalUrl = loadedTab.url;
            break;
          }
        } catch (e) {
          await setState({ scanRunning: false, scanStatus: "error: Scanner tab was closed", scanEndedAt: Date.now() });
          return;
        }
      }
      // Add a small buffer after the redirect is detected to allow DOM to render
      await sleep(1500);
      if (!currentName) {
        try { currentName = nameFromTitle((await chrome.tabs.get(tabId))?.title) || currentName; } catch (e) {}
      }

      const finalProfileMatch = finalUrl.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/in\/[^/?]+)/);
      let finalPublicUrl = finalProfileMatch ? finalProfileMatch[1] + '/' : finalUrl.split('?')[0];

      // Ensure trailing slash for activity link generation
      if (!finalPublicUrl.endsWith('/')) {
        finalPublicUrl += '/';
      }
      currentLink = finalPublicUrl; // Update currentLink after final URL is determined

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content_profile.js']
        });
      } catch(e) {}

      let mainData = { name: 'Unknown', connectionCount: '', connectionCountInt: 0, isPremium: false };
      try {
        const res = await sendToTab({id: tabId}, { type: 'EXTRACT_PROFILE_MAIN' });
        if (res?.ok && res.data) {
          mainData = res.data;
          if (typeof mainData.connectionCount === 'string' && mainData.connectionCount.includes('500+')) {
            mainData.connectionCountInt = Math.max(mainData.connectionCountInt || 0, 500);
          }
          // Use extracted name if found, otherwise keep the one we found earlier
          if (mainData.name) {
            currentName = mainData.name;
          } else {
            mainData.name = currentName;
          }
        }
      } catch (e) {}

      const minConn = state.scanMinConnections || 0;
      let status = 'inactive';
      let finalActivityTime = '';
      let finalActivityType = '';

      let bestAgeDays = Infinity;

      const isActivityUrlGiven = url.includes('/recent-activity');
      let checkActivity = false;

      if (mainData.connectionCountInt >= 5000) {
        status = 'active'; // 5000+ connections/followers: treat as active, skip activity checks
        checkActivity = false;
        finalActivityTime = 'N/A';
        finalActivityType = '5000+';
      } else if (!isActivityUrlGiven && mainData.connectionCountInt < minConn) {
        status = 'inactive'; // Not enough connections
        checkActivity = false;
        finalActivityTime = 'N/A';
        finalActivityType = 'N/A';
      } else if (mainData.isPremium) {
        status = 'active'; // Premium profiles are instantly active
        checkActivity = false;
        finalActivityTime = 'N/A';
        finalActivityType = 'Premium';
      } else {
        checkActivity = true; // Enough connections, or activity URL was directly supplied
      }

      if (checkActivity) {
        // Check in specific explicit order: react > comment > post (shares)
        const activityTabs = isActivityUrlGiven ? [''] : ['reactions', 'comments', 'shares'];

        for (const actTab of activityTabs) {
          let activityUrl = url;
          if (!isActivityUrlGiven) {
            activityUrl = finalPublicUrl + `recent-activity/${actTab}/`;
          }

          await chrome.tabs.update(tabId, { url: activityUrl });

          let actLoaded = await waitForLoad(15000, 'activity');
          if (!actLoaded) {
            await setState({ scanStatus: `Slow activity load — hard reloading (cache cleared)...` });
            actLoaded = await hardReloadAndWait(15000, 'activity'); // 30s total
            if (!actLoaded) {
              // Hard throw out of the profile scan logic instead of just the tab
              throw new Error('AUTO_SKIP_ACTIVITY_FAIL');
            }
          }

          await sleep(1500); // Short wait for SPA to route; content_profile will poll the DOM

          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content_profile.js']
            });
          } catch(e) {
            // Tab was closed mid-scan
            await setState({ scanRunning: false, scanStatus: "error: Scanner tab was closed", scanEndedAt: Date.now() });
            return;
          }

          let actData = { lastActivityTime: '', lastActivityType: '', isPremium: false };
          try {
            const res = await sendToTab({id: tabId}, { type: 'EXTRACT_PROFILE_ACTIVITY' });
            if (res?.ok && res.data) actData = res.data;
          } catch (e) {}

          // Capture premium status from the first activity tab we visit
          if (actData.isPremium) {
            mainData.isPremium = true;
          }

          let isRecentEnough = false;
          let ageInMonths = Infinity;
          if (actData.lastActivityTime) {
            const t = actData.lastActivityTime;
            if (t.toLowerCase().includes('year')) {
              ageInMonths = parseInt(t) * 12;
            } else if (t.toLowerCase().includes('month')) {
              ageInMonths = parseInt(t);
            } else { // 'Hour', 'Day', 'Week', 'Minute', 'now' are all < 1 month
              ageInMonths = 0;
            }

            const minMonths = state.scanMinActivityMonths || 3;
            if (ageInMonths <= minMonths) {
              isRecentEnough = true;
            }
          }

          // Only update if this tab found MORE RECENT activity than previous tabs
          if (actData.lastActivityTime && timeStringToDays(actData.lastActivityTime) <= bestAgeDays) {
            bestAgeDays = timeStringToDays(actData.lastActivityTime);
            status = isRecentEnough ? 'active' : 'inactive';
            finalActivityTime = actData.lastActivityTime;
            finalActivityType = actData.lastActivityType;
          }

          // If we discover it's premium on the activity page, mark active and skip remaining
          if (mainData.isPremium) {
            status = 'active';
            finalActivityType = finalActivityType || 'Premium';
            break;
          }

          // If we found recent enough activity, mark active and skip remaining tabs
          if (status === 'active') {
            break;
          }

          // Small delay before navigating to the next activity tab
          await sleep(2000);
        }
      }

      let finalType = finalActivityType || 'None';
      let finalActivity = finalActivityTime || 'No activity';

      // 5. Save Result
      const newResult = {
        original_url: url,
        name: mainData.name || currentName || 'Unknown',
        profile_url: finalPublicUrl,
        status: status,
        is_premium: mainData.isPremium ? 'Yes' : 'No',
        connection_count: mainData.connectionCount || '0',
        activity_type: finalType,
        last_activity: finalActivity
      };

      const newState = await getState();
      if (!newState.scanRunning) return;

      const results = newState.scanResults || [];
      upsertResult(results, newResult);
      await incrementDailyScanned(1);

      await setState({
        scanResults: results,
        scanIndex: newState.scanIndex + 1,
        scanStartedAt: Date.now()
      });

    })()]); // end Promise.race

  } catch (err) {
    skipDelay = true;
    const s = await getState();
    if (!s.scanRunning) return;

    const failed = s.scanFailed || [];
    failed.push(url);

    const results = s.scanResults || [];
    upsertResult(results, {
      original_url: url, name: currentName, profile_url: currentLink,
      status: 'Skipped', is_premium: 'Skipped', connection_count: 'Skipped',
      activity_type: 'Skipped', last_activity: 'Skipped'
    });

    if (String(err).includes('PROFILE_TIMEOUT')) {
      log(`Profile ${state.scanIndex + 1} timed out after 90s, auto-skipping.`);
      if (!s.scanRunning) return;
      await setState({
        scanIndex: (s.scanIndex || 0) + 1,
        scanFailed: failed,
        scanResults: results,
        scanStatus: `Skipped profile ${state.scanIndex + 1} (timed out after 90s)`,
        scanStartedAt: Date.now()
      });
    } else if (String(err).includes('PROFILE_MANUAL_SKIP')) {
      log(`Profile ${state.scanIndex + 1} was manually skipped.`);
      if (!s.scanRunning) return;
      await setState({
        scanIndex: (s.scanIndex || 0) + 1,
        scanFailed: failed,
        scanResults: results,
        scanStatus: `Skipped profile ${state.scanIndex + 1} (manually skipped)`,
        scanStartedAt: Date.now()
      });
    } else if (String(err).includes('AUTO_SKIP_LOAD_FAIL')) {
      log(`Profile ${state.scanIndex + 1} failed to load after 30s, auto-skipping.`);
      if (!s.scanRunning) return;
      await setState({
        scanIndex: (s.scanIndex || 0) + 1,
        scanFailed: failed,
        scanResults: results,
        scanStatus: `Skipped profile ${state.scanIndex + 1} (failed to load after 30s)`,
        scanStartedAt: Date.now()
      });
    } else if (String(err).includes('AUTO_SKIP_ACTIVITY_FAIL')) {
      log(`Profile ${state.scanIndex + 1} activity tab failed to load after 30s, auto-skipping.`);
      if (!s.scanRunning) return;
      await setState({
        scanIndex: (s.scanIndex || 0) + 1,
        scanFailed: failed,
        scanResults: results,
        scanStatus: `Skipped profile ${state.scanIndex + 1} (activity tab failed after 30s)`,
        scanStartedAt: Date.now()
      });
    } else {
      log('Fatal error scanning profile', err);
      await setState({ scanIndex: (s.scanIndex || 0) + 1, scanFailed: failed, scanResults: results, scanStartedAt: Date.now() });
    }
  } finally {
    clearTimeout(timeoutId);
    _cancelCurrentScan = null;
  }

  // Check if the queue is fully processed
  const latestState = await getState();
  const isQueueDone = (latestState.scanIndex || 0) >= (latestState.scanQueue || []).length;

  if (isQueueDone) {
    // Immediately finalize — no delay, no extra loop iteration
    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIF_ICON,
      title: 'Deep Profile Scanner',
      message: 'Scanner has finished processing all profiles in the queue.'
    });
    await setState({ scanRunning: false, scanStatus: "done", scanTabId: null, scanEndedAt: Date.now() });
    return;
  }

  // Delay before next profile to avoid rate limits (Random 1-7s)
  if (!skipDelay) {
    const delayMs = Math.floor(Math.random() * 6000) + 1000;
    await setState({ scanStatus: `Waiting ${Math.round(delayMs/1000)}s...` });
    await sleep(delayMs);
  }

  // Schedule next profile scan via alarm so it works even when window is minimized.
  await scheduleNextScan();
}

async function downloadScannerData(results) {
  const header = ['Name', 'Profile URL', 'Status', 'Is Premium?', 'Number of Connections', 'Last Activity'];
  const esc = (v) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[,\"\n\r]/.test(s) ? `"${s}"` : s;
  };
  const lines = [header.join(",")].concat(
    results.map((r) => [
      esc(r.name),
      esc(r.profile_url),
      esc(r.status),
      esc(r.is_premium),
      esc(r.connection_count),
      esc(r.last_activity)
    ].join(","))
  );
  const csv = lines.join("\n");
  return downloadBlob(csv, 'text/csv;charset=utf-8', 'profile_scan_results.csv', true);
}

async function scheduleNextStep() {
  // Use a one-shot alarm so the step fires even if the window is minimized/pinned.
  // Chrome alarms fire reliably regardless of window focus or minimization.
  // Minimum delay is effectively ~1 second in practice for one-shot alarms.
  try {
    await chrome.alarms.clear("stepNow");
    chrome.alarms.create("stepNow", { delayInMinutes: 1 / 60 }); // ~1 second
  } catch (e) {
    // Fallback to setTimeout if alarms fail for any reason
    setTimeout(async () => {
      const s = await getState();
      if (s.running) await stepOnce();
    }, 500);
  }
}

async function scheduleNextScan() {
  // Use a one-shot alarm for the scanner loop too.
  try {
    await chrome.alarms.clear("scanNow");
    chrome.alarms.create("scanNow", { delayInMinutes: 1 / 60 }); // ~1 second
  } catch (e) {
    setTimeout(scanNext, 500);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Heartbeat alarm — fires every 30 seconds as a failsafe to restart stalled loops.
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
});

// Also create the heartbeat alarm when the service worker starts up (not just on install).
// This covers cases where the service worker is restarted by Chrome.
chrome.alarms.get("tick", (alarm) => {
  if (!alarm) {
    chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  }
});

// Alarm handler — drives both the main loop and the scanner loop.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tick") {
    // Heartbeat failsafe: restart any stalled loop.
    const s = await getState();
    if (s.running && !_stepping) await stepOnce();
    if (s.scanRunning && !_scanning) await scanNext();
    if (s.compScanRunning && !_compStepping) await compScanNext();
    return;
  }
  if (alarm.name === "stepNow") {
    const s = await getState();
    if (s.running) await stepOnce();
    return;
  }
  if (alarm.name === "scanNow") {
    const s = await getState();
    if (s.scanRunning) await scanNext();
    return;
  }
  if (alarm.name === "compScanNow") {
    const s = await getState();
    if (s.compScanRunning) await compScanNext();
    return;
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Offscreen-addressed messages are handled by offscreen.js, not here.
  if (msg?.target === 'offscreen-blob' || msg?.target === 'offscreen-revoke') return false;

  if (msg?.type === "CONVERT_TO_CSV") {
    sendResponse({ ok: true, csv: toCsv(msg.rows, msg.mode) });
    return false;
  }

  (async () => {
    if (msg.type === "OPEN_AND_START") {
      // Save current session to history before wiping
      const prev = await getState();
      if ((prev.rows || []).length > 0) {
        await pushHistory({ ts: Date.now(), kind: 'auto', mode: prev.mode || 'people', rows: prev.rows.length });
      }
      const mode = detectModeFromUrl(msg.url);
      const maxProfiles = msg.maxProfiles || null;
      let targetUrl = msg.url;
      let startPage = 1;

      try {
        const u = new URL(targetUrl);
        const pageVal = parseInt(u.searchParams.get('page'), 10);
        if (pageVal > 1) {
          startPage = pageVal;
        } else {
          u.searchParams.set('page', '1');
          targetUrl = u.toString();
          startPage = 1;
        }
      } catch (e) { }

      const tab = await chrome.tabs.create({ url: targetUrl });
      // pagesDone is tracked as "number of pages completed so far".
      // If we start on page 5, pagesDone should be 4, so the next scrape does page 5.
      await setState({ tabId: tab.id, mode, running: true, status: `running (opening tab at page ${startPage})`, pagesDone: startPage - 1, rows: [], seen: {}, maxProfiles, scrollSpeed: msg.scrollSpeed || 'fast', currentPageOnly: msg.currentPageOnly || false, deepFetch: msg.deepFetch || false, companyDeep: msg.companyDeep || false });
      // Give the new tab time to load before starting the loop
      setTimeout(() => scheduleNextStep(), 4000);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "START") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return sendResponse({ ok: false, error: "No active tab" });
      let targetUrl = tab.url || "";
      const mode = targetUrl.includes("/sales/search/company") ? "company" : "people";
      const maxProfiles = msg.maxProfiles || null;

      // If we are NOT paused, starting again implies a new session. We should archive the old one.
      const prev = await getState();
      let newRows = prev.rows || [];
      let newSeen = prev.seen || {};

      if (!prev.status?.startsWith('paused')) {
        if (newRows.length > 0) {
          await pushHistory({ ts: Date.now(), kind: 'auto', mode: prev.mode || 'people', rows: newRows.length });
        }
        newRows = [];
        newSeen = {};
      }

      let startPage = 1;

      try {
        const u = new URL(targetUrl);
        const pageVal = parseInt(u.searchParams.get('page'), 10);
        if (pageVal > 1) {
          startPage = pageVal;
        }
      } catch (e) { }

      await setState({ tabId: tab.id, mode, running: true, status: `running (starting on page ${startPage})`, pagesDone: startPage - 1, rows: newRows, seen: newSeen, maxProfiles, scrollSpeed: msg.scrollSpeed || 'fast', currentPageOnly: msg.currentPageOnly || false, deepFetch: msg.deepFetch || false, companyDeep: msg.companyDeep || false });
      sendResponse({ ok: true });
      // Start the loop asynchronously so we don't block the popup response
      scheduleNextStep();
      return;
    }

    if (msg.type === "PAUSE") {
      await setState({ running: false, status: "paused" });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "DOWNLOAD_FINAL") {
      const s = await getState();
      if (s.status !== "done_no_next" && s.status !== "done_reached_max_profiles" && s.status !== "done_current_page_only") {
        sendResponse({ ok: false, error: "Not finished yet" });
        return;
      }
      try {
        const id = await downloadFinalData(msg.format || 'csv');
        sendResponse({ ok: true, downloadId: id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg.type === "DOWNLOAD_PARTIAL") {
      const s = await getState();
      if (!s.rows || s.rows.length === 0) {
        sendResponse({ ok: false, error: "No rows yet" });
        return;
      }
      try {
        const id = await downloadPartialData(msg.format || 'csv');
        sendResponse({ ok: true, downloadId: id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg.type === "RESET") {
      // Save current session to history before wiping
      const prev = await getState();
      if ((prev.rows || []).length > 0) {
        await pushHistory({ ts: Date.now(), kind: 'auto', mode: prev.mode || 'people', rows: prev.rows.length });
      }
      await chrome.storage.local.remove(STATE_KEY);
      try { chrome.action.setBadgeText({ text: '' }); } catch(err){}
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "HISTORY") {
      const h = await getHistory();
      sendResponse({ ok: true, history: h });
      return;
    }

    if (msg.type === "HISTORY_CLEAR") {
      await chrome.storage.local.remove(HISTORY_KEY);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "DOWNLOAD_SHOW") {
      const id = msg.downloadId;
      if (typeof id !== 'number') {
        sendResponse({ ok: false, error: 'downloadId required' });
        return;
      }
      chrome.downloads.show(id);
      sendResponse({ ok: true });
      return;
    }

    // ─── Profile Scanner Endpoints ───
    if (msg.type === "START_SCAN") {
      let urls = msg.urls || [];
      if (urls.length === 0) return sendResponse({ ok: false, error: "No URLs provided" });

      // -- Daily limit: max 100 --
      const dailyCount = await getDailyScannedCount();
      const remaining = Math.max(0, 100 - dailyCount);
      if (!msg.force) {
        if (remaining === 0) return sendResponse({ ok: false, error: 'Daily limit reached (100 profiles/day). Please try again tomorrow.' });
        if (urls.length > remaining) urls = urls.slice(0, remaining);
      }

      await setState({
        scanQueue: urls,
        scanMinConnections: msg.minConnections || 0,
        scanMinActivityMonths: msg.minActivityMonths || 3,
        scanResults: [],
        scanFailed: [],
        scanIndex: 0,
        scanRunning: true,
        scanStatus: "Starting scan...",
        scanStartedAt: Date.now(),
        scanGlobalStartedAt: Date.now(),
        scanEndedAt: null
      });

      sendResponse({ ok: true });
      scanNext();
      return;
    }

    if (msg.type === "PAUSE_SCAN") {
      await setState({ scanRunning: false, scanStatus: "paused", scanEndedAt: Date.now() });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SKIP_SCAN") {
      if (_cancelCurrentScan) {
        _cancelCurrentScan(); // This will abort the current iteration immediately
      } else {
        // If it was idle, just bump index manually
        const s = await getState();
        if (!s.scanQueue || s.scanQueue.length === 0) {
          sendResponse({ ok: false, error: 'No scan in progress' });
          return;
        }
        const currentUrl = (s.scanQueue || [])[s.scanIndex || 0];
        const failed = s.scanFailed || [];
        const results = s.scanResults || [];

        if (currentUrl) {
          failed.push(currentUrl);
          upsertResult(results, {
            original_url: currentUrl, name: getNameForUrl(currentUrl, s.rows), profile_url: currentUrl,
            status: 'Skipped', is_premium: 'Skipped', connection_count: 'Skipped',
            activity_type: 'Skipped', last_activity: 'Skipped'
          });
        }

        const newIndex = (s.scanIndex || 0) + 1;
        if (newIndex >= (s.scanQueue || []).length) {
          await setState({ scanRunning: false, scanStatus: 'done', scanIndex: newIndex, scanFailed: failed, scanResults: results, scanEndedAt: Date.now() });
        } else {
          await setState({ scanIndex: newIndex, scanStatus: `Skipped to profile ${newIndex + 1}`, scanRunning: true, scanFailed: failed, scanResults: results, scanStartedAt: Date.now() });
          scheduleNextScan();
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "RETRY_FAILED") {
      const s = await getState();
      const failedUrls = s.scanFailed || [];
      if (failedUrls.length === 0) {
        sendResponse({ ok: false, error: 'No failed profiles to retry' });
        return;
      }
      await setState({
        scanQueue: failedUrls,
        scanFailed: [],
        scanIndex: 0,
        scanRunning: true,
        scanStatus: `Retrying ${failedUrls.length} failed profile(s)...`,
        scanStartedAt: Date.now()
      });
      sendResponse({ ok: true });
      scanNext();
      return;
    }

    if (msg.type === "STOP_SCAN") {
      const s = await getState();
      if (s.scanTabId) {
        // Optional: we can leave the tab open on stop as well
      }
      await setState({
        scanRunning: false,
        scanStatus: "Stopped",
        scanQueue: [],
        scanIndex: 0,
        scanTabId: null,
        scanEndedAt: Date.now()
      });
      if (_cancelCurrentScan) _cancelCurrentScan();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "RESET_SCAN") {
      const s = await getState();
      if (s.scanTabId) {
        // Optional: we can leave the tab open on stop as well
      }
      await setState({
        scanRunning: false,
        scanStatus: "Ready",
        scanQueue: [],
        scanResults: [],
        scanFailed: [],
        scanIndex: 0,
        scanStartedAt: null,
        scanTabId: null
      });
      if (_cancelCurrentScan) _cancelCurrentScan();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "DOWNLOAD_SCAN") {
      const s = await getState();
      if (!s.scanResults || s.scanResults.length === 0) {
        sendResponse({ ok: false, error: "No scan results yet" });
        return;
      }
      try {
        const id = await downloadScannerData(s.scanResults);
        sendResponse({ ok: true, downloadId: id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg.type === "STATUS") {
      const s = await getState();
      const dailyCount = await getDailyScannedCount();
      sendResponse({ ok: true, state: s, dailyCount });
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ════ COMPANY SCANNER MESSAGE HANDLERS ═══════════════════════
    // ════════════════════════════════════════════════════════════════════

    if (msg.type === "GET_COMP_SCAN_STATUS") {
      const s = await getState();
      sendResponse({
        ok: true,
        compScanRunning: s.compScanRunning || false,
        compScanStatus: s.compScanStatus || 'Ready',
        compScanQueue: s.compScanQueue || [],
        compScanIndex: s.compScanIndex || 0,
        compScanResults: s.compScanResults || [],
        compScanStartedAt: s.compScanStartedAt || null,
        compScanGlobalStartedAt: s.compScanGlobalStartedAt || null,
        compScanEndedAt: s.compScanEndedAt || null,
        compScanTabId: s.compScanTabId || null
      });
      return;
    }

    if (msg.type === "START_COMPANY_SCAN") {
      const urls = msg.urls || [];
      if (urls.length === 0) {
        sendResponse({ ok: false, error: "No URLs provided" });
        return;
      }
      const s = await getState();
      if (s.compScanRunning) {
        sendResponse({ ok: false, error: "Company scan already running" });
        return;
      }
      await setState({
        compScanRunning: true,
        compScanStatus: 'Starting...',
        compScanQueue: urls,
        compScanIndex: 0,
        compScanResults: [],
        compScanFailed: [],
        compScanStartedAt: Date.now(),
        compScanGlobalStartedAt: Date.now(),
        compScanEndedAt: null,
        compScanTabId: null
      });
      scheduleNextCompScan();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "PAUSE_COMPANY_SCAN") {
      await setState({ compScanRunning: false, compScanStatus: "paused", compScanEndedAt: Date.now() });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "STOP_COMPANY_SCAN") {
      await setState({
        compScanRunning: false,
        compScanStatus: "Stopped",
        compScanQueue: [],
        compScanIndex: 0,
        compScanTabId: null,
        compScanEndedAt: Date.now()
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "RESET_COMPANY_SCAN") {
      await setState({
        compScanRunning: false,
        compScanStatus: "Ready",
        compScanQueue: [],
        compScanResults: [],
        compScanFailed: [],
        compScanIndex: 0,
        compScanStartedAt: null,
        compScanGlobalStartedAt: null,
        compScanEndedAt: null,
        compScanTabId: null
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "RESUME_COMPANY_SCAN") {
      const s = await getState();
      if (s.compScanStatus !== 'paused') {
        sendResponse({ ok: false, error: "Not paused" });
        return;
      }
      await setState({ compScanRunning: true, compScanStatus: 'Resuming...', compScanStartedAt: Date.now() });
      scheduleNextCompScan();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "DOWNLOAD_COMPANY_SCAN") {
      const s = await getState();
      if (!s.compScanResults || s.compScanResults.length === 0) {
        sendResponse({ ok: false, error: "No company scan results yet" });
        return;
      }
      try {
        const id = await downloadCompanyScannerData(s.compScanResults);
        sendResponse({ ok: true, downloadId: id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();

  return true;
});

// ══════════════════════════════════════════════════════════════════════
// ════ COMPANY SCANNER CORE LOGIC ══════════════════════════
// ═════════════════════════════════════════════════════════════════════

let _compStepping = false;

async function scheduleNextCompScan() {
  try {
    await chrome.alarms.clear("compScanNow");
    chrome.alarms.create("compScanNow", { delayInMinutes: 1 / 60 }); // ~1 second
  } catch (e) {
    setTimeout(compScanNext, 500);
  }
}

async function compScanNext() {
  if (_compStepping) return;
  _compStepping = true;
  try {
    await _compScanNextInner();
  } catch (e) {
    log('Company scan step error:', e);
  } finally {
    _compStepping = false;
  }

  const s = await getState();
  if (s.compScanRunning && s.compScanIndex < (s.compScanQueue || []).length) {
    // Small random jitter between companies so requests don't look machine-timed.
    // ponytail: was 3-8s; bump back up if LinkedIn starts throwing checkpoints
    const delayMs = 500 + Math.floor(Math.random() * 1000);
    await sleep(delayMs);
    await scheduleNextCompScan();
  }
}

async function _compScanNextInner() {
  const state = await getState();
  if (!state.compScanRunning) return;

  if (state.compScanIndex >= (state.compScanQueue || []).length) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIF_ICON,
      title: 'Company Scanner',
      message: 'Company scanner has finished processing all companies.'
    });
    await setState({ compScanRunning: false, compScanStatus: "done", compScanTabId: null, compScanEndedAt: Date.now() });
    return;
  }

  const url = state.compScanQueue[state.compScanIndex];

  await setState({
    compScanStatus: `Scanning company ${state.compScanIndex + 1} of ${state.compScanQueue.length}`
  });

  // 60-second timeout per company
  const COMP_TIMEOUT_MS = 60000;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('COMPANY_TIMEOUT')), COMP_TIMEOUT_MS);
  });

  try {
    await Promise.race([timeoutPromise, (async () => {
      // Normalize URL: convert Sales Navigator company URLs to public LinkedIn URLs
      let companyUrl = url;
      // Sales Nav format: https://www.linkedin.com/sales/company/12345
      // Public format: https://www.linkedin.com/company/name/
      // We'll navigate to whatever they pasted — the content script handles both

      // Ensure it has /about/ suffix to get the details section
      if (!companyUrl.includes('/about')) {
        companyUrl = companyUrl.replace(/\/+$/, '') + '/about/';
      }

      // Get or create tab
      let scanTab = null;
      if (state.compScanTabId) {
        try { scanTab = await chrome.tabs.get(state.compScanTabId); } catch (e) {}
      }

      // Remember the URL we're navigating away from, so we can tell when the
      // new navigation has committed (tab.url flips to the new page).
      let beforeUrl = '';
      if (!scanTab) {
        scanTab = await chrome.tabs.create({ url: companyUrl, active: false });
        await setState({ compScanTabId: scanTab.id });
      } else {
        beforeUrl = scanTab.url || '';
        await chrome.tabs.update(scanTab.id, { url: companyUrl });
      }

      const tabId = scanTab.id;

      // Wait only until the navigation COMMITS (url switches to the new company) —
      // not for the full page load. The content script polls the DOM itself and
      // returns as soon as the info is visible.
      // ponytail: was 15s status==='complete' poll + fixed 3s SPA sleep
      await setState({ compScanStatus: `Loading company ${state.compScanIndex + 1} of ${state.compScanQueue.length}` });

      for (let i = 0; i < 27; i++) { // Max ~8s for the navigation to commit
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.url && t.url !== beforeUrl && t.url.includes('linkedin.com')) break;
        } catch (e) {
          await setState({ compScanRunning: false, compScanStatus: "error: Tab closed", compScanEndedAt: Date.now() });
          return;
        }
        await sleep(300);
      }

      await setState({ compScanStatus: `Extracting company ${state.compScanIndex + 1} of ${state.compScanQueue.length}` });

      // Inject content script (retry briefly — injection can race the commit)
      for (let i = 0; i < 10; i++) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content_company_profile.js']
          });
          break;
        } catch (e) {
          if (i === 9) log('Failed to inject company content script:', e);
          await sleep(300);
        }
      }

      // Extract data
      let compData = {};
      try {
        const res = await sendToTab({ id: tabId }, { type: 'EXTRACT_COMPANY_MAIN' });
        if (res?.ok && res.data) compData = res.data;
      } catch (e) {
        log('Company extraction error:', e);
      }

      // Build result
      const newResult = {
        original_url: url,
        companyName: compData.companyName || '',
        website: compData.website || '',
        industry: compData.industry || '',
        companySize: compData.companySize || '',
        headquarters: compData.headquarters || '',
        founded: compData.founded || '',
        companyType: compData.companyType || '',
        description: compData.description || '',
        specialties: compData.specialties || '',
        linkedinUrl: compData.linkedinUrl || url,
        followerCount: compData.followerCount || '',
        employeesOnLinkedIn: compData.employeesOnLinkedIn || ''
      };

      // Save result
      const newState = await getState();
      if (!newState.compScanRunning) return;

      const results = newState.compScanResults || [];
      upsertResult(results, newResult);

      await setState({
        compScanResults: results,
        compScanIndex: newState.compScanIndex + 1,
        compScanStartedAt: Date.now()
      });

    })()]);

    clearTimeout(timeoutId);

  } catch (err) {
    clearTimeout(timeoutId);
    log('Company scan error for', url, err.message);

    const s = await getState();
    if (!s.compScanRunning) return;

    const failed = s.compScanFailed || [];
    failed.push(url);

    const results = s.compScanResults || [];
    upsertResult(results, {
      original_url: url,
      companyName: 'Error',
      website: '',
      industry: '',
      companySize: '',
      headquarters: '',
      founded: '',
      companyType: '',
      description: err.message || 'Timeout',
      specialties: '',
      linkedinUrl: url,
      followerCount: '',
      employeesOnLinkedIn: ''
    });

    await setState({
      compScanResults: results,
      compScanFailed: failed,
      compScanIndex: (s.compScanIndex || 0) + 1,
      compScanStartedAt: Date.now()
    });
  }
}

// Download company scanner results as CSV
async function downloadCompanyScannerData(results) {
  const headers = ['Company Name', 'Website', 'Industry', 'Company Size', 'Headquarters', 'Founded', 'Type', 'Description', 'Specialties', 'LinkedIn URL', 'Followers', 'Employees on LinkedIn', 'Original URL'];

  const escCsv = (v) => {
    const s = String(v || '').replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };

  const lines = [headers.join(',')];
  for (const r of results) {
    lines.push([
      escCsv(r.companyName),
      escCsv(r.website),
      escCsv(r.industry),
      escCsv(r.companySize),
      escCsv(r.headquarters),
      escCsv(r.founded),
      escCsv(r.companyType),
      escCsv(r.description),
      escCsv(r.specialties),
      escCsv(r.linkedinUrl),
      escCsv(r.followerCount),
      escCsv(r.employeesOnLinkedIn),
      escCsv(r.original_url)
    ].join(','));
  }

  const csv = lines.join('\n');
  const filename = `company_scan_${new Date().toISOString().split('T')[0]}.csv`;
  return downloadBlob(csv, 'text/csv;charset=utf-8', filename, true);
}
