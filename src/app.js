// ============================================================
// VC+
// All-in-one Discord bot
// discord.js v14
// ============================================================

import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    AuditLogEvent
} from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';

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
// DATA
// ============================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'vcplus.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {
    guilds: {},
    ranks: {},
    vouches: {}
};

try {
    if (fs.existsSync(DATA_FILE)) {
        db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
} catch (error) {
    console.error('Database load error:', error);
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error('Database save error:', error);
    }
}

// Temporary VC data
const tempVCs = new Map();

// Security tracking
const banTracker = new Map();

// ============================================================
// RANK SYSTEM
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

function ensureGuild(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            triggerId: null,
            categoryId: null,
            channelName: "{username} vc",
            userLimit: 0,
            bitrate: 64000,
            vouchLimit: 1
        };
    }

    if (!db.ranks[guildId]) {
        db.ranks[guildId] = {};
    }

    if (!db.vouches[guildId]) {
        db.vouches[guildId] = {};
    }

    return db.guilds[guildId];
}

function getRank(guildId, userId) {
    const rank = db.ranks?.[guildId]?.[userId];
    return rank || 'member';
}

function power(guildId, userId) {
    return RANK_POWER[getRank(guildId, userId)] || 0;
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

function canControlAnyVC(message) {
    return isGod(message);
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, type = 'info') {
    const colors = {
        info: 0x5865F2,
        success: 0x57F287,
        warning: 0xFEE75C,
        danger: 0xED4245
    };

    return new EmbedBuilder()
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setColor(colors[type] ?? colors.info)
        .setTimestamp();
}

function helpBox(command, description, syntax, example, access) {
    let text =
        `**Command**\n${command}\n\n` +
        `**Description**\n${description}\n\n` +
        `**Syntax**\n${syntax}\n\n` +
        `**Example**\n${example}`;

    if (access) {
        text += `\n\n**Access**\n${access}`;
    }

    return box('Help', text);
}

// ============================================================
// SAFE REPLY
// ============================================================

async function reply(message, content) {
    try {
        return await message.reply(content);
    } catch {
        return null;
    }
}

async function safeEdit(channel, data) {
    try {
        return await channel.edit(data);
    } catch {
        return null;
    }
}

// ============================================================
// TARGET
// ============================================================

async function getTarget(message, input) {
    if (!input) return null;

    const mentioned = message.mentions.members.first();

    if (mentioned) return mentioned;

    const id = input.replace(/[<@!>]/g, '');

    if (!/^\d{17,20}$/.test(id)) return null;

    try {
        return await message.guild.members.fetch(id);
    } catch {
        return null;
    }
}

// ============================================================
// VC OWNER
// ============================================================

function getVC(channelId) {
    return tempVCs.get(channelId);
}

function canControlVC(message, channel) {
    if (!channel) return false;

    if (canControlAnyVC(message)) {
        return true;
    }

    const data = getVC(channel.id);

    return !!(
        data &&
        data.ownerId === message.author.id
    );
}

// ============================================================
// VC NAME
// ============================================================

function makeVCName(member, template) {
    return template
        .replaceAll(
            '{username}',
            member.user.username
        )
        .replaceAll(
            '{displayName}',
            member.displayName
        )
        .slice(0, 100);
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member, guild) {
    const config = ensureGuild(guild.id);

    if (!config.categoryId) {
        return null;
    }

    const category =
        guild.channels.cache.get(config.categoryId);

    if (!category) return null;

    const existing = [...tempVCs.entries()]
        .find(([, data]) =>
            data.ownerId === member.id
        );

    if (existing) {
        const existingChannel =
            guild.channels.cache.get(existing[0]);

        if (existingChannel) {
            try {
                await member.voice.setChannel(
                    existingChannel
                );
            } catch {}

            return existingChannel;
        }

        tempVCs.delete(existing[0]);
    }

    let channel;

    try {
        channel = await guild.channels.create({
            name: makeVCName(member, config.channelName),
            type: ChannelType.GuildVoice,
            parent: category.id,
            userLimit: config.userLimit,
            bitrate: Math.min(
                Math.max(config.bitrate, 8000),
                384000
            ),
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
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
                        PermissionFlagsBits.Stream
                    ]
                }
            ]
        });

    } catch (error) {
        console.error('VC creation error:', error);
        return null;
    }

    tempVCs.set(channel.id, {
        ownerId: member.id,
        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        locked: false,
        stfu: new Set()
    });

    try {
        await member.voice.setChannel(channel);
    } catch (error) {
        console.error('VC move error:', error);
    }

    return channel;
}

// ============================================================
// VC INTERFACE
// ============================================================

async function sendVCInterface(channel) {
    try {
        const data = getVC(channel.id);

        if (!data) return;

        const owner =
            channel.guild.members.cache.get(
                data.ownerId
            );

        const embed = box(
            'Voice Control',
            [
                `**Owner:** ${owner || `<@${data.ownerId}>`}`,
                '',
                '**Voice Commands**',
                '`-vc kick @user` — Remove someone',
                '`-vc ban @user` — Ban from VC',
                '`-vc unban @user` — Remove VC ban',
                '`-vc reject @user` — Reject someone',
                '`-vc permit @user` — Permit someone',
                '`-vc lock` — Lock the VC',
                '`-vc unlock` — Unlock the VC',
                '`-vc limit 10` — Set limit',
                '`-vc rename My VC` — Rename',
                '`-vc transfer @user` — Transfer owner',
                '`-vc stfu @user` — Server mute',
                '`-vc unstfu @user` — Remove forced mute',
                '`-interface` — Show this interface',
                '',
                '**Owner controls are limited to this VC.**',
                '**Founder/God can control VC+ calls.**'
            ].join('\n'),
            'info'
        );

        await channel.send({
            embeds: [embed]
        });

    } catch (error) {
        console.error('Interface error:', error);
    }
}

// ============================================================
// HELP
// ============================================================

function mainHelp() {
    return box(
        'Help',
        [
            '**Moderation**',
            '`-ban @user [reason]`',
            '`-foreverban @user [reason]`',
            '`-unban <id>`',
            '`-kick @user [reason]`',
            '`-timeout @user <minutes>`',
            '`-untimeout @user`',
            '',
            '**Voice**',
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
            '`-vc transfer @user`',
            '`-vc stfu @user`',
            '`-vc unstfu @user`',
            '`-interface`',
            '`-dragall`',
            '',
            '**Ranks**',
            '`-rank @user <rank>`',
            '`-ranks`',
            '',
            '**Vouches**',
            '`-vouch add @user`',
            '`-vouch remove @user`',
            '`-vouch set <number>`',
            '`-vouch info @user`',
            '',
            '**Other**',
            '`-ping`',
            '`-help`'
        ].join('\n'),
        'info'
    );
}

// ============================================================
// VC SETUP
// ============================================================

async function vcSetup(message) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ManageChannels
        )
    ) {
        return reply(message, {
            embeds: [
                helpBox(
                    'vc setup',
                    'Creates the complete VC+ Join-to-Create system.',
                    '-vc setup',
                    '-vc setup',
                    'Requires Manage Channels.'
                )
            ]
        });
    }

    const config = ensureGuild(message.guild.id);

    if (config.triggerId) {
        const old =
            message.guild.channels.cache.get(
                config.triggerId
            );

        if (old) {
            return reply(message, {
                embeds: [
                    box(
                        'Already Setup',
                        `VC+ is already configured.\n\nJoin ${old} to create your personal VC.`,
                        'warning'
                    )
                ]
            });
        }
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
                userLimit: 0,
                bitrate: 64000
            });

        config.categoryId = category.id;
        config.triggerId = trigger.id;

        saveDB();

        await reply(message, {
            embeds: [
                box(
                    'Setup Complete',
                    [
                        `**Join to Create:** ${trigger}`,
                        '',
                        'When a member joins it, VC+ automatically creates their personal VC and moves them into it.',
                        '',
                        'The personal VC receives the VC+ control interface.'
                    ].join('\n'),
                    'success'
                )
            ]
        });

    } catch (error) {
        console.error('VC setup error:', error);

        return reply(message, {
            embeds: [
                box(
                    'Setup Failed',
                    'I could not create the VC+ system. Make sure my bot role has **Manage Channels** and is high enough in the role hierarchy.',
                    'danger'
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
            embeds: [mainHelp()]
        });
    }

    if (sub === 'setup') {
        return vcSetup(message);
    }

    const channel = message.member.voice.channel;

    if (!channel) {
        return reply(message, {
            embeds: [
                helpBox(
                    `vc ${sub}`,
                    'You must be inside a VC.',
                    `-vc ${sub} @user`,
                    `-vc ${sub} @user`,
                    'Join your VC first.'
                )
            ]
        });
    }

    const data = getVC(channel.id);

    if (!data) {
        return reply(message, {
            embeds: [
                box(
                    'Not a VC+ Call',
                    'This is not a VC+ personal call.',
                    'warning'
                )
            ]
        });
    }

    if (!canControlVC(message, channel)) {
        return reply(message, {
            embeds: [
                box(
                    'Access Denied',
                    'You can only control your own VC. Founder and God can control VC+ calls.',
                    'danger'
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

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc kick',
                        'Remove a member from your VC.',
                        '-vc kick @user',
                        '-vc kick @user'
                    )
                ]
            });
        }

        if (
            target.voice.channelId !==
            channel.id
        ) {
            return reply(message, {
                embeds: [
                    box(
                        'Cannot Kick',
                        'That member is not in this VC.',
                        'warning'
                    )
                ]
            });
        }

        if (
            power(
                message.guild.id,
                target.id
            ) >= power(
                message.guild.id,
                message.author.id
            ) &&
            !isFounder(message)
        ) {
            return reply(message, {
                embeds: [
                    box(
                        'Protected User',
                        'You cannot use VC moderation against a higher/equal VC+ rank.',
                        'danger'
                    )
                ]
            });
        }

        await target.voice.disconnect(
            'VC+ owner kick'
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'Member Removed',
                    `${target} was removed from the VC.`,
                    'success'
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
                        'Prevent a member from joining this VC.',
                        '-vc ban @user',
                        '-vc ban @user'
                    )
                ]
            });
        }

        if (
            power(message.guild.id, target.id) >=
                power(message.guild.id, message.author.id) &&
            !isFounder(message)
        ) {
            return reply(message, {
                embeds: [
                    box(
                        'Protected User',
                        'You cannot VC-ban a higher/equal VC+ rank.',
                        'danger'
                    )
                ]
            });
        }

        data.banned.add(target.id);
        data.rejected.add(target.id);

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.disconnect(
                'VC+ ban'
            ).catch(() => {});
        }

        return reply(message, {
            embeds: [
                box(
                    'VC Ban',
                    `${target} is now banned from this VC.`,
                    'success'
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
                    helpBox(
                        'vc unban',
                        'Remove a VC ban.',
                        '-vc unban @user',
                        '-vc unban @user'
                    )
                ]
            });
        }

        data.banned.delete(target.id);
        data.rejected.delete(target.id);

        return reply(message, {
            embeds: [
                box(
                    'VC Unban',
                    `${target} can join this VC again.`,
                    'success'
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
                        'Reject a member from joining your VC.',
                        '-vc reject @user',
                        '-vc reject @user'
                    )
                ]
            });
        }

        data.rejected.add(target.id);

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.disconnect(
                'VC+ reject'
            ).catch(() => {});
        }

        return reply(message, {
            embeds: [
                box(
                    'Rejected',
                    `${target} has been rejected from this VC.`,
                    'success'
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
                    helpBox(
                        'vc permit',
                        'Allow a rejected member into your VC.',
                        '-vc permit @user',
                        '-vc permit @user'
                    )
                ]
            });
        }

        data.rejected.delete(target.id);
        data.banned.delete(target.id);
        data.permitted.add(target.id);

        return reply(message, {
            embeds: [
                box(
                    'Permitted',
                    `${target} is permitted to join this VC.`,
                    'success'
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
            {
                Connect: false
            }
        ).catch(() => {});

        data.locked = true;

        return reply(message, {
            embeds: [
                box(
                    'VC Locked',
                    'Your VC is now locked.',
                    'success'
                )
            ]
        });
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

        data.locked = false;

        return reply(message, {
            embeds: [
                box(
                    'VC Unlocked',
                    'Your VC is now unlocked.',
                    'success'
                )
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
                        '-vc limit <0-99>',
                        '-vc limit 10'
                    )
                ]
            });
        }

        await channel.setUserLimit(limit)
            .catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'User Limit',
                    `The VC limit is now **${limit === 0 ? 'Unlimited' : limit}**.`,
                    'success'
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
                        '-vc rename <name>',
                        '-vc rename gaming vc'
                    )
                ]
            });
        }

        await channel.setName(name)
            .catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'VC Renamed',
                    `Your VC is now **${name}**.`,
                    'success'
                )
            ]
        });
    }

    // --------------------------------------------------------
    // TRANSFER
    // --------------------------------------------------------

    if (sub === 'transfer') {
        if (!isFounder(message)) {
            const data = getVC(channel.id);

            if (
                !data ||
                data.ownerId !== message.author.id
            ) {
                return reply(message, {
                    embeds: [
                        box(
                            'Access Denied',
                            'Only the current VC owner or Founder can transfer ownership.',
                            'danger'
                        )
                    ]
                });
            }
        }

        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc transfer',
                        'Transfer VC ownership.',
                        '-vc transfer @user',
                        '-vc transfer @user'
                    )
                ]
            });
        }

        data.ownerId = target.id;

        return reply(message, {
            embeds: [
                box(
                    'Ownership Transferred',
                    `${target} is now the owner of this VC.`,
                    'success'
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

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc stfu',
                        'Force mute a member in the VC.',
                        '-vc stfu @user',
                        '-vc stfu @user'
                    )
                ]
            });
        }

        const targetRank =
            getRank(
                message.guild.id,
                target.id
            );

        if (
            (targetRank === 'founder' ||
             targetRank === 'god') &&
            !isFounder(message)
        ) {
            return reply(message, {
                embeds: [
                    box(
                        'Protected User',
                        'You cannot use `-vc stfu` on a Founder or God.',
                        'danger'
                    )
                ]
            });
        }

        data.stfu.add(target.id);

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.setMute(
                true,
                'VC+ forced mute'
            ).catch(() => {});
        }

        return reply(message, {
            embeds: [
                box(
                    'Forced Mute',
                    `${target} is now forced muted in this VC.`,
                    'success'
                )
            ]
        });
    }

    // --------------------------------------------------------
    // UNSTFU
    // --------------------------------------------------------

    if (sub === 'unstfu') {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc unstfu',
                        'Remove a forced VC mute.',
                        '-vc unstfu @user',
                        '-vc unstfu @user'
                    )
                ]
            });
        }

        data.stfu.delete(target.id);

        await target.voice.setMute(
            false,
            'VC+ forced mute removed'
        ).catch(() => {});

        return reply(message, {
            embeds: [
                box(
                    'Mute Removed',
                    `${target} is no longer force-muted.`,
                    'success'
                )
            ]
        });
    }

    return reply(message, {
        embeds: [
            box(
                'Unknown VC Command',
                'Use `-help` or `-interface` to see VC+ commands.',
                'warning'
            )
        ]
    });
}

// ============================================================
// RANKS
// ============================================================

async function rankCommand(message, args) {
    if (!isFounder(message)) {
        return reply(message, {
            embeds: [
                box(
                    'Access Denied',
                    'Only Founder can manage VC+ ranks.',
                    'danger'
                )
            ]
        });
    }

    const target =
        await getTarget(message, args[0]);

    const rank =
        args[1]?.toLowerCase();

    if (!target || !RANK_POWER[rank]) {
        return reply(message, {
            embeds: [
                box(
                    'Rank Help',
                    [
                        '`-rank @user founder`',
                        '`-rank @user god`',
                        '`-rank @user owner`',
                        '`-rank @user coowner`',
                        '`-rank @user executive`',
                        '`-rank @user director`',
                        '`-rank @user admin`',
                        '`-rank @user moderator`',
                        '`-rank @user staff`',
                        '`-rank @user member`'
                    ].join('\n'),
                    'info'
                )
            ]
        });
    }

    db.ranks[message.guild.id][target.id] =
        rank;

    saveDB();

    return reply(message, {
        embeds: [
            box(
                'Rank Updated',
                `${target} is now **${rank}** in VC+.\n\nThis is a VC+ rank and does not create a Discord role.`,
                'success'
            )
        ]
    });
}

// ============================================================
// RANK LIST
// ============================================================

async function ranksCommand(message) {
    return reply(message, {
        embeds: [
            box(
                'VC+ Rank List',
                [
                    '**1. Founder** — Full VC+ control',
                    '**2. God** — Advanced control',
                    '**3. Owner** — VC+ owner rank',
                    '**4. Co-Owner**',
                    '**5. Executive**',
                    '**6. Director**',
                    '**7. Admin**',
                    '**8. Moderator**',
                    '**9. Staff**',
                    '**10. Member**'
                ].join('\n'),
                'info'
            )
        ]
    });
}

// ============================================================
// VOUCH
// ============================================================

async function vouchCommand(message, args) {
    if (!isFounder(message)) {
        return reply(message, {
            embeds: [
                box(
                    'Access Denied',
                    'Only Founder can manage vouches.',
                    'danger'
                )
            ]
        });
    }

    const action =
        args.shift()?.toLowerCase();

    const config =
        ensureGuild(message.guild.id);

    if (action === 'set') {
        const amount = Number(args[0]);

        if (
            !Number.isInteger(amount) ||
            amount < 1 ||
            amount > 100
        ) {
            return reply(message, {
                embeds: [
                    box(
                        'Invalid Vouch Limit',
                        'Use a number from 1 to 100.',
                        'warning'
                    )
                ]
            });
        }

        config.vouchLimit = amount;
        saveDB();

        return reply(message, {
            embeds: [
                box(
                    'Vouch Limit',
                    `The required vouches are now **${amount}**.`,
                    'success'
                )
            ]
        });
    }

    const target =
        await getTarget(message, args[0]);

    if (!target) {
        return reply(message, {
            embeds: [
                box(
                    'Vouch Help',
                    [
                        '`-vouch add @user`',
                        '`-vouch remove @user`',
                        '`-vouch info @user`',
                        '`-vouch set 5`'
                    ].join('\n'),
                    'info'
                )
            ]
        });
    }

    if (!db.vouches[message.guild.id][target.id]) {
        db.vouches[message.guild.id][target.id] = 0;
    }

    if (action === 'add') {
        db.vouches[message.guild.id][target.id]++;

        const count =
            db.vouches[message.guild.id][target.id];

        let promoted = '';

        if (count >= config.vouchLimit) {
            promoted =
                '\n\nThey reached the configured vouch requirement and qualify for the **second-highest VC+ rank: God**.';
        }

        saveDB();

        return reply(message, {
            embeds: [
                box(
                    'Vouch Added',
                    `${target} now has **${count}** vouch(es).${promoted}`,
                    'success'
                )
            ]
        });
    }

    if (action === 'remove') {
        db.vouches[message.guild.id][target.id] =
            Math.max(
                0,
                db.vouches[message.guild.id][target.id] - 1
            );

        saveDB();

        return reply(message, {
            embeds: [
                box(
                    'Vouch Removed',
                    `${target} now has **${db.vouches[message.guild.id][target.id]}** vouch(es).`,
                    'success'
                )
            ]
        });
    }

    if (action === 'info') {
        const count =
            db.vouches[message.guild.id][target.id] || 0;

        return reply(message, {
            embeds: [
                box(
                    'Vouch Information',
                    [
                        `**User:** ${target}`,
                        `**Vouches:** ${count}`,
                        `**Required:** ${config.vouchLimit}`,
                        `**Eligible for God:** ${count >= config.vouchLimit ? 'Yes' : 'No'}`
                    ].join('\n'),
                    'info'
                )
            ]
        });
    }

    return reply(message, {
        embeds: [
            box(
                'Vouch Help',
                '`-vouch add @user`\n`-vouch remove @user`\n`-vouch info @user`\n`-vouch set 5`',
                'info'
            )
        ]
    });
}

// ============================================================
// MODERATION
// ============================================================

async function banCommand(message, args, forever = false) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        return reply(message, {
            embeds: [
                helpBox(
                    forever ? 'foreverban' : 'ban',
                    'Ban a member from the server.',
                    `-${forever ? 'foreverban' : 'ban'} @user [reason]`,
                    `-${forever ? 'foreverban' : 'ban'} @user rule violation`
                )
            ]
        });
    }

    const target =
        await getTarget(message, args[0]);

    if (!target) {
        return reply(message, {
            embeds: [
                box(
                    'Missing User',
                    `Mention a member to ${forever ? 'foreverban' : 'ban'}.`,
                    'warning'
                )
            ]
        });
    }

    if (
        target.id === message.author.id ||
        target.id === message.guild.ownerId
    ) {
        return reply(message, {
            embeds: [
                box(
                    'Protected User',
                    'You cannot ban this user.',
                    'danger'
                )
            ]
        });
    }

    if (!target.bannable) {
        return reply(message, {
            embeds: [
                box(
                    'Cannot Ban',
                    'My role is not high enough to ban that member.',
                    'danger'
                )
            ]
        });
    }

    const reason =
        args.slice(1).join(' ') ||
        'No reason provided';

    try {
        await target.ban({
            reason: `${BOT_NAME}: ${reason}`
        });

        return reply(message, {
            embeds: [
                box(
                    forever ? 'Forever Banned' : 'Banned',
                    `${target.user.tag} has been banned.\n\n**Reason:** ${reason}`,
                    'success'
                )
            ]
        });

    } catch (error) {
        console.error('Ban error:', error);

        return reply(message, {
            embeds: [
                box(
                    'Ban Failed',
                    'Discord rejected the ban. Check my permissions and role hierarchy.',
                    'danger'
                )
            ]
        });
    }
}

async function kickCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.KickMembers
        )
    ) {
        return reply(message, {
            embeds: [
                helpBox(
                    'kick',
                    'Kick a member.',
                    '-kick @user [reason]',
                    '-kick @user spam'
                )
            ]
        });
    }

    const target =
        await getTarget(message, args[0]);

    if (!target || !target.kickable) {
        return reply(message, {
            embeds: [
                box(
                    'Kick Failed',
                    'I cannot kick that member.',
                    'danger'
                )
            ]
        });
    }

    const reason =
        args.slice(1).join(' ') ||
        'No reason provided';

    await target.kick(
        `${BOT_NAME}: ${reason}`
    ).catch(() => {});

    return reply(message, {
        embeds: [
            box(
                'Kicked',
                `${target.user.tag} was kicked.\n\n**Reason:** ${reason}`,
                'success'
            )
        ]
    });
}

// ============================================================
// DRAG ALL
// ============================================================

async function dragAll(message) {
    if (!isGod(message)) {
        return reply(message, {
            embeds: [
                box(
                    'Access Denied',
                    'Only Founder and God can use `-dragall`.',
                    'danger'
                )
            ]
        });
    }

    const source =
        message.member.voice.channel;

    if (!source) {
        return reply(message, {
            embeds: [
                box(
                    'No VC',
                    'Join a voice channel first.',
                    'warning'
                )
            ]
        });
    }

    let moved = 0;

    for (const [, member] of message.guild.members.cache) {
        if (
            member.user.bot ||
            !member.voice.channel ||
            member.id === message.author.id
        ) continue;

        if (
            member.voice.channel.id ===
            source.id
        ) continue;

        try {
            await member.voice.setChannel(
                source
            );

            moved++;
        } catch {}
    }

    return reply(message, {
        embeds: [
            box(
                'Drag All',
                `Moved **${moved}** member(s) into ${source}.`,
                'success'
            )
        ]
    });
}

// ============================================================
// MESSAGE COMMAND HANDLER
// ============================================================

client.on(
    'messageCreate',
    async message => {
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

            ensureGuild(message.guild.id);

            // ----------------------------------------------
            // HELP
            // ----------------------------------------------

            if (command === 'help') {
                return reply(message, {
                    embeds: [mainHelp()]
                });
            }

            // ----------------------------------------------
            // PING
            // ----------------------------------------------

            if (command === 'ping') {
                return reply(message, {
                    embeds: [
                        box(
                            'Ping',
                            `Pong!\n\n**Latency:** ${client.ws.ping}ms`,
                            'success'
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // INTERFACE
            // ----------------------------------------------

            if (command === 'interface') {
                const channel =
                    message.member.voice.channel;

                if (!channel) {
                    return reply(message, {
                        embeds: [
                            box(
                                'No VC',
                                'Join your VC first.',
                                'warning'
                            )
                        ]
                    });
                }

                if (!getVC(channel.id)) {
                    return reply(message, {
                        embeds: [
                            box(
                                'Not VC+',
                                'This is not a VC+ personal call.',
                                'warning'
                            )
                        ]
                    });
                }

                return sendVCInterface(channel);
            }

            // ----------------------------------------------
            // VC
            // ----------------------------------------------

            if (command === 'vc') {
                return vcCommand(
                    message,
                    args
                );
            }

            // ----------------------------------------------
            // RANK
            // ----------------------------------------------

            if (command === 'rank') {
                return rankCommand(
                    message,
                    args
                );
            }

            // ----------------------------------------------
            // RANKS
            // ----------------------------------------------

            if (command === 'ranks') {
                return ranksCommand(message);
            }

            // ----------------------------------------------
            // VOUCH
            // ----------------------------------------------

            if (command === 'vouch') {
                return vouchCommand(
                    message,
                    args
                );
            }

            // ----------------------------------------------
            // BAN
            // ----------------------------------------------

            if (command === 'ban') {
                return banCommand(
                    message,
                    args,
                    false
                );
            }

            // ----------------------------------------------
            // FOREVER BAN
            // ----------------------------------------------

            if (command === 'foreverban') {
                if (!isGod(message)) {
                    return reply(message, {
                        embeds: [
                            box(
                                'Access Denied',
                                'Only Founder and God can use `-foreverban`.',
                                'danger'
                            )
                        ]
                    });
                }

                return banCommand(
                    message,
                    args,
                    true
                );
            }

            // ----------------------------------------------
            // KICK
            // ----------------------------------------------

            if (command === 'kick') {
                return kickCommand(
                    message,
                    args
                );
            }

            // ----------------------------------------------
            // UNBAN
            // ----------------------------------------------

            if (command === 'unban') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.BanMembers
                    )
                ) {
                    return reply(message, {
                        embeds: [
                            box(
                                'Access Denied',
                                'You need Ban Members permission.',
                                'danger'
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
                                '-unban <userID>',
                                '-unban 123456789'
                            )
                        ]
                    });
                }

                try {
                    await message.guild.members.unban(id);

                    return reply(message, {
                        embeds: [
                            box(
                                'Unbanned',
                                `User **${id}** has been unbanned.`,
                                'success'
                            )
                        ]
                    });
                } catch {
                    return reply(message, {
                        embeds: [
                            box(
                                'Unban Failed',
                                'That user may not be banned or the ID is invalid.',
                                'danger'
                            )
                        ]
                    });
                }
            }

            // ----------------------------------------------
            // TIMEOUT
            // ----------------------------------------------

            if (command === 'timeout') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return reply(message, {
                        embeds: [
                            box(
                                'Access Denied',
                                'You need Moderate Members permission.',
                                'danger'
                            )
                        ]
                    });
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
                    return reply(message, {
                        embeds: [
                            helpBox(
                                'timeout',
                                'Timeout a member.',
                                '-timeout @user <minutes>',
                                '-timeout @user 10'
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
                    'VC+ timeout'
                ).catch(() => {});

                return reply(message, {
                    embeds: [
                        box(
                            'Timeout',
                            `${target} was timed out for **${minutes} minute(s)**.`,
                            'success'
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNTIMEOUT
            // ----------------------------------------------

            if (command === 'untimeout') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return reply(message, {
                        embeds: [
                            box(
                                'Access Denied',
                                'You need Moderate Members permission.',
                                'danger'
                            )
                        ]
                    });
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                if (!target) {
                    return reply(message, {
                        embeds: [
                            helpBox(
                                'untimeout',
                                'Remove a timeout.',
                                '-untimeout @user',
                                '-untimeout @user'
                            )
                        ]
                    });
                }

                await target.timeout(
                    null,
                    'VC+ timeout removed'
                ).catch(() => {});

                return reply(message, {
                    embeds: [
                        box(
                            'Timeout Removed',
                            `${target} is no longer timed out.`,
                            'success'
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // DRAG ALL
            // ----------------------------------------------

            if (command === 'dragall') {
                return dragAll(message);
            }

            // ----------------------------------------------
            // UNKNOWN
            // ----------------------------------------------

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

        } catch (error) {
            console.error(
                'Command handler error:',
                error
            );

            try {
                await reply(message, {
                    embeds: [
                        box(
                            'Error',
                            'Something went wrong while processing that command. The bot stayed online.',
                            'danger'
                        )
                    ]
                });
            } catch {}
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

            if (!guild) return;

            const config =
                ensureGuild(guild.id);

            // ----------------------------------------------
            // AUTO CREATE
            // ----------------------------------------------

            if (
                newState.channelId &&
                newState.channelId ===
                    config.triggerId
            ) {
                const member =
                    newState.member;

                if (member) {
                    const channel =
                        await createPersonalVC(
                            member,
                            guild
                        );

                    if (channel) {
                        setTimeout(
                            () =>
                                sendVCInterface(
                                    channel
                                ),
                            500
                        );
                    }
                }

                return;
            }

            // ----------------------------------------------
            // VC SECURITY
            // ----------------------------------------------

            if (newState.channelId) {
                const data =
                    getVC(
                        newState.channelId
                    );

                if (data) {
                    const member =
                        newState.member;

                    if (!member) return;

                    // Founder/God are protected.
                    const rank =
                        getRank(
                            guild.id,
                            member.id
                        );

                    // VC bans/rejections
                    if (
                        data.banned.has(member.id) ||
                        data.rejected.has(member.id)
                    ) {
                        await member.voice
                            .disconnect(
                                'VC+ rejected/banned'
                            )
                            .catch(() => {});

                        return;
                    }

                    // Forced mute
                    if (
                        data.stfu.has(member.id)
                    ) {
                        await member.voice
                            .setMute(
                                true,
                                'VC+ forced mute'
                            )
                            .catch(() => {});

                        return;
                    }

                    // Founder/God auto-unmute protection
                    if (
                        rank === 'founder' ||
                        rank === 'god'
                    ) {
                        if (
                            newState.serverMute
                        ) {
                            await member.voice
                                .setMute(
                                    false,
                                    'VC+ rank protection'
                                )
                                .catch(() => {});
                        }
                    }
                }
            }

            // ----------------------------------------------
            // AUTO CLEANUP
            // ----------------------------------------------

            if (oldState.channelId) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    tempVCs.has(
                        oldChannel.id
                    ) &&
                    oldChannel.members.size === 0
                ) {
                    tempVCs.delete(
                        oldChannel.id
                    );

                    await oldChannel.delete(
                        'VC+ empty personal VC'
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
// MANUAL MUTE PROTECTION
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            if (
                !newState.guild ||
                !newState.channelId
            ) return;

            const guild =
                newState.guild;

            const rank =
                getRank(
                    guild.id,
                    newState.id
                );

            // Founder/God cannot remain server muted.
            if (
                (
                    rank === 'founder' ||
                    rank === 'god'
                ) &&
                newState.serverMute
            ) {
                await newState.member?.voice
                    .setMute(
                        false,
                        'VC+ protected rank'
                    )
                    .catch(() => {});
            }

            const data =
                getVC(newState.channelId);

            if (!data) return;

            // STFU cannot be manually undone.
            if (
                data.stfu.has(
                    newState.id
                ) &&
                !newState.serverMute
            ) {
                await newState.member?.voice
                    .setMute(
                        true,
                        'VC+ forced mute'
                    )
                    .catch(() => {});
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
// ANTI ABUSE
// ============================================================
//
// Detects rapid server bans.
// It DOES NOT automatically ban the executor.
// Instead it removes manageable roles and alerts
// the server owner to avoid accidental mass punishment.
// ============================================================

client.on(
    'guildBanAdd',
    async (ban) => {
        try {
            const guild =
                ban.guild;

            const logs =
                await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberBanAdd,
                    limit: 5
                }).catch(() => null);

            if (!logs) return;

            const entry =
                logs.entries.find(
                    e =>
                        e.target?.id ===
                            ban.user.id &&
                        Date.now() -
                            e.createdTimestamp <
                            10000
                );

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            // Bot itself
            if (
                executor.id === client.user.id
            ) return;

            // Founder is trusted.
            if (
                isFounder({
                    guild,
                    author: executor
                })
            ) {
                return;
            }

            const key =
                `${guild.id}:${executor.id}`;

            const now =
                Date.now();

            const list =
                banTracker.get(key) || [];

            const recent =
                list.filter(
                    time =>
                        now - time <
                        10000
                );

            recent.push(now);

            banTracker.set(
                key,
                recent
            );

            // 3 bans within 10 seconds
            if (recent.length >= 3) {
                const member =
                    await guild.members
                        .fetch(executor.id)
                        .catch(() => null);

                if (member) {
                    const removable =
                        member.roles.cache.filter(
                            role =>
                                role.id !==
                                    guild.id &&
                                role.editable
                        );

                    if (removable.size) {
                        await member.roles
                            .remove(
                                removable,
                                'VC+ anti-abuse protection'
                            )
                            .catch(() => {});
                    }
                }

                const owner =
                    await guild.members
                        .fetch(
                            guild.ownerId
                        )
                        .catch(() => null);

                if (owner) {
                    await owner.send({
                        embeds: [
                            box(
                                'Security Alert',
                                [
                                    `**Server:** ${guild.name}`,
                                    `**User:** ${executor.tag}`,
                                    '',
                                    'VC+ detected multiple rapid bans from this account.',
                                    'The account was stripped of manageable roles.',
                                    '',
                                    '**Review the audit log immediately.**'
                                ].join('\n'),
                                'danger'
                            )
                        ]
                    }).catch(() => {});
                }

                banTracker.delete(key);
            }

        } catch (error) {
            console.error(
                'Security monitor error:',
                error
            );
        }
    }
);

// ============================================================
// GUILD JOIN
// ============================================================

client.on(
    'guildCreate',
    guild => {
        ensureGuild(guild.id);
        saveDB();

        console.log(
            `Joined ${guild.name}`
        );
    }
);

// ============================================================
// READY
// ============================================================

client.once(
    'ready',
    () => {
        console.log(
            `Logged in as ${client.user.tag}`
        );

        client.user.setPresence({
            status: 'online',
            activities: [
                {
                    name: 'VC+',
                    type: 0
                }
            ]
        });

        console.log(
            `${BOT_NAME} is ready.`
        );
    }
);

// ============================================================
// ERROR PROTECTION
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
    process.env.DISCORD_TOKEN ||
    process.env.BOT_TOKEN;

if (!token) {
    console.error(
        'Missing DISCORD_TOKEN in environment.'
    );

    process.exit(1);
}

client.login(token)
    .catch(error => {
        console.error(
            'Login failed:',
            error
        );

        process.exit(1);
    });
