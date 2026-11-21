import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/home/box/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js"));
}

const BASE = process.env.BASE || "https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev";
const OUT = process.env.OUT || "/workspace/verify";
const TAG = process.env.TAG || "check"; // before | after
const WIDTHS = [1440, 1280, 390];
const PAGES = [
  ["/", "overview"],
  ["/lifecycle", "lifecycle"],
  ["/billing", "billing"],
  ["/invoicing", "invoicing"],
  ["/cash", "cash"],
  ["/vendors", "vendors"],
  ["/gl", "gl"],
  ["/hops", "hops"],
  ["/authorization", "authorization"],
  ["/scheme", "scheme"],
  ["/bank", "bank"],
  ["/fees", "fees"],
  ["/terminals", "terminals"],
  ["/apm", "apm"],
  ["/fx", "fx"],
  ["/pricing", "pricing"],
  ["/payouts", "payouts"],
  ["/chargebacks", "chargebacks"],
  ["/agents", "agents"],
];

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function overlaps(page) {
  return page.evaluate(() => {
    const hidden = (el) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return true;
      return false;
    };
    const sels = [
      "h1", "h2", "h3", "p", "span", "label", "th", "td", "button", "a", "li",
      ".recharts-cartesian-axis-tick text",
      ".recharts-legend-item-text",
      ".recharts-label",
      ".react-flow__node",
      ".react-flow__edge-text",
      "svg text",
    ];
    const seen = new Set();
    const boxes = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el) || hidden(el)) continue;
        seen.add(el);
        // skip containers that only wrap other text elements
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 80) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.bottom < 0 || r.right < 0 || r.top > (innerHeight + 2000) || r.left > innerWidth) continue;
        boxes.push({
          text: text.slice(0, 60),
          x: r.x, y: r.y, w: r.width, h: r.height,
          path: el.className && String(el.className).toString ? String(el.className).toString().slice(0, 80) : el.tagName,
        });
      }
    }
    const hits = [];
    const area = (b) => b.w * b.h;
    const inter = (a, b) => {
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const r = Math.min(a.x + a.w, b.x + b.w);
      const bt = Math.min(a.y + a.h, b.y + b.h);
      const w = r - x, h = bt - y;
      if (w <= 1 || h <= 1) return 0;
      return w * h;
    };
    const contains = (a, b) =>
      a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (contains(a, b) || contains(b, a)) continue;
        const ia = inter(a, b);
        if (ia < 8) continue;
        const frac = ia / Math.min(area(a), area(b));
        if (frac < 0.12) continue;
        hits.push({ a: a.text, b: b.text, frac: Math.round(frac * 100) / 100, ia: Math.round(ia) });
      }
    }
    return { n: boxes.length, hits };
  });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = [];
mkdirSync(OUT, { recursive: true });

for (const width of WIDTHS) {
  const height = width === 390 ? 844 : 900;
  const page = await browser.newPage({
    viewport: { width, height },
    userAgent: UA,
  });
  page.setDefaultTimeout(45000);
  for (const [path, name] of PAGES) {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(800);
    const file = `${OUT}/v3-layout-${TAG}-${name}-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const { n, hits } = await overlaps(page);
    const rec = { tag: TAG, width, path, name, text_boxes: n, overlaps: hits.length, samples: hits.slice(0, 8), file };
    report.push(rec);
    console.log(`${TAG} ${width} ${path} boxes=${n} overlaps=${hits.length}` + (hits[0] ? ` e.g. "${hits[0].a}" ∩ "${hits[0].b}"` : ""));
  }
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/v3-layout-${TAG}-report.json`, JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.overlaps > 0);
console.log("SUMMARY", TAG, "pages_with_overlaps", bad.length, "/", report.length);
if (bad.length) {
  for (const r of bad) console.log("  FAIL", r.width, r.path, r.overlaps);
}
