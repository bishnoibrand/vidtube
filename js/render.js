import { icon, CATEGORY_ICONS } from "./icons.js";
import { hashString } from "./sanitize.js";
import { formatCount, formatCreated, formatDuration } from "./text.js";

const AVATAR_COLORS = ["#b91c1c", "#1d4ed8", "#047857", "#7c3aed", "#b45309", "#0f766e"];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "title") node.title = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "hidden") node.hidden = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  if (node) node.replaceChildren();
}

function avatarNode(video, round = true) {
  if (video.ownerAvatar) {
    const img = el("img", {
      class: round ? "avatar" : "avatar",
      alt: "",
      src: video.ownerAvatar,
      loading: "lazy",
      decoding: "async",
    });
    img.addEventListener("error", () => img.replaceWith(letterAvatar(video)));
    return img;
  }
  return letterAvatar(video);
}

function letterAvatar(video) {
  const label = (video.ownerName || "?").trim().charAt(0).toUpperCase() || "?";
  const color = AVATAR_COLORS[hashString(video.ownerId || video.ownerName) % AVATAR_COLORS.length];
  const node = el("span", { class: "avatar-fallback round", text: label });
  node.style.background = color;
  node.style.color = "#fff";
  return node;
}

function thumbImage(url, className) {
  const img = el("img", { alt: "", src: url, loading: "lazy", decoding: "async" });
  if (className) img.className = className;
  img.addEventListener("error", () => {
    const fallback = el("span", { class: "thumb-fallback" });
    fallback.append(icon("play"));
    img.replaceWith(fallback);
  });
  return img;
}

function metaLine(video) {
  const bits = [];
  if (video.mode === "live" && video.onair === true) {
    const audience = video.audience == null ? "Live now" : `${formatCount(video.audience)} watching`;
    bits.push(audience);
  } else if (video.views == null) {
    bits.push("Views unavailable");
  } else {
    bits.push(`${formatCount(video.views)} views`);
  }
  bits.push(formatCreated(video.createdTime));
  return bits.join(" · ");
}

export function videoCard(video, { onOpen, progress } = {}) {
  const thumb = el("span", { class: "thumb" }, [thumbImage(video.thumbnail)]);
  if (video.mode === "live" && video.onair === true) {
    thumb.append(el("span", { class: "badge live", text: "LIVE" }));
  } else {
    const duration = formatDuration(video.duration);
    if (duration) thumb.append(el("span", { class: "badge", text: duration }));
  }
  if (video.portrait && !video.short) {
    thumb.append(el("span", { class: "badge vert", text: "Vertical" }));
  }
  if (Number.isFinite(progress) && progress >= 0.02 && progress <= 1) {
    const bar = el("span", { class: "watch-progress" }, [
      el("span", { style: "" }),
    ]);
    bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
    thumb.append(bar);
  }
  const channel = el("p", { class: "channel-line" }, [
    el("span", { class: "ellipsis", text: video.ownerName }),
  ]);
  if (video.ownerVerified === true) {
    const mark = icon("check", "icon verified");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "Verified on Dailymotion");
    channel.append(mark);
  }
  const button = el("button", {
    class: "card",
    type: "button",
    "data-id": video.id,
    onclick: () => onOpen?.(video),
  }, [
    thumb,
    el("span", { class: "card-body" }, [
      avatarNode(video),
      el("span", { class: "card-copy" }, [
        el("span", { class: "card-title", text: video.title, title: video.title }),
        channel,
        el("p", { class: "meta-line", text: metaLine(video) }),
      ]),
    ]),
  ]);
  return button;
}

export function shortCard(video, onOpen) {
  const button = el("button", {
    class: "short-card",
    type: "button",
    onclick: () => onOpen?.(video),
  }, [
    thumbImage(video.thumbnail),
    el("span", { class: "shade" }, [
      el("strong", { text: video.title }),
      el("span", { text: video.views == null ? "Views unavailable" : `${formatCount(video.views)} views` }),
    ]),
  ]);
  return button;
}

export function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => el("div", { class: "skel-card", "aria-hidden": "true" }, [
    el("div", { class: "skel skel-thumb" }),
    el("div", { class: "skel skel-line", style: "width:72%" }),
    el("div", { class: "skel skel-line", style: "width:46%" }),
  ]));
}

export function shortSkeletons(count = 6) {
  return Array.from({ length: count }, () => el("div", { class: "short-skel skel", "aria-hidden": "true" }));
}

export function statusPanel({ title, message, actions = [] }) {
  const panel = el("div", { class: "panel" }, [
    el("h2", { text: title }),
    el("p", { text: message }),
  ]);
  if (actions.length) {
    const row = el("div", { class: "actions" });
    for (const action of actions) {
      row.append(el("button", {
        type: "button",
        class: action.primary ? "primary-btn" : "ghost-btn",
        onclick: action.onClick,
        text: action.label,
      }));
    }
    panel.append(row);
  }
  return panel;
}

export function recItem(video, onOpen) {
  const duration = formatDuration(video.duration);
  const thumb = el("span", { class: "rec-thumb" }, [thumbImage(video.thumbnailSmall || video.thumbnail)]);
  if (video.mode === "live" && video.onair) thumb.append(el("span", { class: "badge live", text: "LIVE" }));
  else if (duration) thumb.append(el("span", { class: "badge", text: duration }));
  return el("button", { class: "rec-item", type: "button", onclick: () => onOpen?.(video) }, [
    thumb,
    el("span", { class: "rec-copy" }, [
      el("span", { class: "card-title", text: video.title }),
      el("p", { class: "meta-line", text: video.ownerName }),
      el("p", { class: "meta-line", text: metaLine(video) }),
    ]),
  ]);
}

export function commentItem(comment) {
  const name = typeof comment?.["owner.screenname"] === "string" && comment["owner.screenname"].trim()
    ? comment["owner.screenname"].trim()
    : "Dailymotion user";
  const message = typeof comment?.message === "string" ? comment.message.trim() : "";
  if (!message) return null;
  const created = Number(comment.created_time);
  return el("article", { class: "comment" }, [
    el("span", { class: "avatar-fallback round", text: name.charAt(0).toUpperCase() }),
    el("div", {}, [
      el("strong", { text: name }),
      el("span", { class: "notice", text: ` · ${formatCreated(Number.isFinite(created) ? created : null)}` }),
      el("p", { text: message }),
    ]),
  ]);
}

export function chipButton(category, { active, onClick }) {
  return el("button", {
    type: "button",
    class: active ? "chip active" : "chip",
    role: "tab",
    "aria-selected": active ? "true" : "false",
    onclick: onClick,
    text: category.label,
  });
}

export function navButton({ id, label, iconName, active, onClick }) {
  return el("button", {
    type: "button",
    class: active ? "nav-btn active" : "nav-btn",
    "data-nav": id,
    "aria-current": active ? "page" : null,
    onclick: onClick,
  }, [icon(iconName), el("span", { text: label })]);
}

export function categoryIcon(id) {
  return CATEGORY_ICONS[id] || "play";
}

export function fillPlayerDetails(video, nodes, library) {
  nodes.heading.textContent = video.title;
  nodes.title.textContent = video.title;
  nodes.channel.textContent = video.ownerName;
  nodes.avatar.replaceChildren(avatarNode(video));
  const followerBits = [];
  if (video.followers == null) followerBits.push("Follower count unavailable");
  else followerBits.push(`${formatCount(video.followers)} followers on Dailymotion`);
  nodes.followers.textContent = followerBits.join("");
  nodes.verified.hidden = video.ownerVerified !== true;
  const viewText = video.mode === "live" && video.onair
    ? (video.audience == null ? "Live now" : `${formatCount(video.audience)} watching`)
    : (video.views == null ? "Views unavailable" : `${formatCount(video.views)} views`);
  const likeText = video.likes == null ? "Likes unavailable" : `${formatCount(video.likes)} likes on Dailymotion`;
  nodes.stats.textContent = `${viewText} · ${formatCreated(video.createdTime)} · ${likeText}`;
  const description = video.description || "No description was provided for this video.";
  nodes.description.textContent = description;
  nodes.description.classList.toggle("clamped", description.length > 180);
  nodes.more.hidden = description.length <= 180;
  nodes.more.textContent = "Show more";
  const following = library.isFollowing(video.ownerId);
  nodes.follow.textContent = following ? "Following" : "Follow";
  nodes.follow.setAttribute("aria-pressed", following ? "true" : "false");
  nodes.follow.disabled = !video.ownerId;
  nodes.follow.title = video.ownerId
    ? "Saved only on this device. VidTube has no subscription backend."
    : "This video has no channel id, so it cannot be followed.";
  const liked = library.isLiked(video.id);
  nodes.like.textContent = liked ? "Saved" : "Save";
  nodes.like.setAttribute("aria-pressed", liked ? "true" : "false");
  const later = library.isLater(video.id);
  nodes.later.textContent = later ? "In Watch later" : "Watch later";
  nodes.later.setAttribute("aria-pressed", later ? "true" : "false");
}
