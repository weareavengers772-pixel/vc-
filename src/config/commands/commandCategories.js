/**
 * Command category metadata for the command access manager.
 */

export const CATEGORY_ICONS = {
  Birthday: "🎂",
  Community: "👥",
  Core: "ℹ️",
  Economy: "💰",
  Fun: "🎮",
  Giveaway: "🎉",
  JoinToCreate: "🔌",
  Leveling: "📊",
  Logging: "📝",
  Moderation: "🛡️",
  Music: "🎵",
  Reaction_roles: "🎭",
  Search: "🔍",
  ServerStats: "📈",
  Ticket: "🎫",
  Tools: "🛠️",
  Utility: "🔧",
  Verification: "✅",
  Welcome: "👋",
};

/**
 * Commands that always stay available.
 */
export const PROTECTED_COMMANDS = new Set([
  "commands",
  "configwizard",
  "help",
  "ping",
]);

/**
 * Normalize category names.
 *
 * JoinToCreate
 * join_to_create
 * join-to-create
 * join to create
 *
 * all become:
 * jointocreate
 */
export function normalizeCategoryKey(category) {
  return String(category || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Format a category name for display.
 */
export function formatCategoryName(rawCategory) {
  const value = String(rawCategory || "")
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

  if (!value) {
    return "Unknown";
  }

  return value.replace(/\b\w/g, (char) =>
    char.toUpperCase()
  );
}

/**
 * Get the category icon.
 */
export function getCategoryIcon(category) {
  const normalized = normalizeCategoryKey(category);

  const icons = {
    birthday: "🎂",
    community: "👥",
    core: "ℹ️",
    economy: "💰",
    fun: "🎮",
    giveaway: "🎉",

    // Join To Create
    jointocreate: "🔌",

    leveling: "📊",
    logging: "📝",
    moderation: "🛡️",
    music: "🎵",
    reactionroles: "🎭",
    search: "🔍",
    serverstats: "📈",
    ticket: "🎫",
    tools: "🛠️",
    utility: "🔧",
    verification: "✅",
    welcome: "👋",
  };

  return icons[normalized] || "📁";
}
