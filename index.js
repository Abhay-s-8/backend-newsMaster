require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const Parser = require("rss-parser");

const parser = new Parser();
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3001",
    "X-Title": "NewsMaster",
  },
});

// ─── GNews category mapping ───────────────────────────────────────────────────
const GNEWS_CATEGORY_MAP = {
  general:       "general",
  business:      "business",
  entertainment: "entertainment",
  health:        "health",
  science:       "science",
  sports:        "sports",
  technology:    "technology",
  defence:       "nation",
};

// ─── PIB RSS feeds per category ───────────────────────────────────────────────
// PIB ModIds: 6=General, 3=Defence, 44=Science & Tech, 36=Health, 48=Economy
const PIB_FEEDS = {
  general:       "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
  business:      "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
  technology:    "https://pib.gov.in/RssMain.aspx?ModId=44&Lang=1&Regid=3",
  health:        "https://pib.gov.in/RssMain.aspx?ModId=36&Lang=1&Regid=3",
  science:       "https://pib.gov.in/RssMain.aspx?ModId=44&Lang=1&Regid=3",
  sports:        "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
  entertainment: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
  defence:       "https://pib.gov.in/RssMain.aspx?ModId=3&Lang=1&Regid=3",
};

// ─── What each category means for CDS / UPSC aspirants ───────────────────────
// Used to inject exam-specific framing into the prompt so the AI
// knows exactly what angle, topics, and vocabulary to prioritise.
const EXAM_CONTEXT = {
  general: {
    examTopics: [
      "Polity & Governance", "Constitutional Amendments", "Government Schemes",
      "Cabinet decisions", "National awards & honours", "Supreme Court judgements",
      "Reports & indices released by government bodies",
    ],
    cdsAngle:  "Focus on topics likely in CDS GK paper: national events, defence ministry announcements, military exercises, government policies.",
    upscAngle: "Focus on GS Paper 2 (Governance, Polity) and GS Paper 3 (Economy, Security) angles. Note any policy implications.",
  },
  business: {
    examTopics: [
      "GDP & growth figures", "RBI policy decisions", "Inflation / CPI / WPI data",
      "Union Budget provisions", "FDI & FII flows", "PSU disinvestment",
      "Trade agreements & export-import data", "Banking sector reforms",
    ],
    cdsAngle:  "Highlight economic facts useful for CDS GK: key indices, government economic schemes, defence budget allocations.",
    upscAngle: "Frame through GS Paper 3 (Indian Economy): fiscal policy, monetary policy, inclusive growth, and infrastructure.",
  },
  technology: {
    examTopics: [
      "ISRO & space missions", "DRDO developments", "India's semiconductor policy",
      "Cybersecurity & IT Act amendments", "Digital India initiatives",
      "AI & emerging tech policy", "National Quantum Mission",
    ],
    cdsAngle:  "Emphasise defence technology: weapon systems, DRDO projects, indigenous defence manufacturing (Make in India defence).",
    upscAngle: "Frame for GS Paper 3 (Science & Tech): achievements, indigenisation, dual-use tech, and ethical/regulatory dimensions.",
  },
  health: {
    examTopics: [
      "National Health Mission", "AYUSHMAN Bharat", "WHO reports on India",
      "Disease outbreaks & India's response", "ICMR research",
      "New drug approvals", "Mental health policy",
    ],
    cdsAngle:  "Note health schemes relevant to armed forces personnel and ex-servicemen (ECHS, Military hospitals).",
    upscAngle: "Frame for GS Paper 2 (Social Justice): health indices, government schemes, and international health bodies.",
  },
  science: {
    examTopics: [
      "ISRO launches & missions", "Nuclear energy developments",
      "DRDO breakthroughs", "Climate & environment science",
      "National science awards", "India's R&D expenditure",
    ],
    cdsAngle:  "Highlight defence science: missile tests, naval technology, satellite-based surveillance, hypersonic research.",
    upscAngle: "Frame for GS Paper 3: recent developments in science, India's space programme, indigenisation of research.",
  },
  sports: {
    examTopics: [
      "Olympics & Commonwealth Games India performance",
      "Arjuna, Khel Ratna, Dronacharya Awards",
      "New sports policies & Khelo India",
      "International tournaments hosted by India",
      "India rankings in major sports",
    ],
    cdsAngle:  "Note sports achievements by armed forces athletes (Army, Navy, Air Force sports meets, Services quota).",
    upscAngle: "Frame for GS Paper 2: sports governance, welfare of athletes, soft power through sports diplomacy.",
  },
  entertainment: {
    examTopics: [
      "Dadasaheb Phalke Award", "National Film Awards",
      "UNESCO Intangible Cultural Heritage listings (India)",
      "Classical arts & culture policy",
      "Padma awards in arts & culture",
    ],
    cdsAngle:  "Focus on national awards and cultural heritage facts typically asked in CDS GK.",
    upscAngle: "Frame for GS Paper 1 (Art & Culture): classical traditions, UNESCO listings, government cultural schemes.",
  },
  defence: {
    examTopics: [
      "Military exercises (bilateral & multilateral)",
      "New weapon systems inducted (Army, Navy, Air Force, Coast Guard)",
      "Defence acquisitions & Make in India defence",
      "Chief of Defence Staff (CDS) & tri-service commands",
      "Border disputes & Line of Control / Line of Actual Control developments",
      "Defence Export targets & achievements",
      "DRDO test firings & missile programmes",
      "UN Peacekeeping missions (India's contribution)",
      "Defence budget & capital outlay",
      "Agnipath / Agniveer scheme updates",
    ],
    cdsAngle:  "This is the CORE CDS paper topic. Cover all three services (Army, Navy, IAF), ranks, exercises, doctrines, and new inductions with full specificity — names of ships, aircraft, missile systems, and exercise locations.",
    upscAngle: "Frame for GS Paper 3 (Internal Security & Defence): border management, military modernisation, civil-military relations, and India's strategic posture.",
  },
};

const MODEL = "google/gemini-2.5-flash";

// ─── Dynamic system prompt ────────────────────────────────────────────────────
function buildSystemPrompt(category) {
  const ctx = EXAM_CONTEXT[category] || EXAM_CONTEXT.general;
  const topicList = ctx.examTopics.map(t => `  • ${t}`).join("\n");

  return `
You are NewsMaster AI — a specialised current-affairs tutor for UPSC Civil Services
and CDS (Combined Defence Services) examination aspirants in India.

════════════════════════════════════════
SELECTED CATEGORY : ${category.toUpperCase()}
TARGET EXAMS      : UPSC CSE  |  CDS (I & II)
════════════════════════════════════════

STEP 1 — FILTER
Read every article provided. Retain ONLY those relevant to the category
"${category}". Silently discard off-topic articles.

STEP 2 — EXAM-SPECIFIC TOPICS TO PRIORITISE
The following sub-topics are frequently tested for this category:
${topicList}

STEP 3 — CDS ANGLE
${ctx.cdsAngle}

STEP 4 — UPSC ANGLE
${ctx.upscAngle}

STEP 5 — SUMMARY (strictly ~700 words)
Write a single cohesive prose summary (~700 words, never fewer than 600).
Rules:
- Cover ONLY "${category}" news.
- Analytical, newspaper-editorial tone — not bullet points.
- Open with the most significant development.
- Weave in exam-relevant framing: constitutional provisions, article numbers,
  scheme names, committee names, index ranks, treaty names, exercise names, etc.
- Name every key person, place, date, and statistic present in the articles.
- Close with a "significance" paragraph explaining why these developments matter
  for UPSC/CDS aspirants.

STEP 6 — KEY FACTS (8–12 items)
Short, standalone, exam-ready facts. Each fact must be self-contained — a student
should be able to read it in isolation and retain it. Include numbers, names,
dates, and ranks wherever possible.

STEP 7 — QUICK REVISION POINTS (8-12 items)
One-liner mnemonics or connecting statements. Designed to be read aloud the night
before the exam. Format: "<Subject> → <key detail>".

OUTPUT FORMAT — Return ONLY this JSON object, no markdown, no code fences:

{
  "summary": "<~400 word prose>",
  "keyFacts": ["<fact>", ...],
  "quickRevisionPoints": ["<Subject> → <detail>", ...]
}
`.trim();
}

// ─── RSS helper ───────────────────────────────────────────────────────────────
async function getRSSNews(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items.slice(0, 12).map(item => ({
      title:       item.title || "",
      description: item.contentSnippet || item.content || item.summary || "",
    }));
  } catch (err) {
    console.error("RSS fetch error:", err.message);
    return [];
  }
}

// ─── /api/news ────────────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  try {
    const { category = "general", fromDate, toDate } = req.body;

    const gnewsCategory = GNEWS_CATEGORY_MAP[category] || "general";

    const gnewsParams = {
      category: gnewsCategory,
      country:  "in",
      lang:     "en",
      max:      6,
      apikey:   process.env.GNEWS_API_KEY,
    };

    if (fromDate) gnewsParams.from = new Date(fromDate).toISOString();
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      gnewsParams.to = end.toISOString();
    }

    const [gnewsResponse, pibNews] = await Promise.all([
      axios.get("https://gnews.io/api/v4/top-headlines", { params: gnewsParams }),
      getRSSNews(PIB_FEEDS[category] || PIB_FEEDS.general),
    ]);

    const gnewsArticles = (gnewsResponse.data.articles || []).map(a => ({
      title:       a.title || "",
      description: a.description || "",
    }));

    const allNews = [...gnewsArticles, ...pibNews];

    if (!allNews.length) {
      return res.json({
        summary:             "No news articles found for this category and date range.",
        keyFacts:            [],
        quickRevisionPoints: [],
      });
    }

    console.log(`[${category}] ${allNews.length} articles → AI`);

    const articleText = allNews
      .map(item => `Title: ${item.title}\nDescription: ${item.description}`)
      .join("\n\n---\n\n");

    const aiResponse = await client.chat.completions.create({
      model:           MODEL,
      max_tokens:      2500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(category) },
        { role: "user",   content: articleText },
      ],
    });

    let raw = aiResponse.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let content;
    try {
      content = JSON.parse(raw);
    } catch {
      return res.json({ summary: raw, keyFacts: [], quickRevisionPoints: [] });
    }

    return res.json(content);

  } catch (error) {
    console.error("Server error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`NewsMaster server running on port ${port}`);
});