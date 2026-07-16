"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import NextLink from "next/link";
import {
  Users, ScanLine, Download, Play, Square, Trash2, Cookie,
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, Globe,
  FileSpreadsheet, FileJson, Search, Building2, Link, MapPin,
} from "lucide-react";
import styles from "./dashboard.module.css";

/* ── Types ── */
interface ProfileResult {
  original_url: string; name: string; profile_url: string;
  status: string; is_premium: string; connection_count: string;
  activity_type: string; last_activity: string;
}

interface LeadResult {
  full_name: string; first_name: string; last_name: string;
  linkedin_profile_url: string; sales_navigator_url: string;
  title: string; headline: string; company_name: string; company_url: string;
  industry: string; profile_location: string; connection_degree: string;
  is_premium: boolean; is_open_link: boolean; profile_picture_url: string;
}

interface CompanyResult {
  company_name: string; linkedin_company_url: string;
  industry: string; employees: string;
}

interface CompanyProfileResult {
  original_url: string; companyName: string; website: string; industry: string;
  companySize: string; headquarters: string; founded: string; companyType: string;
  description: string; specialties: string; linkedinUrl: string;
  followerCount: string; employeesOnLinkedIn: string; error?: string;
}

interface Location { lat: number | null; lng: number | null; }
interface MapsResult {
  title: string;
  placeId: string;
  address: string | null;
  location: Location;
  categories: string[];
  categoryName: string | null;
  totalScore: number | null;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  reviewsCount: number | null;
  url: string;
  price: string | null;
  imageUrl: string | null;
  website: string | null;
  phone: string | null;
  openingHours: Array<{ day: string; hours: string }>;
  description: string | null;
  neighborhood: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  state: string | null;
  countryCode: string | null;
  scrapedAt: string;
}

type AnyResult = ProfileResult | LeadResult | CompanyResult | CompanyProfileResult | MapsResult;
type TabId = "search" | "profile" | "company" | "maps";

/* ── Main Dashboard ── */
export default function DashboardClient() {
  const [activeTab, setActiveTab] = useState<TabId>("search");

  // Cookie state (shared)
  const [liAt, setLiAt] = useState("");
  const [jsessionId, setJsessionId] = useState("");
  const [showCookies, setShowCookies] = useState(false);
  const [cookieSaved, setCookieSaved] = useState(false);
  const [proxyCountry, setProxyCountry] = useState("bd");

  // Search scraper state
  const [searchUrl, setSearchUrl] = useState("");
  const [maxResults, setMaxResults] = useState(100);
  const [searchRunning, setSearchRunning] = useState(false);
  const [searchResults, setSearchResults] = useState<(LeadResult | CompanyResult)[]>([]);
  const [searchMode, setSearchMode] = useState<"leads" | "companies">("leads");

  // Profile scanner state
  const [profileUrls, setProfileUrls] = useState("");
  const [profileRunning, setProfileRunning] = useState(false);
  const [profileResults, setProfileResults] = useState<ProfileResult[]>([]);
  const [minConnections, setMinConnections] = useState(0);
  const [minActivityMonths, setMinActivityMonths] = useState(3);

  // Company scanner state
  const [companyUrls, setCompanyUrls] = useState("");
  const [companyRunning, setCompanyRunning] = useState(false);
  const [companyResults, setCompanyResults] = useState<CompanyProfileResult[]>([]);

  // Maps scanner state
  const [searchStringsArray, setSearchStringsArray] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [maxCrawledPlacesPerSearch, setMaxCrawledPlacesPerSearch] = useState(100);
  const [mapsRunning, setMapsRunning] = useState(false);
  const [mapsResults, setMapsResults] = useState<MapsResult[]>([]);
  const [mapsSearchMode, setMapsSearchMode] = useState<"single" | "batch">("single");
  const [mapsBatchQueries, setMapsBatchQueries] = useState("");
  const [scrapePlaceDetailPage, setScrapePlaceDetailPage] = useState(true);
  const [language, setLanguage] = useState("en");
  const [categoryFilterWords, setCategoryFilterWords] = useState("");
  const [placeMinimumStars, setPlaceMinimumStars] = useState<number | null>(null);
  const [websiteFilter, setWebsiteFilter] = useState<"allPlaces" | "withWebsite" | "withoutWebsite">("allPlaces");
  const [skipClosedPlaces, setSkipClosedPlaces] = useState(false);

  // Shared state
  const [progress, setProgress] = useState({ current: 0, total: 0, page: 0 });
  const [statusMessage, setStatusMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const resultsPerPage = 10;

  const isRunning = searchRunning || profileRunning || companyRunning || mapsRunning;

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const getCookies = () => {
    const raw = liAt.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        return parsed.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || ".linkedin.com",
          path: c.path || "/",
        }));
      } catch (e) {
        addLog("⚠ Invalid JSON format in cookie field. Falling back to text mode.");
      }
    }
    return [
      { name: "li_at", value: raw },
      ...(jsessionId.trim() ? [{ name: "JSESSIONID", value: jsessionId.trim() }] : []),
    ];
  };

  const saveCookies = () => {
    if (!liAt.trim()) return;
    setCookieSaved(true);
    addLog("Cookies saved successfully");
  };

  const detectMode = (url: string) => {
    if (url.includes("/sales/search/company") || url.includes("/sales/lists/company")) return "companies";
    return "leads";
  };

  // ─── Search Scraper ───
  const startSearch = useCallback(async () => {
    if (!cookieSaved || !searchUrl.trim()) return;

    const mode = detectMode(searchUrl);
    setSearchMode(mode);
    setSearchRunning(true);
    setSearchResults([]);
    setCurrentPage(1);
    setProgress({ current: 0, total: maxResults, page: 0 });
    addLog(`🚀 Starting ${mode} search export (max ${maxResults})`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/scrape/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchUrl, cookies: getCookies(), maxResults, mode, proxyCountry }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`❌ ${err.error}`);
        setSearchRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setSearchRunning(false); return; }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            setProgress({ current: event.current, total: event.total, page: event.page || 0 });
            setStatusMessage(event.message);
            addLog(event.message);
            if (event.type === "page_done" && event.data) {
              setSearchResults(prev => [...prev, ...event.data]);
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") addLog("⏹ Search stopped");
      else addLog(`❌ ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSearchRunning(false);
      abortRef.current = null;
    }
  }, [cookieSaved, searchUrl, maxResults, liAt, jsessionId, proxyCountry]);

  // ─── Profile Scanner ───
  const startProfileScan = useCallback(async () => {
    if (!cookieSaved) return;
    const urlList = profileUrls.split("\n").map(u => u.trim()).filter(u => u.includes("linkedin.com/in/"));
    if (urlList.length === 0) { addLog("⚠️ No valid URLs"); return; }

    setProfileRunning(true);
    setProfileResults([]);
    setCurrentPage(1);
    setProgress({ current: 0, total: urlList.length, page: 0 });
    addLog(`🚀 Starting scan of ${urlList.length} profiles`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/scrape/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList, cookies: getCookies(), minConnections, minActivityMonths, proxyCountry }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`❌ ${err.error}`);
        setProfileRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setProfileRunning(false); return; }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            setProgress(p => ({ ...p, current: event.current, total: event.total }));
            setStatusMessage(event.message);
            addLog(event.message);
            if (event.type === "result" && event.data) {
              setProfileResults(prev => [...prev, event.data]);
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") addLog("⏹ Scan stopped");
      else addLog(`❌ ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setProfileRunning(false);
      abortRef.current = null;
    }
  }, [cookieSaved, profileUrls, liAt, jsessionId, minConnections, minActivityMonths, proxyCountry]);

  // ─── Company Scanner ───
  const startCompanyScan = useCallback(async () => {
    if (!cookieSaved) return;
    const urlList = companyUrls.split("\n").map(u => u.trim()).filter(u => u.includes("linkedin.com/company/"));
    if (urlList.length === 0) { addLog("⚠️ No valid URLs"); return; }

    setCompanyRunning(true);
    setCompanyResults([]);
    setCurrentPage(1);
    setProgress({ current: 0, total: urlList.length, page: 0 });
    addLog(`🚀 Starting scan of ${urlList.length} companies`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/scrape/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList, cookies: getCookies(), proxyCountry }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`❌ ${err.error}`);
        setCompanyRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setCompanyRunning(false); return; }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            setProgress(p => ({ ...p, current: event.current, total: event.total }));
            setStatusMessage(event.message);
            addLog(event.message);
            if (event.type === "result" && event.data) {
              setCompanyResults(prev => [...prev, event.data]);
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") addLog("⏹ Scan stopped");
      else addLog(`❌ ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCompanyRunning(false);
      abortRef.current = null;
    }
  }, [cookieSaved, companyUrls, liAt, jsessionId, proxyCountry]);

  // ─── Maps Scraper ───
  const startMapsSearch = useCallback(async () => {
    const hasSingle = mapsSearchMode === "single" && searchStringsArray.trim();
    const hasBatch = mapsSearchMode === "batch" && mapsBatchQueries.trim();
    if (!hasSingle && !hasBatch) return;

    const batchQueries = mapsSearchMode === "batch"
      ? mapsBatchQueries.split("\n").map(q => q.trim()).filter(Boolean)
      : [];

    setMapsRunning(true);
    setMapsResults([]);
    setCurrentPage(1);
    setProgress({ current: 0, total: maxCrawledPlacesPerSearch, page: 0 });
    addLog(`🚀 Starting Google Maps search export (max ${maxCrawledPlacesPerSearch})`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/scrape/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStringsArray: mapsSearchMode === "single" ? [searchStringsArray] : batchQueries,
          locationQuery,
          maxCrawledPlacesPerSearch,
          scrapePlaceDetailPage,
          language,
          categoryFilterWords: categoryFilterWords ? categoryFilterWords.split(",").map(w => w.trim()).filter(Boolean) : [],
          placeMinimumStars,
          website: websiteFilter,
          skipClosedPlaces,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`❌ ${err.error}`);
        setMapsRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setMapsRunning(false); return; }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            setProgress({ current: event.current, total: event.total, page: event.page || 0 });
            setStatusMessage(event.message);
            addLog(event.message);
            if (event.type === "page_done" && event.data) {
              setMapsResults(prev => {
                const newResults = [...prev];
                for (const item of event.data) {
                  if (!newResults.find(r => r.url === item.url)) {
                    newResults.push(item);
                  }
                }
                return newResults;
              });
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") addLog("⏹ Search stopped");
      else addLog(`❌ ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setMapsRunning(false);
      abortRef.current = null;
    }
  }, [searchStringsArray, locationQuery, maxCrawledPlacesPerSearch, mapsSearchMode, mapsBatchQueries, scrapePlaceDetailPage, language, categoryFilterWords, placeMinimumStars, websiteFilter, skipClosedPlaces]);

  // ─── Export ───
  const exportCSV = (data: AnyResult[], filename: string) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const esc = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      s = s.replace(/"/g, '""');
      return /[,"\n\r]/.test(s) ? `"${s}"` : s;
    };
    const rows = data.map(r => headers.map(h => esc((r as unknown as Record<string, unknown>)[h])).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    addLog(`📥 Exported ${data.length} rows as CSV`);
  };

  const exportJSON = (data: AnyResult[], filename: string) => {
    if (data.length === 0) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    addLog(`📥 Exported ${data.length} rows as JSON`);
  };

  const stop = () => abortRef.current?.abort();

  const currentResults = activeTab === "search" ? searchResults : activeTab === "profile" ? profileResults : activeTab === "company" ? companyResults : mapsResults;

  // Pagination helpers (must be after currentResults)
  const totalPages = Math.ceil(currentResults.length / resultsPerPage);
  const paginatedResults = currentResults.slice(
    (currentPage - 1) * resultsPerPage,
    currentPage * resultsPerPage
  );
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const activeCount = activeTab === "profile" ? profileResults.filter(r => r.status === "active").length : activeTab === "maps" ? mapsResults.length : searchResults.length;
  const inactiveCount = activeTab === "profile" ? profileResults.filter(r => r.status === "inactive").length : 0;
  const mapsOpenNowCount = activeTab === "maps" ? mapsResults.filter(r => !r.permanentlyClosed && !r.temporarilyClosed).length : 0;
  const mapsWithWebsiteCount = activeTab === "maps" ? mapsResults.filter(r => r.website).length : 0;
  const companyWithWebsiteCount = activeTab === "company" ? companyResults.filter(r => r.website).length : 0;
  const companyWithIndustryCount = activeTab === "company" ? companyResults.filter(r => r.industry).length : 0;

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NextLink href="/salesnav-exporter" className={styles.logo}>
            <div className={styles.logoIcon}>SN</div>
            <div>
              <div className={styles.logoTitle}>SalesNav Exporter</div>
              <div className={styles.logoSub}>Scraping Dashboard</div>
            </div>
          </NextLink>
          <div className={styles.headerBadge}>
            <div className={`${styles.statusDot} ${isRunning ? styles.active : ""}`} />
            {isRunning ? "Scanning..." : "Ready"}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.grid}>
          {/* ── Left Column ── */}
          <div className={styles.leftCol}>
            {/* Tabs */}
            <div className={styles.tabBar}>
              <button className={`${styles.tab} ${activeTab === "search" ? styles.activeTab : ""}`} onClick={() => { setActiveTab("search"); setCurrentPage(1); }}>
                <Search size={15} /> Search Export
              </button>
              <button className={`${styles.tab} ${activeTab === "profile" ? styles.activeTab : ""}`} onClick={() => { setActiveTab("profile"); setCurrentPage(1); }}>
                <ScanLine size={15} /> Profile Scanner
              </button>
              <button className={`${styles.tab} ${activeTab === "company" ? styles.activeTab : ""}`} onClick={() => { setActiveTab("company"); setCurrentPage(1); }}>
                <Building2 size={15} /> Company Scanner
              </button>
              <button className={`${styles.tab} ${activeTab === "maps" ? styles.activeTab : ""}`} onClick={() => { setActiveTab("maps"); setCurrentPage(1); }}>
                <MapPin size={15} /> Google Maps
              </button>
            </div>

            {/* Proxy & Auth Card */}
            {activeTab !== "maps" && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <Globe size={18} />
                <span>Proxy & Authentication</span>
                {cookieSaved && <span className={styles.savedBadge}><CheckCircle2 size={12} /> Saved</span>}
              </div>
              <div className={styles.cardBody}>
                <label className={styles.label}>Proxy Country</label>
                <select 
                  className={styles.input} 
                  value={proxyCountry} 
                  onChange={e => setProxyCountry(e.target.value)}
                  disabled={isRunning}
                  style={{ marginBottom: 16 }}
                >
                  <option value="bd">🇧🇩 Bangladesh</option>
                  <option value="us">🇺🇸 United States</option>
                  <option value="gb">🇬🇧 United Kingdom</option>
                  <option value="in">🇮🇳 India</option>
                  <option value="ca">🇨🇦 Canada</option>
                  <option value="au">🇦🇺 Australia</option>
                  <option value="de">🇩🇪 Germany</option>
                </select>

                <p className={styles.hint}>
                  Paste full <strong>JSON Array</strong> from EditThisCookie or just your <strong>li_at</strong> string.
                </p>
                <label className={styles.label}>Cookies (JSON / li_at) <span className={styles.required}>*</span></label>
                <div className={styles.passwordField}>
                  {showCookies ? (
                    <textarea 
                      value={liAt}
                      onChange={e => { setLiAt(e.target.value); setCookieSaved(false); }}
                      placeholder='[{"domain": ".linkedin.com", "name": "li_at", ...}] OR AQE...' 
                      className={styles.input} 
                      disabled={isRunning}
                      style={{ minHeight: "80px", resize: "vertical", fontFamily: "monospace" }}
                    />
                  ) : (
                    <input type="password" value={liAt}
                      onChange={e => { setLiAt(e.target.value); setCookieSaved(false); }}
                      placeholder='Paste JSON array or li_at here...' className={styles.input} disabled={isRunning} />
                  )}
                  <button className={styles.eyeBtn} onClick={() => setShowCookies(!showCookies)} type="button">
                    {showCookies ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <label className={styles.label}>JSESSIONID (optional)</label>
                <input type={showCookies ? "text" : "password"} value={jsessionId}
                  onChange={e => { setJsessionId(e.target.value); setCookieSaved(false); }}
                  placeholder="ajax:123..." className={styles.input} disabled={isRunning} />
                <button className={styles.btnPrimary} onClick={saveCookies}
                  disabled={!liAt.trim() || isRunning} style={{ marginTop: 12, width: '100%' }}>
                  <CheckCircle2 size={16} /> Save Settings
                </button>
              </div>
            </div>
            )}

            {/* ── Tab: Search Export ── */}
            {activeTab === "search" && (
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <Search size={18} />
                  <span>Sales Navigator Search URL</span>
                </div>
                <div className={styles.cardBody}>
                  <p className={styles.hint}>
                    Paste your Sales Navigator <strong>Lead</strong> or <strong>Company</strong> search URL. Mode auto-detects.
                  </p>
                  <label className={styles.label}>Search URL</label>
                  <input type="text" value={searchUrl}
                    onChange={e => setSearchUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/sales/search/people?..."
                    className={styles.input} disabled={isRunning} />
                  {searchUrl && (
                    <div className={styles.modeBadge} style={{ marginTop: 8 }}>
                      {detectMode(searchUrl) === "leads"
                        ? <><Users size={14} /> Lead Search</>
                        : <><Building2 size={14} /> Company Search</>}
                    </div>
                  )}
                  <label className={styles.label}>Max Results</label>
                  <input type="number" value={maxResults}
                    onChange={e => setMaxResults(parseInt(e.target.value) || 100)}
                    min={1} max={500} className={styles.input} disabled={isRunning} />
                  <div className={styles.actionRow}>
                    {!searchRunning ? (
                      <button className={styles.btnPrimary} onClick={startSearch}
                        disabled={!cookieSaved || !searchUrl.trim()}>
                        <Play size={16} /> Start Export
                      </button>
                    ) : (
                      <button className={styles.btnDanger} onClick={stop}>
                        <Square size={16} /> Stop
                      </button>
                    )}
                    <button className={styles.btnGhost}
                      onClick={() => { setSearchUrl(""); setSearchResults([]); setCurrentPage(1); }}
                      disabled={isRunning}>
                      <Trash2 size={16} /> Clear
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Profile Scanner ── */}
            {activeTab === "profile" && (
              <>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <Users size={18} />
                  <span>Profile URLs</span>
                  <span className={styles.countBadge}>
                    {profileUrls.split("\n").filter(u => u.includes("linkedin.com/in/")).length} valid
                  </span>
                </div>
                <div className={styles.cardBody}>
                  <textarea className={styles.textarea} rows={6} value={profileUrls}
                    onChange={e => setProfileUrls(e.target.value)}
                    placeholder={"https://www.linkedin.com/in/johndoe\nhttps://www.linkedin.com/in/janedoe"}
                    disabled={isRunning} />
                </div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <ScanLine size={18} />
                  <span>Scanner Settings</span>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.filterRow}>
                    <div>
                      <label className={styles.label}>Min Connections</label>
                      <input type="number" value={minConnections} min={0} max={10000}
                        onChange={e => setMinConnections(parseInt(e.target.value) || 0)}
                        className={styles.input} disabled={isRunning} />
                    </div>
                    <div>
                      <label className={styles.label}>Activity Window (months)</label>
                      <input type="number" value={minActivityMonths} min={1} max={24}
                        onChange={e => setMinActivityMonths(parseInt(e.target.value) || 3)}
                        className={styles.input} disabled={isRunning} />
                    </div>
                  </div>
                  <p className={styles.hint} style={{ marginTop: 12 }}>
                    Checks <strong>reactions → comments → posts</strong> to determine activity. Premium profiles are marked as active automatically.
                  </p>
                  <div className={styles.actionRow}>
                    {!profileRunning ? (
                      <button className={styles.btnPrimary} onClick={startProfileScan}
                        disabled={!cookieSaved || !profileUrls.trim()}>
                        <Play size={16} /> Start Scanning
                      </button>
                    ) : (
                      <button className={styles.btnDanger} onClick={stop}>
                        <Square size={16} /> Stop
                      </button>
                    )}
                    <button className={styles.btnGhost}
                      onClick={() => { setProfileUrls(""); setProfileResults([]); setLogs([]); setCurrentPage(1); setProgress({ current: 0, total: 0, page: 0 }); }}
                      disabled={isRunning}>
                      <Trash2 size={16} /> Clear
                    </button>
                  </div>
                </div>
              </div>
              </>
            )}

            {/* ── Tab: Company Scanner ── */}
            {activeTab === "company" && (
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <Building2 size={18} />
                  <span>Company URLs</span>
                  <span className={styles.countBadge}>
                    {companyUrls.split("\n").filter(u => u.includes("linkedin.com/company/")).length} valid
                  </span>
                </div>
                <div className={styles.cardBody}>
                  <textarea className={styles.textarea} rows={6} value={companyUrls}
                    onChange={e => setCompanyUrls(e.target.value)}
                    placeholder={"https://www.linkedin.com/company/acme-inc\nhttps://www.linkedin.com/company/globex"}
                    disabled={isRunning} />
                  <p className={styles.hint} style={{ marginTop: 12 }}>
                    Visits each company's About page for website, industry, size, headquarters, founded year, type, and specialties.
                  </p>
                  <div className={styles.actionRow}>
                    {!companyRunning ? (
                      <button className={styles.btnPrimary} onClick={startCompanyScan}
                        disabled={!cookieSaved || !companyUrls.trim()}>
                        <Play size={16} /> Start Scanning
                      </button>
                    ) : (
                      <button className={styles.btnDanger} onClick={stop}>
                        <Square size={16} /> Stop
                      </button>
                    )}
                    <button className={styles.btnGhost}
                      onClick={() => { setCompanyUrls(""); setCompanyResults([]); setLogs([]); setCurrentPage(1); setProgress({ current: 0, total: 0, page: 0 }); }}
                      disabled={isRunning}>
                      <Trash2 size={16} /> Clear
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Maps Scraper ── */}
            {activeTab === "maps" && (
              <>
                {/* Search Mode Toggle */}
                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    <MapPin size={18} />
                    <span>Google Maps Search</span>
                  </div>
                  <div className={styles.cardBody}>
                    {/* Mode Toggle */}
                    <div className={styles.modeToggle}>
                      <button
                        className={`${styles.modeBtn} ${mapsSearchMode === "single" ? styles.modeBtnActive : ""}`}
                        onClick={() => setMapsSearchMode("single")}
                        disabled={isRunning}
                      >
                        <Search size={14} /> Single Query
                      </button>
                      <button
                        className={`${styles.modeBtn} ${mapsSearchMode === "batch" ? styles.modeBtnActive : ""}`}
                        onClick={() => setMapsSearchMode("batch")}
                        disabled={isRunning}
                      >
                        <FileSpreadsheet size={14} /> Batch Queries
                      </button>
                    </div>

                    {mapsSearchMode === "single" ? (
                      <>
                        <label className={styles.label}>Search Query or URL</label>
                        <input type="text" value={searchStringsArray}
                          onChange={e => setSearchStringsArray(e.target.value)}
                          placeholder="e.g. Restaurants in New York or https://www.google.com/maps/search/..."
                          className={styles.input} disabled={isRunning} />
                      </>
                    ) : (
                      <>
                        <label className={styles.label}>Batch Queries (one per line)</label>
                        <textarea
                          className={styles.textarea}
                          rows={4}
                          value={mapsBatchQueries}
                          onChange={e => setMapsBatchQueries(e.target.value)}
                          placeholder={"Restaurants in New York\nHotels in Paris\nDentists in London"}
                          disabled={isRunning}
                        />
                        <span className={styles.countBadge} style={{ marginTop: 8, display: "inline-block" }}>
                          {mapsBatchQueries.split("\n").filter(q => q.trim()).length} queries
                        </span>
                      </>
                    )}

                    {/* Quick Presets */}
                    <label className={styles.label} style={{ marginTop: 16 }}>Quick Presets</label>
                    <div className={styles.presetsRow}>
                      {["Restaurants", "Hotels", "Dentists", "Plumbers", "Lawyers", "Doctors", "Gyms", "Cafes"].map(preset => (
                        <button
                          key={preset}
                          className={styles.presetBtn}
                          onClick={() => {
                            if (mapsSearchMode === "single") {
                              setSearchStringsArray(preset);
                            } else {
                              setMapsBatchQueries(prev => prev ? prev + "\n" + preset : preset);
                            }
                          }}
                          disabled={isRunning}
                          type="button"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Filters & Settings */}
                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    <Globe size={18} />
                    <span>Filters & Settings</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.filterRow}>
                      <div>
                        <label className={styles.label}>Max Results</label>
                        <input type="number" value={maxCrawledPlacesPerSearch}
                          onChange={e => setMaxCrawledPlacesPerSearch(parseInt(e.target.value) || 100)}
                          min={1} max={500} className={styles.input} disabled={isRunning} />
                      </div>
                      <div>
                        <label className={styles.label}>Place Minimum Stars</label>
                        <select
                          className={styles.input}
                          value={placeMinimumStars ?? 0}
                          onChange={e => { const v = parseFloat(e.target.value); setPlaceMinimumStars(v > 0 ? v : null); }}
                          disabled={isRunning}
                        >
                          <option value={0}>Any</option>
                          <option value={2}>2.0+</option>
                          <option value={2.5}>2.5+</option>
                          <option value={3}>3.0+</option>
                          <option value={3.5}>3.5+</option>
                          <option value={4}>4.0+</option>
                          <option value={4.5}>4.5+</option>
                        </select>
                      </div>
                    </div>

                    <div className={styles.filterRow} style={{ marginTop: 12 }}>
                      <div>
                        <label className={styles.label}>Location</label>
                        <input type="text" value={locationQuery}
                          onChange={e => setLocationQuery(e.target.value)}
                          placeholder="e.g. New York, USA"
                          className={styles.input} disabled={isRunning} />
                      </div>
                      <div>
                        <label className={styles.label}>Language</label>
                        <select
                          className={styles.input}
                          value={language}
                          onChange={e => setLanguage(e.target.value)}
                          disabled={isRunning}
                        >
                          <option value="en">English</option>
                          <option value="es">Spanish</option>
                          <option value="fr">French</option>
                          <option value="de">German</option>
                          <option value="it">Italian</option>
                          <option value="pt">Portuguese</option>
                          <option value="ru">Russian</option>
                          <option value="ja">Japanese</option>
                          <option value="ko">Korean</option>
                          <option value="zh-CN">Chinese (Simplified)</option>
                          <option value="ar">Arabic</option>
                          <option value="hi">Hindi</option>
                          <option value="bn">Bengali</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label className={styles.label}>Category Filter (comma separated)</label>
                      <input type="text" value={categoryFilterWords}
                        onChange={e => setCategoryFilterWords(e.target.value)}
                        placeholder="e.g. restaurant, cafe, bar"
                        className={styles.input} disabled={isRunning} />
                    </div>

                    <div className={styles.filterRow} style={{ marginTop: 12 }}>
                      <div>
                        <label className={styles.label}>Website Filter</label>
                        <select
                          className={styles.input}
                          value={websiteFilter}
                          onChange={e => setWebsiteFilter(e.target.value as "allPlaces" | "withWebsite" | "withoutWebsite")}
                          disabled={isRunning}
                        >
                          <option value="allPlaces">Any</option>
                          <option value="withWebsite">With Website</option>
                          <option value="withoutWebsite">Without Website</option>
                        </select>
                      </div>
                      <div>
                        <label className={styles.label}>Skip Closed Places</label>
                        <div className={styles.checkboxRow}>
                          <input
                            type="checkbox"
                            id="skipClosedPlaces"
                            checked={skipClosedPlaces}
                            onChange={e => setSkipClosedPlaces(e.target.checked)}
                            disabled={isRunning}
                          />
                          <label htmlFor="skipClosedPlaces" style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                            Skip permanently or temporarily closed places
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className={styles.checkboxRow} style={{ marginTop: 12 }}>
                      <input
                        type="checkbox"
                        id="scrapeDetails"
                        checked={scrapePlaceDetailPage}
                        onChange={e => setScrapePlaceDetailPage(e.target.checked)}
                        disabled={isRunning}
                      />
                      <label htmlFor="scrapeDetails" style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                        <strong>Scrape details</strong> (opens each result for richer data — slower)
                      </label>
                    </div>

                    <div className={styles.actionRow} style={{ marginTop: 16 }}>
                      {!mapsRunning ? (
                        <button className={styles.btnPrimary} onClick={startMapsSearch}
                          disabled={mapsSearchMode === "single" ? !searchStringsArray.trim() : !mapsBatchQueries.trim()}>
                          <Play size={16} /> Start Export
                        </button>
                      ) : (
                        <button className={styles.btnDanger} onClick={stop}>
                          <Square size={16} /> Stop
                        </button>
                      )}
                      <button className={styles.btnGhost}
                        onClick={() => {
                          setSearchStringsArray("");
                          setMapsBatchQueries("");
                          setMapsResults([]);
                          setCurrentPage(1);
                          setLocationQuery("");
                          setLanguage("en");
                          setCategoryFilterWords("");
                          setPlaceMinimumStars(null);
                          setWebsiteFilter("allPlaces");
                          setSkipClosedPlaces(false);
                        }}
                        disabled={isRunning}>
                        <Trash2 size={16} /> Clear All
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Log */}
            <div className={styles.card}>
              <div className={styles.cardHeader}><ScanLine size={18} /><span>Activity Log</span></div>
              <div className={styles.logBox}>
                {logs.length === 0
                  ? <div className={styles.logEmpty}>No activity yet</div>
                  : logs.map((l, i) => <div key={i} className={styles.logLine}>{l}</div>)}
              </div>
            </div>
          </div>

          {/* ── Right Column ── */}
          <div className={styles.rightCol}>
            {/* Stats */}
            <div className={styles.statsBar}>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>Results</div>
                <div className={styles.statValue} style={{ color: "#00d4ff" }}>{currentResults.length}</div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>
                  {activeTab === "search" ? "Page" : activeTab === "maps" ? "Open Now" : activeTab === "company" ? "With Website" : "Active"}
                </div>
                <div className={styles.statValue} style={{ color: "#22c55e" }}>
                  {activeTab === "search" ? progress.page || 0 : activeTab === "maps" ? mapsOpenNowCount : activeTab === "company" ? companyWithWebsiteCount : activeCount}
                </div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>
                  {activeTab === "search" ? "Max" : activeTab === "maps" ? "With Website" : activeTab === "company" ? "With Industry" : "Inactive"}
                </div>
                <div className={styles.statValue} style={{ color: activeTab === "search" ? "#a855f7" : activeTab === "maps" || activeTab === "company" ? "#3b82f6" : "#ef4444" }}>
                  {activeTab === "search" ? maxResults : activeTab === "maps" ? mapsWithWebsiteCount : activeTab === "company" ? companyWithIndustryCount : inactiveCount}
                </div>
              </div>
              <div className={styles.statItem}>
                <div className={styles.statLabel}>Status</div>
                <div className={styles.statValue}>
                  {isRunning ? <span className={styles.runningText}><Loader2 size={14} className={styles.spin} /> {pct}%</span>
                    : progress.total > 0 ? "Done" : "Idle"}
                </div>
              </div>
            </div>

            {/* Progress */}
            {progress.total > 0 && (
              <div className={styles.progressBar}>
                <motion.div className={styles.progressFill} initial={{ width: 0 }}
                  animate={{ width: `${Math.min(pct, 100)}%` }} transition={{ duration: 0.3 }} />
              </div>
            )}

            {/* Export */}
            {currentResults.length > 0 && !isRunning && (
              <div className={styles.exportRow}>
                <button className={styles.btnExport} onClick={() =>
                  exportCSV(currentResults, `salesnav_${activeTab}_${new Date().toISOString().split("T")[0]}.csv`)}>
                  <FileSpreadsheet size={16} /> Export CSV
                </button>
                <button className={styles.btnExport} onClick={() =>
                  exportJSON(currentResults, `salesnav_${activeTab}_${new Date().toISOString().split("T")[0]}.json`)}>
                  <FileJson size={16} /> Export JSON
                </button>
              </div>
            )}

            {/* Results Table */}
            <div className={styles.card} style={{ flex: 1 }}>
              <div className={styles.cardHeader}>
                {activeTab === "search" ? <Search size={18} /> : activeTab === "maps" ? <MapPin size={18} /> : activeTab === "company" ? <Building2 size={18} /> : <Users size={18} />}
                <span>Results ({currentResults.length})</span>
              </div>
              <div className={styles.tableWrap}>
                {currentResults.length === 0 ? (
                  <div className={styles.emptyState}>
                    <ScanLine size={48} strokeWidth={1} />
                    <p>No results yet. Start a {activeTab === "search" ? "search export" : activeTab === "maps" ? "maps export" : activeTab === "company" ? "company scan" : "profile scan"} to see data here.</p>
                  </div>
                ) : activeTab === "company" ? (
                  <table className={styles.table}>
                    <thead><tr>
                      <th>#</th><th>Company</th><th>Website</th><th>Industry</th><th>Size</th>
                      <th>HQ</th><th>Founded</th><th>Type</th><th>Followers</th><th>Employees</th><th>URL</th>
                    </tr></thead>
                    <tbody>
                      {(paginatedResults as CompanyProfileResult[]).map((r, i) => (
                        <tr key={(currentPage - 1) * resultsPerPage + i} className={r.error ? styles.errorRow : ""}>
                          <td>{(currentPage - 1) * resultsPerPage + i + 1}</td>
                          <td className={styles.nameCell}>{r.companyName || "—"}</td>
                          <td>{r.website || "—"}</td>
                          <td>{r.industry || "—"}</td>
                          <td>{r.companySize || "—"}</td>
                          <td>{r.headquarters || "—"}</td>
                          <td>{r.founded || "—"}</td>
                          <td>{r.companyType || "—"}</td>
                          <td>{r.followerCount || "—"}</td>
                          <td>{r.employeesOnLinkedIn || "—"}</td>
                          <td><a href={r.linkedinUrl || r.original_url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            <Link size={12} /> Link
                          </a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeTab === "maps" ? (
                  <table className={styles.table}>
                    <thead><tr>
                      <th>#</th><th>Name</th><th>Category</th><th>Price</th>
                      <th>Address</th><th>Phone</th><th>Rating</th><th>Hours</th>
                      <th>Status</th><th>Website</th><th>Maps</th>
                    </tr></thead>
                    <tbody>
                      {(paginatedResults as MapsResult[]).map((r, i) => (
                        <tr key={(currentPage - 1) * resultsPerPage + i}>
                          <td>{(currentPage - 1) * resultsPerPage + i + 1}</td>
                          <td className={styles.nameCell}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {r.imageUrl && (
                                <img src={r.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} />
                              )}
                              {r.title || "—"}
                            </div>
                          </td>
                          <td>{r.categoryName || "—"}</td>
                          <td>{r.price || "—"}</td>
                          <td>{r.address || "—"}</td>
                          <td>{r.phone || "—"}</td>
                          <td>{r.totalScore ? `${r.totalScore} ★ (${r.reviewsCount ?? 0})` : "—"}</td>
                          <td>
                            {!r.permanentlyClosed && !r.temporarilyClosed ? (
                              <span className={styles.successBadge}><CheckCircle2 size={12} /> Open</span>
                            ) : r.openingHours && r.openingHours.length > 0 ? (
                              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{r.openingHours.map(h => `${h.day}: ${h.hours}`).join(", ")}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {r.permanentlyClosed ? (
                              <span className={styles.errorBadge}><XCircle size={12} /> Closed</span>
                            ) : r.temporarilyClosed ? (
                              <span style={{ color: "var(--neon-amber)", fontSize: "0.78rem", fontWeight: 600 }}>Temp Closed</span>
                            ) : (
                              <span className={styles.successBadge}>Active</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              {r.website && <a href={r.website} target="_blank" rel="noopener noreferrer" className={styles.profileLink}><Link size={12} /> Web</a>}
                            </div>
                          </td>
                          <td><a href={r.url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            <Link size={12} /> Map
                          </a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeTab === "search" && searchMode === "leads" ? (
                  <table className={styles.table}>
                    <thead><tr>
                      <th>#</th><th>Name</th><th>Title</th><th>Company</th>
                      <th>Location</th><th>Degree</th><th>Industry</th><th>Profile</th>
                    </tr></thead>
                    <tbody>
                      {(paginatedResults as LeadResult[]).map((r, i) => (
                        <tr key={(currentPage - 1) * resultsPerPage + i}>
                          <td>{(currentPage - 1) * resultsPerPage + i + 1}</td>
                          <td className={styles.nameCell}>{r.full_name || "—"}</td>
                          <td>{r.title || "—"}</td>
                          <td>{r.company_name || "—"}</td>
                          <td>{r.profile_location || "—"}</td>
                          <td>{r.connection_degree || "—"}</td>
                          <td>{r.industry || "—"}</td>
                          <td><a href={r.linkedin_profile_url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            <Link size={12} /> Link
                          </a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeTab === "search" && searchMode === "companies" ? (
                  <table className={styles.table}>
                    <thead><tr>
                      <th>#</th><th>Company</th><th>Industry</th>
                      <th>Employees</th><th>URL</th>
                    </tr></thead>
                    <tbody>
                      {(paginatedResults as CompanyResult[]).map((r, i) => (
                        <tr key={(currentPage - 1) * resultsPerPage + i}>
                          <td>{(currentPage - 1) * resultsPerPage + i + 1}</td>
                          <td className={styles.nameCell}>{r.company_name || "—"}</td>
                          <td>{r.industry || "—"}</td>
                          <td>{r.employees || "—"}</td>
                          <td><a href={r.linkedin_company_url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            <Link size={12} /> Link
                          </a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className={styles.table}>
                    <thead><tr>
                      <th>#</th><th>Name</th><th>Status</th><th>Premium</th>
                      <th>Connections</th><th>Last Activity</th><th>Type</th><th>Profile</th>
                    </tr></thead>
                    <tbody>
                      {(paginatedResults as ProfileResult[]).map((r, i) => (
                        <tr key={(currentPage - 1) * resultsPerPage + i} className={r.status === "Skipped" ? styles.errorRow : ""}>
                          <td>{(currentPage - 1) * resultsPerPage + i + 1}</td>
                          <td><a href={r.profile_url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            {r.name || "—"}
                          </a></td>
                          <td>{r.status === "active"
                            ? <span className={styles.successBadge}><CheckCircle2 size={12} /> Active</span>
                            : r.status === "inactive"
                            ? <span className={styles.errorBadge}><XCircle size={12} /> Inactive</span>
                            : <span style={{ color: "var(--text-muted)" }}>Skipped</span>}
                          </td>
                          <td>{r.is_premium === "Yes" ? <span className={styles.premiumBadge}>Yes</span> : r.is_premium}</td>
                          <td>{r.connection_count}</td>
                          <td>{r.last_activity}</td>
                          <td>{r.activity_type}</td>
                          <td><a href={r.profile_url} target="_blank" rel="noopener noreferrer" className={styles.profileLink}>
                            <Link size={12} /> Link
                          </a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {currentResults.length > resultsPerPage && (
                <div className={styles.paginationBar}>
                  <div className={styles.paginationInfo}>
                    Showing {(currentPage - 1) * resultsPerPage + 1}-{Math.min(currentPage * resultsPerPage, currentResults.length)} of {currentResults.length}
                  </div>
                  <div className={styles.paginationControls}>
                    <button
                      className={styles.pageBtn}
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      Previous
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      // Show window of 5 pages around current
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`${styles.pageBtn} ${pageNum === currentPage ? styles.pageBtnActive : ""}`}
                          onClick={() => goToPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      className={styles.pageBtn}
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
