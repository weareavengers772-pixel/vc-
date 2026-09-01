/**
 * Command Aliases Configuration
 * Maps shortened command names to their full command names
 */

export const commandAliases = {
    // =========================
    // ECONOMY
    // =========================
    'bal': 'balance',
    'money': 'balance',
    'cash': 'balance',

    'dep': 'deposit',
    'with': 'withdraw',
    'work': 'work',
    'daily': 'daily',
    'gamble': 'gamble',
    'bet': 'gamble',
    'rob': 'rob',
    'crime': 'crime',
    'pay': 'pay',
    'give': 'pay',
    'send': 'pay',

    // =========================
    // BASIC
    // =========================
    'ping': 'ping',
    'help': 'help',
    'h': 'help',
    'info': 'help',

    // =========================
    // MODERATION
    // =========================
    'ban': 'ban',
    'kick': 'kick',
    'mute': 'timeout',
    'warn': 'warn',
    'clear': 'purge',
    'purge': 'purge',
    'untimeout': 'untimeout',
    'unmute': 'untimeout',

    // =========================
    // LEVELING
    // =========================
    'rank': 'rank',
    'lvl': 'rank',
    'xp': 'rank',

    'leaderboard': 'leaderboard',
    'lb': 'leaderboard',
    'top': 'leaderboard',

    // =========================
    // SHOP
    // =========================
    'shop': 'shop',
    'buy': 'buy',
    'inventory': 'inventory',
    'inv': 'inventory',
    'items': 'inventory',

    // =========================
    // USER
    // =========================
    'user': 'userinfo',
    'userinfo': 'userinfo',
    'whois': 'userinfo',
    'ui': 'userinfo',

    'avatar': 'avatar',
    'pfp': 'avatar',
    'icon': 'avatar',

    // =========================
    // BIRTHDAY
    // =========================
    'bd': 'birthday',
    'bday': 'birthday',
    'b': 'birthday',

    // =========================
    // FUN
    // =========================
    'flip': 'flip',
    'coin': 'flip',
    'roll': 'roll',
    'dice': 'roll',
    'fight': 'fight',

    // =========================
    // GIVEAWAYS
    // =========================
    'gcreate': 'gcreate',
    'gstart': 'gcreate',

    'gend': 'gend',
    'gstop': 'gend',

    'gdelete': 'gdelete',

    'greroll': 'greroll',
    'groll': 'greroll',

    // =========================
    // TICKETS
    // =========================
    'ticket': 'ticket',
    't': 'ticket',
    'new': 'ticket',

    // =========================
    // VERIFICATION
    // =========================
    'ver': 'verify',
    'vadmin': 'verification',
    'av': 'autoverify',

    // =========================
    // WELCOME
    // =========================
    'welcome': 'welcome',
    'greet': 'greet',
    'goodbye': 'goodbye',
    'autorole': 'autorole',

    // =========================
    // TOOLS
    // =========================
    'calc': 'calculate',
    'math': 'calculate',
    'weather': 'weather',
    'todo': 'todo',
    'report': 'report',

    // =========================
    // SERVER STATS
    // =========================
    'serverstats': 'serverstats',
    'ss': 'serverstats',
    'sstats': 'serverstats',

    // =========================
    // REACTION ROLES
    // =========================
    'rr': 'reactroles',
    'reactionroles': 'reactroles',

    // =========================
    // VOICE
    // =========================
    'vc': 'vc',
    'voice': 'vc',
    'v': 'vc',

    // Join-to-create old names
    'jtc': 'vc',
    'jointocreate': 'vc',

    // =========================
    // MUSIC
    // =========================
    'np': 'nowplaying',
    'now': 'nowplaying',
};


/**
 * Subcommand aliases
 */
export const subcommandAliases = {

    // General
    'l': 'list',
    'ls': 'list',

    's': 'set',
    'i': 'info',

    'r': 'remove',
    'rm': 'remove',
    'del': 'remove',

    'n': 'next',
    'sc': 'setchannel',

    // Tasks
    'a': 'add',
    'c': 'complete',
    'done': 'complete',
    'd': 'complete',

    // Giveaways
    'start': 'create',
    'stop': 'end',
    'roll': 'reroll',

    // Generic
    'add': 'add',
    'remove': 'remove',
    'list': 'list',
};


/**
 * Resolve a command alias to its full command name
 *
 * @param {string} commandName
 * @returns {string}
 */
export function resolveCommandAlias(commandName) {
    if (!commandName) {
        return commandName;
    }

    const normalized = String(commandName)
        .trim()
        .toLowerCase();

    return commandAliases[normalized] || normalized;
}


/**
 * Resolve a subcommand alias to its full subcommand name
 *
 * @param {string} subcommandName
 * @returns {string}
 */
export function resolveSubcommandAlias(subcommandName) {
    if (!subcommandName) {
        return subcommandName;
    }

    const normalized = String(subcommandName)
        .trim()
        .toLowerCase();

    return subcommandAliases[normalized] || normalized;
}


/**
 * Check whether a command has an alias
 *
 * @param {string} commandName
 * @returns {boolean}
 */
export function hasCommandAlias(commandName) {
    if (!commandName) {
        return false;
    }

    const normalized = String(commandName)
        .trim()
        .toLowerCase();

    return Object.prototype.hasOwnProperty.call(
        commandAliases,
        normalized
    );
}


/**
 * Get all aliases for a command
 *
 * @param {string} commandName
 * @returns {string[]}
 */
export function getCommandAliases(commandName) {
    if (!commandName) {
        return [];
    }

    const normalized = String(commandName)
        .trim()
        .toLowerCase();

    return Object.entries(commandAliases)
        .filter(([, target]) => target === normalized)
        .map(([alias]) => alias);
}


/**
 * Get all aliases
 *
 * @returns {object}
 */
export function getAllCommandAliases() {
    return { ...commandAliases };
}
