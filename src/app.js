// src/app.js

import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    EmbedBuilder
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
// VC DATA
// ============================================================

// Temporary VC information is kept in memory.
// Restarting the bot clears this data.
const vcData = new Map();

// ============================================================
// HELP EMBED
// ============================================================

function commandHelp(
    command,
    description,
    syntax,
    example,
    access = null
) {
    const embed = new EmbedBuilder()
        .setTitle('TitanBot help')
        .addFields(
            {
                name: 'Command',
                value: command,
                inline: false
            },
            {
                name: 'Description',
                value: description,
                inline: false
            },
            {
                name: 'Syntax',
                value: syntax,
                inline: false
            },
            {
                name: 'Example',
                value: example,
                inline: false
            }
        );

    if (access) {
        embed.addFields({
            name: 'Access',
            value: access,
            inline: false
        });
    }

    return embed;
}

// ============================================================
// GET VC OWNER
// ============================================================

function getUserVC(member) {
    if (!member?.voice?.channelId) return null;

    return vcData.get(member.voice.channelId) || null;
}

// ============================================================
// GET TARGET MEMBER
// ============================================================

async function getTargetMember(message, input) {
    if (!input) return null;

    const mentioned =
        message.mentions.members.first();

    if (mentioned) return mentioned;

    const id =
        input.replace(/[<@!>]/g, '');

    if (!/^\d+$/.test(id)) return null;

    try {
        return await message.guild.members.fetch(id);
    } catch {
        return null;
    }
}

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
    console.log(
        `Logged in as ${client.user.tag}`
    );

    console.log(
        `Connected to ${client.guilds.cache.size} server(s)`
    );

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
        console.log(
            'Presence error:',
            error
        );
    }

    console.log('Bot is ready.');
});

// ============================================================
// GUILD JOIN
// ============================================================

client.on('guildCreate', (guild) => {
    console.log(
        `Joined server: ${guild.name}`
    );
});

// ============================================================
// GUILD LEAVE
// ============================================================

client.on('guildDelete', (guild) => {
    console.log(
        `Left server: ${guild.name}`
    );
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async (message) => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;

        const content =
            message.content.trim();

        if (!content.startsWith(PREFIX)) {
            return;
        }

        const args =
            content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();

        if (!command) return;

        // ====================================================
        // HELP
        // ====================================================

        if (command === 'help') {
            return message.reply(
                {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('TitanBot help')
                            .setDescription(
                                [
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
                                    '**Voice Master**',
                                    '`-vc setup`',
                                    '`-vc kick @user`',
                                    '`-vc ban @user`',
                                    '`-vc unban @user`',
                                    '`-vc reject @user`',
                                    '`-vc permit @user`',
                                    '`-vc lock`',
                                    '`-vc unlock`',
                                    '`-vc limit <number>`',
                                    '`-vc rename <name>`',
                                    '`-vc claim`',
                                    '`-vc transfer @user`',
                                    '`-vc stfu`',
                                    '',
                                    '**Other**',
                                    '`-ping`',
                                    '`-help`'
                                ].join('\n')
                            )
                    ]
                }
            );
        }

        // ====================================================
        // PING
        // ====================================================

        if (command === 'ping') {
            return message.reply(
                `🏓 Pong! ${client.ws.ping}ms`
            );
        }

        // ====================================================
        // RANK
        // ONLY SERVER OWNER
        // ====================================================

        if (command === 'rank') {
            if (
                message.author.id !==
                message.guild.ownerId
            ) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'rank',
                            'Give a server rank to a member.',
                            '-rank @user (rank)',
                            '-rank @user admin',
                            'Only the server owner can give ranks.'
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const rankName =
                args
                    .slice(1)
                    .join('')
                    .toLowerCase();

            if (!target) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'rank',
                            'Give a server rank to a member.',
                            '-rank @user (rank)',
                            '-rank @user admin'
                        )
                    ]
                });
            }

            if (!rankName) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'rank',
                            'Give a server rank to a member.',
                            '-rank @user (rank)',
                            '-rank @user admin',
                            [
                                'Available ranks:',
                                'Founder 👑',
                                'God ✦',
                                'Owner ★',
                                'Co-Owner ✧',
                                'Executive ◆',
                                'Director ◇',
                                'Admin ⚔',
                                'Moderator 🛡',
                                'Staff ✚',
                                'Member ◟'
                            ].join('\n')
                        )
                    ]
                });
            }

            const roleName =
                RANKS[rankName];

            if (!roleName) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'rank',
                            'Give a server rank to a member.',
                            '-rank @user (rank)',
                            '-rank @user admin',
                            'Invalid rank.'
                        )
                    ]
                });
            }

            try {
                const rankRoleNames =
                    Object.values(RANKS);

                const rolesToRemove =
                    target.roles.cache.filter(
                        role =>
                            rankRoleNames.includes(
                                role.name
                            )
                    );

                if (rolesToRemove.size > 0) {
                    await target.roles.remove(
                        rolesToRemove
                    );
                }

                let role =
                    message.guild.roles.cache.find(
                        r =>
                            r.name === roleName
                    );

                if (!role) {
                    role =
                        await message.guild.roles.create({
                            name: roleName,
                            reason:
                                'TitanBot rank system'
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
                console.error(
                    'Rank error:',
                    error
                );

                return message.reply({
                    embeds: [
                        commandHelp(
                            'rank',
                            'Give a server rank to a member.',
                            '-rank @user (rank)',
                            '-rank @user admin',
                            'I could not manage the rank. Make sure my bot role is above the rank role.'
                        )
                    ]
                });
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'ban',
                            'Ban a member from the server.',
                            '-ban @user [reason]',
                            '-ban @user breaking rules',
                            'Requires Ban Members permission.'
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'ban',
                            'Ban a member from the server.',
                            '-ban @user [reason]',
                            '-ban @user breaking rules'
                        )
                    ]
                });
            }

            if (
                target.id ===
                message.author.id
            ) {
                return message.reply(
                    '❌ You cannot ban yourself.'
                );
            }

            if (!target.bannable) {
                return message.reply(
                    '❌ I cannot ban this member. Check my role position.'
                );
            }

            const reason =
                args.slice(1).join(' ') ||
                'No reason provided';

            try {
                await target.ban({
                    reason
                });

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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'unban',
                            'Unban a user from the server.',
                            '-unban (user ID)',
                            '-unban 123456789012345678',
                            'Requires Ban Members permission.'
                        )
                    ]
                });
            }

            const userId = args[0];

            if (!userId) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'unban',
                            'Unban a user from the server.',
                            '-unban (user ID)',
                            '-unban 123456789012345678'
                        )
                    ]
                });
            }

            try {
                await message.guild.members.unban(
                    userId
                );

                return message.reply(
                    `✅ User **${userId}** has been unbanned.`
                );
            } catch {
                return message.reply(
                    '❌ Could not unban that user.'
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'kick',
                            'Kick a member from the server.',
                            '-kick @user [reason]',
                            '-kick @user breaking rules',
                            'Requires Kick Members permission.'
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'kick',
                            'Kick a member from the server.',
                            '-kick @user [reason]',
                            '-kick @user breaking rules'
                        )
                    ]
                });
            }

            if (!target.kickable) {
                return message.reply(
                    '❌ I cannot kick this member.'
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'timeout',
                            'Timeout a member.',
                            '-timeout @user (minutes) [reason]',
                            '-timeout @user 10 spam',
                            'Requires Moderate Members permission.'
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const minutes =
                Number(args[1]);

            if (
                !target ||
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'timeout',
                            'Timeout a member.',
                            '-timeout @user (minutes) [reason]',
                            '-timeout @user 10 spam'
                        )
                    ]
                });
            }

            const duration =
                Math.min(minutes, 40320) *
                60 *
                1000;

            const reason =
                args.slice(2).join(' ') ||
                'No reason provided';

            try {
                await target.timeout(
                    duration,
                    reason
                );

                return message.reply(
                    `⏱️ **${target.user.tag}** has been timed out for **${minutes} minutes**.`
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'untimeout',
                            'Remove a member timeout.',
                            '-untimeout @user',
                            '-untimeout @user',
                            'Requires Moderate Members permission.'
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'untimeout',
                            'Remove a member timeout.',
                            '-untimeout @user',
                            '-untimeout @user'
                        )
                    ]
                });
            }

            try {
                await target.timeout(
                    null,
                    'Timeout removed'
                );

                return message.reply(
                    `✅ Timeout removed from **${target.user.tag}**.`
                );
            } catch {
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'massban',
                            'Ban multiple mentioned members.',
                            '-massban @user @user ...',
                            '-massban @john @jane',
                            'Requires Ban Members permission.'
                        )
                    ]
                });
            }

            const members =
                message.mentions.members;

            if (members.size === 0) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'massban',
                            'Ban multiple mentioned members.',
                            '-massban @user @user ...',
                            '-massban @john @jane'
                        )
                    ]
                });
            }

            let success = 0;
            let failed = 0;

            for (
                const [, member]
                of members
            ) {
                try {
                    if (
                        member.id !==
                            message.author.id &&
                        member.bannable
                    ) {
                        await member.ban({
                            reason:
                                'Mass ban'
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
                return message.reply({
                    embeds: [
                        commandHelp(
                            'massunban',
                            'Unban multiple users by ID.',
                            '-massunban (id) (id) ...',
                            '-massunban 123 456',
                            'Requires Ban Members permission.'
                        )
                    ]
                });
            }

            if (args.length === 0) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'massunban',
                            'Unban multiple users by ID.',
                            '-massunban (id) (id) ...',
                            '-massunban 123 456'
                        )
                    ]
                });
            }

            let success = 0;
            let failed = 0;

            for (
                const userId of args
            ) {
                try {
                    await message.guild.members.unban(
                        userId,
                        'Mass unban'
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
        // VC COMMAND
        // ====================================================

        if (command === 'vc') {
            const subcommand =
                args.shift()?.toLowerCase();

            // ------------------------------------------------
            // VC HELP
            // ------------------------------------------------

            if (!subcommand) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            'vc',
                            'Manage your personal voice channel.',
                            '-vc (command)',
                            '-vc kick @user'
                        )
                    ]
                });
            }

            // ------------------------------------------------
            // VC SETUP
            // ------------------------------------------------

            if (subcommand === 'setup') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ManageChannels
                    )
                ) {
                    return message.reply({
                        embeds: [
                            commandHelp(
                                'vc setup',
                                'Set up a Join-to-Create voice channel.',
                                '-vc setup',
                                '-vc setup',
                                'Requires Manage Channels permission.'
                            )
                        ]
                    });
                }

                try {
                    const category =
                        await message.guild.channels.create({
                            name: 'Voice Channels',
                            type: 4
                        });

                    const trigger =
                        await message.guild.channels.create({
                            name: '➕ Create VC',
                            type: 2,
                            parent: category.id
                        });

                    return message.reply(
                        `✅ VC setup created.\nJoin **${trigger.name}** to create your personal VC.`
                    );

                } catch (error) {
                    console.error(
                        'VC setup error:',
                        error
                    );

                    return message.reply(
                        '❌ I could not set up the VC system. Make sure I have Manage Channels permission.'
                    );
                }
            }

            // ------------------------------------------------
            // MUST BE IN VC
            // ------------------------------------------------

            const voiceChannel =
                message.member.voice.channel;

            if (!voiceChannel) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            `vc ${subcommand}`,
                            'Manage your personal voice channel.',
                            `-vc ${subcommand} (options)`,
                            `-vc ${subcommand}`,
                            'You must be inside your voice channel.'
                        )
                    ]
                });
            }

            const data =
                getUserVC(message.member);

            // ------------------------------------------------
            // CLAIM
            // ------------------------------------------------

            if (subcommand === 'claim') {
                if (data) {
                    return message.reply(
                        '❌ You already own this VC.'
                    );
                }

                vcData.set(
                    voiceChannel.id,
                    {
                        ownerId:
                            message.author.id,
                        banned: new Set(),
                        rejected: new Set(),
                        permitted: new Set(),
                        muted: new Set()
                    }
                );

                return message.reply(
                    '👑 You now own this voice channel.'
                );
            }

            // ------------------------------------------------
            // NO OWNER
            // ------------------------------------------------

            if (!data) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            `vc ${subcommand}`,
                            'Manage your personal voice channel.',
                            `-vc ${subcommand} (options)`,
                            `-vc ${subcommand} @user`,
                            'This VC does not have an owner.'
                        )
                    ]
                });
            }

            // ------------------------------------------------
            // OWNER CHECK
            // ------------------------------------------------

            if (
                data.ownerId !==
                message.author.id
            ) {
                return message.reply({
                    embeds: [
                        commandHelp(
                            `vc ${subcommand}`,
                            'Manage your personal voice channel.',
                            `-vc ${subcommand} (options)`,
                            `-vc ${subcommand} @user`,
                            'Only the owner of this VC can use this command.'
                        )
                    ]
                });
            }

            // ------------------------------------------------
            // TARGET COMMANDS
            // ------------------------------------------------

            if (
                [
                    'kick',
                    'ban',
                    'unban',
                    'reject',
                    'permit',
                    'transfer'
                ].includes(subcommand)
            ) {
                const target =
                    await getTargetMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return message.reply({
                        embeds: [
                            commandHelp(
                                `vc ${subcommand}`,
                                getVCDescription(
                                    subcommand
                                ),
                                `-vc ${subcommand} (member)`,
                                `-vc ${subcommand} @user`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // KICK
                // --------------------------------------------

                if (subcommand === 'kick') {
                    if (
                        target.voice.channelId !==
                        voiceChannel.id
                    ) {
                        return message.reply(
                            '❌ That member is not in your VC.'
                        );
                    }

                    await target.voice.disconnect(
                        'VC owner kicked member'
                    ).catch(() => {});

                    return message.reply(
                        `👢 ${target} has been kicked from your VC.`
                    );
                }

                // --------------------------------------------
                // BAN
                // --------------------------------------------

                if (subcommand === 'ban') {
                    data.banned.add(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice.disconnect(
                            'VC owner banned member'
                        ).catch(() => {});
                    }

                    return message.reply(
                        `🔨 ${target} has been banned from your VC.`
                    );
                }

                // --------------------------------------------
                // UNBAN
                // --------------------------------------------

                if (subcommand === 'unban') {
                    data.banned.delete(
                        target.id
                    );

                    return message.reply(
                        `✅ ${target} has been unbanned from your VC.`
                    );
                }

                // --------------------------------------------
                // REJECT
                // --------------------------------------------

                if (subcommand === 'reject') {
                    data.rejected.add(
                        target.id
                    );

                    return message.reply(
                        `🚫 ${target} has been rejected from your VC.`
                    );
                }

                // --------------------------------------------
                // PERMIT
                // --------------------------------------------

                if (subcommand === 'permit') {
                    data.rejected.delete(
                        target.id
                    );

                    data.permitted.add(
                        target.id
                    );

                    return message.reply(
                        `✅ ${target} has been permitted in your VC.`
                    );
                }

                // --------------------------------------------
                // TRANSFER
                // --------------------------------------------

                if (subcommand === 'transfer') {
                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return message.reply(
                            '❌ You already own this VC.'
                        );
                    }

                    data.ownerId =
                        target.id;

                    return message.reply(
                        `👑 VC ownership transferred to ${target}.`
                    );
                }
            }

            // ------------------------------------------------
            // LOCK
            // ------------------------------------------------

            if (subcommand === 'lock') {
                try {
                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    return message.reply(
                        '🔒 Your VC is now locked.'
                    );
                } catch {
                    return message.reply(
                        '❌ I could not lock your VC.'
                    );
                }
            }

            // ------------------------------------------------
            // UNLOCK
            // ------------------------------------------------

            if (subcommand === 'unlock') {
                try {
                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    return message.reply(
                        '🔓 Your VC is now unlocked.'
                    );
                } catch {
                    return message.reply(
                        '❌ I could not unlock your VC.'
                    );
                }
            }

            // ------------------------------------------------
            // LIMIT
            // ------------------------------------------------

            if (subcommand === 'limit') {
                const limit =
                    Number(args[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return message.reply({
                        embeds: [
                            commandHelp(
                                'vc limit',
                                'Change the user limit of your VC.',
                                '-vc limit (0-99)',
                                '-vc limit 10'
                            )
                        ]
                    });
                }

                try {
                    await voiceChannel.setUserLimit(
                        limit
                    );

                    return message.reply(
                        `👥 VC user limit set to **${limit}**.`
                    );
                } catch {
                    return message.reply(
                        '❌ I could not change the user limit.'
                    );
                }
            }

            // ------------------------------------------------
            // RENAME
            // ------------------------------------------------

            if (subcommand === 'rename') {
                const name =
                    args.join(' ').trim();

                if (!name) {
                    return message.reply({
                        embeds: [
                            commandHelp(
                                'vc rename',
                                'Rename your personal VC.',
                                '-vc rename (name)',
                                '-vc rename Gaming Room'
                            )
                        ]
                    });
                }

                try {
                    await voiceChannel.setName(
                        name.slice(0, 100)
                    );

                    return message.reply(
                        `✏️ VC renamed to **${name.slice(0, 100)}**.`
                    );
                } catch {
                    return message.reply(
                        '❌ I could not rename your VC.'
                    );
                }
            }

            // ------------------------------------------------
            // STFU
            // ------------------------------------------------

            if (subcommand === 'stfu') {
                const target =
                    await getTargetMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return message.reply({
                        embeds: [
                            commandHelp(
                                'vc stfu',
                                'Server boosters can mute a member in their personal VC.',
                                '-vc stfu @user',
                                '-vc stfu @user'
                            )
                        ]
                    });
                }

                try {
                    await target.voice.setMute(
                        true,
                        'VC owner used stfu'
                    );

                    return message.reply(
                        `🔇 ${target} has been server-muted in your VC.`
                    );
                } catch {
                    return message.reply(
                        '❌ I could not mute that member.'
                    );
                }
            }

            // ------------------------------------------------
            // UNKNOWN VC COMMAND
            // ------------------------------------------------

            return message.reply({
                embeds: [
                    commandHelp(
                        `vc ${subcommand}`,
                        'Manage your personal voice channel.',
                        '-vc (command)',
                        '-vc kick @user'
                    )
                ]
            });
        }

        // ====================================================
        // UNKNOWN COMMAND
        // ====================================================

        return message.reply({
            embeds: [
                commandHelp(
                    command,
                    'Unknown command.',
                    '-help',
                    '-help'
                )
            ]
        });

    } catch (error) {
        console.error(
            'messageCreate error:',
            error
        );
    }
});

// ============================================================
// VOICE STATE UPDATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const channel =
                newState.channel;

            if (!channel) return;

            const data =
                vcData.get(channel.id);

            if (!data) return;

            // Remove banned/rejected users
            if (
                data.banned.has(
                    newState.id
                ) ||
                data.rejected.has(
                    newState.id
                )
            ) {
                await newState.member?.voice
                    .disconnect(
                        'Not permitted in VC'
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                'voiceStateUpdate error:',
                error
            );
        }
    }
);

// ============================================================
// VC CLEANUP
// ============================================================

client.on(
    'voiceStateUpdate',
    (oldState) => {
        try {
            if (!oldState.channelId) {
                return;
            }

            const channel =
                oldState.channel;

            if (!channel) return;

            const data =
                vcData.get(channel.id);

            if (!data) return;

            if (
                channel.members.size === 0
            ) {
                vcData.delete(
                    channel.id
                );

                channel.delete(
                    'Temporary VC became empty'
                ).catch(() => {});
            }

        } catch (error) {
            console.error(
                'VC cleanup error:',
                error
            );
        }
    }
);

// ============================================================
// VC DESCRIPTION
// ============================================================

function getVCDescription(command) {
    const descriptions = {
        kick:
            'Kick a member from your VC.',

        ban:
            'Ban a member from joining your VC.',

        unban:
            'Remove a member from your VC ban list.',

        reject:
            'Reject a member from joining your VC.',

        permit:
            'Permit a member to join your VC.',

        transfer:
            'Transfer ownership of your VC to another member.'
    };

    return (
        descriptions[command] ||
        'Manage your personal voice channel.'
    );
}

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

        console.log(
            'Starting bot...'
        );

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
