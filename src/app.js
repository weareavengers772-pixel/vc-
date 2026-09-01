// src/app.js

import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits
} from 'discord.js';

import { logger } from './utils/logger.js';
import { BotConfig } from './config/bot.js';

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember
    ]
});

// ============================================================
// PREFIX
// ============================================================

const PREFIX = '-';

// ============================================================
// RANKS
// ============================================================

const RANKS = {
    founder: 'Founder 👑',
    god: 'God ✦',
    owner: 'Owner ★',
    coowner: 'Co-Owner ✧',
    executive: 'Executive ◆',
    director: 'Director ◇',
    admin: 'Admin ⚔',
    moderator: 'Moderator 🛡',
    staff: 'Staff ✚',
    member: 'Member ◟'
};

// ============================================================
// ERROR PROTECTION
// ============================================================

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.on('shardError', (error) => {
    console.error('Discord shard error:', error);
});

// ============================================================
// READY
// ============================================================

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Connected to ${client.guilds.cache.size} server(s)`);

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
        console.log('Presence error:', error);
    }

    console.log('Bot is ready.');
});

// ============================================================
// GUILD JOIN
// ============================================================

client.on('guildCreate', (guild) => {
    console.log(`Joined server: ${guild.name}`);
});

// ============================================================
// GUILD LEAVE
// ============================================================

client.on('guildDelete', (guild) => {
    console.log(`Left server: ${guild.name}`);
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async (message) => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;

        const content = message.content.trim();

        if (!content.startsWith(PREFIX)) return;

        const args = content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

        const command = args.shift()?.toLowerCase();

        if (!command) return;

        // ====================================================
        // HELP
        // ====================================================

        if (command === 'help') {
            return message.reply(
                [
                    '**TitanBot Commands**',
                    '',
                    '**Moderation**',
                    '`-ban @user [reason]`',
                    '`-unban <userID>`',
                    '`-kick @user [reason]`',
                    '`-timeout @user <minutes> [reason]`',
                    '`-untimeout @user`',
                    '`-massban @user @user ...`',
                    '`-massunban <id> <id> ...`',
                    '',
                    '**Ranks**',
                    '`-rank @user <rank>`',
                    '',
                    '**Other**',
                    '`-help`',
                    '`-ping`'
                ].join('\n')
            );
        }

        // ====================================================
        // PING
        // ====================================================

        if (command === 'ping') {
            return message.reply(`🏓 Pong! ${client.ws.ping}ms`);
        }

        // ====================================================
        // RANK
        // ONLY SERVER OWNER CAN USE THIS
        // ====================================================

        if (command === 'rank') {
            if (message.author.id !== message.guild.ownerId) {
                return message.reply(
                    '❌ Only the server owner can give ranks.'
                );
            }

            const target =
                message.mentions.members.first();

            const rankName =
                args.slice(1).join('').toLowerCase();

            if (!target) {
                return message.reply(
                    '❌ Mention a user.\nExample: `-rank @user admin`'
                );
            }

            if (!rankName) {
                return message.reply(
                    [
                        '**Available Ranks:**',
                        '`founder` 👑',
                        '`god` ✦',
                        '`owner` ★',
                        '`coowner` ✧',
                        '`executive` ◆',
                        '`director` ◇',
                        '`admin` ⚔',
                        '`moderator` 🛡',
                        '`staff` ✚',
                        '`member` ◟'
                    ].join('\n')
                );
            }

            const roleName = RANKS[rankName];

            if (!roleName) {
                return message.reply(
                    '❌ Invalid rank. Use `-rank @user` to see the ranks.'
                );
            }

            try {
                // Remove all existing rank roles
                const rankRoleNames =
                    Object.values(RANKS);

                const rolesToRemove =
                    target.roles.cache.filter(role =>
                        rankRoleNames.includes(role.name)
                    );

                if (rolesToRemove.size > 0) {
                    await target.roles.remove(
                        rolesToRemove
                    );
                }

                // Find existing role
                let role =
                    message.guild.roles.cache.find(
                        r => r.name === roleName
                    );

                // Create role if it doesn't exist
                if (!role) {
                    role =
                        await message.guild.roles.create({
                            name: roleName,
                            reason: 'TitanBot rank system'
                        });
                }

                await target.roles.add(
                    role,
                    'Server owner assigned rank'
                );

                return message.reply(
                    `✅ ${target} is now **${roleName}**.`
                );

            } catch (error) {
                console.error('Rank error:', error);

                return message.reply(
                    '❌ I could not give that rank. Make sure my bot role is above the rank roles.'
                );
            }
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === 'ban') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Ban Members** permission.'
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    '❌ Mention a user.\nExample: `-ban @user reason`'
                );
            }

            if (target.id === message.author.id) {
                return message.reply(
                    '❌ You cannot ban yourself.'
                );
            }

            if (!target.bannable) {
                return message.reply(
                    '❌ I cannot ban this user. Check my role position and permissions.'
                );
            }

            const reason =
                args.slice(1).join(' ') ||
                'No reason provided';

            try {
                await target.ban({ reason });

                return message.reply(
                    `🔨 **${target.user.tag}** has been banned.\n**Reason:** ${reason}`
                );
            } catch (error) {
                console.error(error);

                return message.reply(
                    '❌ Failed to ban the user.'
                );
            }
        }

        // ====================================================
        // UNBAN
        // ====================================================

        if (command === 'unban') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Ban Members** permission.'
                );
            }

            const userId = args[0];

            if (!userId) {
                return message.reply(
                    '❌ Enter a user ID.\nExample: `-unban 123456789012345678`'
                );
            }

            try {
                await message.guild.members.unban(userId);

                return message.reply(
                    `✅ User **${userId}** has been unbanned.`
                );
            } catch (error) {
                return message.reply(
                    '❌ Could not unban that user. Check the ID and make sure they are banned.'
                );
            }
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === 'kick') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.KickMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Kick Members** permission.'
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    '❌ Mention a user.\nExample: `-kick @user reason`'
                );
            }

            if (!target.kickable) {
                return message.reply(
                    '❌ I cannot kick this user.'
                );
            }

            const reason =
                args.slice(1).join(' ') ||
                'No reason provided';

            try {
                await target.kick(reason);

                return message.reply(
                    `👢 **${target.user.tag}** has been kicked.\n**Reason:** ${reason}`
                );
            } catch (error) {
                console.error(error);

                return message.reply(
                    '❌ Failed to kick the user.'
                );
            }
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === 'timeout') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Moderate Members** permission.'
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    '❌ Mention a user.\nExample: `-timeout @user 10 reason`'
                );
            }

            const minutes =
                Number(args[1]);

            if (
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return message.reply(
                    '❌ Enter a valid number of minutes.'
                );
            }

            const duration =
                Math.min(minutes, 40320) * 60 * 1000;

            const reason =
                args.slice(2).join(' ') ||
                'No reason provided';

            try {
                await target.timeout(
                    duration,
                    reason
                );

                return message.reply(
                    `⏱️ **${target.user.tag}** has been timed out for **${minutes} minutes**.\n**Reason:** ${reason}`
                );
            } catch (error) {
                console.error(error);

                return message.reply(
                    '❌ Failed to timeout the user.'
                );
            }
        }

        // ====================================================
        // UNTIMEOUT
        // ====================================================

        if (command === 'untimeout') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Moderate Members** permission.'
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply(
                    '❌ Mention a user.'
                );
            }

            try {
                await target.timeout(
                    null,
                    'Timeout removed'
                );

                return message.reply(
                    `✅ Timeout removed from **${target.user.tag}**.`
                );
            } catch (error) {
                console.error(error);

                return message.reply(
                    '❌ Failed to remove the timeout.'
                );
            }
        }

        // ====================================================
        // MASS BAN
        // ====================================================

        if (command === 'massban') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Ban Members** permission.'
                );
            }

            const members =
                message.mentions.members;

            if (members.size === 0) {
                return message.reply(
                    '❌ Mention the users you want to ban.'
                );
            }

            let success = 0;
            let failed = 0;

            for (const [, member] of members) {
                try {
                    if (
                        member.id !== message.author.id &&
                        member.bannable
                    ) {
                        await member.ban({
                            reason:
                                'Mass ban by moderator'
                        });

                        success++;
                    } else {
                        failed++;
                    }
                } catch {
                    failed++;
                }
            }

            return message.reply(
                `🔨 Mass ban complete.\n✅ Banned: **${success}**\n❌ Failed: **${failed}**`
            );
        }

        // ====================================================
        // MASS UNBAN
        // ====================================================

        if (command === 'massunban') {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return message.reply(
                    '❌ You need **Ban Members** permission.'
                );
            }

            if (args.length === 0) {
                return message.reply(
                    '❌ Enter user IDs.\nExample: `-massunban 123 456 789`'
                );
            }

            let success = 0;
            let failed = 0;

            for (const userId of args) {
                try {
                    await message.guild.members.unban(
                        userId,
                        'Mass unban by moderator'
                    );

                    success++;
                } catch {
                    failed++;
                }
            }

            return message.reply(
                `✅ Mass unban complete.\n✅ Unbanned: **${success}**\n❌ Failed: **${failed}**`
            );
        }

        // ====================================================
        // UNKNOWN COMMAND
        // ====================================================

        return message.reply(
            `❌ Unknown command. Use \`${PREFIX}help\``
        );

    } catch (error) {
        console.error(
            'messageCreate error:',
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
            const module =
                await import(
                    './events/joinToCreate.js'
                );

            if (
                typeof module.handleJoinToCreate ===
                'function'
            ) {
                await module.handleJoinToCreate(
                    oldState,
                    newState,
                    client
                );
            }
        } catch (error) {
            console.error(
                'Join-to-create error:',
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
                'DISCORD_TOKEN is missing.'
            );
        }

        console.log('Starting bot...');

        await client.login(token);

    } catch (error) {
        console.error(
            'Failed to start bot:',
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
    console.log(
        `${signal} received. Shutting down...`
    );

    try {
        client.destroy();
    } catch (error) {
        console.error(error);
    }

    process.exit(0);
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
