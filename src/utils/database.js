```js
// src/utils/database.js
// Main database facade

import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';
import { BotConfig, getDefaultApplicationQuestions } from '../config/bot.js';

// ============================================================
// DATABASE WRAPPER
// ============================================================

export {
    db,
    initializeDatabase,
    getFromDb,
    setInDb,
    deleteFromDb,
} from './database/wrapper.js';

// ============================================================
// DATABASE KEYS
// ============================================================

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

// ============================================================
// POSTGRES
// ============================================================

export { pgDb };

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
                `Color path '${path}' not found. Using fallback.`
            );

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
            logger.error(
                'Database client is not available for getGuildBirthdays.'
            );

            return {};
        }

        const key = getGuildBirthdaysKey(guildId);
        const data = await client.db.get(key, {});

        const result = unwrapReplitData(data);

        return result && typeof result === 'object'
            ? result
            : {};
    } catch (error) {
        logger.error(
            `Error getting birthdays for guild ${guildId}:`,
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
            logger.error(
                'Database client is not available for setBirthday.'
            );

            return false;
        }

        const key = getGuildBirthdaysKey(guildId);

        const birthdays =
            await getGuildBirthdays(client, guildId);

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

export async function deleteBirthday(
    client,
    guildId,
    userId
) {
    try {
        if (!client?.db?.set) {
            logger.error(
                'Database client is not available for deleteBirthday.'
            );

            return false;
        }

        const key = getGuildBirthdaysKey(guildId);

        const birthdays =
            await getGuildBirthdays(client, guildId);

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
        'December',
    ];

    const month = Number(monthNum);

    if (month < 1 || month > 12) {
        return 'Invalid Month';
    }

    return months[month - 1];
}

// ============================================================
// VERIFICATION AUDIT
// ============================================================

export async function insertVerificationAudit(record) {
    try {
        if (!record || typeof record !== 'object') {
            return false;
        }

        const {
            db,
            getFromDb,
            setInDb,
        } = await import('./database/wrapper.js');

        if (!db.initialized) {
            await db.initialize();
        }

        if (
            db.isAvailable?.() &&
            typeof pgDb?.insertVerificationAudit === 'function'
        ) {
            return await pgDb.insertVerificationAudit(record);
        }

        const guildId = record.guildId;

        if (!guildId) {
            return false;
        }

        const key =
            `verification:audit:${guildId}`;

        const existing =
            await getFromDb(key, []);

        const entries =
            Array.isArray(existing)
                ? existing
                : [];

        entries.push({
            ...record,
            createdAt:
                record.createdAt ||
                new Date().toISOString(),
        });

        const maxEntries =
            BotConfig?.verification
                ?.maxInMemoryAuditEntries ?? 1000;

        if (entries.length > maxEntries) {
            entries.splice(
                0,
                entries.length - maxEntries
            );
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

// ============================================================
// APPLICATION DEFAULTS
// ============================================================

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
            BotConfig?.applications
                ?.applicationCooldown ?? 7,

        allowMultipleApplications: false,

        requireVerification: false,

        customWelcomeMessage: '',

        pendingApplicationRetentionDays: 30,

        reviewedApplicationRetentionDays:
            BotConfig?.applications
                ?.deleteApprovedAfter ?? 14,
    };
}

// ============================================================
// SAFETY
// ============================================================

process.on('unhandledRejection', (error) => {
    logger.error(
        'Unhandled database promise rejection:',
        error
    );
});

process.on('uncaughtException', (error) => {
    logger.error(
        'Uncaught database exception:',
        error
    );
});
```
