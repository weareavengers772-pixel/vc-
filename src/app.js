import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder
} from 'discord.js';
import 'dotenv/config';

// ============================================================
// vc+
// ============================================================

const PREFIX = '-';
const BOT_NAME = 'vc+';

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
// BOT-ONLY RANK SYSTEM
// No Discord roles are created.
// ============================================================

const RANKS = [
    'founder',
    'god',
    'owner',
    'coowner',
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
    coowner: 70,
    executive: 60,
    director: 50,
    admin: 40,
    moderator: 30,
    staff: 20,
    member: 10
};

// guildId -> Map(userId, rank)
const rankData = new Map();

// guildId -> settings
const guildData = new Map();

// channelId -> VC information
const vcData = new Map();

// ============================================================
// EMBEDS
// ============================================================

function box(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0x2b2d31)
        .setFooter({ text: BOT_NAME })
        .setTimestamp();
}

function helpBox(command, description, syntax, example, access = null) {
    const embed = box('vc+ help', '');

    embed.addFields(
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
// SAFE REPLY
// ============================================================

async function reply(message, content) {
    try {
        return await message.reply(content);
    } catch (error) {
        console.error('Reply error:', error.message);
        return null;
    }
}

// ============================================================
// RANK FUNCTIONS
// ============================================================

function getRank(guildId, userId) {
    return rankData.get(guildId)?.get(userId) || null;
}

function setRank(guildId, userId, rank) {
    if (!rankData.has(guildId)) {
        rankData.set(guildId, new Map());
    }

    rankData.get(guildId).set(userId, rank);
}

function rankPower(guildId, userId) {
    const rank = getRank(guildId, userId);
    return rank ? RANK_POWER[rank] || 0 : 0;
}

function isFounder(message) {
    return (
        message.guild &&
        (
            message.author.id === message.guild.ownerId ||
            getRank(message.guild.id, message.author.id) === 'founder'
        )
    );
}

function isGod(message) {
    return (
        isFounder(message) ||
        getRank(message.guild.id, message.author.id) === 'god'
    );
}

function canManage(message, requiredRank = 'admin') {
    if (isFounder(message)) return true;

    const power = rankPower(
        message.guild.id,
        message.author.id
    );

    return power >= RANK_POWER[requiredRank];
}

// ============================================================
// TARGET MEMBER
// ============================================================

async function getTarget(message, input) {
    if (!input) return null;

    const mentioned = message.mentions.members.first();

    if (mentioned) return mentioned;

    const id = input.replace(/[<@!>]/g, '');

    if (!/^\d+$/.test(id)) return null;

    try {
        return await message.guild.members.fetch(id);
    } catch {
        return null;
    }
}

// ============================================================
// USER VC
// ============================================================

function getUserVC(member) {
    if (!member?.voice?.channelId) return null;

    return vcData.get(member.voice.channelId) || null;
}

function isVCOwner(message) {
    const data = getUserVC(message.member);

    if (!data) return false;

    return (
        data.ownerId === message.author.id ||
        isFounder(message)
    );
}

// ============================================================
// HELP
// ============================================================

async function sendHelp(message) {
    const embed = box(
        'vc+ help',
        'Commands available for vc+.'
    );

    embed.addFields(
        {
            name: 'General',
            value:
                '`-help`\n' +
                '`-ping`\n' +
                '`-ranklist`\n' +
                '`-interface`',
            inline: false
        },
        {
            name: 'Moderation',
            value:
                '`-kick @user`\n' +
                '`-ban @user`\n' +
                '`-foreverban @user`\n' +
                '`-unban ID`\n' +
                '`-timeout @user minutes`\n' +
                '`-untimeout @user`',
            inline: false
        },
        {
            name: 'Ranks',
            value:
                '`-rank @user rank`\n' +
                '`-vouch @user`\n' +
                '`-vouches @user`',
            inline: false
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
                '`-vc stfu @user`',
            inline: false
        }
    );

    return reply(message, { embeds: [embed] });
}

// ============================================================
// PING
// ============================================================

async function ping(message) {
    return reply(
        message,
        {
            embeds: [
                box(
                    'vc+',
                    `Pong!\nLatency: **${client.ws.ping}ms**`
                )
            ]
        }
    );
}

// ============================================================
// RANK LIST
// ============================================================

async function rankList(message) {
    const text = RANKS.map(
        (rank, index) =>
            `**${index + 1}.** ${rank}`
    ).join('\n');

    return reply(message, {
        embeds: [
            box(
                'vc+ ranks',
                text
            )
        ]
    });
}

// ============================================================
// RANK COMMAND
// ============================================================

async function rankCommand(message, args) {
    if (!isFounder(message)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'rank',
                    'Assign a bot-only rank.',
                    '-rank @user rank',
                    '-rank @user god',
                    'Founder only.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);
    const rank = args[1]?.toLowerCase();

    if (!target || !RANKS.includes(rank)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'rank',
                    'Assign a bot-only rank.',
                    '-rank @user rank',
                    '-rank @user god',
                    `Ranks:\n${RANKS.join(', ')}`
                )
            ]
        });
    }

    if (target.id === message.guild.ownerId && rank !== 'founder') {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'The server owner cannot be assigned a lower bot rank.'
                )
            ]
        });
    }

    setRank(
        message.guild.id,
        target.id,
        rank
    );

    return reply(message, {
        embeds: [
            box(
                'vc+ rank updated',
                `${target} is now **${rank}** in vc+.`
            )
        ]
    });
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

async function vouchCommand(message, args) {
    if (!isFounder(message)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'vouch',
                    'Vouch for a member.',
                    '-vouch @user',
                    '-vouch @user',
                    'Founder only.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(message, {
            embeds: [
                helpBox(
                    'vouch',
                    'Vouch for a member.',
                    '-vouch @user',
                    '-vouch @user'
                )
            ]
        });
    }

    const guild = guildData.get(message.guild.id);

    if (!guild.vouches) {
        guild.vouches = new Map();
    }

    const old = guild.vouches.get(target.id) || 0;
    const amount = old + 1;

    guild.vouches.set(target.id, amount);

    return reply(message, {
        embeds: [
            box(
                'vc+ vouch',
                `${target} now has **${amount} vouch${amount === 1 ? '' : 'es'}**.`
            )
        ]
    });
}

async function vouchesCommand(message, args) {
    const target =
        await getTarget(message, args[0]) ||
        message.member;

    const guild =
        guildData.get(message.guild.id);

    const amount =
        guild?.vouches?.get(target.id) || 0;

    return reply(message, {
        embeds: [
            box(
                'vc+ vouches',
                `${target} has **${amount} vouch${amount === 1 ? '' : 'es'}**.`
            )
        ]
    });
}

// ============================================================
// MODERATION
// ============================================================

async function banCommand(message, args, forever = false) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return reply(message, {
            embeds: [
                helpBox(
                    forever ? 'foreverban' : 'ban',
                    'Ban a member.',
                    `-${forever ? 'foreverban' : 'ban'} @user [reason]`,
                    `-${forever ? 'foreverban' : 'ban'} @user reason`,
                    'Requires Ban Members permission.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(message, {
            embeds: [
                helpBox(
                    forever ? 'foreverban' : 'ban',
                    'Ban a member.',
                    `-${forever ? 'foreverban' : 'ban'} @user [reason]`,
                    `-${forever ? 'foreverban' : 'ban'} @user reason`
                )
            ]
        });
    }

    if (target.id === message.author.id) {
        return reply(message, {
            embeds: [box('vc+', 'You cannot ban yourself.')]
        });
    }

    if (forever && !isGod(message)) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    '**Foreverban** is restricted to Founder and God.'
                )
            ]
        });
    }

    if (!target.bannable) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'I cannot ban that member because of Discord role hierarchy.'
                )
            ]
        });
    }

    const reason =
        args.slice(1).join(' ') ||
        (forever ? 'vc+ foreverban' : 'vc+ ban');

    try {
        await target.ban({
            reason,
            deleteMessageSeconds: 0
        });

        return reply(message, {
            embeds: [
                box(
                    forever ? 'vc+ foreverban' : 'vc+ ban',
                    `${target.user.tag} has been ${forever ? '**permanently banned**' : '**banned**'}.\n\nReason: ${reason}`
                )
            ]
        });
    } catch (error) {
        console.error('Ban error:', error);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'The ban failed. Check my permissions and role position.'
                )
            ]
        });
    }
}

async function kickCommand(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'kick',
                    'Kick a member.',
                    '-kick @user [reason]',
                    '-kick @user spam',
                    'Requires Kick Members permission.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);

    if (!target || !target.kickable) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'I cannot kick that member.'
                )
            ]
        });
    }

    try {
        await target.kick(
            args.slice(1).join(' ') || 'vc+ kick'
        );

        return reply(message, {
            embeds: [
                box(
                    'vc+ kick',
                    `${target.user.tag} has been kicked.`
                )
            ]
        });
    } catch (error) {
        console.error('Kick error:', error);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'The kick failed.'
                )
            ]
        });
    }
}

// ============================================================
// TIMEOUT
// ============================================================

async function timeoutCommand(message, args, remove = false) {
    if (!message.member.permissions.has(
        PermissionFlagsBits.ModerateMembers
    )) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'You need Moderate Members permission.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(message, {
            embeds: [
                helpBox(
                    remove ? 'untimeout' : 'timeout',
                    remove
                        ? 'Remove a timeout.'
                        : 'Timeout a member.',
                    remove
                        ? '-untimeout @user'
                        : '-timeout @user minutes',
                    remove
                        ? '-untimeout @user'
                        : '-timeout @user 10'
                )
            ]
        });
    }

    try {
        if (remove) {
            await target.timeout(null, 'vc+ untimeout');

            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        `${target} is no longer timed out.`
                    )
                ]
            });
        }

        const minutes = Number(args[1]);

        if (!Number.isFinite(minutes) || minutes <= 0) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'Enter a valid number of minutes.'
                    )
                ]
            });
        }

        const duration =
            Math.min(minutes, 40320) *
            60 *
            1000;

        await target.timeout(
            duration,
            'vc+ timeout'
        );

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} has been timed out for **${Math.min(minutes, 40320)} minutes**.`
                )
            ]
        });
    } catch (error) {
        console.error('Timeout error:', error);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'The timeout failed.'
                )
            ]
        });
    }
}

// ============================================================
// VC SETUP
// ============================================================

async function vcSetup(message) {
    if (!isFounder(message) &&
        !message.member.permissions.has(
            PermissionFlagsBits.ManageChannels
        )) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'You need Manage Channels permission to set up Join to Create.'
                )
            ]
        });
    }

    const existing = guildData.get(message.guild.id);

    if (existing?.triggerId) {
        const channel =
            message.guild.channels.cache.get(existing.triggerId);

        if (channel) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        `Join to Create is already set up.\n\nJoin ${channel} to create your personal VC.`
                    )
                ]
            });
        }
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
                userLimit: 0
            });

        guildData.set(message.guild.id, {
            categoryId: category.id,
            triggerId: trigger.id,
            vouches: new Map()
        });

        return reply(message, {
            embeds: [
                box(
                    'vc+ setup complete',
                    `Join ${trigger} and vc+ will automatically create your personal voice channel and move you into it.`
                )
            ]
        });
    } catch (error) {
        console.error('VC setup error:', error);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'Setup failed. Give the bot **Manage Channels** permission and make sure its role is high enough.'
                )
            ]
        });
    }
}

// ============================================================
// VC COMMAND
// ============================================================

async function vcCommand(message, args) {
    const sub = args.shift()?.toLowerCase();

    if (!sub) {
        return reply(message, {
            embeds: [
                helpBox(
                    'vc',
                    'Manage your personal voice channel.',
                    '-vc command',
                    '-vc kick @user'
                )
            ]
        });
    }

    if (sub === 'setup') {
        return vcSetup(message);
    }

    const channel =
        message.member.voice.channel;

    if (!channel) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'You must be inside your personal VC to use that command.'
                )
            ]
        });
    }

    const data =
        vcData.get(channel.id);

    if (!data) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'This is not a vc+ personal VC.'
                )
            ]
        });
    }

    if (
        data.ownerId !== message.author.id &&
        !isFounder(message)
    ) {
        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    'Only the VC owner or Founder can control this VC.'
                )
            ]
        });
    }

    // --------------------------------------------------------
    // KICK
    // --------------------------------------------------------

    if (sub === 'kick') {
        const target =
            await getTarget(message, args[0]);

        if (!target ||
            target.voice.channelId !== channel.id) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'That user is not in your VC.'
                    )
                ]
            });
        }

        if (isProtectedMember(message.guild, target.id)) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'You cannot use VC controls against a Founder or God.'
                    )
                ]
            });
        }

        await target.voice.disconnect(
            'vc+ VC owner kick'
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} was kicked from the VC.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // BAN
    // --------------------------------------------------------

    if (sub === 'ban') {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc ban',
                        'Prevent a user from entering your VC.',
                        '-vc ban @user',
                        '-vc ban @user'
                    )
                ]
            });
        }

        if (isProtectedMember(message.guild, target.id)) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'You cannot VC-ban a Founder or God.'
                    )
                ]
            });
        }

        data.banned.add(target.id);

        if (target.voice.channelId === channel.id) {
            await target.voice.disconnect(
                'vc+ VC ban'
            ).catch(() => {});
        }

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} is now banned from this VC.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // UNBAN
    // --------------------------------------------------------

    if (sub === 'unban') {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'Mention the user you want to unban.'
                    )
                ]
            });
        }

        data.banned.delete(target.id);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} can join your VC again.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // REJECT
    // --------------------------------------------------------

    if (sub === 'reject') {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc reject',
                        'Reject a member from your VC.',
                        '-vc reject @user',
                        '-vc reject @user'
                    )
                ]
            });
        }

        if (isProtectedMember(message.guild, target.id)) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'You cannot reject a Founder or God.'
                    )
                ]
            });
        }

        data.rejected.add(target.id);

        if (target.voice.channelId === channel.id) {
            await target.voice.disconnect(
                'vc+ VC reject'
            ).catch(() => {});
        }

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} has been rejected from your VC.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // PERMIT
    // --------------------------------------------------------

    if (sub === 'permit') {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'Mention the user you want to permit.'
                    )
                ]
            });
        }

        data.banned.delete(target.id);
        data.rejected.delete(target.id);

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} is permitted to join your VC.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // LOCK
    // --------------------------------------------------------

    if (sub === 'lock') {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            { Connect: false }
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box('vc+ lock', 'Your VC is now locked.')
            ]
        });
    }

    // --------------------------------------------------------
    // UNLOCK
    // --------------------------------------------------------

    if (sub === 'unlock') {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            { Connect: true }
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box('vc+ unlock', 'Your VC is now unlocked.')
            ]
        });
    }

    // --------------------------------------------------------
    // LIMIT
    // --------------------------------------------------------

    if (sub === 'limit') {
        const limit = Number(args[0]);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc limit',
                        'Change your VC user limit.',
                        '-vc limit 0-99',
                        '-vc limit 10'
                    )
                ]
            });
        }

        await channel.setUserLimit(limit).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `VC limit set to **${limit === 0 ? 'unlimited' : limit}**.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // RENAME
    // --------------------------------------------------------

    if (sub === 'rename') {
        const name =
            args.join(' ').trim().slice(0, 100);

        if (!name) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc rename',
                        'Rename your VC.',
                        '-vc rename name',
                        '-vc rename gaming'
                    )
                ]
            });
        }

        await channel.setName(name).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `Your VC is now **${name}**.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // TRANSFER
    // --------------------------------------------------------

    if (sub === 'transfer') {
        const target =
            await getTarget(message, args[0]);

        if (!target ||
            target.voice.channelId !== channel.id) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'The new owner must be inside the VC.'
                    )
                ]
            });
        }

        if (isProtectedMember(message.guild, target.id) &&
            !isFounder(message)) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'That member cannot receive VC ownership.'
                    )
                ]
            });
        }

        data.ownerId = target.id;

        return reply(message, {
            embeds: [
                box(
                    'vc+',
                    `${target} is now the VC owner.`
                )
            ]
        });
    }

    // --------------------------------------------------------
    // STFU
    // --------------------------------------------------------

    if (sub === 'stfu') {
        const target =
            await getTarget(message, args[0]);

        if (!target ||
            target.voice.channelId !== channel.id) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc stfu',
                        'Server mute a member in your VC.',
                        '-vc stfu @user',
                        '-vc stfu @user'
                    )
                ]
            });
        }

        if (isProtectedMember(message.guild, target.id)) {
            return reply(message, {
                embeds: [
                    box(
                        'vc+',
                        'You cannot use `-vc stfu` on a Founder or God.'
                    )
                ]
            });
        }

        data.stfu.add(target.id);

        await target.voice.setMute(
            true,
            'vc+ stfu'
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'vc+ stfu',
                    `${target} is now server-muted in this VC.`
                )
            ]
        });
    }

    return reply(message, {
        embeds: [
            helpBox(
                `vc ${sub}`,
                'Unknown VC command.',
                '-vc command',
                '-vc kick @user'
            )
        ]
    });
}

// ============================================================
// PROTECTED RANKS
// ============================================================

function isProtectedMember(guild, userId) {
    if (userId === guild.ownerId) return true;

    const rank = getRank(guild.id, userId);

    return (
        rank === 'founder' ||
        rank === 'god'
    );
}

// ============================================================
// INTERFACE
// ============================================================

async function interfaceCommand(message) {
    const channel =
        message.member.voice.channel;

    if (!channel) {
        return reply(message, {
            embeds: [
                box(
                    'vc+ interface',
                    'Join your vc+ voice channel first.'
                )
            ]
        });
    }

    const data = vcData.get(channel.id);

    if (!data) {
        return reply(message, {
            embeds: [
                box(
                    'vc+ interface',
                    'You are not inside a vc+ personal VC.'
                )
            ]
        });
    }

    const embed = box(
        `${message.member.displayName} VC`,
        [
            '**VC Controls**',
            '',
            '`-vc kick @user` — Kick',
            '`-vc ban @user` — VC ban',
            '`-vc unban @user` — Remove VC ban',
            '`-vc reject @user` — Reject',
            '`-vc permit @user` — Permit',
            '`-vc lock` — Lock VC',
            '`-vc unlock` — Unlock VC',
            '`-vc limit 10` — Set limit',
            '`-vc rename name` — Rename',
            '`-vc transfer @user` — Transfer',
            '`-vc stfu @user` — Server mute',
            '',
            `Owner: <@${data.ownerId}>`
        ].join('\n')
    );

    return reply(message, {
        embeds: [embed]
    });
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async message => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;

        const content =
            message.content.trim();

        if (!content.startsWith(PREFIX)) return;

        const args =
            content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();

        if (!command) return;

        switch (command) {
            case 'help':
                return sendHelp(message);

            case 'ping':
                return ping(message);

            case 'ranklist':
            case 'ranks':
                return rankList(message);

            case 'rank':
                return rankCommand(message, args);

            case 'vouch':
                return vouchCommand(message, args);

            case 'vouches':
                return vouchesCommand(message, args);

            case 'ban':
                return banCommand(message, args, false);

            case 'foreverban':
                return banCommand(message, args, true);

            case 'kick':
                return kickCommand(message, args);

            case 'unban': {
                if (!message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )) {
                    return reply(message, {
                        embeds: [
                            box(
                                'vc+',
                                'You need Ban Members permission.'
                            )
                        ]
                    });
                }

                const id = args[0];

                if (!id) {
                    return reply(message, {
                        embeds: [
                            helpBox(
                                'unban',
                                'Unban a user.',
                                '-unban ID',
                                '-unban 123456789'
                            )
                        ]
                    });
                }

                try {
                    await message.guild.members.unban(
                        id,
                        'vc+ unban'
                    );

                    return reply(message, {
                        embeds: [
                            box(
                                'vc+ unban',
                                `User **${id}** has been unbanned.`
                            )
                        ]
                    });
                } catch {
                    return reply(message, {
                        embeds: [
                            box(
                                'vc+',
                                'That user could not be unbanned.'
                            )
                        ]
                    });
                }
            }

            case 'timeout':
                return timeoutCommand(message, args, false);

            case 'untimeout':
                return timeoutCommand(message, args, true);

            case 'vc':
                return vcCommand(message, args);

            case 'interface':
                return interfaceCommand(message);

            default:
                return reply(message, {
                    embeds: [
                        helpBox(
                            command,
                            'Unknown command.',
                            '-help',
                            '-help'
                        )
                    ]
                });
        }
    } catch (error) {
        console.error(
            `Command error [${message.content}]:`,
            error
        );

        return reply(message, {
            embeds: [
                box(
                    'vc+ error',
                    'Something went wrong while processing that command. The bot is still running.'
                )
            ]
        }).catch(() => {});
    }
});

// ============================================================
// JOIN TO CREATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild;

            if (!guild) return;

            const settings =
                guildData.get(guild.id);

            // ------------------------------------------------
            // JOIN TO CREATE
            // ------------------------------------------------

            if (
                newState.channelId &&
                settings?.triggerId &&
                newState.channelId === settings.triggerId
            ) {
                const member =
                    newState.member;

                if (!member) return;

                const category =
                    guild.channels.cache.get(
                        settings.categoryId
                    );

                if (!category) return;

                const name =
                    `${member.displayName} VC`;

                const personalVC =
                    await guild.channels.create({
                        name: name.slice(0, 100),
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        userLimit: 0
                    });

                vcData.set(
                    personalVC.id,
                    {
                        ownerId: member.id,
                        banned: new Set(),
                        rejected: new Set(),
                        stfu: new Set()
                    }
                );

                await member.voice.setChannel(
                    personalVC
                );

                return;
            }

            // ------------------------------------------------
            // PROTECTED USER AUTO UNMUTE
            // ------------------------------------------------

            if (
                newState.channel &&
                newState.serverMute
            ) {
                const protectedUser =
                    isProtectedMember(
                        guild,
                        newState.id
                    );

                if (protectedUser) {
                    await newState.setMute(
                        false,
                        'vc+ rank protection'
                    ).catch(() => {});
                }
            }

            // ------------------------------------------------
            // VC BAN / REJECT
            // ------------------------------------------------

            if (newState.channelId) {
                const data =
                    vcData.get(
                        newState.channelId
                    );

                if (data) {
                    if (
                        data.banned.has(newState.id) ||
                        data.rejected.has(newState.id)
                    ) {
                        await newState.disconnect(
                            'vc+ access denied'
                        ).catch(() => {});

                        return;
                    }

                    // ------------------------------------------------
                    // STFU PROTECTION
                    // ------------------------------------------------

                    if (
                        data.stfu.has(newState.id) &&
                        !isProtectedMember(
                            guild,
                            newState.id
                        )
                    ) {
                        await newState.setMute(
                            true,
                            'vc+ stfu protection'
                        ).catch(() => {});
                    }
                }
            }

            // ------------------------------------------------
            // CLEAN EMPTY VC
            // ------------------------------------------------

            if (oldState.channelId) {
                const oldChannel =
                    oldState.channel;

                const oldData =
                    vcData.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    oldData &&
                    oldChannel.members.size === 0
                ) {
                    vcData.delete(
                        oldChannel.id
                    );

                    await oldChannel.delete(
                        'vc+ empty temporary VC'
                    ).catch(() => {});
                }
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
// EXTRA MUTE PROTECTION
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            if (!newState.channel) return;

            // Founder/God should never remain server muted.
            if (
                newState.serverMute &&
                isProtectedMember(
                    newState.guild,
                    newState.id
                )
            ) {
                await newState.setMute(
                    false,
                    'vc+ protected rank'
                ).catch(() => {});
            }

            const data =
                vcData.get(
                    newState.channelId
                );

            if (!data) return;

            if (
                data.stfu.has(newState.id) &&
                !isProtectedMember(
                    newState.guild,
                    newState.id
                ) &&
                !newState.serverMute
            ) {
                await newState.setMute(
                    true,
                    'vc+ stfu protection'
                ).catch(() => {});
            }
        } catch (error) {
            console.error(
                'Mute protection error:',
                error
            );
        }
    }
);

// ============================================================
// READY
// ============================================================

client.once('ready', () => {
    console.log('================================');
    console.log(`${BOT_NAME} is online`);
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log('================================');

    try {
        client.user.setPresence({
            status: 'online',
            activities: [
                {
                    name: '-help | vc+',
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
});

// ============================================================
// GUILD EVENTS
// ============================================================

client.on('guildCreate', guild => {
    console.log(
        `Joined guild: ${guild.name} (${guild.id})`
    );
});

client.on('guildDelete', guild => {
    console.log(
        `Left guild: ${guild.name} (${guild.id})`
    );

    guildData.delete(guild.id);
    rankData.delete(guild.id);
});

// ============================================================
// CRASH PROTECTION
// ============================================================

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
            'Shard error:',
            error
        );
    }
);

// ============================================================
// LOGIN
// ============================================================

const token =
    process.env.DISCORD_TOKEN;

if (!token) {
    console.error(
        'Missing DISCORD_TOKEN in .env'
    );
    process.exit(1);
}

client.login(token).catch(error => {
    console.error(
        'Discord login failed:',
        error
    );

    process.exit(1);
});
