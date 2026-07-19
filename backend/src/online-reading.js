import { clean, ensureArray } from "./utils.js";

const DEFAULT_LIMIT = 8;
const FETCH_TIMEOUT_MS = 8000;

const QUERY_EXPANSIONS = [
  { pattern: /数据结构|复杂度|编程|代码|程序设计|软件工程|系统设计/, query: "data structures algorithms software engineering textbook survey" },
  { pattern: /机器学习|深度学习|人工智能|神经网络|模型评估|预测|数据分析|数据挖掘|分类|回归|模型/, query: "machine learning model evaluation prediction survey" },
  { pattern: /算法/, query: "data structures algorithms textbook survey" },
  { pattern: /英语|口语|语言|听力|发音/, query: "English speaking second language acquisition pronunciation" },
  { pattern: /金融|理财|投资|风险/, query: "personal finance financial literacy risk management" },
  { pattern: /设计|产品|用户体验|交互/, query: "product design user experience interaction design" }
];

const QUERY_STOPWORDS = new Set([
  "survey",
  "tutorial",
  "review",
  "foundation",
  "project",
  "complete",
  "explain",
  "results",
  "能够",
  "完成",
  "解释",
  "基础"
]);

export async function enrichInputWithOnlineReadings(input, options = {}) {
  const result = await collectOnlineReadingRecommendations(input, options);
  return {
    ...input,
    onlineReadingRecommendations: result.recommendations,
    onlineReadingStatus: result.status
  };
}

export async function collectOnlineReadingRecommendations(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const limit = Math.max(3, Math.min(12, Number(options.limit || DEFAULT_LIMIT)));
  const queries = buildOnlineReadingQueries(input).slice(0, 2);
  if (!fetchImpl || !queries.length) {
    return emptyResult("当前运行环境不支持联网检索，拓展阅读不会使用本地模板兜底。", queries);
  }

  const providerResults = [];
  for (const query of queries) {
    const settled = await Promise.allSettled([
      fetchOpenAlex(query, fetchImpl, limit),
      fetchCrossref(query, fetchImpl, limit),
      fetchArxiv(query, fetchImpl, Math.min(6, limit))
    ]);
    providerResults.push(...settled.map((result, index) => ({
      provider: ["OpenAlex", "Crossref", "arXiv"][index],
      ok: result.status === "fulfilled",
      value: result.status === "fulfilled" ? result.value : [],
      error: result.status === "rejected" ? String(result.reason?.message || result.reason) : null
    })));
  }

  const candidates = dedupeCandidates(providerResults.flatMap((item) => item.value));
  const recommendations = candidates
    .map((item) => ({ ...item, maturityScore: scoreCandidate(item, queries) }))
    .sort((left, right) => right.maturityScore - left.maturityScore || Number(right.year || 0) - Number(left.year || 0))
    .slice(0, limit)
    .map((item, index) => ({
      id: `online-reading-${index + 1}`,
      type: item.type || "online-literature",
      source: "online-scholarship",
      title: item.title,
      authors: item.authors,
      year: item.year,
      venue: item.venue,
      publisher: item.publisher,
      doi: item.doi,
      url: item.url,
      locator: item.doi ? `DOI: ${item.doi}` : item.url,
      provider: item.provider,
      citationCount: item.citationCount,
      abstract: item.abstract,
      citationId: item.doi || item.externalId || item.url,
      reason: buildEvidenceReason(item),
      recommendedFor: buildRecommendedFor(input),
      fetchedAt: new Date().toISOString()
    }));

  return {
    recommendations,
    status: {
      mode: "online-scholarship",
      query: queries.join(" | "),
      providers: providerResults.map(({ provider, ok, error, value }) => ({
        provider,
        ok,
        count: value.length,
        error
      })),
      candidateCount: candidates.length,
      recommendationCount: recommendations.length,
      fetchedAt: new Date().toISOString(),
      warning: recommendations.length
        ? ""
        : "未检索到带 DOI/URL 的成熟在线资料，系统不会用本地模板伪造拓展阅读。"
    }
  };
}

export function buildOnlineReadingQueries(input = {}) {
  const raw = [
    input.topic,
    input.goal,
    input.major,
    input.weaknesses
  ].map((item) => clean(item, 120)).filter(Boolean).join(" ");
  const expansion = QUERY_EXPANSIONS.find((item) => item.pattern.test(raw))?.query || raw;
  const topic = clean(input.topic, 80);
  return [
    [topic, expansion, "survey tutorial review"].filter(Boolean).join(" "),
    [expansion, clean(input.goal, 100)].filter(Boolean).join(" ")
  ].map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function fetchOpenAlex(query, fetchImpl, limit) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("sort", "cited_by_count:desc");
  url.searchParams.set("select", "id,doi,title,display_name,publication_year,cited_by_count,authorships,primary_location,locations,abstract_inverted_index,type");
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  const data = await fetchJson(url, fetchImpl);
  return ensureArray(data?.results, []).map((item) => {
    const urlValue = item.primary_location?.landing_page_url
      || ensureArray(item.locations, []).find((location) => location?.landing_page_url)?.landing_page_url
      || item.doi;
    return {
      provider: "OpenAlex",
      query,
      externalId: item.id,
      type: item.type || "scholarly-work",
      title: clean(item.display_name || item.title, 500),
      authors: ensureArray(item.authorships, [])
        .map((authorship) => authorship?.author?.display_name)
        .filter(Boolean)
        .slice(0, 6),
      year: Number(item.publication_year || 0) || null,
      venue: item.primary_location?.source?.display_name || "",
      publisher: item.primary_location?.source?.host_organization_name || "",
      doi: normalizeDoi(item.doi),
      url: normalizeUrl(urlValue),
      citationCount: Number(item.cited_by_count || 0),
      abstract: abstractFromOpenAlex(item.abstract_inverted_index)
    };
  }).filter(validOnlineReading);
}

async function fetchCrossref(query, fetchImpl, limit) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("sort", "is-referenced-by-count");
  url.searchParams.set("order", "desc");
  url.searchParams.set("select", "DOI,title,author,issued,published-print,published-online,URL,type,container-title,publisher,is-referenced-by-count,abstract");
  if (process.env.CROSSREF_MAILTO) url.searchParams.set("mailto", process.env.CROSSREF_MAILTO);
  const data = await fetchJson(url, fetchImpl);
  return ensureArray(data?.message?.items, []).map((item) => ({
    provider: "Crossref",
    query,
    externalId: item.DOI,
    type: item.type || "scholarly-work",
    title: clean(ensureArray(item.title, [])[0], 500),
    authors: ensureArray(item.author, [])
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 6),
    year: extractYear(item.issued || item["published-print"] || item["published-online"]),
    venue: clean(ensureArray(item["container-title"], [])[0], 180),
    publisher: clean(item.publisher, 180),
    doi: normalizeDoi(item.DOI),
    url: normalizeUrl(item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : "")),
    citationCount: Number(item["is-referenced-by-count"] || 0),
    abstract: clean(stripTags(item.abstract), 900)
  })).filter(validOnlineReading);
}

async function fetchArxiv(query, fetchImpl, limit) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const xml = await fetchText(url, fetchImpl);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const id = textFromXml(entry, "id");
    return {
      provider: "arXiv",
      query,
      externalId: id,
      type: "preprint",
      title: clean(textFromXml(entry, "title").replace(/\s+/g, " "), 500),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
        .map((author) => decodeXml(author[1]))
        .slice(0, 6),
      year: Number((textFromXml(entry, "published").match(/\d{4}/) || [])[0]) || null,
      venue: "arXiv",
      publisher: "arXiv",
      doi: normalizeDoi(textFromXml(entry, "arxiv:doi")),
      url: normalizeUrl(id),
      citationCount: 0,
      abstract: clean(textFromXml(entry, "summary").replace(/\s+/g, " "), 900)
    };
  }).filter(validOnlineReading);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchWithTimeout(url, fetchImpl, {
    headers: { Accept: "application/json", "User-Agent": "SoftwareCupLearningBot/1.0" }
  });
  return response.json();
}

async function fetchText(url, fetchImpl) {
  const response = await fetchWithTimeout(url, fetchImpl, {
    headers: { Accept: "application/atom+xml,text/xml", "User-Agent": "SoftwareCupLearningBot/1.0" }
  });
  return response.text();
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${url.hostname} 返回 ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function validOnlineReading(item) {
  return Boolean(item.title && (item.doi || item.url) && item.provider);
}

function dedupeCandidates(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = (item.doi || item.title || item.url || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function scoreCandidate(item, queries) {
  const relevance = relevanceScore(item, queries);
  const citationScore = Math.log10(Math.max(1, Number(item.citationCount || 0))) * 18;
  const year = Number(item.year || 0);
  const yearScore = year >= 2018 ? 8 : year >= 2010 ? 5 : year >= 2000 ? 2 : 0;
  const doiScore = item.doi ? 8 : 0;
  const venueScore = item.venue && item.venue !== "arXiv" ? 5 : 0;
  const maturity = citationScore + yearScore + doiScore + venueScore;
  return relevance ? maturity + relevance * 32 : maturity * 0.22;
}

function relevanceScore(item, queries) {
  const queryText = queries.join(" ").toLowerCase();
  const text = `${item.title || ""} ${item.abstract || ""} ${item.venue || ""}`.toLowerCase();
  const queryTokens = [...new Set(queryText.match(/[a-z][a-z0-9+#-]{3,}|[\u3400-\u9fff]{2,}/g) || [])]
    .filter((token) => !QUERY_STOPWORDS.has(token));
  const directMatches = queryTokens.filter((token) => text.includes(token)).length;
  let score = directMatches / Math.max(1, Math.min(8, queryTokens.length));
  if (/machine learning/.test(queryText)
    && /(machine learning|deep learning|transfer learning|neural network|random forest|scikit|tensorflow|support vector|model evaluation|prediction model|regression)/.test(text)) {
    score += 1;
  }
  if (/data structures|algorithms/.test(queryText)
    && /(data structure|algorithm|complexity|graph|tree|hash|sorting|dynamic programming)/.test(text)) {
    score += 1;
  }
  return Math.min(2, score);
}

function buildEvidenceReason(item) {
  const facts = [
    item.provider,
    item.year ? `${item.year} 年` : "",
    item.venue,
    item.citationCount ? `引用量 ${item.citationCount}` : "",
    item.doi ? `DOI ${item.doi}` : "公开 URL"
  ].filter(Boolean);
  return `来自在线资料元数据：${facts.join(" / ")}。`;
}

function buildRecommendedFor(input) {
  return [input.topic, input.goal].map((item) => clean(item, 80)).filter(Boolean).slice(0, 2);
}

function normalizeDoi(value) {
  return String(value || "").replace(/^https?:\/\/doi\.org\//i, "").trim();
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^10\.\d{4,9}\//.test(text)) return `https://doi.org/${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return "";
}

function abstractFromOpenAlex(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of ensureArray(positions, [])) words[Number(position)] = word;
  }
  return clean(words.filter(Boolean).join(" "), 900);
}

function extractYear(dateParts) {
  const year = Number(ensureArray(dateParts?.["date-parts"], [[]])[0]?.[0] || 0);
  return year || null;
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function textFromXml(entry, tag) {
  const escaped = tag.replace(":", "\\:");
  const match = entry.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function emptyResult(warning, queries = []) {
  return {
    recommendations: [],
    status: {
      mode: "online-scholarship",
      query: queries.join(" | "),
      providers: [],
      candidateCount: 0,
      recommendationCount: 0,
      fetchedAt: new Date().toISOString(),
      warning
    }
  };
}
