/* ═══════════════════════════════════════════════════
 * LINKEDIN COMPANY PAGE SCRAPER (DEEP COMPANY SCANNER)
 * Injected into: https://www.linkedin.com/company/*
 * ═══════════════════════════════════════════════════ */

if (!window._salesNavCompanyProfileScannerInstalled) {
window._salesNavCompanyProfileScannerInstalled = true;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main Company Page Extraction ───
async function extractCompanyMain() {
  await sleep(3000); // Give React time to render

  let companyName = '';
  let website = '';
  let industry = '';
  let companySize = '';
  let headquarters = '';
  let founded = '';
  let companyType = '';
  let description = '';
  let specialties = '';
  let linkedinUrl = '';
  let followerCount = '';
  let employeesOnLinkedIn = '';

  try {
    // ─── Company Name ───
    // Try multiple selectors for the company name
    let nameEl = null;
    for (let i = 0; i < 16; i++) {
      nameEl = document.querySelector(
        'h1.org-top-card-summary__title, ' +
        'h1.t-24, ' +
        '.org-top-card-summary-info-list + h1, ' +
        'main h1, ' +
        '.top-card-layout__title, ' +
        '[data-anonymize="company-name"], ' +
        'h1'
      );
      if (nameEl && nameEl.innerText.trim()) break;
      await sleep(250);
    }
    if (nameEl) companyName = nameEl.innerText.trim();

    // ─── LinkedIn URL ───
    linkedinUrl = window.location.href.split('?')[0];
    if (!linkedinUrl.endsWith('/')) linkedinUrl += '/';

    // ─── About / Description Section ───
    // The "About" section typically contains the description
    const aboutSection = document.querySelector(
      '.org-about-us-organization-description__text, ' +
      '[data-test-id="about-us__description"], ' +
      'section.org-about-module p, ' +
      '.break-words .org-top-card-summary__tagline, ' +
      '.org-page-details-module__card-spacing p'
    );
    if (aboutSection) {
      description = aboutSection.innerText.trim();
    }

    // ─── Try to extract from the "About" page details ───
    // LinkedIn company pages show details in a structured format
    const allText = document.body.innerText || '';

    // ─── Website ───
    // Look for external link in About section
    const websiteLink = document.querySelector(
      'a[data-test-id="about-us__website"] span, ' +
      '.org-about-us-company-module__company-page-url a, ' +
      '.org-about-company-module__company-page-url a, ' +
      'a[href*="company-website"], ' +
      '.link-without-visited-state[data-test-id="about-us__website"]'
    );
    if (websiteLink) {
      website = websiteLink.innerText?.trim() || websiteLink.href || '';
    }

    // ─── Parse structured detail items (dt/dd pairs) ───
    const dtElements = document.querySelectorAll('dt');
    for (const dt of dtElements) {
      const label = (dt.innerText || '').trim().toLowerCase();
      const dd = dt.nextElementSibling;
      if (!dd) continue;
      const value = dd.innerText?.trim() || '';

      if (label.includes('website') && !website) {
        website = value;
      } else if (label.includes('industry') && !industry) {
        industry = value;
      } else if (label.includes('company size') || label.includes('organization size')) {
        if (!companySize) companySize = value;
      } else if (label.includes('headquarters') || label.includes('location')) {
        if (!headquarters) headquarters = value;
      } else if (label.includes('founded')) {
        if (!founded) founded = value;
      } else if (label.includes('type')) {
        if (!companyType) companyType = value;
      } else if (label.includes('specialties') || label.includes('specialities')) {
        if (!specialties) specialties = value;
      }
    }

    // ─── Alternative: Parse from text blocks with labels ───
    // Some LinkedIn layouts use different structures
    const detailItems = document.querySelectorAll(
      '.org-about-company-module__company-info-item, ' +
      '.org-page-details__definition-term, ' +
      '.org-top-card-summary-info-list__info-item'
    );
    for (const item of detailItems) {
      const text = item.innerText?.trim() || '';
      const lower = text.toLowerCase();

      if (lower.includes('website') && !website) {
        const link = item.querySelector('a');
        if (link) website = link.href || link.innerText?.trim() || '';
      }
    }

    // ─── Fallback: Extract from page text using regex ───
    if (!industry) {
      const indMatch = allText.match(/(?:Industry|industry)\s*\n\s*(.+)/);
      if (indMatch) industry = indMatch[1].trim();
    }

    if (!companySize) {
      const sizeMatch = allText.match(/(?:Company size|Organization size)\s*\n\s*(.+)/i);
      if (sizeMatch) companySize = sizeMatch[1].trim();
    }

    if (!headquarters) {
      const hqMatch = allText.match(/(?:Headquarters|Location)\s*\n\s*(.+)/i);
      if (hqMatch) headquarters = hqMatch[1].trim();
    }

    if (!founded) {
      const foundedMatch = allText.match(/(?:Founded)\s*\n\s*(\d{4})/i);
      if (foundedMatch) founded = foundedMatch[1].trim();
    }

    if (!companyType) {
      const typeMatch = allText.match(/(?:Type)\s*\n\s*(.+)/i);
      if (typeMatch) {
        const val = typeMatch[1].trim();
        // Only accept if it looks like a company type
        if (/public|private|nonprofit|partnership|self-employed|government|educational/i.test(val)) {
          companyType = val;
        }
      }
    }

    if (!specialties) {
      const specMatch = allText.match(/(?:Specialties|Specialities)\s*\n\s*(.+)/i);
      if (specMatch) specialties = specMatch[1].trim();
    }

    // ─── Followers ───
    const followerMatch = allText.match(/([\d,]+)\s*followers/i);
    if (followerMatch) followerCount = followerMatch[1].replace(/,/g, '');

    // ─── Employees on LinkedIn ───
    const empMatch = allText.match(/([\d,]+)\s*(?:employees?\s+on\s+LinkedIn|associated\s+members)/i);
    if (empMatch) employeesOnLinkedIn = empMatch[1].replace(/,/g, '');

    // ─── Website cleanup ───
    if (website) {
      // Remove trailing "..." or whitespace
      website = website.replace(/…$/, '').replace(/\.\.\.$/, '').trim();
    }

  } catch (e) {
    console.warn("Company Profile Parse Error", e);
  }

  return {
    companyName,
    website,
    industry,
    companySize,
    headquarters,
    founded,
    companyType,
    description,
    specialties,
    linkedinUrl,
    followerCount,
    employeesOnLinkedIn
  };
}

// ─── Message Listener ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXTRACT_COMPANY_MAIN') {
    (async () => {
      try {
        const data = await extractCompanyMain();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }
});

} // end guard
