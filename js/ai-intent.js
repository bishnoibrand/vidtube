/**
 * Detect explicit video commands without treating ordinary chat as a search.
 * A command must start with a supported verb. Substring matches such as
 * "research" or "display" are intentionally ignored.
 */

const SEARCH = /^(?:please\s+)?(?:search(?:\s+for)?|find(?:\s+me)?|look\s+up|show\s+me)\s+(.{2,120})$/i;
const PLAY = /^(?:please\s+)?(?:play|watch)\s+(.{2,120})$/i;
const CATEGORY = /^(?:please\s+)?(?:open|go\s+to|show)\s+(?:the\s+)?(trending|home|all|programming|music|comedy|live|gadgets|tech(?:nology)?(?:\s+&\s+gadgets)?|cooking|gaming|news|sports|education|motivation)(?:\s+videos?)?$/i;

const CATEGORY_ALIASES = {
  trending: "all",
  home: "all",
  all: "all",
  programming: "programming",
  music: "music",
  comedy: "comedy",
  live: "live",
  gadgets: "gadgets",
  tech: "gadgets",
  technology: "gadgets",
  "technology & gadgets": "gadgets",
  "tech & gadgets": "gadgets",
  cooking: "cooking",
  gaming: "gaming",
  news: "news",
  sports: "sports",
  education: "education",
  motivation: "motivation",
};

function tidy(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function detectVideoCommand(input) {
  const text = tidy(input);
  if (!text || text.length > 180) return null;

  const categoryMatch = text.match(CATEGORY);
  if (categoryMatch) {
    const key = categoryMatch[1].toLowerCase();
    const categoryId = CATEGORY_ALIASES[key];
    if (!categoryId) return null;
    return { type: "category", categoryId };
  }

  const searchMatch = text.match(SEARCH);
  if (searchMatch) {
    const query = tidy(searchMatch[1]).replace(/[.?!]+$/g, "").trim();
    if (query.length < 2) return null;
    return { type: "search", query };
  }

  const playMatch = text.match(PLAY);
  if (playMatch) {
    const query = tidy(playMatch[1]).replace(/[.?!]+$/g, "").trim();
    if (query.length < 2) return null;
    return { type: "play", query };
  }

  return null;
}
