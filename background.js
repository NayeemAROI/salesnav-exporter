const STATE_KEY = "salesnav_export_state";
const HISTORY_KEY = "salesnav_export_history";
const SCAN_DAILY_KEY = "salesnav_scan_daily";
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
      skippedLocked: 0,
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
      chrome.action.setBadgeBackgroundColor({ color: '#00d4ff' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {}

  // Tab Pinning logic
  try {
    // 1. Search Scraper pinning (running -> !running)
    if (next.tabId) {
      if (patch.running === true && !s.running) {
        chrome.tabs.update(next.tabId, { pinned: true }).catch(() => {});
      } else if (patch.running === false && s.running) {
        chrome.tabs.update(next.tabId, { pinned: false }).catch(() => {});
      }
    }
    // 2. Profile Scanner pinning (scanRunning -> !scanRunning)
    if (next.scanTabId) {
      if (patch.scanRunning === true && !s.scanRunning) {
        chrome.tabs.update(next.scanTabId, { pinned: true }).catch(() => {});
      } else if (patch.scanRunning === false && s.scanRunning) {
        chrome.tabs.update(next.scanTabId, { pinned: false }).catch(() => {});
      }
    }
  } catch (e) {}

  return next;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randPageDelayMs(speed) {
  switch (speed) {
    case 'safe':   return 8000 + Math.floor(Math.random() * 10000); // 8-18s
    case 'medium': return 4000 + Math.floor(Math.random() * 6000);  // 4-10s
    case 'fast':
    default:       return 1000 + Math.floor(Math.random() * 4000);  // 1-5s
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
  const mode = await inferModeFromTab(tab);
  const file = mode === 'company' ? 'content_company.js' : 'content_people.js';
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
      ? ["company_name", "linkedin_profile_url", "industry", "employees"]
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
    v = (v ?? "").toString();
    if (/[,\"\n\r]/.test(v)) return `"${v.replace(/\"/g, '""')}"`;
    return v;
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

async function ensureOffscreen() {
  // Some Chrome versions/environments do not support the offscreen API.
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error('chrome.offscreen API not available in this Chrome version');
  }

  // hasDocument() exists in newer Chromes; if missing, attempt create and ignore "already exists".
  let has = false;
  try {
    // @ts-ignore
    has = await chrome.offscreen.hasDocument?.();
  } catch {
    has = false;
  }
  if (has) return;

  try {
    // @ts-ignore
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Create blob URLs for CSV downloads from MV3 service worker.'
    });
  } catch (e) {
    const msg = String(e);
    // If it already exists, continue.
    if (!/exists|already/i.test(msg)) throw e;
  }
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

  let urlToDownload = null;

  // Prefer offscreen blob URL. Fall back to data URL.
  try {
    await ensureOffscreen();
    const resp = await chrome.runtime.sendMessage({ type: 'MAKE_BLOB_URL', data: content, mimeType });
    if (resp?.ok && resp.url) urlToDownload = resp.url;
  } catch (e) {
    log('offscreen unavailable, falling back to data URL:', String(e));
  }

  if (!urlToDownload) {
    // Fallback data URL
    urlToDownload = `data:${mimeType},` + encodeURIComponent(content);
  }

  const downloadId = await chrome.downloads.download({
    url: urlToDownload,
    filename,
    saveAs: false
  });

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
    extracted = await sendToTab(tab, { type: "EXTRACT_PAGE", options: { deepFetch: state.deepFetch } });
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

  // Track skipped locked profiles
  const pageLocked = extracted?.meta?.skippedLocked || 0;
  const totalLocked = (latest.skippedLocked || 0) + pageLocked;

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
    await setState({ rows, seen, skippedLocked: totalLocked, status: `running (page ${currentPage}, +${added}, total ${rows.length}, ${totalLocked} locked)` });
    if (rows.length > 0) {
      await pushHistory({ ts: Date.now(), kind: 'auto', mode: latest.mode || 'people', rows: rows.length });
    }
    
    let stopStatus = latest.currentPageOnly ? "done_current_page_only" : "done_reached_max_profiles";
    await setState({ running: false, status: stopStatus });
    return;
  }

  await setState({ rows, seen, skippedLocked: totalLocked, status: `running (page ${currentPage}, +${added}, total ${rows.length}, ${totalLocked} locked)` });

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

  const pageLoadDelay = speed === 'safe' ? 7000 : speed === 'medium' ? 5000 : 4000;
  await setState({ pagesDone: latest.pagesDone + 1, status: "running (waiting for next page to load)" });
  await sleep(pageLoadDelay);

  // Check before scheduling next iteration
  if (!await isStillRunning()) return;

  // Continue loop immediately instead of waiting for alarm
  scheduleNextStep();
}

/** Schedule the next stepOnce() call. Uses setTimeout to avoid blocking the service worker. */
// ═══════════════════════════════════════════════════
// DEEP PROFILE SCANNER LOGIC
// ═══════════════════════════════════════════════════
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
      iconUrl: 'icon128.png', // Assuming default extension icon
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
               mainData.connectionCountInt = 500;
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

      if (!isActivityUrlGiven && mainData.connectionCountInt < minConn) {
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
             
             // Helper: convert string to days for comparison
             function timeStringToDays(t) {
                 if (!t || t === 'now') return 0;
                 const num = parseInt(t) || 0;
                 const lower = t.toLowerCase();
                 if (lower.includes('minute')) return 0;
                 if (lower.includes('hour')) return 0;
                 if (lower.includes('day')) return num;
                 if (lower.includes('week')) return num * 7;
                 if (lower.includes('month')) return num * 30;
                 if (lower.includes('year')) return num * 365;
                 return 9999;
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
      iconUrl: 'icon128.png',
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
    v = (v ?? "").toString();
    if (/[,\"\n\r]/.test(v)) return `"${v.replace(/\"/g, '""')}"`;
    return v;
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
  
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: base64,
      filename: "profile_scan_results.csv",
      saveAs: true
    }, (id) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError.message);
      else resolve(id);
    });
  });
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
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Let offscreen document handle blob URL creation.
  if (msg?.type === 'MAKE_BLOB_URL') return false;

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
        // Always force start from page 1
        u.searchParams.set('page', '1');
        targetUrl = u.toString();
        startPage = 1;
      } catch (e) { }

      const tab = await chrome.tabs.create({ url: targetUrl });
      // pagesDone is tracked as "number of pages completed so far". 
      // If we start on page 5, pagesDone should be 4, so the next scrape does page 5.
      await setState({ tabId: tab.id, mode, running: true, status: `running (opening tab at page ${startPage})`, pagesDone: startPage - 1, rows: [], seen: {}, maxProfiles, skippedLocked: 0, scrollSpeed: msg.scrollSpeed || 'fast', currentPageOnly: msg.currentPageOnly || false, deepFetch: msg.deepFetch || false });
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
      let newLocked = prev.skippedLocked || 0;

      if (!prev.status?.startsWith('paused')) {
        if (newRows.length > 0) {
          await pushHistory({ ts: Date.now(), kind: 'auto', mode: prev.mode || 'people', rows: newRows.length });
        }
        newRows = [];
        newSeen = {};
        newLocked = 0;
      }

      let startPage = 1;
      let needsRedirect = false;

      try {
        const u = new URL(targetUrl);
        const originalPage = u.searchParams.get('page');
        
        // Always force start from page 1
        u.searchParams.set('page', '1');
        targetUrl = u.toString();
        startPage = 1;
        
        // If they weren't explicitly on page 1, we need to redirect them
        if (originalPage !== '1') {
          needsRedirect = true;
        }
      } catch (e) { }

      if (needsRedirect) {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await setState({ tabId: tab.id, mode, running: true, status: "running (redirecting to page 1)", pagesDone: 0, rows: newRows, seen: newSeen, maxProfiles, skippedLocked: newLocked, scrollSpeed: msg.scrollSpeed || 'fast', currentPageOnly: msg.currentPageOnly || false, deepFetch: msg.deepFetch || false });
        sendResponse({ ok: true });
        setTimeout(() => scheduleNextStep(), 4000);
        return;
      }

      await setState({ tabId: tab.id, mode, running: true, status: `running (starting on page ${startPage})`, pagesDone: startPage - 1, rows: newRows, seen: newSeen, maxProfiles, skippedLocked: newLocked, scrollSpeed: msg.scrollSpeed || 'fast', currentPageOnly: msg.currentPageOnly || false, deepFetch: msg.deepFetch || false });
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

      // -- Per-scan limit: max 50 --
      if (urls.length > 50) urls = urls.slice(0, 50);

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

    // ═══════════════════════════════════════════════════════════
    // ════ COMPANY SCANNER MESSAGE HANDLERS ═══════════════════
    // ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// ════ COMPANY SCANNER CORE LOGIC ═════════════════════════════
// ═══════════════════════════════════════════════════════════════

let _compStepping = false;

function scheduleNextCompScan() {
  setTimeout(() => compScanNext(), 500);
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
    // Random delay 3-8s between companies
    const delay = 3000 + Math.floor(Math.random() * 5000);
    setTimeout(() => compScanNext(), delay);
  }
}

async function _compScanNextInner() {
  const state = await getState();
  if (!state.compScanRunning) return;

  if (state.compScanIndex >= (state.compScanQueue || []).length) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
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

      if (!scanTab) {
        scanTab = await chrome.tabs.create({ url: companyUrl, active: false });
        await setState({ compScanTabId: scanTab.id });
      } else {
        await chrome.tabs.update(scanTab.id, { url: companyUrl });
      }

      const tabId = scanTab.id;

      // Wait for page to load
      await setState({ compScanStatus: `Loading company ${state.compScanIndex + 1} of ${state.compScanQueue.length}` });

      for (let i = 0; i < 30; i++) { // Max 15 seconds
        await sleep(500);
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.status === 'complete') break;
        } catch (e) {
          await setState({ compScanRunning: false, compScanStatus: "error: Tab closed", compScanEndedAt: Date.now() });
          return;
        }
      }

      // Extra wait for SPA to render
      await sleep(3000);

      await setState({ compScanStatus: `Extracting company ${state.compScanIndex + 1} of ${state.compScanQueue.length}` });

      // Inject content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content_company_profile.js']
        });
      } catch(e) {
        log('Failed to inject company content script:', e);
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
      results.push(newResult);

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
    results.push({
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
  const url = `data:text/csv;charset=utf-8,` + encodeURIComponent(csv);
  const filename = `company_scan_${new Date().toISOString().split('T')[0]}.csv`;

  const id = await chrome.downloads.download({ url, filename, saveAs: true });
  return id;
}
