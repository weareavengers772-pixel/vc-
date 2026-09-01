/**
 * Canonical database key registry.
 *
 * All storage keys should be created through these helpers.
 * Keep this file dependency-free so it can never cause a circular import.
 */

export const getGuildConfigKey = (guildId) =>
    `guild:${guildId}:config`;

export const getGuildBirthdaysKey = (guildId) =>
    `guild:${guildId}:birthdays`;

export const getBirthdayLeftBackupKey = (guildId) =>
    `guild:${guildId}:birthdays:left`;

export const getBirthdayTrackingKey = (guildId) =>
    `guild:${guildId}:birthdays:tracking`;

export const getTicketKey = (guildId, channelId) =>
    `guild:${guildId}:ticket:${channelId}`;

export const getTicketCounterKey = (guildId) =>
    `guild:${guildId}:ticket:counter`;

export const getInviteTrackingKey = (guildId) =>
    `guild:${guildId}:invites`;

export const getMemberInvitesKey = (guildId, userId) =>
    `guild:${guildId}:invites:${userId}`;

export const getInviteUsesKey = (guildId, inviteCode) =>
    `guild:${guildId}:invite_uses:${inviteCode}`;

export const getFakeAccountKey = (guildId, userId) =>
    `guild:${guildId}:fake_account:${userId}`;

export const getEconomyKey = (guildId, userId) =>
    `guild:${guildId}:economy:${userId}`;

export const getEconomyPrefix = (guildId) =>
    `guild:${guildId}:economy:`;

export const getAFKKey = (guildId, userId) =>
    `guild:${guildId}:afk:${userId}`;

export const getWelcomeConfigKey = (guildId) =>
    `guild:${guildId}:welcome`;

export const getLevelingKey = (guildId) =>
    `guild:${guildId}:leveling:config`;

export const getUserLevelKey = (guildId, userId) =>
    `guild:${guildId}:leveling:users:${userId}`;

export const getUserLevelPrefix = (guildId) =>
    `guild:${guildId}:leveling:users:`;

export const getApplicationRolesKey = (guildId) =>
    `guild:${guildId}:applications:roles`;

export const getApplicationSettingsKey = (guildId) =>
    `guild:${guildId}:applications:settings`;

export const getUserApplicationsKey = (guildId, userId) =>
    `guild:${guildId}:applications:users:${userId}`;

export const getApplicationKey = (guildId, applicationId) =>
    `guild:${guildId}:applications:${applicationId}`;

export const getApplicationsPrefix = (guildId) =>
    `guild:${guildId}:applications:`;

export const getApplicationRoleSettingsKey = (guildId, roleId) =>
    `guild:${guildId}:applications:role:${roleId}:settings`;

export const getJoinToCreateConfigKey = (guildId) =>
    `guild:${guildId}:jointocreate`;

export const getJoinToCreateChannelsKey = (guildId) =>
    `guild:${guildId}:jointocreate:channels`;

export const getWarningsKey = (guildId, userId) =>
    `guild:${guildId}:warnings:${userId}`;

export const getWarningsPrefix = (guildId) =>
    `guild:${guildId}:warnings:`;

export const getUserNotesKey = (guildId, userId) =>
    `guild:${guildId}:usernotes:${userId}`;

export const getUserNotesListKey = (guildId) =>
    `guild:${guildId}:usernotes:list`;

export const getReactionRoleKey = (guildId, messageId) =>
    `guild:${guildId}:reaction_roles:${messageId}`;

export const getReactionRolesPrefix = (guildId) =>
    `guild:${guildId}:reaction_roles:`;

export const getServerCountersKey = (guildId) =>
    `guild:${guildId}:counters`;

export const getGiveawayEntryKey = (userId, giveawayId) =>
    `giveaway:${userId}:${giveawayId}`;

export const getGiveawayLockKey = (messageId) =>
    `giveaway:lock:${messageId}`;

/**
 * Validate IDs before creating keys.
 * This prevents accidental "undefined" database keys.
 */
function validId(value) {
    return (
        value !== undefined &&
        value !== null &&
        String(value).trim().length > 0
    );
}

/**
 * Canonicalize legacy keys.
 */
export const LEGACY_KEY_RESOLVERS = [
    {
        pattern: /^economy:([^:]+):([^:]+)$/,
        toCanonical: ([, guildId, userId]) =>
            getEconomyKey(guildId, userId),
    },

    {
        pattern: /^birthdays:([^:]+)$/,
        toCanonical: ([, guildId]) =>
            getGuildBirthdaysKey(guildId),
    },

    {
        pattern: /^([^:]+):leveling:users:([^:]+)$/,
        toCanonical: ([, guildId, userId]) =>
            getUserLevelKey(guildId, userId),
        skipIf: (guildId) => guildId === 'guild',
    },

    {
        pattern: /^moderation:warnings:([^:]+):([^:]+)$/,
        toCanonical: ([, guildId, userId]) =>
            getWarningsKey(guildId, userId),
    },

    {
        pattern: /^moderation_user_notes_([^_]+)_([^_]+)$/,
        toCanonical: ([, guildId, userId]) =>
            getUserNotesKey(guildId, userId),
    },

    {
        pattern: /^moderation_user_notes_list_([^_]+)$/,
        toCanonical: ([, guildId]) =>
            getUserNotesListKey(guildId),
    },

    {
        pattern: /^reaction_roles:([^:]+):([^:]+)$/,
        toCanonical: ([, guildId, messageId]) =>
            getReactionRoleKey(guildId, messageId),
    },

    {
        pattern: /^counters:([^:]+)$/,
        toCanonical: ([, guildId]) =>
            getServerCountersKey(guildId),
    },

    {
        pattern: /^bday-role-tracking-([^:]+)$/,
        toCanonical: ([, guildId]) =>
            getBirthdayTrackingKey(guildId),
    },
];

/**
 * Convert legacy storage keys to canonical keys.
 */
export function canonicalizeKey(key) {
    if (typeof key !== 'string' || !key) {
        return key;
    }

    for (const resolver of LEGACY_KEY_RESOLVERS) {
        const match = key.match(resolver.pattern);

        if (!match) {
            continue;
        }

        if (resolver.skipIf?.(match[1])) {
            continue;
        }

        try {
            const result = resolver.toCanonical(match);

            if (typeof result === 'string' && result.length > 0) {
                return result;
            }
        } catch {
            return key;
        }
    }

    return key;
}

/**
 * Return legacy keys for a canonical key.
 */
export function getLegacyVariantsForCanonical(canonicalKey) {
    if (typeof canonicalKey !== 'string' || !canonicalKey) {
        return [];
    }

    const variants = [];

    let match;

    match = canonicalKey.match(
        /^guild:([^:]+):economy:([^:]+)$/
    );

    if (match) {
        variants.push(`economy:${match[1]}:${match[2]}`);
    }

    match = canonicalKey.match(
        /^guild:([^:]+):birthdays$/
    );

    if (match) {
        variants.push(`birthdays:${match[1]}`);
    }

    match = canonicalKey.match(
        /^guild:([^:]+):leveling:users:([^:]+)$/
    );

    if (match) {
        variants.push(
            `${match[1]}:leveling:users:${match[2]}`
        );
    }

    match = canonicalKey.match(
        /^guild:([^:]+):warnings:([^:]+)$/
    );

    if (match) {
        variants.push(
            `moderation:warnings:${match[1]}:${match[2]}`
        );
    }

    match = canonicalKey.match(
        /^guild:([^:]+):usernotes:([^:]+)$/
    );

    if (match) {
        variants.push(
            `moderation_user_notes_${match[1]}_${match[2]}`
        );
    }

    match = canonicalKey.match(
        /^guild:([^:]+):usernotes:list$/
    );

    if (match) {
        variants.push(
            `moderation_user_notes_list_${match[1]}`
        );
    }

    match = canonicalKey.match(
        /^guild:([^:]+):reaction_roles:([^:]+)$/
    );

    if (match) {
        variants.push(
            `reaction_roles:${match[1]}:${match[2]}`
        );
    }

    match = canonicalKey.match(
        /^guild:([^:]+):counters$/
    );

    if (match) {
        variants.push(`counters:${match[1]}`);
    }

    match = canonicalKey.match(
        /^guild:([^:]+):birthdays:tracking$/
    );

    if (match) {
        variants.push(
            `bday-role-tracking-${match[1]}`
        );
    }

    return [...new Set(variants)];
}

/**
 * Safely build a key.
 */
export function safeKey(builder, ...args) {
    if (typeof builder !== 'function') {
        throw new TypeError('Database key builder must be a function');
    }

    if (args.some((value) => !validId(value))) {
        throw new Error(
            `Invalid database key arguments: ${args.join(', ')}`
        );
    }

    return builder(...args);
}
