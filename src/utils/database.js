```js
// src/utils/database.js
// Database facade / backward-compatible exports

import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';
import { BotConfig, getDefaultApplicationQuestions } from '../config/bot.js';

// Database wrapper
export {
    db,
    initializeDatabase,
    getFromDb,
    setInDb,
    deleteFromDb,
} from './database/wrapper.js';

// Database keys
export {
    getGuildConfigKey,
    getGuildBirthdaysKey,
    getBirthdayLeftBackupKey,
    getBirthdayTrackingKey,
    getTicketKey,
    getTicketCounterKey,
    getInviteTrackingKey,
    getMemberInvitesKey,
    getInviteUsesKey,
    getFakeAccountKey,
    getEconomyKey,
    getEconomyPrefix,
    getAFKKey,
    getWelcomeConfigKey,
    getLevelingKey,
    getUserLevelKey,
    getUserLevelPrefix,
    getApplicationRolesKey,
    getApplicationSettingsKey,
    getUserApplicationsKey,
    getApplicationKey,
    getApplicationsPrefix,
    getJoinToCreateConfigKey,
    getJoinToCreateChannelsKey,
    getWarningsKey,
    getWarningsPrefix,
    getUserNotesKey,
    getUserNotesListKey,
    getReactionRoleKey,
    getReactionRolesPrefix,
    getServerCountersKey,
    getGiveawayEntryKey,
    getGiveawayLockKey,
    canonicalizeKey,
    getLegacyVariantsForCanonical,
} from './database/keys.js';

// PostgreSQL
export { pgDb };

// --------------------------------------------------
// Helpers
// --------------------------------------------------

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
    let message = BotConfig?.messages?.[key] ?? key;

    for (const [name, value] of Object.entries(replacements)) {
        message = message.replace(
            new RegExp(`\\{${name}\\}`, 'g'),
            String(value)
        );
    }

    return message;
}

export function getColor(path, fallback = '#000000') {
    if (!path) return fallback;

    const parts = path.split('.');
    let current = BotConfig?.embeds?.colors;

    for (const part of parts) {
        if (!current || current[part] === undefined) {
            logger?.warn?.(
                `Color path '${path}' not found, using fallback`
            );
            return fallback;
        }

        current = current[part];
    }

    return typeof current === 'string' ? current : fallback;
}

// --------------------------------------------------
// Birthdays
// --------------------------------------------------

export async function getGuildBirthdays(client, guildId) {
    try {
        if (!client?.db?.get) {
            logger.error('Database client unavailable for birthdays.');
            return {};
        }

        const key = getGuildBirthdaysKey(guildId);
        const data = await client.db.get(key, {});

        return unwrapReplitData(data) || {};
    } catch (error) {
        logger.error(
            `Error getting birthdays for guild ${guildId}:`,
            error
        );
        return {};
    }
}

export async function setBirthday(client, guildId, userId, month, day) {
    try {
        if (!client?.db?.set) {
            logger.error('Database client unavailable for setBirthday.');
            return false;
        }

        const key = getGuildBirthdaysKey(guildId);
        const birthdays = await getGuildBirthdays(client, guildId);

        birthdays[userId] = {
            month: Number(month),
            day: Number(day),
        };

        await client.db.set(key, birthdays);
        return true;
    } catch (error) {
        logger.error(
            `Error setting birthday for ${userId}:`,
            error
        );
        return false;
    }
}

export async function deleteBirthday(client, guildId, userId) {
    try {
        if (!client?.db?.set) {
            logger.error('Database client unavailable for deleteBirthday.');
            return false;
        }

        const key = getGuildBirthdaysKey(guildId);
        const birthdays = await getGuildBirthdays(client, guildId);

        if (birthdays[userId]) {
            delete birthdays[userId];
            await client.db.set(key, birthdays);
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
        'December',
    ];

    const month = Number(monthNum);

    return month >= 1 && month <= 12
        ? months[month - 1]
        : 'Invalid Month';
}

// --------------------------------------------------
// Verification audit
// --------------------------------------------------

export async function insertVerificationAudit(record) {
    try {
        const { db, getFromDb, setInDb } =
            await import('./database/wrapper.js');

        if (!db.initialized) {
            await db.initialize();
        }

        if (
            db.isAvailable?.() &&
            typeof pgDb?.insertVerificationAudit === 'function'
        ) {
            return await pgDb.insertVerificationAudit(record);
        }

        const key = `verification:audit:${record.guildId}`;

        const existing = await getFromDb(key, []);
        const entries = Array.isArray(existing) ? existing : [];

        entries.push({
            ...record,
            createdAt:
                record.createdAt ||
                new Date().toISOString(),
        });

        const maxEntries =
            BotConfig?.verification?.maxInMemoryAuditEntries ?? 1000;

        if (entries.length > maxEntries) {
            entries.splice(0, entries.length - maxEntries);
        }

        await setInDb(key, entries);

        return true;
    } catch (error) {
        logger.error(
            'Error storing verification audit:',
            error
        );
        return false;
    }
}

// --------------------------------------------------
// Safe application defaults
// --------------------------------------------------

export function getDefaultApplicationSettings() {
    return {
        enabled: false,
        applicationChannelId: null,
        logChannelId: null,
        questions:
            typeof getDefaultApplicationQuestions === 'function'
                ? getDefaultApplicationQuestions()
                : [],
        roles: {
            admin: null,
            reviewer: null,
            accepted: null,
            denied: null,
        },
        requiredRoles: [],
        deniedRoles: [],
        minAccountAge: 0,
        maxApplications: 1,
        cooldown:
            BotConfig?.applications?.applicationCooldown ?? 7,
        allowMultipleApplications: false,
        requireVerification: false,
        customWelcomeMessage: '',
        pendingApplicationRetentionDays: 30,
        reviewedApplicationRetentionDays:
            BotConfig?.applications?.deleteApprovedAfter ?? 14,
    };
}
```
