/* ═══════════════════════════════════════════════════
 * LINKEDIN PROFILE SCRAPER (DEEP SCANNER)
 * Injected into: https://www.linkedin.com/in/*
 * ═══════════════════════════════════════════════════ */

if (!window._salesNavProfileScannerInstalled) {
window._salesNavProfileScannerInstalled = true;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 1. Main Profile Page Extraction ───
async function extractProfileMain() {
  await sleep(3000); // Give React time to render 

  let name = '';
  let connectionCount = '';
  let connectionCountInt = 0;
  let isPremium = false;
  let publicProfileUrl = '';

  try {
    // Retry finding the name for up to 4 seconds (handles slow React rendering)
    let nameEl = null;
    for (let i = 0; i < 16; i++) {
        nameEl = document.querySelector(
          'h1.text-heading-xlarge, ' + 
          '.ph5 h1, ' + 
          '.pv-top-card h1, ' + 
          'main h1, ' + 
          '[data-anonymize="person-name"], ' + 
          '.profile-topcard-person-entity__name, ' + 
          '.pv-top-card--list .text-heading-xlarge'
        );
        if (nameEl && nameEl.innerText.trim()) break;
        await sleep(250);
    }
    
    if (nameEl) name = nameEl.innerText.trim();

    // The connection count is often in a specific format like "500+ connections"
    const allText = document.body.innerText || '';
    const connMatch = allText.match(/([\d,]+\+?)\s+connections/i) || allText.match(/([\d,]+\+?)\s+followers/i);
    
    if (connMatch) {
      connectionCount = connMatch[1];
    } else {
      // Fallback selector
      const connEls = document.querySelectorAll('.t-bold');
      for (const el of connEls) {
        if (el.innerText.includes('500+')) {
          connectionCount = '500+';
          break;
        }
      }
    }

    if (connectionCount) {
      connectionCountInt = parseInt(connectionCount.replace(/,/g, '').replace(/\+/g, ''), 10) || 0;
    }

    // Premium is NOT detected here anymore.
    // It is detected on the Recent Activity page using a reliable, dedicated badge class.

    // Extract true public profile URL from the Contact Info link
    const contactOverlayLink = document.querySelector('a[href*="/overlay/contact-info"]');
    if (contactOverlayLink) {
       const rawHref = contactOverlayLink.getAttribute('href') || '';
       const publicMatch = rawHref.match(/(https:\/\/[A-Za-z]{2,3}\.linkedin\.com\/in\/[^/?]+)/);
       if (publicMatch) publicProfileUrl = publicMatch[1] + '/';
    }

  } catch (e) {
    console.warn("Main Profile Parse Error", e);
  }

  return { name, connectionCount, connectionCountInt, isPremium, publicProfileUrl };
}

// ═══════════════════════════════════════════════════
// HELPER: Decode LinkedIn Snowflake ID to timestamp
// LinkedIn activity URNs contain IDs where the first 41 bits = Unix epoch ms
// ═══════════════════════════════════════════════════
function decodeSnowflakeTimestamp(idStr) {
  try {
    const id = BigInt(idStr);
    // LinkedIn Snowflake: top 41 bits are timestamp in ms since a custom epoch
    // The epoch offset is approximately 1288834974657 (Twitter-compatible)
    const timestamp = Number(id >> 22n) + 1288834974657;
    const date = new Date(timestamp);
    // Sanity check: should be between 2010 and 2030
    if (date.getFullYear() >= 2010 && date.getFullYear() <= 2030) {
      return date;
    }
  } catch(e) {}
  return null;
}

function monthsAgo(date) {
  const now = new Date();
  return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = monthsAgo(date);
  const diffYears = Math.floor(diffMonths / 12);
  
  if (diffHours < 1) return 'now';
  if (diffHours < 24) return diffHours + (diffHours === 1 ? ' Hour' : ' Hours');
  if (diffDays < 7) return diffDays + (diffDays === 1 ? ' Day' : ' Days');
  if (diffWeeks < 5) return diffWeeks + (diffWeeks === 1 ? ' Week' : ' Weeks');
  if (diffMonths < 12) return diffMonths + (diffMonths === 1 ? ' Month' : ' Months');
  return diffYears + (diffYears === 1 ? ' Year' : ' Years');
}

// ─── 2. Recent Activity Feed Extraction ───
async function extractProfileActivity() {
  let feedFound = false;
  let isEmpty = false;
  
  // Wait up to 6 seconds for feed container or empty state to appear
  for (let i = 0; i < 12; i++) {
     if (document.querySelector('.profile-creator-shared-feed-update__container, .feed-shared-update-v2, .occludable-update, [data-urn^="urn:li:activity:"]')) {
       feedFound = true; break;
     }
     if (document.querySelector('.artdeco-empty-state')) {
       feedFound = true; isEmpty = true; break;
     }
     // Also check for "hasn't posted yet" or "No activity" text
     const bodyText = document.body.innerText || '';
     if (bodyText.includes("hasn't posted") || bodyText.includes('No posts') || bodyText.includes('No activity')) {
       feedFound = true; isEmpty = true; break;
     }
     await new Promise(r => setTimeout(r, 500));
  }

  let totalPosts = 0;
  let totalComments = 0;
  let totalReactions = 0;
  let isActive = false;
  let lastActivityTime = '';
  let lastActivityType = '';

  // ═══════════════════════════════════════════════
  // PREMIUM DETECTION — on the Activity page
  // The activity page renders a dedicated "PREMIUM" wordmark badge
  // with the class: span.pv-recent-activity-top-card__premium_wordmark
  // This is the most reliable indicator available.
  // We poll for up to 3 seconds because the badge may render slightly after the feed.
  // ═══════════════════════════════════════════════
  let isPremium = false;
  for (let i = 0; i < 6; i++) {
      // Strategy A: Specific class selector
      const premiumWordmark = document.querySelector(
          'span.pv-recent-activity-top-card__premium_wordmark, ' +
          '.pv-recent-activity-top-card__premium_wordmark, ' +
          '.pv-recent-activity-top-card__premium-wordmark, ' +
          '[class*="premium_wordmark"], ' +
          '[class*="premium-wordmark"]'
      );
      if (premiumWordmark) {
          isPremium = true;
          break;
      }
      
      // Strategy B: Look for any visible element whose text is literally "PREMIUM"
      const allSpans = document.querySelectorAll('.pv-recent-activity-top-card span, .profile-creator-shared-header span');
      for (const span of allSpans) {
          if (span.innerText.trim().toUpperCase() === 'PREMIUM') {
              isPremium = true;
              break;
          }
      }
      if (isPremium) break;
      
      await sleep(500);
  }

  if (isEmpty || !feedFound) {
      return { totalPosts, totalComments, totalReactions, isActive, lastActivityTime, lastActivityType, isPremium };
  }

  try {
    // Scroll slightly to trigger lazy-loaded feed elements just in case
    window.scrollBy(0, 500);
    await new Promise(r => setTimeout(r, 500));

    const updateEls = document.querySelectorAll('.profile-creator-shared-feed-update__container, .feed-shared-update-v2, .occludable-update, [data-urn^="urn:li:activity:"]');
    
    // Deduplicate: skip child elements if their parent is also in the set
    const uniqueEls = [];
    const elSet = new Set(updateEls);
    for (const el of updateEls) {
        let dominated = false;
        let parent = el.parentElement;
        while (parent) {
            if (elSet.has(parent)) { dominated = true; break; }
            parent = parent.parentElement;
        }
        if (!dominated) uniqueEls.push(el);
    }

    // Helper: convert a time string like "2 Months" to a numeric age in days for comparison
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
        return 9999; // unknown = very old
    }

    let bestAgeDays = Infinity;

    for (const el of uniqueEls) {
        let currentType = 'Post';
        
        // Classify activity type: check the element's top text for clues
        const href = window.location.href;
        if (href.includes('/comments/')) {
            currentType = 'Comment';
            totalComments++;
        } else if (href.includes('/reactions/')) {
            currentType = 'Reaction';
            totalReactions++;
        } else if (href.includes('/shares/')) {
            currentType = 'Post';
            totalPosts++;
        } else {
            let typeText = '';
            const headerEl = el.querySelector('.update-components-header__text-wrapper, .update-components-header__text-view, .update-components-header, .update-components-actor__description, .feed-shared-header');
            if (headerEl) {
                typeText = headerEl.innerText.toLowerCase();
            }
            if (!typeText) {
                typeText = (el.innerText || '').substring(0, 300).toLowerCase();
            }

            if (typeText.match(/\bcommented\b|\breplied\b/)) {
                totalComments++;
                currentType = 'Comment';
            } else if (typeText.match(/\bliked\b|\breacted\b|\bcelebrated\b|\bfinds this\b/)) {
                totalReactions++;
                currentType = 'Reaction';
            } else if (typeText.match(/\breposted\b|\bshared\b/)) {
                totalPosts++;
                currentType = 'Repost';
            } else {
                totalPosts++;
                currentType = 'Post';
            }
        }

        let currentTime = '';
        let currentDate = null;

        // STRATEGY 1: HTML5 <time datetime="..."> element
        const timeEl = el.querySelector('time[datetime]');
        if (timeEl) {
            const isoStr = timeEl.getAttribute('datetime');
            const parsed = new Date(isoStr);
            if (!isNaN(parsed.getTime())) {
                currentDate = parsed;
                currentTime = formatTimeAgo(parsed);
            }
        }

        // STRATEGY 2: Snowflake ID from data-urn
        if (!currentDate) {
            const urn = el.getAttribute('data-urn') || '';
            const urnMatch = urn.match(/activity:(\d{15,20})/);
            if (urnMatch) {
                const decoded = decodeSnowflakeTimestamp(urnMatch[1]);
                if (decoded) {
                    currentDate = decoded;
                    currentTime = formatTimeAgo(decoded);
                }
            }
        }

        // STRATEGY 3: Activity link Snowflake IDs
        if (!currentDate) {
            const activityLinks = el.querySelectorAll('a[href*="activity:"]');
            for (const link of activityLinks) {
                const hrefStr = link.getAttribute('href') || '';
                const idMatch = hrefStr.match(/activity[:\-](\d{15,20})/);
                if (idMatch) {
                    const decoded = decodeSnowflakeTimestamp(idMatch[1]);
                    if (decoded) {
                        currentDate = decoded;
                        currentTime = formatTimeAgo(decoded);
                        break;
                    }
                }
            }
        }

        // STRATEGY 4: Relative time text parsing
        if (!currentTime) {
            const headerBlock = el.querySelector('.update-components-actor, .update-components-header');
            const rawText = (headerBlock ? headerBlock.innerText : el.innerText.substring(0, 400)).toLowerCase();
            
            const timeMatch = rawText.match(/\b(\d+)\s*(mo|yr|month|year|week|day|hour|min|sec)s?\b/i) || 
                             rawText.match(/\b(\d+)\s*([hdws])\b/i) ||
                             rawText.match(/\b(now)\b/i);
            
            if (timeMatch) {
                if (timeMatch[1] === 'now') {
                    currentTime = 'now';
                } else {
                    const val = parseInt(timeMatch[1]);
                    const unit = timeMatch[2].toLowerCase();
                    if (unit.startsWith('min') || unit === 'm' || unit.startsWith('sec') || unit === 's') currentTime = val + (val === 1 ? ' Minute' : ' Minutes');
                    else if (unit.startsWith('hour') || unit === 'h') currentTime = val + (val === 1 ? ' Hour' : ' Hours');
                    else if (unit.startsWith('day') || unit === 'd') currentTime = val + (val === 1 ? ' Day' : ' Days');
                    else if (unit.startsWith('week') || unit === 'w') currentTime = val + (val === 1 ? ' Week' : ' Weeks');
                    else if (unit.startsWith('month') || unit === 'mo') currentTime = val + (val === 1 ? ' Month' : ' Months');
                    else if (unit.startsWith('year') || unit === 'yr') currentTime = val + (val === 1 ? ' Year' : ' Years');
                }
            }
        }

        // Keep the MOST RECENT activity (smallest age in days)
        if (currentTime) {
            const ageDays = timeStringToDays(currentTime);
            if (ageDays < bestAgeDays) {
                bestAgeDays = ageDays;
                lastActivityTime = currentTime;
                lastActivityType = currentType;
            }
        }
    }
  } catch (e) {
      console.warn("Activity Feed Parse Error", e);
  }
  // FALLBACK: If we found feed items but couldn't extract a timestamp from any of them,
  // try to grab the visible relative time from the first post's actor line on the page.
  if (!lastActivityTime && feedFound) {
      const allSpans = document.querySelectorAll('span.visually-hidden, span[aria-hidden="true"], .update-components-actor__sub-description span');
      for (const span of allSpans) {
          const t = (span.innerText || '').trim().toLowerCase();
          const m = t.match(/^(\d+)(mo|yr|h|d|w|m|now)/i);
          if (m) {
              if (m[1] === 'now') {
                  lastActivityTime = 'now';
              } else {
                  const val = parseInt(m[1]);
                  const unit = m[2];
                  if (unit === 'm') lastActivityTime = val + (val === 1 ? ' Minute' : ' Minutes');
                  else if (unit === 'h') lastActivityTime = val + (val === 1 ? ' Hour' : ' Hours');
                  else if (unit === 'd') lastActivityTime = val + (val === 1 ? ' Day' : ' Days');
                  else if (unit === 'w') lastActivityTime = val + (val === 1 ? ' Week' : ' Weeks');
                  else if (unit === 'mo') lastActivityTime = val + (val === 1 ? ' Month' : ' Months');
                  else if (unit === 'yr') lastActivityTime = val + (val === 1 ? ' Year' : ' Years');
              }
              lastActivityType = lastActivityType || 'Post';
              break;
          }
      }
  }

  return { totalPosts, totalComments, totalReactions, isActive, lastActivityTime, lastActivityType, isPremium };
}

// ─── Message Listener ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXTRACT_PROFILE_MAIN') {
    (async () => {
      try {
        const data = await extractProfileMain();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; 
  }
  
  if (msg.type === 'EXTRACT_PROFILE_ACTIVITY') {
    (async () => {
      try {
        const data = await extractProfileActivity();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

} // End of Injection Guard
