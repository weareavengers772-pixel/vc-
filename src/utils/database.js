// src/utils/database.js
// Safe database facade
// Location: src/utils/database.js

import { logger } from './logger.js';

// ============================================================
// SAFE IMPORTS
// ============================================================

let wrapper = null;
let keys = null;
let pgDb = null;
let BotConfig = {};

let databaseLoaded = false;

// Load database modules without crashing the bot on startup
async function loadDatabase() {
    if (databaseLoaded) return;

    databaseLoaded = true;

    try {
        wrapper = await import('./database/wrapper.js');
    } catch (error) {
        logger.error('Could not load database/wrapper.js:', error);
        wrapper = {};
    }

    try {
        keys = await import('./database/keys.js');
    } catch (error) {
        logger.error('Could not load database/keys.js:', error);
        keys = {};
    }

    try {
        const postgres = await import('./postgresDatabase.js');
        pgDb = postgres.pgDb ?? postgres.default ?? null;
    } catch (error) {
        logger.warn(
            'PostgreSQL module could not be loaded. Continuing without PostgreSQL.'
        );
        pgDb = null;
    }

    try {
        const config = await import('../config/bot.js');
        BotConfig = config.BotConfig ?? config.default ?? {};
    } catch (error) {
        logger.warn(
            'Bot config could not be loaded. Using defaults.'
        );
        BotConfig = {};
    }
}

// ============================================================
// DATABASE
// ============================================================

export const db = {
    get initialized() {
        return Boolean(wrapper?.db?.initialized);
    },

    get pool() {
        return wrapper?.db?.pool ?? null;
    },

    async initialize() {
        await loadDatabase();

        if (typeof wrapper?.initializeDatabase === 'function') {
            return wrapper.initializeDatabase();
        }

        if (typeof wrapper?.db?.initialize === 'function') {
            return wrapper.db.initialize();
        }

        return false;
    },

    isAvailable() {
        try {
            if (typeof wrapper?.db?.isAvailable === 'function') {
                return wrapper.db.isAvailable();
            }

            return false;
        } catch {
            return false;
        }
    },

    isDegraded() {
        try {
            if (typeof wrapper?.db?.isDegraded === 'function') {
                return wrapper.db.isDegraded();
            }

            return false;
        } catch {
            return false;
        }
    },

    async get(key, fallback = null) {
        await loadDatabase();

        try {
            if (typeof wrapper?.getFromDb === 'function') {
                return await wrapper.getFromDb(key, fallback);
            }

            if (typeof wrapper?.db?.get === 'function') {
                return await wrapper.db.get(key, fallback);
            }

            return fallback;
        } catch (error) {
            logger.error(`Database GET failed for ${key}:`, error);
            return fallback;
        }
    },

    async set(key, value) {
        await loadDatabase();

        try {
            if (typeof wrapper?.setInDb === 'function') {
                return await wrapper.setInDb(key, value);
            }

            if (typeof wrapper?.db?.set === 'function') {
                return await wrapper.db.set(key, value);
            }

            return false;
        } catch (error) {
            logger.error(`Database SET failed for ${key}:`, error);
            return false;
        }
    },

    async delete(key) {
        await loadDatabase();

        try {
            if (typeof wrapper?.deleteFromDb === 'function') {
                return await wrapper.deleteFromDb(key);
            }

            if (typeof wrapper?.db?.delete === 'function') {
                return await wrapper.db.delete(key);
            }

            return false;
        } catch (error) {
            logger.error(`Database DELETE failed for ${key}:`, error);
            return false;
        }
    },

    async list(prefix = '') {
        await loadDatabase();

        try {
            if (typeof wrapper?.db?.list === 'function') {
                return await wrapper.db.list(prefix);
            }

            if (typeof wrapper?.listKeys === 'function') {
                return await wrapper.listKeys(prefix);
            }

            return [];
        } catch (error) {
            logger.error(`Database LIST failed for ${prefix}:`, error);
            return [];
        }
    }
};

// ============================================================
// BACKWARD COMPATIBILITY
// ============================================================

export async function initializeDatabase() {
    return db.initialize();
}

export async function getFromDb(key, fallback = null) {
    return db.get(key, fallback);
}

export async function setInDb(key, value) {
    return db.set(key, value);
}

export async function deleteFromDb(key) {
    return db.delete(key);
}

// ============================================================
// KEY FUNCTIONS
// ============================================================

function safeKey(name, fallback, args) {
    try {
        const fn = keys?.[name];

        if (typeof fn === 'function') {
            return fn(...args);
        }

        return fallback(...args);
    } catch (error) {
        logger.error(`Database key error (${name}):`, error);
        return fallback(...args);
    }
}

export function getGuildConfigKey(guildId) {
    return safeKey(
        'getGuildConfigKey',
        id => `guild:${id}:config`,
        [guildId]
    );
}

export function getGuildBirthdaysKey(guildId) {
    return safeKey(
        'getGuildBirthdaysKey',
        id => `guild:${id}:birthdays`,
        [guildId]
    );
}

export function getLevelingKey(guildId) {
    return safeKey(
        'getLevelingKey',
        id => `guild:${id}:leveling`,
        [guildId]
    );
}

export function getUserLevelKey(guildId, userId) {
    return safeKey(
        'getUserLevelKey',
        (g, u) => `guild:${g}:level:${u}`,
        [guildId, userId]
    );
}

export function getUserLevelPrefix(guildId) {
    return safeKey(
        'getUserLevelPrefix',
        id => `guild:${id}:level:`,
        [guildId]
    );
}

export function getWelcomeConfigKey(guildId) {
    return safeKey(
        'getWelcomeConfigKey',
        id => `guild:${id}:welcome`,
        [guildId]
    );
}

export function getEconomyKey(guildId, userId) {
    return safeKey(
        'getEconomyKey',
        (g, u) => `guild:${g}:economy:${u}`,
        [guildId, userId]
    );
}

export function getEconomyPrefix(guildId) {
    return safeKey(
        'getEconomyPrefix',
        id => `guild:${id}:economy:`,
        [guildId]
    );
}

export function getAFKKey(guildId, userId) {
    return safeKey(
        'getAFKKey',
        (g, u) => `guild:${g}:afk:${u}`,
        [guildId, userId]
    );
}

export function getApplicationRolesKey(guildId) {
    return safeKey(
        'getApplicationRolesKey',
        id => `guild:${id}:application-roles`,
        [guildId]
    );
}

export function getApplicationSettingsKey(guildId) {
    return safeKey(
        'getApplicationSettingsKey',
        id => `guild:${id}:application-settings`,
        [guildId]
    );
}

export function getUserApplicationsKey(guildId, userId) {
    return safeKey(
        'getUserApplicationsKey',
        (g, u) => `guild:${g}:applications:user:${u}`,
        [guildId, userId]
    );
}

export function getApplicationKey(guildId, applicationId) {
    return safeKey(
        'getApplicationKey',
        (g, a) => `guild:${g}:applications:${a}`,
        [guildId, applicationId]
    );
}

export function getApplicationsPrefix(guildId) {
    return safeKey(
        'getApplicationsPrefix',
        id => `guild:${id}:applications:`,
        [guildId]
    );
}

export function getJoinToCreateConfigKey(guildId) {
    return safeKey(
        'getJoinToCreateConfigKey',
        id => `guild:${id}:jointocreate`,
        [guildId]
    );
}

export function getJoinToCreateChannelsKey(guildId) {
    return safeKey(
        'getJoinToCreateChannelsKey',
        id => `guild:${id}:jointocreate:channels`,
        [guildId]
    );
}

// ============================================================
// GENERIC KEY FALLBACKS
// ============================================================

export function getBirthdayLeftBackupKey(guildId) {
    return safeKey(
        'getBirthdayLeftBackupKey',
        id => `guild:${id}:birthday:left-backup`,
        [guildId]
    );
}

export function getBirthdayTrackingKey(guildId) {
    return safeKey(
        'getBirthdayTrackingKey',
        id => `guild:${id}:birthday:tracking`,
        [guildId]
    );
}

export function getTicketKey(guildId, ticketId) {
    return safeKey(
        'getTicketKey',
        (g, t) => `guild:${g}:tickets:${t}`,
        [guildId, ticketId]
    );
}

export function getTicketCounterKey(guildId) {
    return safeKey(
        'getTicketCounterKey',
        id => `guild:${id}:tickets:counter`,
        [guildId]
    );
}

export function getInviteTrackingKey(guildId) {
    return safeKey(
        'getInviteTrackingKey',
        id => `guild:${id}:invites`,
        [guildId]
    );
}

export function getMemberInvitesKey(guildId, userId) {
    return safeKey(
        'getMemberInvitesKey',
        (g, u) => `guild:${g}:invites:member:${u}`,
        [guildId, userId]
    );
}

export function getInviteUsesKey(guildId, inviteCode) {
    return safeKey(
        'getInviteUsesKey',
        (g, i) => `guild:${g}:invites:uses:${i}`,
        [guildId, inviteCode]
    );
}

export function getFakeAccountKey(guildId, userId) {
    return safeKey(
        'getFakeAccountKey',
        (g, u) => `guild:${g}:fake:${u}`,
        [guildId, userId]
    );
}

export function getWarningsKey(guildId, userId) {
    return safeKey(
        'getWarningsKey',
        (g, u) => `guild:${g}:warnings:${u}`,
        [guildId, userId]
    );
}

export function getWarningsPrefix(guildId) {
    return safeKey(
        'getWarningsPrefix',
        id => `guild:${id}:warnings:`,
        [guildId]
    );
}

export function getUserNotesKey(guildId, userId) {
    return safeKey(
        'getUserNotesKey',
        (g, u) => `guild:${g}:notes:${u}`,
        [guildId, userId]
    );
}

export function getUserNotesListKey(guildId) {
    return safeKey(
        'getUserNotesListKey',
        id => `guild:${id}:notes`,
        [guildId]
    );
}

export function getReactionRoleKey(guildId, messageId) {
    return safeKey(
        'getReactionRoleKey',
        (g, m) => `guild:${g}:reactionroles:${m}`,
        [guildId, messageId]
    );
}

export function getReactionRolesPrefix(guildId) {
    return safeKey(
        'getReactionRolesPrefix',
        id => `guild:${id}:reactionroles:`,
        [guildId]
    );
}

export function getServerCountersKey(guildId) {
    return safeKey(
        'getServerCountersKey',
        id => `guild:${id}:counters`,
        [guildId]
    );
}

export function getGiveawayEntryKey(guildId, giveawayId) {
    return safeKey(
        'getGiveawayEntryKey',
        (g, i) => `guild:${g}:giveaway:${i}:entries`,
        [guildId, giveawayId]
    );
}

export function getGiveawayLockKey(guildId, giveawayId) {
    return safeKey(
        'getGiveawayLockKey',
        (g, i) => `guild:${g}:giveaway:${i}:lock`,
        [guildId, giveawayId]
    );
}

export function canonicalizeKey(key) {
    try {
        if (typeof keys?.canonicalizeKey === 'function') {
            return keys.canonicalizeKey(key);
        }

        return key;
    } catch {
        return key;
    }
}

export function getLegacyVariantsForCanonical(key) {
    try {
        if (
            typeof keys?.getLegacyVariantsForCanonical ===
            'function'
        ) {
            return keys.getLegacyVariantsForCanonical(key);
        }

        return [];
    } catch {
        return [];
    }
}

// ============================================================
// HELPERS
// ============================================================

export function unwrapReplitData(data) {
    if (
        data &&
        typeof data === 'object' &&
        data.ok !== undefined &&
        data.value !== undefined
    ) {
        return unwrapReplitData(data.value);
    }

    return data;
}

export function getMessage(key, replacements = {}) {
    let message =
        BotConfig?.messages?.[key] ??
        key;

    for (const [name, value] of Object.entries(replacements)) {
        message = String(message).replace(
            new RegExp(`\\{${name}\\}`, 'g'),
            String(value)
        );
    }

    return message;
}

export function getColor(path, fallback = '#000000') {
    if (!path) return fallback;

    let current =
        BotConfig?.embeds?.colors;

    for (const part of String(path).split('.')) {
        if (
            !current ||
            typeof current !== 'object' ||
            current[part] === undefined
        ) {
            return fallback;
        }

        current = current[part];
    }

    return typeof current === 'string'
        ? current
        : fallback;
}

// ============================================================
// BIRTHDAYS
// ============================================================

export async function getGuildBirthdays(client, guildId) {
    try {
        if (!client?.db?.get) {
            return {};
        }

        const key =
            getGuildBirthdaysKey(guildId);

        const data =
            await client.db.get(key, {});

        const result =
            unwrapReplitData(data);

        return result &&
            typeof result === 'object'
            ? result
            : {};
    } catch (error) {
        logger.error(
            `Error getting birthdays for ${guildId}:`,
            error
        );

        return {};
    }
}

export async function setBirthday(
    client,
    guildId,
    userId,
    month,
    day
) {
    try {
        if (!client?.db?.set) {
            return false;
        }

        const key =
            getGuildBirthdaysKey(guildId);

        const birthdays =
            await getGuildBirthdays(
                client,
                guildId
            );

        birthdays[userId] = {
            month: Number(month),
            day: Number(day)
        };

        await client.db.set(
            key,
            birthdays
        );

        return true;
    } catch (error) {
        logger.error(
            `Error setting birthday for ${userId}:`,
            error
        );

        return false;
    }
}

export async function deleteBirthday(
    client,
    guildId,
    userId
) {
    try {
        if (!client?.db?.set) {
            return false;
        }

        const key =
            getGuildBirthdaysKey(guildId);

        const birthdays =
            await getGuildBirthdays(
                client,
                guildId
            );

        if (birthdays[userId]) {
            delete birthdays[userId];

            await client.db.set(
                key,
                birthdays
            );
        }

        return true;
    } catch (error) {
        logger.error(
            `Error deleting birthday for ${userId}:`,
            error
        );

        return false;
    }
}

export function getMonthName(monthNum) {
    const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ];

    const month =
        Number(monthNum);

    return month >= 1 &&
        month <= 12
        ? months[month - 1]
        : 'Invalid Month';
}

// ============================================================
// VERIFICATION AUDIT
// ============================================================

export async function insertVerificationAudit(record) {
    try {
        if (!record || typeof record !== 'object') {
            return false;
        }

        await loadDatabase();

        if (
            pgDb &&
            typeof pgDb.insertVerificationAudit ===
                'function'
        ) {
            try {
                return await pgDb.insertVerificationAudit(
                    record
                );
            } catch (error) {
                logger.error(
                    'PostgreSQL verification audit failed:',
                    error
                );
            }
        }

        if (!record.guildId) {
            return false;
        }

        const key =
            `verification:audit:${record.guildId}`;

        const existing =
            await db.get(key, []);

        const entries =
            Array.isArray(existing)
                ? existing
                : [];

        entries.push({
            ...record,
            createdAt:
                record.createdAt ??
                new Date().toISOString()
        });

        const maxEntries =
            BotConfig?.verification
                ?.maxInMemoryAuditEntries ??
            1000;

        if (entries.length > maxEntries) {
            entries.splice(
                0,
                entries.length - maxEntries
            );
        }

        await db.set(
            key,
            entries
        );

        return true;
    } catch (error) {
        logger.error(
            'Verification audit error:',
            error
        );

        return false;
    }
}

// ============================================================
// APPLICATION DEFAULTS
// ============================================================

export function getDefaultApplicationSettings() {
    let questions = [];

    try {
        const fn =
            BotConfig?.getDefaultApplicationQuestions;

        if (typeof fn === 'function') {
            questions = fn();
        }
    } catch {
        questions = [];
    }

    return {
        enabled: false,
        applicationChannelId: null,
        logChannelId: null,
        questions,
        roles: {
            admin: null,
            reviewer: null,
            accepted: null,
            denied: null
        },
        requiredRoles: [],
        deniedRoles: [],
        minAccountAge: 0,
        maxApplications: 1,
        cooldown:
            BotConfig?.applications
                ?.applicationCooldown ?? 7,
        allowMultipleApplications: false,
        requireVerification: false,
        customWelcomeMessage: '',
        pendingApplicationRetentionDays: 30,
        reviewedApplicationRetentionDays:
            BotConfig?.applications
                ?.deleteApprovedAfter ?? 14
    };
}

// ============================================================
// EXPORT POSTGRES
// ============================================================

export {
    pgDb
};
