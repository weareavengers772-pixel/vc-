import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder
} from 'discord.js';

import { BotConfig } from './config/bot.js';

// ============================================================
// VC+
// ============================================================

const PREFIX = '-';
const BOT_NAME = 'VC+';

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
// RANKS
// ============================================================

const RANKS = [
    'Founder',
    'God',
    'Owner',
    'Co-Owner',
    'Executive',
    'Director',
    'Admin',
    'Moderator',
    'Staff',
    'Member'
];

const RANK_POWER = {
    Founder: 100,
    God: 90,
    Owner: 80,
    'Co-Owner': 70,
    Executive: 60,
    Director: 50,
    Admin: 40,
    Moderator: 30,
    Staff: 20,
    Member: 10
};

// ============================================================
// TEMP VC DATA
// ============================================================

const vcData = new Map();

// guildId -> setup data
const setupData = new Map();

// ============================================================
// BOX MESSAGE
// ============================================================

function box(title, description, fields = []) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: BOT_NAME })
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

    if (fields.length) {
        embed.addFields(fields);
    }

    return embed;
}

function helpBox(command, description, syntax, access = 'Everyone') {
    return box(
        `${BOT_NAME} help`,
        '',
        [
            {
                name: 'Command',
                value: `\`${command}\``,
                inline: false
            },
            {
                name: 'Description',
                value: description,
                inline: false
            },
            {
                name: 'Syntax',
                value: `\`${syntax}\``,
                inline: false
            },
            {
                name: 'Access',
                value: access,
                inline: false
            }
        ]
    );
}

// ============================================================
// SAFE REPLY
// ============================================================

async function reply(message, embed) {
    try {
        return await message.reply({
            embeds: [embed]
        });
    } catch {
        return null;
    }
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(member) {
    if (!member) return null;

    for (const rank of RANKS) {
        if (
            member.roles.cache.some(
                role =>
                    role.name.toLowerCase() ===
                    rank.toLowerCase()
            )
        ) {
            return rank;
        }
    }

    return null;
}

function getRankPower(member) {
    const rank = getRank(member);
    return rank ? RANK_POWER[rank] : 0;
}

function isServerOwner(member) {
    return (
        member?.guild?.ownerId ===
        member?.id
    );
}

function isFounder(member) {
    return (
        isServerOwner(member) ||
        getRank(member) === 'Founder'
    );
}

function isGodOrFounder(member) {
    const rank = getRank(member);

    return (
        isServerOwner(member) ||
        rank === 'Founder' ||
        rank === 'God'
    );
}

// ============================================================
// TARGET
// ============================================================

async function getTarget(message, value) {
    if (!value) return null;

    const mentioned =
        message.mentions.members.first();

    if (mentioned) return mentioned;

    const id =
        value.replace(/[<@!>]/g, '');

    if (!/^\d+$/.test(id)) return null;

    return message.guild.members
        .fetch(id)
        .catch(() => null);
}

// ============================================================
// VC OWNER
// ============================================================

function getVCData(channelId) {
    return vcData.get(channelId);
}

function getMyVC(member) {
    if (!member?.voice?.channelId) {
        return null;
    }

    return vcData.get(
        member.voice.channelId
    );
}

function canControlVC(member, data) {
    if (!data) return false;

    return (
        data.ownerId === member.id ||
        isServerOwner(member) ||
        isFounder(member)
    );
}

// ============================================================
// SETUP
// ============================================================

async function setupVC(message) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ManageChannels
        )
    ) {
        return reply(
            message,
            helpBox(
                'vc setup',
                'Set up the VC+ Join to Create system.',
                '-vc setup',
                'Requires Manage Channels.'
            )
        );
    }

    if (setupData.has(message.guild.id)) {
        return reply(
            message,
            box(
                'VC+',
                'The Join to Create system is already set up in this server.'
            )
        );
    }

    try {
        const category =
            await message.guild.channels.create({
                name: 'VC+',
                type: ChannelType.GuildCategory
            });

        const trigger =
            await message.guild.channels.create({
                name: 'Join to Create',
                type: ChannelType.GuildVoice,
                parent: category.id,
                bitrate: 64000
            });

        setupData.set(
            message.guild.id,
            {
                categoryId: category.id,
                triggerId: trigger.id
            }
        );

        return reply(
            message,
            box(
                'VC+ Setup',
                'Join to Create has been successfully configured.',
                [
                    {
                        name: 'Join Channel',
                        value: `${trigger}`,
                        inline: true
                    },
                    {
                        name: 'Category',
                        value: `${category}`,
                        inline: true
                    },
                    {
                        name: 'How it works',
                        value:
                            'Join **Join to Create** and VC+ will automatically create and move you into your own temporary VC.'
                    }
                ]
            )
        );
    } catch (error) {
        console.error(
            'VC setup error:',
            error
        );

        return reply(
            message,
            box(
                'VC+ Error',
                'I could not create the Join to Create system.',
                [
                    {
                        name: 'Check',
                        value:
                            'Make sure VC+ has **Manage Channels**, **Move Members**, and **Connect** permissions.'
                    }
                ]
            )
        );
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member) {
    const setup =
        setupData.get(member.guild.id);

    if (!setup) return null;

    const category =
        member.guild.channels.cache.get(
            setup.categoryId
        );

    if (!category) return null;

    const name =
        `${member.displayName} VC`
            .slice(0, 100);

    const channel =
        await member.guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: category.id,
            bitrate: 64000,
            permissionOverwrites: [
                {
                    id: member.guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect
                    ]
                },
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.MoveMembers
                    ]
                }
            ]
        });

    vcData.set(
        channel.id,
        {
            ownerId: member.id,
            guildId: member.guild.id,
            banned: new Set(),
            rejected: new Set(),
            muted: new Set()
        }
    );

    await member.voice
        .setChannel(channel)
        .catch(() => {});

    return channel;
}

// ============================================================
// VC COMMAND
// ============================================================

async function vcCommand(message, args) {
    const sub =
        (args.shift() || 'help')
            .toLowerCase();

    // --------------------------------------------------------
    // SETUP
    // --------------------------------------------------------

    if (sub === 'setup') {
        return setupVC(message);
    }

    // --------------------------------------------------------
    // HELP
    // --------------------------------------------------------

    if (sub === 'help') {
        return reply(
            message,
            box(
                'VC+ Voice Commands',
                'Manage your personal voice channel.',
                [
                    {
                        name: 'Voice',
                        value: [
                            '`-vc kick @user`',
                            '`-vc ban @user`',
                            '`-vc unban @user`',
                            '`-vc reject @user`',
                            '`-vc permit @user`',
                            '`-vc mute @user`',
                            '`-vc unmute @user`',
                            '`-vc stfu @user`',
                            '`-vc lock`',
                            '`-vc unlock`',
                            '`-vc limit 10`',
                            '`-vc rename Name`',
                            '`-vc transfer @user`',
                            '`-vc claim`'
                        ].join('\n')
                    },
                    {
                        name: 'Setup',
                        value: '`-vc setup`'
                    }
                ]
            )
        );
    }

    const channel =
        message.member.voice.channel;

    if (!channel) {
        return reply(
            message,
            helpBox(
                `vc ${sub}`,
                'You must be inside a VC to use this command.',
                `-vc ${sub} @user`
            )
        );
    }

    let data =
        getVCData(channel.id);

    // --------------------------------------------------------
    // CLAIM
    // --------------------------------------------------------

    if (sub === 'claim') {
        if (data) {
            return reply(
                message,
                box(
                    'VC+',
                    'This VC already has an owner.'
                )
            );
        }

        data = {
            ownerId: message.author.id,
            guildId: message.guild.id,
            banned: new Set(),
            rejected: new Set(),
            muted: new Set()
        };

        vcData.set(
            channel.id,
            data
        );

        return reply(
            message,
            box(
                'VC Claimed',
                `${message.member} now owns this VC.`
            )
        );
    }

    if (!data) {
        return reply(
            message,
            box(
                'VC+',
                'This is not a VC+ personal voice channel.'
            )
        );
    }

    // --------------------------------------------------------
    // OWNER / FOUNDER / SERVER OWNER
    // --------------------------------------------------------

    if (
        !canControlVC(
            message.member,
            data
        )
    ) {
        return reply(
            message,
            helpBox(
                `vc ${sub}`,
                'Manage your personal voice channel.',
                `-vc ${sub} @user`,
                'Only the VC owner, Founder, or server owner.'
            )
        );
    }

    // --------------------------------------------------------
    // TARGET COMMANDS
    // --------------------------------------------------------

    const targetCommands = [
        'kick',
        'ban',
        'unban',
        'reject',
        'permit',
        'mute',
        'unmute',
        'stfu',
        'transfer'
    ];

    if (targetCommands.includes(sub)) {
        const target =
            await getTarget(
                message,
                args[0]
            );

        if (!target) {
            return reply(
                message,
                helpBox(
                    `vc ${sub}`,
                    getVCDescription(sub),
                    `-vc ${sub} @user`
                )
            );
        }

        if (
            target.id ===
            message.author.id
        ) {
            return reply(
                message,
                box(
                    'VC+',
                    'You cannot target yourself.'
                )
            );
        }

        // KICK
        if (sub === 'kick') {
            if (
                target.voice.channelId !==
                channel.id
            ) {
                return reply(
                    message,
                    box(
                        'VC Kick',
                        `${target} is not in your VC.`
                    )
                );
            }

            await target.voice
                .disconnect(
                    'VC+ owner kick'
                )
                .catch(() => {});

            return reply(
                message,
                box(
                    'VC Kick',
                    `${target} was kicked from the VC.`
                )
            );
        }

        // BAN
        if (sub === 'ban') {
            data.banned.add(
                target.id
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect(
                        'VC+ VC ban'
                    )
                    .catch(() => {});
            }

            return reply(
                message,
                box(
                    'VC Ban',
                    `${target} is now banned from this VC.`
                )
            );
        }

        // UNBAN
        if (sub === 'unban') {
            data.banned.delete(
                target.id
            );

            return reply(
                message,
                box(
                    'VC Unban',
                    `${target} can now join this VC again.`
                )
            );
        }

        // REJECT
        if (sub === 'reject') {
            data.rejected.add(
                target.id
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect(
                        'VC+ reject'
                    )
                    .catch(() => {});
            }

            return reply(
                message,
                box(
                    'VC Reject',
                    `${target} has been rejected from this VC.`
                )
            );
        }

        // PERMIT
        if (sub === 'permit') {
            data.rejected.delete(
                target.id
            );

            data.banned.delete(
                target.id
            );

            return reply(
                message,
                box(
                    'VC Permit',
                    `${target} has been permitted to join this VC.`
                )
            );
        }

        // MUTE
        if (
            sub === 'mute' ||
            sub === 'stfu'
        ) {
            if (
                target.voice.channelId !==
                channel.id
            ) {
                return reply(
                    message,
                    box(
                        'VC Mute',
                        `${target} is not in your VC.`
                    )
                );
            }

            data.muted.add(
                target.id
            );

            await target.voice
                .setMute(
                    true,
                    'VC+ owner mute'
                )
                .catch(() => {});

            return reply(
                message,
                box(
                    'VC Mute',
                    `${target} is now server-muted in this VC.`
                )
            );
        }

        // UNMUTE
        if (sub === 'unmute') {
            data.muted.delete(
                target.id
            );

            await target.voice
                .setMute(
                    false,
                    'VC+ owner unmute'
                )
                .catch(() => {});

            return reply(
                message,
                box(
                    'VC Unmute',
                    `${target} has been unmuted.`
                )
            );
        }

        // TRANSFER
        if (sub === 'transfer') {
            data.ownerId =
                target.id;

            return reply(
                message,
                box(
                    'VC Ownership',
                    `${target} is now the owner of this VC.`
                )
            );
        }
    }

    // --------------------------------------------------------
    // LOCK
    // --------------------------------------------------------

    if (sub === 'lock') {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: false
            }
        ).catch(() => {});

        return reply(
            message,
            box(
                'VC Locked',
                'Your VC is now locked.'
            )
        );
    }

    // --------------------------------------------------------
    // UNLOCK
    // --------------------------------------------------------

    if (sub === 'unlock') {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: true
            }
        ).catch(() => {});

        return reply(
            message,
            box(
                'VC Unlocked',
                'Your VC is now unlocked.'
            )
        );
    }

    // --------------------------------------------------------
    // LIMIT
    // --------------------------------------------------------

    if (sub === 'limit') {
        const limit =
            Number(args[0]);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return reply(
                message,
                helpBox(
                    'vc limit',
                    'Change your VC user limit.',
                    '-vc limit 0-99'
                )
            );
        }

        await channel
            .setUserLimit(limit)
            .catch(() => {});

        return reply(
            message,
            box(
                'VC Limit',
                `The VC limit is now **${limit === 0 ? 'Unlimited' : limit}**.`
            )
        );
    }

    // --------------------------------------------------------
    // RENAME
    // --------------------------------------------------------

    if (sub === 'rename') {
        const name =
            args.join(' ').trim();

        if (!name) {
            return reply(
                message,
                helpBox(
                    'vc rename',
                    'Rename your VC.',
                    '-vc rename My Room'
                )
            );
        }

        const newName =
            name.slice(0, 100);

        await channel
            .setName(newName)
            .catch(() => {});

        return reply(
            message,
            box(
                'VC Rename',
                `Your VC is now named **${newName}**.`
            )
        );
    }

    return reply(
        message,
        helpBox(
            `vc ${sub}`,
            'Unknown VC command.',
            '-vc help'
        )
    );
}

// ============================================================
// VC DESCRIPTION
// ============================================================

function getVCDescription(command) {
    const descriptions = {
        kick: 'Kick a member from your VC.',
        ban: 'Ban a member from your VC.',
        unban: 'Remove a member from your VC ban list.',
        reject: 'Reject a member from joining your VC.',
        permit: 'Permit a member to join your VC.',
        mute: 'Server mute a member in your VC.',
        unmute: 'Remove a VC mute.',
        stfu: 'Keep a member server-muted in your VC.',
        transfer: 'Transfer ownership of your VC.'
    };

    return (
        descriptions[command] ||
        'Manage your personal VC.'
    );
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on(
    'messageCreate',
    async message => {
        try {
            if (!message.guild) return;
            if (message.author.bot) return;

            const content =
                message.content.trim();

            if (
                !content.startsWith(PREFIX)
            ) {
                return;
            }

            const args =
                content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()
                    ?.toLowerCase();

            if (!command) return;

            // =================================================
            // HELP
            // =================================================

            if (command === 'help') {
                return reply(
                    message,
                    box(
                        'VC+ Commands',
                        'Main commands available in VC+.',
                        [
                            {
                                name: 'General',
                                value: [
                                    '`-help`',
                                    '`-ping`',
                                    '`-rank list`'
                                ].join('\n')
                            },
                            {
                                name: 'Moderation',
                                value: [
                                    '`-ban @user`',
                                    '`-unban ID`',
                                    '`-kick @user`',
                                    '`-timeout @user 10`',
                                    '`-untimeout @user`'
                                ].join('\n')
                            },
                            {
                                name: 'Voice',
                                value: [
                                    '`-vc setup`',
                                    '`-vc help`',
                                    '`-vc kick @user`',
                                    '`-vc ban @user`',
                                    '`-vc unban @user`',
                                    '`-vc reject @user`',
                                    '`-vc permit @user`',
                                    '`-vc mute @user`',
                                    '`-vc unmute @user`',
                                    '`-vc stfu @user`',
                                    '`-vc lock`',
                                    '`-vc unlock`',
                                    '`-vc limit 10`',
                                    '`-vc rename Name`',
                                    '`-vc transfer @user`'
                                ].join('\n')
                            },
                            {
                                name: 'Ranks',
                                value: '`-rank list`'
                            }
                        ]
                    )
                );
            }

            // =================================================
            // PING
            // =================================================

            if (command === 'ping') {
                return reply(
                    message,
                    box(
                        'Pong',
                        `Bot latency: **${client.ws.ping}ms**`
                    )
                );
            }

            // =================================================
            // RANK
            // =================================================

            if (command === 'rank') {
                const sub =
                    (args.shift() || '')
                        .toLowerCase();

                // RANK LIST
                if (sub === 'list') {
                    return reply(
                        message,
                        box(
                            'VC+ Rank List',
                            'All available server ranks, from highest to lowest.',
                            RANKS.map(
                                (rank, index) => ({
                                    name:
                                        `${index + 1}. ${rank}`,
                                    value:
                                        `Power: **${RANK_POWER[rank]}**`,
                                    inline: true
                                })
                            )
                        )
                    );
                }

                // ONLY SERVER OWNER CAN ASSIGN
                if (
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'rank',
                            'Assign a server rank.',
                            '-rank @user Founder',
                            'Only the server owner can assign ranks.'
                        )
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                const rankInput =
                    args.slice(1).join(' ')
                        .toLowerCase();

                const rank =
                    RANKS.find(
                        r =>
                            r.toLowerCase() ===
                            rankInput
                    );

                if (!target || !rank) {
                    return reply(
                        message,
                        helpBox(
                            'rank',
                            'Assign a server rank.',
                            '-rank @user Founder',
                            `Ranks: ${RANKS.join(', ')}`
                        )
                    );
                }

                try {
                    // Remove existing VC+ ranks
                    const oldRoles =
                        target.roles.cache.filter(
                            role =>
                                RANKS.some(
                                    r =>
                                        r.toLowerCase() ===
                                        role.name.toLowerCase()
                                )
                        );

                    if (oldRoles.size) {
                        await target.roles.remove(
                            oldRoles
                        );
                    }

                    let role =
                        message.guild.roles.cache.find(
                            r =>
                                r.name === rank
                        );

                    if (!role) {
                        role =
                            await message.guild.roles.create({
                                name: rank,
                                reason:
                                    'VC+ rank system'
                            });
                    }

                    await target.roles.add(
                        role,
                        'VC+ rank assignment'
                    );

                    return reply(
                        message,
                        box(
                            'Rank Assigned',
                            `${target} is now **${rank}**.`
                        )
                    );
                } catch (error) {
                    console.error(
                        'Rank error:',
                        error
                    );

                    return reply(
                        message,
                        box(
                            'Rank Error',
                            'I could not assign that rank. Make sure my bot role is above the rank roles.'
                        )
                    );
                }
            }

            // =================================================
            // BAN
            // =================================================

            if (command === 'ban') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.BanMembers
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'ban',
                            'Ban a member from the server.',
                            '-ban @user [reason]',
                            'Requires Ban Members.'
                        )
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                if (!target) {
                    return reply(
                        message,
                        helpBox(
                            'ban',
                            'Ban a member from the server.',
                            '-ban @user [reason]'
                        )
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return reply(
                        message,
                        box(
                            'Ban',
                            'The server owner cannot be banned.'
                        )
                    );
                }

                if (!target.bannable) {
                    return reply(
                        message,
                        box(
                            'Ban',
                            'I cannot ban that member because of Discord role hierarchy.'
                        )
                    );
                }

                const reason =
                    args.slice(1).join(' ') ||
                    'No reason provided';

                await target.ban({
                    reason
                }).catch(() => {});

                return reply(
                    message,
                    box(
                        'Ban',
                        `${target.user.tag} has been banned.`,
                        [
                            {
                                name: 'Reason',
                                value: reason
                            }
                        ]
                    )
                );
            }

            // =================================================
            // UNBAN
            // =================================================

            if (command === 'unban') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.BanMembers
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'unban',
                            'Unban a user.',
                            '-unban ID',
                            'Requires Ban Members.'
                        )
                    );
                }

                const id = args[0];

                if (!id) {
                    return reply(
                        message,
                        helpBox(
                            'unban',
                            'Unban a user.',
                            '-unban ID'
                        )
                    );
                }

                try {
                    await message.guild.members.unban(
                        id
                    );

                    return reply(
                        message,
                        box(
                            'Unban',
                            `**${id}** has been unbanned.`
                        )
                    );
                } catch {
                    return reply(
                        message,
                        box(
                            'Unban',
                            'I could not unban that user.'
                        )
                    );
                }
            }

            // =================================================
            // KICK
            // =================================================

            if (command === 'kick') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.KickMembers
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'kick',
                            'Kick a member.',
                            '-kick @user [reason]',
                            'Requires Kick Members.'
                        )
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                if (
                    !target ||
                    !target.kickable
                ) {
                    return reply(
                        message,
                        helpBox(
                            'kick',
                            'Kick a member.',
                            '-kick @user [reason]'
                        )
                    );
                }

                const reason =
                    args.slice(1).join(' ') ||
                    'No reason provided';

                await target.kick(
                    reason
                ).catch(() => {});

                return reply(
                    message,
                    box(
                        'Kick',
                        `${target.user.tag} has been kicked.`,
                        [
                            {
                                name: 'Reason',
                                value: reason
                            }
                        ]
                    )
                );
            }

            // =================================================
            // TIMEOUT
            // =================================================

            if (command === 'timeout') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'timeout',
                            'Timeout a member.',
                            '-timeout @user 10 [reason]',
                            'Requires Moderate Members.'
                        )
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                const minutes =
                    Number(args[1]);

                if (
                    !target ||
                    !Number.isFinite(minutes) ||
                    minutes <= 0
                ) {
                    return reply(
                        message,
                        helpBox(
                            'timeout',
                            'Timeout a member.',
                            '-timeout @user 10 [reason]'
                        )
                    );
                }

                const duration =
                    Math.min(
                        minutes,
                        40320
                    ) *
                    60 *
                    1000;

                const reason =
                    args.slice(2).join(' ') ||
                    'No reason provided';

                await target.timeout(
                    duration,
                    reason
                ).catch(() => {});

                return reply(
                    message,
                    box(
                        'Timeout',
                        `${target} has been timed out for **${minutes} minutes**.`
                    )
                );
            }

            // =================================================
            // UNTIMEOUT
            // =================================================

            if (command === 'untimeout') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return reply(
                        message,
                        helpBox(
                            'untimeout',
                            'Remove a timeout.',
                            '-untimeout @user'
                        )
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                if (!target) {
                    return reply(
                        message,
                        helpBox(
                            'untimeout',
                            'Remove a timeout.',
                            '-untimeout @user'
                        )
                    );
                }

                await target.timeout(
                    null,
                    'VC+ timeout removed'
                ).catch(() => {});

                return reply(
                    message,
                    box(
                        'Timeout Removed',
                        `${target} is no longer timed out.`
                    )
                );
            }

            // =================================================
            // VC
            // =================================================

            if (command === 'vc') {
                return vcCommand(
                    message,
                    args
                );
            }

            // =================================================
            // UNKNOWN
            // =================================================

            return reply(
                message,
                helpBox(
                    command,
                    'Unknown command.',
                    '-help'
                )
            );

        } catch (error) {
            console.error(
                'Command error:',
                error
            );

            return reply(
                message,
                box(
                    'VC+ Error',
                    'Something went wrong while processing that command.'
                )
            );
        }
    }
);

// ============================================================
// VOICE STATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild;

            const setup =
                setupData.get(
                    guild.id
                );

            // -------------------------------------------------
            // JOIN TO CREATE
            // -------------------------------------------------

            if (
                setup &&
                newState.channelId ===
                setup.triggerId
            ) {
                const member =
                    newState.member;

                if (!member) return;

                const channel =
                    await createPersonalVC(
                        member
                    );

                if (channel) {
                    console.log(
                        `Created VC ${channel.id} for ${member.user.tag}`
                    );
                }

                return;
            }

            // -------------------------------------------------
            // PROTECT VC
            // -------------------------------------------------

            const data =
                newState.channelId
                    ? vcData.get(
                        newState.channelId
                    )
                    : null;

            if (!data) return;

            // BANNED / REJECTED
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
                        'VC+ restricted user'
                    )
                    .catch(() => {});

                return;
            }

            // AUTO MUTE
            if (
                data.muted.has(
                    newState.id
                )
            ) {
                await newState.member?.voice
                    .setMute(
                        true,
                        'VC+ persistent mute'
                    )
                    .catch(() => {});
            }

            // -------------------------------------------------
            // AUTO UNMUTE WHEN JOINING
            // -------------------------------------------------

            if (
                !data.muted.has(
                    newState.id
                ) &&
                newState.serverMute
            ) {
                await newState.member?.voice
                    .setMute(
                        false,
                        'VC+ automatic unmute'
                    )
                    .catch(() => {});
            }

            // -------------------------------------------------
            // CLEAN EMPTY VC
            // -------------------------------------------------

            const channel =
                newState.channel;

            if (
                channel &&
                channel.members.size === 0
            ) {
                vcData.delete(
                    channel.id
                );

                await channel
                    .delete(
                        'VC+ empty temporary VC'
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
// EMPTY VC CLEANUP
// ============================================================

client.on(
    'voiceStateUpdate',
    async oldState => {
        try {
            if (!oldState.channel) return;

            const channel =
                oldState.channel;

            const data =
                vcData.get(
                    channel.id
                );

            if (!data) return;

            if (
                channel.members.size === 0
            ) {
                vcData.delete(
                    channel.id
                );

                await channel
                    .delete(
                        'VC+ temporary channel empty'
                    )
                    .catch(() => {});
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
// READY
// ============================================================

client.once(
    'ready',
    () => {
        console.log(
            `${BOT_NAME} online as ${client.user.tag}`
        );

        try {
            client.user.setPresence({
                status:
                    BotConfig?.presence?.status ||
                    'online',
                activities: [
                    {
                        name:
                            BotConfig?.presence?.activity ||
                            'VC+',
                        type: 0
                    }
                ]
            });
        } catch (error) {
            console.error(
                'Presence error:',
                error
            );
        }
    }
);

// ============================================================
// ERROR PROTECTION
// ============================================================

client.on(
    'error',
    error => {
        console.error(
            'Discord client error:',
            error
        );
    }
);

client.on(
    'shardError',
    error => {
        console.error(
            'Discord shard error:',
            error
        );
    }
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            'Unhandled rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            'Uncaught exception:',
            error
        );
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

        console.log(
            `Starting ${BOT_NAME}...`
        );

        await client.login(
            token
        );

    } catch (error) {
        console.error(
            'Failed to start VC+:',
            error
        );

        process.exit(1);
    }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    console.log(
        `${signal} received. Shutting down VC+...`
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
