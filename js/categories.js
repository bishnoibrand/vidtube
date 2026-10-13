/**
 * Single source of truth for category filters.
 * Queries and channel ids match Dailymotion's documented public filters.
 * Home/trending never sends the word "Trending" as a search.
 */

export const CHANNEL_LABELS = {
  animals: "Animals",
  auto: "Cars",
  people: "Celeb",
  fun: "Comedy & Entertainment",
  creation: "Creative",
  school: "Education",
  videogames: "Gaming",
  kids: "Kids",
  lifestyle: "Lifestyle & How-to",
  shortfilms: "Movies",
  music: "Music",
  news: "News",
  sport: "Sports",
  tech: "Tech",
  travel: "Travel",
  tv: "TV",
  webcam: "Webcam",
};

export const LANGUAGES = [
  { id: "", label: "Any language" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "ar", label: "Arabic" },
  { id: "pt", label: "Portuguese" },
  { id: "de", label: "German" },
];

export const CATEGORIES = [
  {
    id: "all",
    label: "All",
    kind: "trending",
    subtitle: "Trending on Dailymotion",
    sidebar: false,
  },
  {
    id: "programming",
    label: "Programming",
    kind: "search",
    search: "programming",
    sort: "relevance",
    preferredChannels: ["tech", "school", "creation"],
    subtitle: "Programming videos, ranked by relevance",
    sidebar: true,
    icon: "code",
  },
  {
    id: "music",
    label: "Music",
    kind: "channel",
    channel: "music",
    sort: "trending",
    subtitle: "Music category on Dailymotion",
    sidebar: true,
    icon: "music",
  },
  {
    id: "comedy",
    label: "Comedy",
    kind: "channel",
    channel: "fun",
    sort: "trending",
    subtitle: "Comedy & Entertainment category",
    sidebar: true,
    icon: "comedy",
  },
  {
    id: "live",
    label: "Live",
    kind: "live",
    subtitle: "Streams that are on air now",
    sidebar: true,
    icon: "live",
  },
  {
    id: "gadgets",
    label: "Tech & Gadgets",
    kind: "channel",
    channel: "tech",
    sort: "trending",
    preferredChannels: ["tech"],
    subtitle: "Tech category on Dailymotion",
    sidebar: true,
    icon: "tech",
  },
  {
    id: "cooking",
    label: "Cooking",
    kind: "search",
    search: "cooking recipes",
    sort: "relevance",
    preferredChannels: ["lifestyle"],
    subtitle: "Cooking and recipe videos",
    sidebar: true,
    icon: "cooking",
  },
  {
    id: "gaming",
    label: "Gaming",
    kind: "channel",
    channel: "videogames",
    sort: "trending",
    subtitle: "Gaming category on Dailymotion",
    sidebar: true,
    icon: "gaming",
  },
  {
    id: "news",
    label: "News",
    kind: "channel",
    channel: "news",
    sort: "recent",
    subtitle: "Latest videos in News",
    sidebar: true,
    icon: "news",
  },
  {
    id: "sports",
    label: "Sports",
    kind: "channel",
    channel: "sport",
    sort: "trending",
    subtitle: "Sports category on Dailymotion",
    sidebar: true,
    icon: "sports",
  },
  {
    id: "education",
    label: "Education",
    kind: "channel",
    channel: "school",
    sort: "trending",
    subtitle: "Education category on Dailymotion",
    sidebar: true,
    icon: "education",
  },
  {
    id: "motivation",
    label: "Motivation",
    kind: "search",
    search: "motivation",
    sort: "relevance",
    preferredChannels: ["people", "lifestyle", "school"],
    subtitle: "Motivation videos, ranked by relevance",
    sidebar: true,
    icon: "motivation",
  },
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function getCategory(id) {
  return BY_ID.get(id) || null;
}

export function channelLabel(id) {
  if (!id || typeof id !== "string") return null;
  return CHANNEL_LABELS[id] || null;
}

/**
 * Build Dailymotion list parameters.
 * Home never includes a search term. User search and category search are separate.
 */
export function buildListParams({
  mode,
  categoryId = "all",
  query = "",
  page = 1,
  limit = 20,
  language = "",
  fields,
}) {
  const category = getCategory(categoryId) || getCategory("all");
  const params = {
    fields,
    limit: String(limit),
    page: String(page),
    flags: "no_explicit",
  };
  if (language && /^[a-z]{2}$/i.test(language)) params.languages = language.toLowerCase();

  if (mode === "search") {
    params.search = query;
    params.sort = "relevance";
    return { params, category, mode: "search" };
  }

  if (mode === "popular") {
    params.sort = "visited-week";
    return {
      params,
      category: {
        id: "popular",
        label: "Most viewed",
        kind: "popular",
        subtitle: "Most viewed this week on Dailymotion. This is an explicit fallback, not a random topic.",
      },
      mode: "popular",
    };
  }

  if (!category || category.kind === "trending" || mode === "home") {
    params.sort = "trending";
    return { params, category: getCategory("all"), mode: "home" };
  }

  if (category.kind === "channel") {
    params.channel = category.channel;
    params.sort = category.sort || "trending";
    return { params, category, mode: "category" };
  }

  if (category.kind === "live") {
    params.flags = "live_onair,no_explicit";
    params.sort = "live-audience";
    return { params, category, mode: "category" };
  }

  if (category.kind === "search") {
    params.search = category.search;
    params.sort = category.sort || "relevance";
    return { params, category, mode: "category" };
  }

  params.sort = "trending";
  return { params, category: getCategory("all"), mode: "home" };
}

export function feedHeading({ mode, category, query }) {
  if (mode === "search") {
    return {
      title: "Search",
      subtitle: query ? `Results for “${query}”` : "Search",
    };
  }
  if (mode === "popular") {
    return {
      title: "Most viewed this week",
      subtitle: "Explicit fallback after trending failed. Not a random topic.",
    };
  }
  if (mode === "library") {
    return { title: category?.label || "Library", subtitle: category?.subtitle || "" };
  }
  if (!category || category.id === "all") {
    return {
      title: "Trending",
      subtitle: "Trending on Dailymotion, then ranked for variety and available quality signals",
    };
  }
  return {
    title: category.label,
    subtitle: category.subtitle || category.label,
  };
}
