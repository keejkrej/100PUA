import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ csvPath: string; slug: string; topicTitle: string; courseLine: string; outFile: string; queryPrefix: string; normalizeTitle?: (raw: string) => string }} TopicRecipe */

/**
 * YouTube CSV titles repeat "Stanford CS336 … | Spring 2025 | …". Keep the trailing session title only.
 * @param {string} raw
 */
function normalizeStanfordCs336Title(raw) {
  let s = raw.trim().replace(/\s+/g, " ");
  const lastPipe = s.lastIndexOf("|");
  if (lastPipe !== -1) {
    s = s.slice(lastPipe + 1).trim();
  }
  const m = s.match(/^(?:Lec(?:ture)?\.?|Lecture)\s*(\d+)\s*:\s*(.+)$/i);
  if (!m) {
    return s;
  }
  let rest = m[2].trim();
  rest = rest.replace(/\bPytorch\b/g, "PyTorch");
  rest = rest.replace(/^Mixture of experts$/i, "Mixture of Experts");
  rest = rest.replace(/^Scaling laws (\d+)/i, "Scaling Laws $1");
  rest = rest.replace(/^Alignment\s*-\s*/i, "Alignment — ");
  return `Session ${m[1]}: ${rest}`;
}

/**
 * @param {string} queryBody
 * @param {string[]} urls
 */
function appendResourceUrlsToQuery(queryBody, urls) {
  const list = (Array.isArray(urls) ? urls : []).map((u) => String(u).trim()).filter(Boolean);
  const b = queryBody.trimEnd();
  if (!list.length) return b;
  const missing = list.filter((u) => !b.includes(u));
  if (!missing.length) return b;
  const lines = missing.map((u) => `- ${u}`).join("\n");
  return `${b}\n\nReference URLs (use for context; do not claim you watched a video or accessed paywalled sources unless you can verify them):\n${lines}`;
}

/** @type {Record<string, TopicRecipe>} */
const TOPICS = {
  nonequilibrium: {
    csvPath: path.join(
      "C:",
      "Users",
      "ctyja",
      "Downloads",
      "Nonequilibrium Physics -- Stochastic Dynamics & Field Theories, LMU Munich, Summer Semester 2025.csv",
    ),
    slug: "nonequilibrium-lmu-ss2025",
    topicTitle: "Nonequilibrium Physics — stochastic dynamics & field theories",
    courseLine: "LMU Munich · Summer Semester 2025 · PhysicsOfLifeLMU playlist",
    outFile: "nonequilibrium-lmu-ss2025.json",
    queryPrefix: "Help me understand this topic (nonequilibrium / stochastic dynamics):\n\n",
  },
  "self-org": {
    csvPath: path.join(
      "C:",
      "Users",
      "ctyja",
      "Downloads",
      "Self-Organization and Pattern Formation, LMU Munich, Winter Semester 2025_2026.csv",
    ),
    slug: "self-organization-lmu-ws2025-2026",
    topicTitle: "Self-Organization and Pattern Formation",
    courseLine: "LMU Munich · Winter Semester 2025/26 · PhysicsOfLifeLMU playlist",
    outFile: "self-organization-lmu-ws2025-2026.json",
    queryPrefix: "Help me understand this topic (self-organization / pattern formation):\n\n",
  },
  "cs336-sp2025": {
    csvPath: path.join(
      "C:",
      "Users",
      "ctyja",
      "Downloads",
      "Stanford CS336 Language Modeling from Scratch I 2025.csv",
    ),
    slug: "stanford-cs336-language-modeling-spring2025",
    topicTitle: "Stanford CS336 — Language Modeling from Scratch",
    courseLine: "Spring 2025 · Stanford Online",
    outFile: "stanford-cs336-language-modeling-spring2025.json",
    queryPrefix:
      "Help me understand this topic from Stanford CS336 (language modeling / LLMs from scratch):\n\n",
    normalizeTitle: normalizeStanfordCs336Title,
  },
};

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * @param {string} key
 */
function main(key) {
  const recipe = TOPICS[key];
  if (!recipe) {
    console.error("Unknown topic:", key);
    console.error("Keys:", Object.keys(TOPICS).join(", "));
    process.exit(1);
  }
  const overridesPath = process.argv[3];
  const csvPath = overridesPath ?? recipe.csvPath;

  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw.trimEnd());
  const header = rows[0];
  const ti = header.indexOf("Title");
  const du = header.indexOf("Duration in timestamp");
  const vu = header.indexOf("Video url");

  /** @type {Array<{ id: string; title: string; query: string; resourceUrls: string[]; durationTimestamp: string }>} */
  const prompts = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.length || row.every((x) => x === "")) continue;

    /** @type {string} */
    let titleRaw = row[ti] ?? "";
    if (/\n|\r/.test(titleRaw)) {
      titleRaw = titleRaw.split(/\r?\n/)[0] ?? "";
    }
    let title = titleRaw.trim();
    if (recipe.normalizeTitle) {
      title = recipe.normalizeTitle(title);
    }

    const primaryUrl = (row[vu] ?? "").trim();
    if (!primaryUrl) continue;

    const m = primaryUrl.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    const id = m ? m[1] : `row-${r}`;
    const duration = du >= 0 ? (row[du] ?? "") : "";

    const resourceUrls = [primaryUrl];
    const query = appendResourceUrlsToQuery(recipe.queryPrefix + title, resourceUrls);
    prompts.push({ id, title, query, resourceUrls, durationTimestamp: duration });
  }

  const out = {
    slug: recipe.slug,
    topicTitle: recipe.topicTitle,
    courseLine: recipe.courseLine,
    promptCount: prompts.length,
    prompts,
  };

  const outPath = path.join(__dirname, "..", "src", "data", recipe.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.warn("wrote", outPath, prompts.length, "prompts");
}

const keyArg = process.argv[2];
if (!keyArg) {
  console.error("Usage: node scripts/import-topic.mjs <topicKey> [csvPathOverride]");
  console.error("Keys:", Object.keys(TOPICS).join(", "));
  process.exit(1);
}
main(keyArg);
