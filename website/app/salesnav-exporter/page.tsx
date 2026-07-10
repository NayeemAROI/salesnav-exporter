"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, ChevronDown, ChevronRight, Search, Users, Building2,
  Zap, ShieldCheck, FileSpreadsheet, ScanLine, Globe, Star,
  CheckCircle2, ArrowRight, Mail, ExternalLink, Monitor,
  Clock, Filter, BarChart3,
} from "lucide-react";
import Image from "next/image";
import styles from "./salesnav.module.css";

/* ─── Metadata (export from layout.tsx or head) ─── */
// export const metadata = { title: "SalesNav Exporter ...", ... }

/* ─── Data ─── */
const FEATURES = [
  {
    icon: <FileSpreadsheet size={28} />,
    title: "List Exporter",
    desc: "Export leads directly from Sales Navigator search results or saved lists as CSV in one click.",
    color: "#00d4ff",
  },
  {
    icon: <ScanLine size={28} />,
    title: "Deep Profile Scanner",
    desc: "Automatically scan profiles to check activity status, premium tier, and connection count.",
    color: "#a855f7",
  },
  {
    icon: <Building2 size={28} />,
    title: "Company Scanner",
    desc: "Extract company data — website, industry, size, headquarters, and specialties.",
    color: "#22c55e",
  },
  {
    icon: <Zap size={28} />,
    title: "Smart Speed Control",
    desc: "Choose Fast, Medium, or Safe mode to avoid LinkedIn rate limits and account restrictions.",
    color: "#f59e0b",
  },
  {
    icon: <ShieldCheck size={28} />,
    title: "100% Privacy",
    desc: "The Chrome extension processes data locally. The separate web dashboard runs protected scraping jobs on your configured server.",
    color: "#ef4444",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Install Extension",
    desc: "Download the ZIP, extract it, and load it in Chrome via Developer Mode.",
    icon: <Download size={24} />,
  },
  {
    num: "02",
    title: "Open Sales Navigator",
    desc: "Navigate to any LinkedIn Sales Navigator search page or saved lead list.",
    icon: <Globe size={24} />,
  },
  {
    num: "03",
    title: "Click & Configure",
    desc: "Open the extension popup, paste your URL or profile links, and hit Start.",
    icon: <Filter size={24} />,
  },
  {
    num: "04",
    title: "Download Results",
    desc: "Get your leads as a clean CSV or JSON file — ready for your CRM or outreach tool.",
    icon: <BarChart3 size={24} />,
  },
];

const FAQS = [
  {
    q: "Is this extension free?",
    a: "Yes! The core features — List Exporter, Profile Scanner, and Company Scanner — are completely free with no signup required.",
  },
  {
    q: "Will my LinkedIn account get restricted?",
    a: "We've built in smart rate limiting with configurable speed modes (Fast, Medium, Safe) and daily scan limits (100/day) to minimize risk. However, excessive scraping always carries some risk — use the Safe mode for best protection.",
  },
  {
    q: "How many profiles can I scan at once?",
    a: "The Profile Scanner supports up to 50 profiles per batch and 100 per day. The Search Scraper can export unlimited pages of search results.",
  },
  {
    q: "Does it work on Edge and Brave?",
    a: "Yes! Any Chromium-based browser supports this extension — Chrome, Edge, Brave, Opera, and Arc.",
  },
  {
    q: "Where does my data go?",
    a: "The Chrome extension processes exports locally. If you use the protected web dashboard, LinkedIn session cookies are sent to your own configured server for the duration of the scraping request and are not intentionally persisted.",
  },
  {
    q: "Do I need Sales Navigator?",
    a: "The List Exporter requires a Sales Navigator subscription. The Profile Scanner works with any LinkedIn profile URL (regular LinkedIn).",
  },
  {
    q: "How do I update the extension?",
    a: "Download the latest ZIP, replace your local files, then go to chrome://extensions and click the Refresh button on the extension card.",
  },
];

const SCREENSHOTS = [
  { src: "/salesnav/preview3.png", alt: "Search Scraper", label: "Search Scraper" },
  { src: "/salesnav/preview1.png", alt: "Profile Scanner Config", label: "Profile Scanner" },
  { src: "/salesnav/preview2.png", alt: "Scanner Progress", label: "Live Progress" },
  { src: "/salesnav/preview4.png", alt: "Batch Limit", label: "Safety Limits" },
];

/* ─── Animation Variants ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

/* ─── Components ─── */

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.faqItem} onClick={() => setOpen(!open)}>
      <div className={styles.faqQuestion}>
        <span>{q}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={20} />
        </motion.div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.faqAnswer}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Main Page ─── */
export default function SalesNavExporterPage() {
  const [activeScreenshot, setActiveScreenshot] = useState(0);

  return (
    <div className={styles.page}>
      {/* ══════ HERO ══════ */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <motion.div
          className={styles.heroContent}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <div className={styles.badge}>
            <Star size={14} /> Free &amp; Open Source
          </div>
          <h1 className={styles.heroTitle}>
            Extract leads from <br />
            <span className={styles.gradient}>Sales Navigator</span>
            <br /> in seconds, not hours.
          </h1>
          <p className={styles.heroSub}>
            A powerful Chrome extension that exports search results, scans profiles for activity,
            and extracts company data — all without leaving your browser.
          </p>
          <div className={styles.heroCtas}>
            <a
              href="https://github.com/NayeemAROI/salesnav-exporter/archive/refs/heads/main.zip"
              className={styles.btnPrimary}
            >
              <Download size={18} /> Download Free
            </a>
            <a href="#docs" className={styles.btnSecondary}>
              <FileSpreadsheet size={18} /> Documentation
            </a>
          </div>
          <div className={styles.heroStats}>
            <div><strong>3</strong> Scanners</div>
            <div className={styles.dot} />
            <div><strong>CSV + JSON</strong> Export</div>
            <div className={styles.dot} />
            <div><strong>100%</strong> Free</div>
          </div>
        </motion.div>

        <motion.div
          className={styles.heroImage}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          <div className={styles.browserFrame}>
            <div className={styles.browserDots}>
              <span /><span /><span />
            </div>
            <Image
              src="/salesnav/preview2.png"
              alt="SalesNav Exporter Preview"
              width={380}
              height={600}
              className={styles.heroScreenshot}
              priority
            />
          </div>
        </motion.div>
      </section>

      {/* ══════ FEATURES ══════ */}
      <section className={styles.section} id="features">
        <motion.div
          className={styles.sectionHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
          custom={0}
        >
          <h2>Everything you need to <span className={styles.gradient}>supercharge</span> your outreach</h2>
          <p>Three powerful tools in one lightweight extension.</p>
        </motion.div>

        <motion.div
          className={styles.featuresGrid}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={stagger}
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              className={styles.featureCard}
              variants={fadeUp}
              custom={i}
              whileHover={{ y: -6, transition: { duration: 0.2 } }}
            >
              <div className={styles.featureIcon} style={{ color: f.color, boxShadow: `0 0 20px ${f.color}33` }}>
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ══════ HOW IT WORKS ══════ */}
      <section className={styles.section} id="how-it-works">
        <motion.div
          className={styles.sectionHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2>Up and running in <span className={styles.gradient}>4 simple steps</span></h2>
          <p>No account needed. No API keys. Just download and go.</p>
        </motion.div>

        <motion.div
          className={styles.stepsGrid}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          {STEPS.map((s, i) => (
            <motion.div key={s.num} className={styles.stepCard} variants={fadeUp} custom={i}>
              <div className={styles.stepNum}>{s.num}</div>
              <div className={styles.stepIcon}>{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {i < STEPS.length - 1 && (
                <div className={styles.stepArrow}><ChevronRight size={20} /></div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ══════ SCREENSHOTS ══════ */}
      <section className={styles.section} id="screenshots">
        <motion.div
          className={styles.sectionHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2>See it in <span className={styles.gradient}>action</span></h2>
        </motion.div>

        <div className={styles.screenshotTabs}>
          {SCREENSHOTS.map((s, i) => (
            <button
              key={s.label}
              className={`${styles.screenshotTab} ${i === activeScreenshot ? styles.active : ""}`}
              onClick={() => setActiveScreenshot(i)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <motion.div
          className={styles.screenshotDisplay}
          key={activeScreenshot}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className={styles.screenshotFrame}>
            <Image
              src={SCREENSHOTS[activeScreenshot].src}
              alt={SCREENSHOTS[activeScreenshot].alt}
              width={380}
              height={600}
              className={styles.screenshotImg}
            />
          </div>
        </motion.div>
      </section>

      {/* ══════ DOCUMENTATION + FAQ ══════ */}
      <section className={styles.section} id="docs">
        <motion.div
          className={styles.sectionHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2><span className={styles.gradient}>Installation</span> Guide</h2>
        </motion.div>

        <motion.div
          className={styles.docsGrid}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          {[
            { n: "1", title: "Download", desc: 'Click the "Download Free" button above to get the latest .ZIP file from GitHub.' },
            { n: "2", title: "Extract", desc: "Unzip the downloaded file into a folder on your computer." },
            { n: "3", title: "Open Extensions", desc: "Go to chrome://extensions (or edge://extensions for Edge, brave://extensions for Brave)." },
            { n: "4", title: "Developer Mode", desc: 'Toggle "Developer mode" ON in the top-right corner of the extensions page.' },
            { n: "5", title: "Load Unpacked", desc: 'Click "Load unpacked" and select the extracted salesnav-exporter folder.' },
            { n: "6", title: "Pin & Use!", desc: "Click the puzzle piece icon in your toolbar and pin the extension. You're ready!" },
          ].map((step, i) => (
            <motion.div key={step.n} className={styles.docStep} variants={fadeUp} custom={i}>
              <div className={styles.docStepNum}>{step.n}</div>
              <div>
                <h4>{step.title}</h4>
                <p>{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* FAQ */}
        <motion.div
          className={styles.faqSection}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h3>Frequently Asked Questions</h3>
          <div className={styles.faqList}>
            {FAQS.map((f) => (
              <FAQ key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </motion.div>
      </section>

      {/* ══════ PRICING ══════ */}
      <section className={styles.section} id="pricing">
        <motion.div
          className={styles.sectionHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2>Simple <span className={styles.gradient}>pricing</span></h2>
          <p>Start free. Upgrade when you need more.</p>
        </motion.div>

        <div className={styles.pricingGrid}>
          <motion.div
            className={styles.pricingCard}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <div className={styles.pricingHeader}>
              <h3>Free</h3>
              <div className={styles.price}>$0<span>/forever</span></div>
            </div>
            <ul>
              <li><CheckCircle2 size={16} /> Search Scraper (25 per page)</li>
              <li><CheckCircle2 size={16} /> Profile Scanner (50/batch, 100/day)</li>
              <li><CheckCircle2 size={16} /> Company Scanner</li>
              <li><CheckCircle2 size={16} /> CSV &amp; JSON export</li>
              <li><CheckCircle2 size={16} /> 3 speed modes</li>
              <li><CheckCircle2 size={16} /> Scan history</li>
            </ul>
            <a
              href="https://github.com/NayeemAROI/salesnav-exporter/archive/refs/heads/main.zip"
              className={styles.btnPrimary}
            >
              <Download size={16} /> Download Now
            </a>
          </motion.div>

          <motion.div
            className={`${styles.pricingCard} ${styles.pricingPro}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <div className={styles.proBadge}>Coming Soon</div>
            <div className={styles.pricingHeader}>
              <h3>Pro</h3>
              <div className={styles.price}>TBD<span>/month</span></div>
            </div>
            <ul>
              <li><CheckCircle2 size={16} /> Everything in Free</li>
              <li><CheckCircle2 size={16} /> Unlimited profiles/day</li>
              <li><CheckCircle2 size={16} /> Excel (.xlsx) export</li>
              <li><CheckCircle2 size={16} /> Email extraction</li>
              <li><CheckCircle2 size={16} /> CRM / Webhook integration</li>
              <li><CheckCircle2 size={16} /> Scheduled scraping</li>
              <li><CheckCircle2 size={16} /> Priority support</li>
            </ul>
            <button className={styles.btnSecondary} disabled>
              <Clock size={16} /> Notify Me
            </button>
          </motion.div>
        </div>
      </section>

      {/* ══════ CTA FOOTER ══════ */}
      <section className={styles.ctaSection}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2>Ready to supercharge your <span className={styles.gradient}>LinkedIn outreach</span>?</h2>
          <p>Join hundreds of sales professionals who save hours every week.</p>
          <div className={styles.ctaButtons}>
            <a
              href="https://github.com/NayeemAROI/salesnav-exporter/archive/refs/heads/main.zip"
              className={styles.btnPrimary}
            >
              <Download size={18} /> Download Now — It&apos;s Free
            </a>
            <a
              href="https://github.com/NayeemAROI/salesnav-exporter"
              className={styles.btnGhost}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> View on GitHub
            </a>
          </div>
        </motion.div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>SN</div>
            <span>SalesNav Exporter</span>
          </div>
          <div className={styles.footerLinks}>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#docs">Docs</a>
            <a href="#pricing">Pricing</a>
            <a href="https://github.com/NayeemAROI/salesnav-exporter" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>
          </div>
          <p className={styles.footerNote}>
            Built with ❤️ for the sales community. Not affiliated with LinkedIn.
          </p>
        </div>
      </footer>
    </div>
  );
}
