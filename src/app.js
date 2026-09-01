```js
// src/app.js

import {
    Client,
    GatewayIntentBits,
    Partials
} from 'discord.js';

import {
    db,
    initializeDatabase,
    pgDb
} from './utils/database.js';

import { logger } from './utils/logger.js';
import { BotConfig } from './config/bot.js';

// ============================================================
// SETTINGS
// ============================================================

const PREFIX = '-';

// ============================================================
// RANK HIERARCHY
// ============================================================

const RANKS = {
    'Founder 👑': 10,
    'God ✦': 9,
    'Owner ★': 8,
    'Co-Owner ✧': 7,
    'Executive ◆': 6,
    'Director ◇': 5,
    'Admin ⚔': 4,
    'Moderator 🛡': 3,
    'Staff ✚': 2,
    'Member ◟': 1
};

const RANK_ALIASES = {
    founder: 'Founder 👑',
    god: 'God ✦',
    owner: 'Owner ★',
    'co-owner': 'Co-Owner ✧',
    coowner: 'Co-Owner ✧',
    executive: 'Executive ◆',
    director: 'Director ◇',
    admin: 'Admin ⚔',
    moderator: 'Moderator 🛡',
    mod: 'Moderator 🛡',
    staff: 'Staff ✚',
    member: 'Member ◟'
};

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
        Partials.Reaction
    ]
});

// ============================================================
// DATABASE
// ============================================================

client.db = db;

// ============================================================
// ERROR PROTECTION
// ============================================================

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
});

process.on('warning', (warning) => {
    logger.warn('Node warning:', warning);
});

client.on('error', (error) => {
    logger.error('Discord client error:', error);
});

client.on('shardError', (error) => {
    logger.error('Discord shard error:', error);
});

// ============================================================
// READY
// ============================================================

client.once('ready', async () => {
    try {
        logger.info(`Logged in as ${client.user.tag}`);
        logger.info(
            `Connected to ${client.guilds.cache.size} server(s)`
        );

        try {
            await initializeDatabase();
            logger.info('Database initialized successfully.');
        } catch (error) {
            logger.error(
                'Database initialization failed:',
                error
            );
        }

        try {
            const status =
                BotConfig?.presence?.status || 'online';

            const activity =
                BotConfig?.presence?.activity || null;

            client.user.setPresence({
                status,
                activities: activity
                    ? [
                        {
                            name: activity,
                            type: 0
                        }
                    ]
                    : []
            });
        } catch (error) {
            logger.warn(
                'Could not set bot presence:',
                error
            );
        }

        logger.info('Bot is ready.');
    } catch (error) {
        logger.error(
            'Ready event error:',
            error
        );
    }
});

// ============================================================
// GUILD JOIN
// ============================================================

client.on('guildCreate', async (guild) => {
    try {
        logger.info(
            `Joined guild: ${guild.name} (${guild.id})`
        );
    } catch (error) {
        logger.error(
            'Guild create error:',
            error
        );
    }
});

// ============================================================
// GUILD LEAVE
// ============================================================

client.on('guildDelete', async (guild) => {
    try {
        logger.info(
            `Left guild: ${guild.name} (${guild.id})`
        );
    } catch (error) {
        logger.error(
            'Guild delete error:',
            error
        );
    }
});

// ============================================================
// GET MEMBER RANK
// ============================================================

function getMemberRank(member) {
    if (!member) return 0;

    let highestRank = 0;

    for (const role of member.roles.cache.values()) {
        const rank = RANKS[role.name];

        if (rank && rank > highestRank) {
            highestRank = rank;
        }
    }

    return highestRank;
}

// ============================================================
// GET RANK ROLE
// ============================================================

function getRankRole(guild, rankName) {
    return guild.roles.cache.find(
        role => role.name === rankName
    );
}

// ============================================================
// RANK COMMAND
// ONLY SERVER OWNER CAN USE THIS
// ============================================================

async function handleRankCommand(message, args) {
    // ONLY THE ACTUAL SERVER OWNER
    if (message.guild.ownerId !== message.author.id) {
        return message.reply(
            '❌ Only the **server owner** can give or remove ranks.'
        );
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return message.reply(
            '❌ Usage: `-rank @user <rank>`'
        );
    }

    if (!args.length) {
        return message.reply(
            '❌ Usage: `-rank @user <rank>`\n\n' +
            '**Ranks:** Founder, God, Owner, Co-Owner, Executive, Director, Admin, Moderator, Staff, Member'
        );
    }

    // Remove mention from arguments
    const rankInput = args
        .slice(1)
        .join(' ')
        .toLowerCase();

    const rankName =
        RANK_ALIASES[rankInput];

    if (!rankName) {
        return message.reply(
            '❌ Invalid rank.\n\n' +
            '**Ranks:** Founder, God, Owner, Co-Owner, Executive, Director, Admin, Moderator, Staff, Member'
        );
    }

    const role =
        getRankRole(message.guild, rankName);

    if (!role) {
        return message.reply(
            `❌ The role **${rankName}** does not exist. Create the role first.`
        );
    }

    // Bot must be above the role
    if (
        message.guild.members.me &&
        role.position >=
        message.guild.members.me.roles.highest.position
    ) {
        return message.reply(
            `❌ My bot role must be **above ${rankName}** in the Discord role list.`
        );
    }

    // Remove old rank roles
    const oldRanks =
        target.roles.cache.filter(
            r => RANKS[r.name]
        );

    try {
        if (oldRanks.size > 0) {
            await target.roles.remove(
                oldRanks,
                `Rank changed by server owner ${message.author.tag}`
            );
        }

        await target.roles.add(
            role,
            `Rank given by server owner ${message.author.tag}`
        );

        return message.reply(
            `✅ ${target} is now **${rankName}**.`
        );
    } catch (error) {
        logger.error(
            'Rank command error:',
            error
        );

        return message.reply(
            '❌ I could not change the rank. Check my permissions and role position.'
        );
    }
}

// ============================================================
// BAN
// ============================================================

async function handleBan(message) {
    if (getMemberRank(message.member) < 4) {
        return message.reply(
            '❌ You need **Admin ⚔** or higher.'
        );
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return message.reply(
            '❌ Usage: `-ban @user`'
        );
    }

    if (target.id === message.author.id) {
        return message.reply(
            '❌ You cannot ban yourself.'
        );
    }

    if (
        getMemberRank(target) >=
        getMemberRank(message.member)
    ) {
        return message.reply(
            '❌ You cannot ban someone with an equal or higher rank.'
        );
    }

    if (!target.bannable) {
        return message.reply(
            '❌ I cannot ban that member. Check my role position.'
        );
    }

    try {
        await target.ban({
            reason: `Banned by ${message.author.tag}`
        });

        return message.reply(
            `🔨 **${target.user.tag}** has been banned.`
        );
    } catch (error) {
        logger.error('Ban error:', error);

        return message.reply(
            '❌ Failed to ban that member.'
        );
    }
}

// ============================================================
// KICK
// ============================================================

async function handleKick(message) {
    if (getMemberRank(message.member) < 3) {
        return message.reply(
            '❌ You need **Moderator 🛡** or higher.'
        );
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return message.reply(
            '❌ Usage: `-kick @user`'
        );
    }

    if (target.id === message.author.id) {
        return message.reply(
            '❌ You cannot kick yourself.'
        );
    }

    if (
        getMemberRank(target) >=
        getMemberRank(message.member)
    ) {
        return message.reply(
            '❌ You cannot kick someone with an equal or higher rank.'
        );
    }

    if (!target.kickable) {
        return message.reply(
            '❌ I cannot kick that member.'
        );
    }

    try {
        await target.kick(
            `Kicked by ${message.author.tag}`
        );

        return message.reply(
            `👢 **${target.user.tag}** has been kicked.`
        );
    } catch (error) {
        logger.error('Kick error:', error);

        return message.reply(
            '❌ Failed to kick that member.'
        );
    }
}

// ============================================================
// TIMEOUT
// ============================================================

async function handleTimeout(message, args) {
    if (getMemberRank(message.member) < 3) {
        return message.reply(
            '❌ You need **Moderator 🛡** or higher.'
        );
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return message.reply(
            '❌ Usage: `-timeout @user 10`'
        );
    }

    if (
        getMemberRank(target) >=
        getMemberRank(message.member)
    ) {
        return message.reply(
            '❌ You cannot timeout someone with an equal or higher rank.'
        );
    }

    const minutes =
        Number(args[1]) || 10;

    if (
        !Number.isFinite(minutes) ||
        minutes < 1 ||
        minutes > 40320
    ) {
        return message.reply(
            '❌ Timeout must be between 1 minute and 28 days.'
        );
    }

    if (!target.moderatable) {
        return message.reply(
            '❌ I cannot timeout that member.'
        );
    }

    try {
        await target.timeout(
            minutes * 60 * 1000,
            `Timed out by ${message.author.tag}`
        );

        return message.reply(
            `⏱️ **${target.user.tag}** has been timed out for **${minutes} minutes**.`
        );
    } catch (error) {
        logger.error('Timeout error:', error);

        return message.reply(
            '❌ Failed to timeout that member.'
        );
    }
}

// ============================================================
// UNTIMEOUT
// ============================================================

async function handleUntimeout(message) {
    if (getMemberRank(message.member) < 3) {
        return message.reply(
            '❌ You need **Moderator 🛡** or higher.'
        );
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return message.reply(
            '❌ Usage: `-untimeout @user`'
        );
    }

    try {
        await target.timeout(null);

        return message.reply(
            `✅ Timeout removed from **${target.user.tag}**.`
        );
    } catch (error) {
        logger.error(
            'Untimeout error:',
            error
        );

        return message.reply(
            '❌ Failed to remove the timeout.'
        );
    }
}

// ============================================================
// UNBAN
// ============================================================

async function handleUnban(message, args) {
    if (getMemberRank(message.member) < 4) {
        return message.reply(
            '❌ You need **Admin ⚔** or higher.'
        );
    }

    const userId = args[0];

    if (!userId) {
        return message.reply(
            '❌ Usage: `-unban USER_ID`'
        );
    }

    try {
        await message.guild.members.unban(
            userId,
            `Unbanned by ${message.author.tag}`
        );

        return message.reply(
            `✅ **${userId}** has been unbanned.`
        );
    } catch {
        return message.reply(
            '❌ That user is not banned or the ID is invalid.'
        );
    }
}

// ============================================================
// MASS BAN
// OWNER OR FOUNDER ONLY
// ============================================================

async function handleMassBan(message, args) {
    if (getMemberRank(message.member) < 8) {
        return message.reply(
            '❌ You need **Owner ★** or higher.'
        );
    }

    if (!args.length) {
        return message.reply(
            '❌ Usage: `-massban ID ID ID`'
        );
    }

    const ids =
        args.filter(id => /^\d{17,20}$/.test(id))
            .slice(0, 50);

    if (!ids.length) {
        return message.reply(
            '❌ No valid Discord IDs were provided.'
        );
    }

    let success = 0;

    for (const id of ids) {
        try {
            await message.guild.members.ban(id, {
                reason:
                    `Mass ban by ${message.author.tag}`
            });

            success++;
        } catch (error) {
            logger.warn(
                `Could not mass ban ${id}:`,
                error
            );
        }
    }

    return message.reply(
        `🔨 Mass ban complete: **${success}/${ids.length}** users banned.`
    );
}

// ============================================================
// MASS UNBAN
// OWNER OR FOUNDER ONLY
// ============================================================

async function handleMassUnban(message, args) {
    if (getMemberRank(message.member) < 8) {
        return message.reply(
            '❌ You need **Owner ★** or higher.'
        );
    }

    if (!args.length) {
        return message.reply(
            '❌ Usage: `-massunban ID ID ID`'
        );
    }

    const ids =
        args.filter(id => /^\d{17,20}$/.test(id))
            .slice(0, 50);

    if (!ids.length) {
        return message.reply(
            '❌ No valid Discord IDs were provided.'
        );
    }

    let success = 0;

    for (const id of ids) {
        try {
            await message.guild.members.unban(id);
            success++;
        } catch (error) {
            logger.warn(
                `Could not mass unban ${id}:`,
                error
            );
        }
    }

    return message.reply(
        `✅ Mass unban complete: **${success}/${ids.length}** users unbanned.`
    );
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async (message) => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;
        if (!message.content.startsWith(PREFIX)) return;

        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();

        if (!command) return;

        switch (command) {

            case 'rank':
                await handleRankCommand(
                    message,
                    args
                );
                break;

            case 'ban':
                await handleBan(message);
                break;

            case 'kick':
                await handleKick(message);
                break;

            case 'timeout':
                await handleTimeout(
                    message,
                    args
                );
                break;

            case 'untimeout':
            case 'un-timeout':
                await handleUntimeout(message);
                break;

            case 'unban':
                await handleUnban(
                    message,
                    args
                );
                break;

            case 'massban':
                await handleMassBan(
                    message,
                    args
                );
                break;

            case 'massunban':
                await handleMassUnban(
                    message,
                    args
                );
                break;

            case 'help':
                await message.reply(
                    '**COMMANDS**\n\n' +
                    '`-rank @user <rank>` — Server owner only\n' +
                    '`-ban @user` — Admin ⚔+\n' +
                    '`-kick @user` — Moderator 🛡+\n' +
                    '`-timeout @user <minutes>` — Moderator 🛡+\n' +
                    '`-untimeout @user` — Moderator 🛡+\n' +
                    '`-unban USER_ID` — Admin ⚔+\n' +
                    '`-massban ID ID` — Owner ★+\n' +
                    '`-massunban ID ID` — Owner ★+'
                );
                break;

            default:
                break;
        }

    } catch (error) {
        logger.error(
            'messageCreate command error:',
            error
        );
    }
});

// ============================================================
// VOICE / JOIN TO CREATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const {
                handleJoinToCreate
            } = await import(
                './events/joinToCreate.js'
            );

            if (
                typeof handleJoinToCreate === 'function'
            ) {
                await handleJoinToCreate(
                    oldState,
                    newState,
                    client
                );
            }
        } catch (error) {
            logger.error(
                'voiceStateUpdate error:',
                error
            );
        }
    }
);

// ============================================================
// LOGIN
// ============================================================

async function startBot() {
    try {
        const token =
            process.env.DISCORD_TOKEN ||
            process.env.BOT_TOKEN ||
            BotConfig?.token;

        if (!token) {
            throw new Error(
                'Discord bot token is missing.'
            );
        }

        logger.info('Starting bot...');

        await client.login(token);

    } catch (error) {
        logger.error(
            'Failed to start Discord bot:',
            error
        );

        setTimeout(() => {
            process.exit(1);
        }, 1000);
    }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    try {
        logger.info(
            `${signal} received. Shutting down...`
        );

        try {
            if (
                pgDb &&
                typeof pgDb.close === 'function'
            ) {
                await pgDb.close();
            }
        } catch (error) {
            logger.error(
                'Database shutdown error:',
                error
            );
        }

        try {
            client.destroy();
        } catch (error) {
            logger.error(
                'Discord shutdown error:',
                error
            );
        }

        process.exit(0);

    } catch (error) {
        logger.error(
            'Shutdown error:',
            error
        );

        process.exit(1);
    }
}

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

// ============================================================
// START
// ============================================================

startBot();
```
