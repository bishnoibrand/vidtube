const ICONS = {
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM20 20l-3.5-3.5",
  close: "M6 6l12 12M18 6 6 18",
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z",
  bolt: "M13 3 5 14h7l-1 7 8-11h-7l1-7Z",
  history: "M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5M12 8v5l3 2",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  thumb: "M8 10V5.5a2.5 2.5 0 0 1 4.8-1L14 8h4.2a2 2 0 0 1 2 2.3l-1 6.2A2 2 0 0 1 17.2 18H8m0-8H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3",
  code: "M8 8 4 12l4 4M16 8l4 4-4 4M13 6l-2 12",
  music: "M9 18a3 3 0 1 1-2-2.8V6l12-2v10.2M19 16a3 3 0 1 1-2-2.8",
  comedy: "M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  live: "M5 8a7 7 0 0 1 0 8M19 8a7 7 0 0 0 0 8M8.5 10.5a3.5 3.5 0 0 1 0 3M15.5 10.5a3.5 3.5 0 0 0 0 3M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  tech: "M7 8h10v8H7V8ZM9 18h6M12 16v2M4 10h3M17 10h3M4 14h3M17 14h3",
  cooking: "M8 4v3M12 4v3M16 4v3M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z",
  gaming: "M6 10h12a4 4 0 0 1 4 4v1a3 3 0 0 1-3 3h-1l-2-2H8l-2 2H5a3 3 0 0 1-3-3v-1a4 4 0 0 1 4-4ZM8 13v3M6.5 14.5h3M16 13.5h.01M18 15.5h.01",
  news: "M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 1-3-3V5ZM8 9h8M8 13h8M8 17h5",
  sports: "M8 20h8M12 16v4M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  education: "M3 9 12 4l9 5-9 5-9-5ZM7 12v5c2 2 8 2 10 0v-5",
  motivation: "M12 3v3M5.6 5.6l2.1 2.1M3 12h3M5.6 18.4l2.1-2.1M12 21v-3M18.4 18.4l-2.1-2.1M21 12h-3M18.4 5.6l-2.1 2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1a3.5 3.5 0 0 0-2.5-3.3M16.5 5.2a3 3 0 0 1 0 5.6",
  share: "M12 4v10M8 8l4-4 4 4M5 14v5h14v-5",
  send: "M4 12 20 4l-6 16-2.5-6.5L4 12Z",
  spark: "M12 3l1.2 4.2L17 8.5l-3.8 1.3L12 14l-1.2-4.2L7 8.5l3.8-1.3L12 3ZM18 14l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2Z",
  back: "M15 5 8 12l7 7",
  chevron: "M9 6l6 6-6 6",
  alert: "M12 9v4M12 17h.01M10.3 4.6 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z",
  play: "M8 5v14l11-7-11-7Z",
  check: "M5 12.5 9.2 17 19 7",
  external: "M14 5h5v5M19 5l-9 9M10 6H6v12h12v-4",
  mic: "M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v3",
};

export function icon(name, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add(className);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] || ICONS.play);
  svg.appendChild(path);
  return svg;
}

export const CATEGORY_ICONS = {
  programming: "code",
  music: "music",
  comedy: "comedy",
  live: "live",
  gadgets: "tech",
  cooking: "cooking",
  gaming: "gaming",
  news: "news",
  sports: "sports",
  education: "education",
  motivation: "motivation",
};
