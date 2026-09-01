// ============================================================
// vc+ | src/app.js
// ============================================================

import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType
} from 'discord.js';

import 'dotenv/config';

// ============================================================
// CONFIG
// ============================================================

const PREFIX = '-';
const BOT_NAME = 'vc+';

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
// These are ONLY names used by the bot.
// The bot does NOT create rank roles.
// ============================================================

const RANKS = [
    'founder',
    'god',
    'owner',
    'co-owner',
    'executive',
    'director',
    'admin',
    'moderator',
    'staff',
    'member'
];

const RANK_POWER = {
    founder: 100,
    god: 90,
    owner: 80,
    'co-owner': 70,
    executive: 60,
    director: 50,
    admin: 40,
    moderator: 30,
    staff: 20,
    member: 10
};

// ============================================================
// SERVER DATA
// ============================================================

const guildData = new Map();

/*
guildData structure:

{
    triggerId,
    categoryId,
    vcs: Map(channelId, {
        ownerId,
        banned: Set,
        rejected: Set,
        permitted: Set,
        muted: Set
    }),
    vouches: Map(userId, number),
    requiredVouches: 1
}
*/

// ============================================================
// GET GUILD DATA
// ============================================================

function getGuildData(guild) {
    if (!guildData.has(guild.id)) {
        guildData.set(guild.id, {
            triggerId: null,
            categoryId: null,
            vcs: new Map(),
            vouches: new Map(),
            requiredVouches: 1
        });
    }

    return guildData.get(guild.id);
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, fields = []) {
    const embed = new EmbedBuilder()
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description || null)
        .setFields(fields)
        .setTimestamp();

    return embed;
}

function success(title, description) {
    return box(`✓ ${title}`, description);
}

function errorBox(command, description, syntax, access = null) {
    const fields = [
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
        }
    ];

    if (access) {
        fields.push({
            name: 'Access',
            value: access,
            inline: false
        });
    }

    return box('Help', '', fields);
}

// ============================================================
// RANK HELPERS
// ============================================================

function getMemberRank(member) {
    if (!member) return null;

    for (const rank of RANKS) {
        const role = member.roles.cache.find(
            r => r.name.toLowerCase() === rank
        );

        if (role) {
            return rank;
        }
    }

    return null;
}

function getRankPower(member) {
    const rank = getMemberRank(member);
    return rank ? RANK_POWER[rank] : 0;
}

function isFounder(member) {
    return getMemberRank(member) === 'founder';
}

function isGod(member) {
    const rank = getMemberRank(member);
    return rank === 'founder' || rank === 'god';
}

function isServerOwner(member) {
    return member?.guild?.ownerId === member?.id;
}

function hasOwnerControl(member) {
    return isServerOwner(member) || isFounder(member);
}

function canModerate(member) {
    return (
        isServerOwner(member) ||
        getRankPower(member) >= RANK_POWER.admin ||
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

// ============================================================
// TARGET
// ============================================================

async function getTarget(message, input) {
    if (!input) return null;

    const mention = message.mentions.members.first();

    if (mention) return mention;

    const id = input.replace(/[<@!>]/g, '');

    if (!/^\d+$/.test(id)) return null;

    return message.guild.members.fetch(id).catch(() => null);
}

// ============================================================
// BOT PERMISSION CHECK
// ============================================================

function botCanManage(message, target) {
    const me = message.guild.members.me;

    if (!me) return false;

    if (target.id === message.guild.ownerId) {
        return false;
    }

    return target.roles.highest.position < me.roles.highest.position;
}

// ============================================================
// VC DATA
// ============================================================

function getVC(member) {
    if (!member?.voice?.channelId) return null;

    const data = getGuildData(member.guild).vcs;

    return data.get(member.voice.channelId) || null;
}

function isVCOwner(member) {
    const vc = getVC(member);

    return !!(
        vc &&
        (
            vc.ownerId === member.id ||
            hasOwnerControl(member)
        )
    );
}

// ============================================================
// INTERFACE
// ============================================================

function vcInterface(channel, ownerId) {
    return box(
        'Voice Interface',
        `Personal voice channel for <@${ownerId}>.\n\n` +
        `Use these commands while inside this VC:`,
        [
            {
                name: 'Voice',
                value:
                    '`-vc kick @user`\n' +
                    '`-vc ban @user`\n' +
                    '`-vc unban @user`\n' +
                    '`-vc reject @user`\n' +
                    '`-vc permit @user`\n' +
                    '`-vc lock`\n' +
                    '`-vc unlock`',
                inline: true
            },
            {
                name: 'Settings',
                value:
                    '`-vc limit 10`\n' +
                    '`-vc rename My VC`\n' +
                    '`-vc transfer @user`\n' +
                    '`-vc stfu @user`\n' +
                    '`-vc unmute @user`\n' +
                    '`-interface`',
                inline: true
            }
        ]
    );
}

// ============================================================
// HELP
// ============================================================

function helpEmbed() {
    return box(
        'Help',
        'vc+ commands',
        [
            {
                name: 'General',
                value:
                    '`-help`\n' +
                    '`-ping`\n' +
                    '`-ranks`\n' +
                    '`-rank @user rank`\n' +
                    '`-interface`'
            },
            {
                name: 'Moderation',
                value:
                    '`-ban @user [reason]`\n' +
                    '`-unban userID`\n' +
                    '`-kick @user [reason]`\n' +
                    '`-timeout @user minutes`\n' +
                    '`-untimeout @user`\n' +
                    '`-foreverban @user [reason]`'
            },
            {
                name: 'Vouches',
                value:
                    '`-vouch @user`\n' +
                    '`-vouch add @user`\n' +
                    '`-vouch set number`'
            },
            {
                name: 'Voice',
                value:
                    '`-vc setup`\n' +
                    '`-vc kick @user`\n' +
                    '`-vc ban @user`\n' +
                    '`-vc unban @user`\n' +
                    '`-vc reject @user`\n' +
                    '`-vc permit @user`\n' +
                    '`-vc lock`\n' +
                    '`-vc unlock`\n' +
                    '`-vc limit number`\n' +
                    '`-vc rename name`\n' +
                    '`-vc transfer @user`\n' +
                    '`-vc stfu @user`\n' +
                    '`-vc unmute @user`'
            }
        ]
    );
}

// ============================================================
// RANK LIST
// ============================================================

function ranksEmbed() {
    return box(
        'Ranks',
        'vc+ recognizes these server roles from highest to lowest:',
        [
            {
                name: 'Rank hierarchy',
                value:
                    '**1. Founder**\n' +
                    '**2. God**\n' +
                    '**3. Owner**\n' +
                    '**4. Co-Owner**\n' +
                    '**5. Executive**\n' +
                    '**6. Director**\n' +
                    '**7. Admin**\n' +
                    '**8. Moderator**\n' +
                    '**9. Staff**\n' +
                    '**10. Member**'
            },
            {
                name: 'Important',
                value:
                    'These are not automatically-created roles. ' +
                    'vc+ checks the roles that already exist in your server.'
            }
        ]
    );
}

// ============================================================
// READY
// ============================================================

client.once('ready', () => {
    console.log('=================================');
    console.log(`${BOT_NAME} is online`);
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log('=================================');

    client.user.setPresence({
        status: 'online',
        activities: [
            {
                name: `${PREFIX}help`,
                type: ActivityType.Watching
            }
        ]
    });
});

// ============================================================
// ERROR PROTECTION
// ============================================================

process.on('unhandledRejection', error => {
    console.error('[Unhandled Rejection]', error);
});

process.on('uncaughtException', error => {
    console.error('[Uncaught Exception]', error);
});

client.on('error', error => {
    console.error('[Discord Client Error]', error);
});

client.on('shardError', error => {
    console.error('[Shard Error]', error);
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async message => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;

        const content = message.content.trim();

        if (!content.startsWith(PREFIX)) return;

        const parts = content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

        const command = parts.shift()?.toLowerCase();

        if (!command) return;

        // ====================================================
        // HELP
        // ====================================================

        if (command === 'help') {
            return message.reply({
                embeds: [helpEmbed()]
            });
        }

        // ====================================================
        // PING
        // ====================================================

        if (command === 'ping') {
            return message.reply({
                embeds: [
                    success(
                        'Pong',
                        `Latency: **${client.ws.ping}ms**`
                    )
                ]
            });
        }

        // ====================================================
        // RANKS
        // ====================================================

        if (command === 'ranks') {
            return message.reply({
                embeds: [ranksEmbed()]
            });
        }

        // ====================================================
        // RANK
        // ====================================================

        if (command === 'rank') {
            if (!isServerOwner(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-rank',
                            'Assign one of the vc+ ranks.',
                            '-rank @user rank',
                            'Only the server owner can assign ranks.'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            const rank = parts[1]?.toLowerCase();

            if (!target || !RANKS.includes(rank)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-rank',
                            'Assign a vc+ rank.',
                            '-rank @user rank',
                            'Use `-ranks` to view the rank list.'
                        )
                    ]
                });
            }

            const role = message.guild.roles.cache.find(
                r => r.name.toLowerCase() === rank
            );

            if (!role) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-rank',
                            'Assign a rank using an existing server role.',
                            `-rank @user ${rank}`,
                            `Create a role named **${rank}** first. vc+ does not create rank roles.`
                        )
                    ]
                });
            }

            if (
                role.position >=
                message.guild.members.me.roles.highest.position
            ) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-rank',
                            'The bot cannot manage that role.',
                            `-rank @user ${rank}`,
                            'Move the bot role above the rank role.'
                        )
                    ]
                });
            }

            try {
                await target.roles.add(role);

                return message.reply({
                    embeds: [
                        success(
                            'Rank Assigned',
                            `${target} now has the **${role.name}** rank.`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-rank',
                            'The rank could not be assigned.',
                            `-rank @user ${rank}`,
                            'Check the bot role hierarchy.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === 'ban') {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-ban',
                            'Ban a member.',
                            '-ban @user [reason]',
                            'Requires moderation access.'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            if (!target) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-ban',
                            'Ban a member.',
                            '-ban @user [reason]'
                        )
                    ]
                });
            }

            if (!botCanManage(message, target)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-ban',
                            'Ban a member.',
                            '-ban @user [reason]',
                            'I cannot manage that member because of role hierarchy.'
                        )
                    ]
                });
            }

            const reason =
                parts.slice(1).join(' ') ||
                'No reason provided';

            try {
                await target.ban({ reason });

                return message.reply({
                    embeds: [
                        success(
                            'Banned',
                            `**${target.user.tag}** has been banned.\n\nReason: ${reason}`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-ban',
                            'Ban a member.',
                            '-ban @user [reason]',
                            'Discord rejected the ban.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // FOREVERBAN
        // Founder + God only
        // ====================================================

        if (
            command === 'foreverban' ||
            command === 'forever-ban'
        ) {
            if (!isGod(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-foreverban',
                            'Permanently ban a member from the guild.',
                            '-foreverban @user [reason]',
                            'Founder and God only.'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            if (!target) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-foreverban',
                            'Permanently ban a member.',
                            '-foreverban @user [reason]',
                            'Founder and God only.'
                        )
                    ]
                });
            }

            if (
                target.id === message.author.id ||
                target.id === message.guild.ownerId
            ) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-foreverban',
                            'Permanently ban a member.',
                            '-foreverban @user [reason]',
                            'That member cannot be foreverbanned.'
                        )
                    ]
                });
            }

            if (!botCanManage(message, target)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-foreverban',
                            'Permanently ban a member.',
                            '-foreverban @user [reason]',
                            'The bot cannot manage that member.'
                        )
                    ]
                });
            }

            const reason =
                parts.slice(1).join(' ') ||
                'Forever ban';

            try {
                await target.ban({
                    reason: `[FOREVERBAN] ${reason}`,
                    deleteMessageSeconds: 0
                });

                return message.reply({
                    embeds: [
                        success(
                            'Forever Banned',
                            `**${target.user.tag}** has been permanently banned from this guild.\n\n` +
                            `This is an account ban. Discord bots cannot access or ban a user's IP address.`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-foreverban',
                            'Permanently ban a member.',
                            '-foreverban @user [reason]',
                            'Discord rejected the ban.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // UNBAN
        // ====================================================

        if (command === 'unban') {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-unban',
                            'Unban a user.',
                            '-unban userID'
                        )
                    ]
                });
            }

            const id = parts[0];

            if (!id) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-unban',
                            'Unban a user.',
                            '-unban userID'
                        )
                    ]
                });
            }

            try {
                await message.guild.members.unban(id);

                return message.reply({
                    embeds: [
                        success(
                            'Unbanned',
                            `User **${id}** has been unbanned.`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-unban',
                            'Unban a user.',
                            '-unban userID',
                            'That user may not be banned.'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === 'kick') {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-kick',
                            'Kick a member.',
                            '-kick @user [reason]'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            if (!target) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-kick',
                            'Kick a member.',
                            '-kick @user [reason]'
                        )
                    ]
                });
            }

            if (!botCanManage(message, target)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-kick',
                            'Kick a member.',
                            '-kick @user [reason]',
                            'The bot cannot manage that member.'
                        )
                    ]
                });
            }

            const reason =
                parts.slice(1).join(' ') ||
                'No reason provided';

            try {
                await target.kick(reason);

                return message.reply({
                    embeds: [
                        success(
                            'Kicked',
                            `**${target.user.tag}** was kicked.\n\nReason: ${reason}`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-kick',
                            'Kick a member.',
                            '-kick @user [reason]'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === 'timeout') {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-timeout',
                            'Timeout a member.',
                            '-timeout @user minutes [reason]'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            const minutes = Number(parts[1]);

            if (
                !target ||
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-timeout',
                            'Timeout a member.',
                            '-timeout @user minutes [reason]'
                        )
                    ]
                });
            }

            if (!botCanManage(message, target)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-timeout',
                            'Timeout a member.',
                            '-timeout @user minutes [reason]'
                        )
                    ]
                });
            }

            const duration =
                Math.min(minutes, 40320) *
                60 *
                1000;

            try {
                await target.timeout(
                    duration,
                    parts.slice(2).join(' ') ||
                    'No reason provided'
                );

                return message.reply({
                    embeds: [
                        success(
                            'Timed Out',
                            `${target} has been timed out for **${minutes} minutes**.`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-timeout',
                            'Timeout a member.',
                            '-timeout @user minutes [reason]'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // UNTIMEOUT
        // ====================================================

        if (command === 'untimeout') {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-untimeout',
                            'Remove a timeout.',
                            '-untimeout @user'
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            if (!target) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-untimeout',
                            'Remove a timeout.',
                            '-untimeout @user'
                        )
                    ]
                });
            }

            try {
                await target.timeout(null);

                return message.reply({
                    embeds: [
                        success(
                            'Timeout Removed',
                            `${target} is no longer timed out.`
                        )
                    ]
                });
            } catch {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-untimeout',
                            'Remove a timeout.',
                            '-untimeout @user'
                        )
                    ]
                });
            }
        }

        // ====================================================
        // VOUCH
        // ====================================================

        if (command === 'vouch') {
            const sub = parts[0]?.toLowerCase();

            const data = getGuildData(message.guild);

            // Founder controls
            if (sub === 'set') {
                if (!isFounder(message.member)) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vouch set',
                                'Set the number of vouches required.',
                                '-vouch set number',
                                'Founder only.'
                            )
                        ]
                    });
                }

                const amount = Number(parts[1]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vouch set',
                                'Set the required vouches.',
                                '-vouch set number',
                                'Use a number from 1 to 100.'
                            )
                        ]
                    });
                }

                data.requiredVouches = amount;

                return message.reply({
                    embeds: [
                        success(
                            'Vouch Requirement',
                            `The requirement is now **${amount} vouch${amount === 1 ? '' : 'es'}**.`
                        )
                    ]
                });
            }

            if (sub === 'add') {
                if (!isFounder(message.member)) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vouch add',
                                'Add a vouch to a member.',
                                '-vouch add @user',
                                'Founder only.'
                            )
                        ]
                    });
                }

                const target = await getTarget(
                    message,
                    parts[1]
                );

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vouch add',
                                'Add a vouch to a member.',
                                '-vouch add @user'
                            )
                        ]
                    });
                }

                const count =
                    (data.vouches.get(target.id) || 0) + 1;

                data.vouches.set(
                    target.id,
                    count
                );

                return message.reply({
                    embeds: [
                        success(
                            'Vouch Added',
                            `${target} now has **${count}** vouch${count === 1 ? '' : 'es'}.\n\n` +
                            `Required: **${data.requiredVouches}**`
                        )
                    ]
                });
            }

            const target = await getTarget(
                message,
                parts[0]
            );

            if (!target) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-vouch',
                            'View a member's vouches.',
                            '-vouch @user'
                        )
                    ]
                });
            }

            const count =
                data.vouches.get(target.id) || 0;

            return message.reply({
                embeds: [
                    box(
                        'Vouches',
                        `${target} has **${count}** vouch${count === 1 ? '' : 'es'}.\n\n` +
                        `Required: **${data.requiredVouches}**`
                    )
                ]
            });
        }

        // ====================================================
        // INTERFACE
        // ====================================================

        if (command === 'interface') {
            const channel =
                message.member.voice.channel;

            if (!channel) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-interface',
                            'Show the VC controls.',
                            '-interface',
                            'You must be inside your personal VC.'
                        )
                    ]
                });
            }

            const vc =
                getVC(message.member);

            if (!vc) {
                return message.reply({
                    embeds: [
                        errorBox(
                            '-interface',
                            'Show the VC controls.',
                            '-interface',
                            'This is not a vc+ temporary VC.'
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    vcInterface(
                        channel,
                        vc.ownerId
                    )
                ]
            });
        }

        // ====================================================
        // VC
        // ====================================================

        if (command === 'vc') {
            const sub = parts.shift()?.toLowerCase();

            // ------------------------------------------------
            // VC SETUP
            // ------------------------------------------------

            if (sub === 'setup') {
                if (!canModerate(message.member)) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc setup',
                                'Create the vc+ Join to Create system.',
                                '-vc setup',
                                'Requires moderation/Manage Server access.'
                            )
                        ]
                    });
                }

                const data =
                    getGuildData(message.guild);

                if (data.triggerId) {
                    const existing =
                        message.guild.channels.cache.get(
                            data.triggerId
                        );

                    if (existing) {
                        return message.reply({
                            embeds: [
                                errorBox(
                                    '-vc setup',
                                    'Set up Join to Create.',
                                    '-vc setup',
                                    `Already configured: ${existing}`
                                )
                            ]
                        });
                    }

                    data.triggerId = null;
                }

                try {
                    const category =
                        await message.guild.channels.create({
                            name: 'vc+',
                            type: ChannelType.GuildCategory
                        });

                    const trigger =
                        await message.guild.channels.create({
                            name: 'Join to Create',
                            type: ChannelType.GuildVoice,
                            parent: category.id,
                            userLimit: 0,
                            bitrate: 64000
                        });

                    data.triggerId =
                        trigger.id;

                    data.categoryId =
                        category.id;

                    return message.reply({
                        embeds: [
                            success(
                                'VC Setup Complete',
                                `Join **${trigger.name}** and vc+ will instantly create your personal voice channel and move you into it.\n\n` +
                                `Your personal channel will look like:\n` +
                                `**username VC**\n\n` +
                                `Use \`-interface\` inside your VC to display the controls.`
                            )
                        ]
                    });
                } catch (error) {
                    console.error(
                        '[VC SETUP]',
                        error
                    );

                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc setup',
                                'Create the vc+ Join to Create system.',
                                '-vc setup',
                                'Make sure vc+ has Manage Channels permission.'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // VC HELP
            // ------------------------------------------------

            if (!sub) {
                return message.reply({
                    embeds: [
                        box(
                            'Voice Commands',
                            'Use these commands while inside your personal VC.',
                            [
                                {
                                    name: 'Management',
                                    value:
                                        '`-vc kick @user`\n' +
                                        '`-vc ban @user`\n' +
                                        '`-vc reject @user`\n' +
                                        '`-vc permit @user`\n' +
                                        '`-vc lock`\n' +
                                        '`-vc unlock`'
                                },
                                {
                                    name: 'Controls',
                                    value:
                                        '`-vc limit number`\n' +
                                        '`-vc rename name`\n' +
                                        '`-vc transfer @user`\n' +
                                        '`-vc stfu @user`\n' +
                                        '`-vc unmute @user`'
                                }
                            ]
                        )
                    ]
                });
            }

            // ------------------------------------------------
            // VC SETUP is the only command that doesn't
            // require being inside a VC.
            // ------------------------------------------------

            const channel =
                message.member.voice.channel;

            if (!channel) {
                return message.reply({
                    embeds: [
                        errorBox(
                            `-vc ${sub}`,
                            'Manage your personal voice channel.',
                            `-vc ${sub} [options]`,
                            'You must be inside your vc+ voice channel.'
                        )
                    ]
                });
            }

            const data =
                getVC(message.member);

            if (!data) {
                return message.reply({
                    embeds: [
                        errorBox(
                            `-vc ${sub}`,
                            'Manage your personal voice channel.',
                            `-vc ${sub} [options]`,
                            'This is not a vc+ temporary voice channel.'
                        )
                    ]
                });
            }

            // ------------------------------------------------
            // VC OWNER CHECK
            // Founder/server owner can override.
            // ------------------------------------------------

            const owner =
                data.ownerId === message.author.id;

            const override =
                hasOwnerControl(message.member);

            if (!owner && !override) {
                return message.reply({
                    embeds: [
                        errorBox(
                            `-vc ${sub}`,
                            'Manage your personal voice channel.',
                            `-vc ${sub} [options]`,
                            'Only the owner of this VC can use these commands.'
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
                ].includes(sub)
            ) {
                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                `-vc ${sub}`,
                                'Manage a member in your VC.',
                                `-vc ${sub} @user`
                            )
                        ]
                    });
                }

                // Never allow VC commands against Founder/God.
                if (
                    isGod(target) &&
                    !isFounder(message.member)
                ) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                `-vc ${sub}`,
                                'Manage a member in your VC.',
                                `-vc ${sub} @user`,
                                'Founder/God protection is enabled.'
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // KICK
                // --------------------------------------------

                if (sub === 'kick') {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return message.reply({
                            embeds: [
                                errorBox(
                                    '-vc kick',
                                    'Kick someone from your VC.',
                                    '-vc kick @user',
                                    'That member is not in your VC.'
                                )
                            ]
                        });
                    }

                    await target.voice.disconnect(
                        'vc+ VC owner kick'
                    ).catch(() => null);

                    return message.reply({
                        embeds: [
                            success(
                                'VC Kick',
                                `${target} was removed from the VC.`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // BAN
                // --------------------------------------------

                if (sub === 'ban') {
                    data.banned.add(target.id);
                    data.rejected.delete(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            'vc+ VC ban'
                        ).catch(() => null);
                    }

                    return message.reply({
                        embeds: [
                            success(
                                'VC Ban',
                                `${target} is banned from this personal VC.`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // UNBAN
                // --------------------------------------------

                if (sub === 'unban') {
                    data.banned.delete(target.id);

                    return message.reply({
                        embeds: [
                            success(
                                'VC Unban',
                                `${target} can join this VC again.`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // REJECT
                // --------------------------------------------

                if (sub === 'reject') {
                    data.rejected.add(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            'vc+ VC reject'
                        ).catch(() => null);
                    }

                    return message.reply({
                        embeds: [
                            success(
                                'VC Reject',
                                `${target} has been rejected from this VC.`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // PERMIT
                // --------------------------------------------

                if (sub === 'permit') {
                    data.rejected.delete(target.id);
                    data.banned.delete(target.id);
                    data.permitted.add(target.id);

                    return message.reply({
                        embeds: [
                            success(
                                'VC Permit',
                                `${target} has been permitted to join this VC.`
                            )
                        ]
                    });
                }

                // --------------------------------------------
                // TRANSFER
                // --------------------------------------------

                if (sub === 'transfer') {
                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return message.reply({
                            embeds: [
                                errorBox(
                                    '-vc transfer',
                                    'Transfer VC ownership.',
                                    '-vc transfer @user',
                                    'You already own this VC.'
                                )
                            ]
                        });
                    }

                    data.ownerId =
                        target.id;

                    return message.reply({
                        embeds: [
                            success(
                                'Ownership Transferred',
                                `${target} is now the owner of this VC.`
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // LOCK
            // ------------------------------------------------

            if (sub === 'lock') {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    return message.reply({
                        embeds: [
                            success(
                                'VC Locked',
                                'Your personal VC is now locked.'
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc lock',
                                'Lock your VC.',
                                '-vc lock'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // UNLOCK
            // ------------------------------------------------

            if (sub === 'unlock') {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    return message.reply({
                        embeds: [
                            success(
                                'VC Unlocked',
                                'Your personal VC is now unlocked.'
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc unlock',
                                'Unlock your VC.',
                                '-vc unlock'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // LIMIT
            // ------------------------------------------------

            if (sub === 'limit') {
                const limit =
                    Number(parts[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc limit',
                                'Change the VC user limit.',
                                '-vc limit 0-99'
                            )
                        ]
                    });
                }

                try {
                    await channel.setUserLimit(limit);

                    return message.reply({
                        embeds: [
                            success(
                                'VC Limit',
                                `The VC limit is now **${limit === 0 ? 'Unlimited' : limit}**.`
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc limit',
                                'Change the VC user limit.',
                                '-vc limit 0-99'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // RENAME
            // ------------------------------------------------

            if (sub === 'rename') {
                const name =
                    parts.join(' ').trim();

                if (!name) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc rename',
                                'Rename your VC.',
                                '-vc rename My VC'
                            )
                        ]
                    });
                }

                const newName =
                    name.slice(0, 100);

                try {
                    await channel.setName(
                        newName
                    );

                    return message.reply({
                        embeds: [
                            success(
                                'VC Renamed',
                                `Your VC is now **${newName}**.`
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc rename',
                                'Rename your VC.',
                                '-vc rename My VC'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // STFU
            // ------------------------------------------------

            if (sub === 'stfu') {
                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc stfu',
                                'Server mute a member in your VC.',
                                '-vc stfu @user'
                            )
                        ]
                    });
                }

                if (isGod(target)) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc stfu',
                                'Server mute a member in your VC.',
                                '-vc stfu @user',
                                'Founder/God godmode protection prevents this.'
                            )
                        ]
                    });
                }

                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc stfu',
                                'Server mute a member in your VC.',
                                '-vc stfu @user',
                                'That member is not in your VC.'
                            )
                        ]
                    });
                }

                try {
                    await target.voice.setMute(
                        true,
                        'vc+ stfu'
                    );

                    data.muted.add(target.id);

                    return message.reply({
                        embeds: [
                            success(
                                'VC Mute',
                                `${target} has been server-muted.`
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc stfu',
                                'Server mute a member.',
                                '-vc stfu @user',
                                'Make sure vc+ has Mute Members permission.'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // UNMUTE
            // ------------------------------------------------

            if (sub === 'unmute') {
                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc unmute',
                                'Remove a VC mute.',
                                '-vc unmute @user'
                            )
                        ]
                    });
                }

                if (isGod(target)) {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc unmute',
                                'Remove a VC mute.',
                                '-vc unmute @user',
                                'Founder/God protection is enabled.'
                            )
                        ]
                    });
                }

                data.muted.delete(target.id);

                try {
                    await target.voice.setMute(
                        false,
                        'vc+ unmute'
                    );

                    return message.reply({
                        embeds: [
                            success(
                                'VC Unmute',
                                `${target} has been unmuted.`
                            )
                        ]
                    });
                } catch {
                    return message.reply({
                        embeds: [
                            errorBox(
                                '-vc unmute',
                                'Remove a VC mute.',
                                '-vc unmute @user'
                            )
                        ]
                    });
                }
            }

            // ------------------------------------------------
            // UNKNOWN VC COMMAND
            // ------------------------------------------------

            return message.reply({
                embeds: [
                    errorBox(
                        `-vc ${sub}`,
                        'Manage your personal voice channel.',
                        '-vc kick @user',
                        'Use `-help` or `-vc` to view commands.'
                    )
                ]
            });
        }

        // ====================================================
        // UNKNOWN COMMAND
        // ====================================================

        return message.reply({
            embeds: [
                errorBox(
                    `-${command}`,
                    'Unknown command.',
                    '-help',
                    'Use `-help` to view all commands.'
                )
            ]
        });

    } catch (error) {
        console.error(
            '[COMMAND ERROR]',
            error
        );

        try {
            await message.reply({
                embeds: [
                    errorBox(
                        'Error',
                        'Something went wrong while running that command.',
                        '-help',
                        'The error was contained so the bot can continue running.'
                    )
                ]
            });
        } catch {}
    }
});

// ============================================================
// VOICE STATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild || oldState.guild;

            if (!guild) return;

            const data =
                getGuildData(guild);

            // =================================================
            // GODMODE
            // Automatically unmute Founder/God.
            // =================================================

            if (
                newState.serverMute &&
                newState.member &&
                isGod(newState.member)
            ) {
                setTimeout(async () => {
                    try {
                        if (
                            newState.member.voice.channelId
                        ) {
                            await newState.member.voice.setMute(
                                false,
                                'vc+ Founder/God godmode'
                            );
                        }
                    } catch {}
                }, 250);
            }

            // =================================================
            // JOIN TO CREATE
            // =================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    data.triggerId
            ) {
                const member =
                    newState.member;

                if (!member) return;

                const category =
                    guild.channels.cache.get(
                        data.categoryId
                    );

                if (!category) return;

                const vcName =
                    `${member.user.username} VC`
                        .slice(0, 100);

                const temp =
                    await guild.channels.create({
                        name: vcName,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        userLimit: 0,
                        bitrate: 64000
                    });

                data.vcs.set(
                    temp.id,
                    {
                        ownerId: member.id,
                        banned: new Set(),
                        rejected: new Set(),
                        permitted: new Set(),
                        muted: new Set()
                    }
                );

                await member.voice.setChannel(
                    temp
                ).catch(async () => {
                    data.vcs.delete(temp.id);

                    await temp.delete(
                        'vc+ failed to move member'
                    ).catch(() => {});
                });

                // =================================================
                // SEND INTERFACE TO TEXT CHAT IF AVAILABLE
                // =================================================

                const textChannel =
                    guild.channels.cache.find(
                        c =>
                            c.type === ChannelType.GuildText &&
                            c.name.toLowerCase() ===
                                'vc-chat'
                    );

                if (textChannel) {
                    await textChannel.send({
                        content:
                            `${member} created **${temp.name}**.`,
                        embeds: [
                            vcInterface(
                                temp,
                                member.id
                            )
                        ]
                    }).catch(() => {});
                }

                return;
            }

            // =================================================
            // TEMP VC JOIN PROTECTION
            // =================================================

            if (newState.channelId) {
                const vc =
                    data.vcs.get(
                        newState.channelId
                    );

                if (vc) {
                    const userId =
                        newState.member?.id;

                    if (!userId) return;

                    if (
                        vc.banned.has(userId) ||
                        vc.rejected.has(userId)
                    ) {
                        await newState.member.voice.disconnect(
                            'vc+ user is not permitted'
                        ).catch(() => {});
                        return;
                    }
                }
            }

            // =================================================
            // PERSISTENT VC MUTES
            // =================================================

            if (
                newState.channelId
            ) {
                const vc =
                    data.vcs.get(
                        newState.channelId
                    );

                if (
                    vc &&
                    vc.muted.has(
                        newState.id
                    ) &&
                    !isGod(newState.member)
                ) {
                    await newState.member.voice.setMute(
                        true,
                        'vc+ persistent mute'
                    ).catch(() => {});
                }
            }

            // =================================================
            // CLEAN EMPTY TEMP VC
            // =================================================

            if (oldState.channelId) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (!oldChannel) return;

                const vc =
                    data.vcs.get(
                        oldChannel.id
                    );

                if (
                    vc &&
                    oldChannel.members.size === 0
                ) {
                    data.vcs.delete(
                        oldChannel.id
                    );

                    await oldChannel.delete(
                        'vc+ empty temporary VC'
                    ).catch(() => {});
                }
            }

        } catch (error) {
            console.error(
                '[VOICE STATE ERROR]',
                error
            );
        }
    }
);

// ============================================================
// LOGIN
// ============================================================

async function start() {
    try {
        const token =
            process.env.DISCORD_TOKEN;

        if (!token) {
            console.error(
                'DISCORD_TOKEN is missing from .env'
            );
            process.exit(1);
        }

        console.log(`${BOT_NAME} starting...`);

        await client.login(token);

    } catch (error) {
        console.error(
            '[LOGIN ERROR]',
            error
        );

        setTimeout(
            () => process.exit(1),
            1000
        );
    }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    console.log(
        `${signal} received. Shutting down ${BOT_NAME}...`
    );

    try {
        client.destroy();
    } catch {}

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

start();
