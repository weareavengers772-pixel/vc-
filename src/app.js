import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder
} from 'discord.js';

// ============================================================
// vc+
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

const PREFIX = '-';
const BOT_NAME = 'vc+';

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
    Founder: 10,
    God: 9,
    Owner: 8,
    'Co-Owner': 7,
    Executive: 6,
    Director: 5,
    Admin: 4,
    Moderator: 3,
    Staff: 2,
    Member: 1
};

// ============================================================
// MEMORY DATA
// ============================================================

const guildData = new Map();

/*
guildData:
{
    triggerId,
    categoryId,
    vcs: Map(channelId, {
        ownerId,
        banned: Set,
        rejected: Set,
        permitted: Set,
        stfu: Set
    }),
    foreverBanned: Set,
    warnings: Map(userId, number),
    vouches: Map(userId, number)
}
*/

// ============================================================
// SAFE DATA
// ============================================================

function getGuildData(guildId) {
    if (!guildData.has(guildId)) {
        guildData.set(guildId, {
            triggerId: null,
            categoryId: null,
            vcs: new Map(),
            foreverBanned: new Set(),
            warnings: new Map(),
            vouches: new Map()
        });
    }

    return guildData.get(guildId);
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, color = 0x5865f2) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: 'vc+' })
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

    return box('vc+ help', text);
}

// ============================================================
// RANK
// ============================================================

function getRank(member) {
    if (!member) return null;

    if (member.id === member.guild.ownerId) {
        return 'Founder';
    }

    for (const rank of RANKS) {
        if (
            member.roles.cache.some(
                role => role.name.toLowerCase() === rank.toLowerCase()
            )
        ) {
            return rank;
        }
    }

    return null;
}

function getPower(member) {
    if (!member) return 0;

    const rank = getRank(member);

    if (!rank) return 0;

    return RANK_POWER[rank] || 0;
}

function hasRank(member, minimum) {
    return getPower(member) >= (RANK_POWER[minimum] || 999);
}

function isFounder(member) {
    return member?.id === member?.guild?.ownerId ||
        getRank(member) === 'Founder';
}

function isGod(member) {
    return isFounder(member) || getRank(member) === 'God';
}

// ============================================================
// TARGET
// ============================================================

async function getTarget(message, input) {
    if (!input) return null;

    const mentioned = message.mentions.members.first();

    if (mentioned) return mentioned;

    const id = input.replace(/[<@!>]/g, '');

    if (!/^\d{15,25}$/.test(id)) return null;

    return message.guild.members.fetch(id).catch(() => null);
}

// ============================================================
// VC OWNER
// ============================================================

function getVC(member) {
    if (!member?.voice?.channelId) return null;

    const data = getGuildData(member.guild.id);

    return data.vcs.get(member.voice.channelId) || null;
}

function canControlVC(member, vc) {
    if (!vc) return false;

    if (vc.ownerId === member.id) {
        return true;
    }

    return isGod(member);
}

// ============================================================
// SAFE REPLY
// ============================================================

async function reply(message, payload) {
    try {
        return await message.reply(payload);
    } catch {
        return null;
    }
}

// ============================================================
// HELP
// ============================================================

function fullHelp() {
    return box(
        'vc+ help',
        [
            '**Moderation**',
            '`-ban @user [reason]`',
            '`-unban <id>`',
            '`-kick @user [reason]`',
            '`-timeout @user <minutes>`',
            '`-untimeout @user`',
            '`-warning @user [reason]`',
            '`-warnings @user`',
            '`-clearwarnings @user`',
            '`-foreverban @user [reason]`',
            '`-foreverunban <id>`',
            '',
            '**Ranks**',
            '`-rank @user <rank>`',
            '`-vouch @user`',
            '',
            '**Voice**',
            '`-vc setup`',
            '`-vc help`',
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
            '`-vc stfu @user`',
            '`-vc unstfu @user`',
            '',
            '**Other**',
            '`-ping`',
            '`-help`'
        ].join('\n')
    );
}

function vcHelp() {
    return box(
        'vc+ • Voice Commands',
        [
            '`-vc setup` — Create Join to Create',
            '`-vc kick @user` — Remove someone',
            '`-vc ban @user` — Ban someone from your VC',
            '`-vc unban @user` — Remove VC ban',
            '`-vc reject @user` — Reject someone',
            '`-vc permit @user` — Permit someone',
            '`-vc lock` — Lock your VC',
            '`-vc unlock` — Unlock your VC',
            '`-vc limit <number>` — Set limit',
            '`-vc rename <name>` — Rename VC',
            '`-vc claim` — Claim an unowned VC',
            '`-vc transfer @user` — Transfer ownership',
            '`-vc stfu @user` — Force mute someone',
            '`-vc unstfu @user` — Remove force mute'
        ].join('\n')
    );
}

// ============================================================
// VC SETUP
// ============================================================

async function setupVC(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'vc setup',
                    'Create the Join to Create voice system.',
                    '-vc setup',
                    '-vc setup',
                    'Requires Manage Channels.'
                )
            ]
        });
    }

    const data = getGuildData(message.guild.id);

    if (data.triggerId) {
        const old = await message.guild.channels
            .fetch(data.triggerId)
            .catch(() => null);

        if (old) {
            return reply(
                message,
                box(
                    'vc+',
                    `Join to Create is already set up.\n\nJoin ${old} to create your VC.`
                )
            );
        }

        data.triggerId = null;
    }

    try {
        const category = await message.guild.channels.create({
            name: 'Voice Channels',
            type: ChannelType.GuildCategory,
            reason: 'vc+ Join to Create setup'
        });

        const trigger = await message.guild.channels.create({
            name: 'Join to Create',
            type: ChannelType.GuildVoice,
            parent: category.id,
            reason: 'vc+ Join to Create setup'
        });

        data.categoryId = category.id;
        data.triggerId = trigger.id;

        return reply(
            message,
            box(
                'vc+ • Setup Complete',
                `Join ${trigger} to automatically create your own VC.\n\n` +
                `Your personal channel will look like:\n` +
                `**username VC**`
            )
        );
    } catch (error) {
        console.error('VC setup error:', error);

        return reply(
            message,
            box(
                'vc+ • Setup Failed',
                'I could not create the voice system.\n\n' +
                'Make sure the bot has **Manage Channels** permission.',
                0xed4245
            )
        );
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    if (!data.categoryId) return null;

    const category = await guild.channels
        .fetch(data.categoryId)
        .catch(() => null);

    if (!category) return null;

    const existing = [...data.vcs.values()]
        .find(vc => vc.ownerId === member.id);

    if (existing) {
        const channel = await guild.channels
            .fetch(
                [...data.vcs.entries()]
                    .find(([, value]) => value === existing)?.[0]
            )
            .catch(() => null);

        if (channel) return channel;
    }

    const channel = await guild.channels.create({
        name: `${member.user.username} VC`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit: 0,
        reason: 'vc+ Join to Create'
    });

    data.vcs.set(channel.id, {
        ownerId: member.id,
        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        stfu: new Set()
    });

    return channel;
}

// ============================================================
// MOVE TO VC
// ============================================================

async function moveIntoVC(member) {
    try {
        const channel = await createPersonalVC(member);

        if (!channel) return;

        await member.voice.setChannel(
            channel,
            'vc+ Join to Create'
        );
    } catch (error) {
        console.error('Move VC error:', error);
    }
}

// ============================================================
// VC PERMISSION
// ============================================================

async function requireVCControl(message, subcommand) {
    const channel = message.member.voice.channel;
    const data = getVC(message.member);

    if (!channel) {
        await reply(message, {
            embeds: [
                helpBox(
                    `vc ${subcommand}`,
                    'You must be inside a personal VC.',
                    `-vc ${subcommand} @user`,
                    `-vc ${subcommand} @user`
                )
            ]
        });

        return null;
    }

    if (!data) {
        await reply(message, {
            embeds: [
                helpBox(
                    `vc ${subcommand}`,
                    'This is not a vc+ personal VC.',
                    `-vc ${subcommand} @user`,
                    `-vc ${subcommand} @user`
                )
            ]
        });

        return null;
    }

    if (!canControlVC(message.member, data)) {
        await reply(message, {
            embeds: [
                helpBox(
                    `vc ${subcommand}`,
                    'Manage your personal VC.',
                    `-vc ${subcommand} @user`,
                    `-vc ${subcommand} @user`,
                    'Only the VC owner, God, or Founder can use this.'
                )
            ]
        });

        return null;
    }

    return {
        channel,
        data
    };
}

// ============================================================
// VC COMMANDS
// ============================================================

async function handleVC(message, args) {
    const sub = args.shift()?.toLowerCase();

    if (!sub || sub === 'help') {
        return reply(message, { embeds: [vcHelp()] });
    }

    if (sub === 'setup') {
        return setupVC(message);
    }

    const control = await requireVCControl(message, sub);

    if (!control) return;

    const { channel, data } = control;

    // --------------------------------------------------------
    // TARGET COMMANDS
    // --------------------------------------------------------

    if (
        [
            'kick',
            'ban',
            'unban',
            'reject',
            'permit',
            'stfu',
            'unstfu',
            'transfer'
        ].includes(sub)
    ) {
        const target = await getTarget(message, args[0]);

        if (!target) {
            return reply(message, {
                embeds: [
                    helpBox(
                        `vc ${sub}`,
                        'Manage a member in your personal VC.',
                        `-vc ${sub} @user`,
                        `-vc ${sub} @user`
                    )
                ]
            });
        }

        // Don't let owners accidentally target themselves.
        if (target.id === message.author.id) {
            return reply(
                message,
                box(
                    'vc+',
                    'You cannot use this command on yourself.',
                    0xed4245
                )
            );
        }

        // ----------------------------------------------------
        // KICK
        // ----------------------------------------------------

        if (sub === 'kick') {
            if (target.voice.channelId !== channel.id) {
                return reply(
                    message,
                    box('vc+', `${target} is not in your VC.`, 0xed4245)
                );
            }

            await target.voice.disconnect(
                'vc+ VC kick'
            ).catch(() => {});

            return reply(
                message,
                box('vc+', `${target} was kicked from the VC.`)
            );
        }

        // ----------------------------------------------------
        // BAN
        // ----------------------------------------------------

        if (sub === 'ban') {
            data.banned.add(target.id);
            data.rejected.add(target.id);

            if (target.voice.channelId === channel.id) {
                await target.voice.disconnect(
                    'vc+ VC ban'
                ).catch(() => {});
            }

            return reply(
                message,
                box('vc+', `${target} is banned from this VC.`)
            );
        }

        // ----------------------------------------------------
        // UNBAN
        // ----------------------------------------------------

        if (sub === 'unban') {
            data.banned.delete(target.id);
            data.rejected.delete(target.id);

            return reply(
                message,
                box('vc+', `${target} can join this VC again.`)
            );
        }

        // ----------------------------------------------------
        // REJECT
        // ----------------------------------------------------

        if (sub === 'reject') {
            data.rejected.add(target.id);

            if (target.voice.channelId === channel.id) {
                await target.voice.disconnect(
                    'vc+ VC reject'
                ).catch(() => {});
            }

            return reply(
                message,
                box('vc+', `${target} has been rejected from this VC.`)
            );
        }

        // ----------------------------------------------------
        // PERMIT
        // ----------------------------------------------------

        if (sub === 'permit') {
            data.rejected.delete(target.id);
            data.permitted.add(target.id);

            return reply(
                message,
                box('vc+', `${target} has been permitted.`)
            );
        }

        // ----------------------------------------------------
        // STFU
        // ----------------------------------------------------

        if (sub === 'stfu') {
            if (target.voice.channelId !== channel.id) {
                return reply(
                    message,
                    box('vc+', `${target} is not in your VC.`, 0xed4245)
                );
            }

            data.stfu.add(target.id);

            await target.voice.setMute(
                true,
                'vc+ STFU'
            ).catch(() => {});

            return reply(
                message,
                box('vc+', `${target} has been server muted.`)
            );
        }

        // ----------------------------------------------------
        // UNSTFU
        // ----------------------------------------------------

        if (sub === 'unstfu') {
            data.stfu.delete(target.id);

            if (target.voice.channelId === channel.id) {
                await target.voice.setMute(
                    false,
                    'vc+ STFU removed'
                ).catch(() => {});
            }

            return reply(
                message,
                box('vc+', `${target} can unmute normally again.`)
            );
        }

        // ----------------------------------------------------
        // TRANSFER
        // ----------------------------------------------------

        if (sub === 'transfer') {
            if (target.voice.channelId !== channel.id) {
                return reply(
                    message,
                    box(
                        'vc+',
                        `${target} must be inside your VC to receive ownership.`,
                        0xed4245
                    )
                );
            }

            data.ownerId = target.id;

            return reply(
                message,
                box(
                    'vc+',
                    `VC ownership transferred to ${target}.`
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
            box('vc+', 'Your VC is now locked.')
        );
    }

    // --------------------------------------------------------
    // UNLOCK
    // --------------------------------------------------------

    if (sub === 'unlock') {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: null
            }
        ).catch(() => {});

        return reply(
            message,
            box('vc+', 'Your VC is now unlocked.')
        );
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

        await channel.setUserLimit(limit).catch(() => {});

        return reply(
            message,
            box(
                'vc+',
                `VC limit set to **${limit === 0 ? 'Unlimited' : limit}**.`
            )
        );
    }

    // --------------------------------------------------------
    // RENAME
    // --------------------------------------------------------

    if (sub === 'rename') {
        const name = args.join(' ').trim();

        if (!name) {
            return reply(message, {
                embeds: [
                    helpBox(
                        'vc rename',
                        'Rename your VC.',
                        '-vc rename <name>',
                        '-vc rename Gaming VC'
                    )
                ]
            });
        }

        const newName = name.slice(0, 100);

        await channel.setName(newName).catch(() => {});

        return reply(
            message,
            box('vc+', `VC renamed to **${newName}**.`)
        );
    }

    // --------------------------------------------------------
    // CLAIM
    // --------------------------------------------------------

    if (sub === 'claim') {
        if (data.ownerId === message.author.id) {
            return reply(
                message,
                box('vc+', 'You already own this VC.', 0xed4245)
            );
        }

        if (
            channel.members.size === 1 &&
            isGod(message.member)
        ) {
            data.ownerId = message.author.id;

            return reply(
                message,
                box('vc+', 'You now own this VC.')
            );
        }

        return reply(
            message,
            box(
                'vc+',
                'Only the current owner or Founder/God can manage ownership.',
                0xed4245
            )
        );
    }

    return reply(message, { embeds: [vcHelp()] });
}

// ============================================================
// RANK COMMAND
// ============================================================

async function rankCommand(message, args) {
    if (!isFounder(message.member)) {
        return reply(message, {
            embeds: [
                helpBox(
                    'rank',
                    'Give a vc+ rank to a member.',
                    '-rank @user <rank>',
                    '-rank @user Admin',
                    'Only Founder/server owner.'
                )
            ]
        });
    }

    const target = await getTarget(message, args[0]);
    const rankName = args.slice(1).join(' ').toLowerCase();

    if (!target || !rankName) {
        return reply(message, {
            embeds: [
                helpBox(
                    'rank',
                    'Give a vc+ rank to a member.',
                    '-rank @user <rank>',
                    '-rank @user Admin',
                    RANKS.join('\n')
                )
            ]
        });
    }

    const rank = RANKS.find(
        r => r.toLowerCase() === rankName
    );

    if (!rank) {
        return reply(
            message,
            box(
                'vc+',
                `Invalid rank.\n\n${RANKS.join('\n')}`,
                0xed4245
            )
        );
    }

    // Never allow the bot to create a role above itself.
    try {
        const rankRoles = message.guild.roles.cache.filter(role =>
            RANKS.some(
                r => r.toLowerCase() === role.name.toLowerCase()
            )
        );

        if (rankRoles.size) {
            await target.roles.remove(rankRoles);
        }

        let role = message.guild.roles.cache.find(
            r => r.name.toLowerCase() === rank.toLowerCase()
        );

        if (!role) {
            role = await message.guild.roles.create({
                name: rank,
                reason: 'vc+ rank system'
            });
        }

        if (role.position >= message.guild.members.me.roles.highest.position) {
            return reply(
                message,
                box(
                    'vc+',
                    'My bot role must be above the rank roles.',
                    0xed4245
                )
            );
        }

        await target.roles.add(
            role,
            'vc+ rank assignment'
        );

        return reply(
            message,
            box(
                'vc+',
                `${target} is now **${rank}**.`
            )
        );
    } catch (error) {
        console.error('Rank error:', error);

        return reply(
            message,
            box(
                'vc+',
                'I could not assign that rank. Check my role permissions.',
                0xed4245
            )
        );
    }
}

// ============================================================
// VOUCH
// ============================================================

async function vouchCommand(message, args) {
    if (!isFounder(message.member)) {
        return reply(
            message,
            box(
                'vc+',
                'Only Founder can use the vouch command.',
                0xed4245
            )
        );
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(
            message,
            box(
                'vc+',
                'Usage: `-vouch @user`',
                0xed4245
            )
        );
    }

    const data = getGuildData(message.guild.id);

    const amount =
        (data.vouches.get(target.id) || 0) + 1;

    data.vouches.set(target.id, amount);

    // Create/use the second-highest role: God.
    let role = message.guild.roles.cache.find(
        r => r.name === 'God'
    );

    try {
        if (!role) {
            role = await message.guild.roles.create({
                name: 'God',
                reason: 'vc+ vouch system'
            });
        }

        if (
            role.position <
            message.guild.members.me.roles.highest.position
        ) {
            await target.roles.add(
                role,
                'vc+ Founder vouch'
            );
        }
    } catch (error) {
        console.error('Vouch role error:', error);
    }

    return reply(
        message,
        box(
            'vc+ • Vouch',
            `${target} received a vouch.\n\n**Vouches:** ${amount}\n**Role:** God`
        )
    );
}

// ============================================================
// BAN
// ============================================================

async function banCommand(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return reply(
            message,
            box(
                'vc+',
                'You need **Ban Members** permission.',
                0xed4245
            )
        );
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(
            message,
            box(
                'vc+',
                'Usage: `-ban @user [reason]`',
                0xed4245
            )
        );
    }

    if (!target.bannable) {
        return reply(
            message,
            box(
                'vc+',
                'I cannot ban that member because of role hierarchy.',
                0xed4245
            )
        );
    }

    const reason =
        args.slice(1).join(' ') || 'No reason provided';

    await target.ban({ reason }).catch(() => null);

    return reply(
        message,
        box(
            'vc+',
            `**${target.user.tag}** has been banned.\n\n**Reason:** ${reason}`
        )
    );
}

// ============================================================
// FOREVER BAN
// ============================================================

async function foreverBan(message, args) {
    if (!isGod(message.member)) {
        return reply(
            message,
            box(
                'vc+',
                'Only Founder and God can use `-foreverban`.',
                0xed4245
            )
        );
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(
            message,
            box(
                'vc+',
                'Usage: `-foreverban @user [reason]`',
                0xed4245
            )
        );
    }

    const data = getGuildData(message.guild.id);

    data.foreverBanned.add(target.id);

    const reason =
        args.slice(1).join(' ') ||
        'Forever banned by vc+';

    await target.ban({
        reason
    }).catch(() => {});

    return reply(
        message,
        box(
            'vc+ • Forever Ban',
            `**${target.user.tag}** is permanently banned from this guild while vc+ is active.\n\n` +
            `**Reason:** ${reason}`
        )
    );
}

// ============================================================
// FOREVER UNBAN
// ============================================================

async function foreverUnban(message, args) {
    if (!isGod(message.member)) {
        return reply(
            message,
            box(
                'vc+',
                'Only Founder and God can use this command.',
                0xed4245
            )
        );
    }

    const id = args[0];

    if (!id) {
        return reply(
            message,
            box(
                'vc+',
                'Usage: `-foreverunban <user ID>`',
                0xed4245
            )
        );
    }

    const data = getGuildData(message.guild.id);

    data.foreverBanned.delete(id);

    await message.guild.members.unban(
        id,
        'vc+ foreverban removed'
    ).catch(() => {});

    return reply(
        message,
        box(
            'vc+',
            `**${id}** has been removed from the forever-ban list.`
        )
    );
}

// ============================================================
// KICK
// ============================================================

async function kickCommand(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return reply(
            message,
            box(
                'vc+',
                'You need **Kick Members** permission.',
                0xed4245
            )
        );
    }

    const target = await getTarget(message, args[0]);

    if (!target || !target.kickable) {
        return reply(
            message,
            box(
                'vc+',
                'I cannot kick that member.',
                0xed4245
            )
        );
    }

    const reason =
        args.slice(1).join(' ') || 'No reason provided';

    await target.kick(reason).catch(() => {});

    return reply(
        message,
        box(
            'vc+',
            `**${target.user.tag}** has been kicked.\n\n**Reason:** ${reason}`
        )
    );
}

// ============================================================
// WARNING
// ============================================================

async function warningCommand(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return reply(
            message,
            box(
                'vc+',
                'You need moderation permission.',
                0xed4245
            )
        );
    }

    const target = await getTarget(message, args[0]);

    if (!target) {
        return reply(
            message,
            box(
                'vc+',
                'Usage: `-warning @user [reason]`',
                0xed4245
            )
        );
    }

    const data = getGuildData(message.guild.id);

    const count =
        (data.warnings.get(target.id) || 0) + 1;

    data.warnings.set(target.id, count);

    const reason =
        args.slice(1).join(' ') || 'No reason provided';

    return reply(
        message,
        box(
            'vc+ • Warning',
            `${target} received a warning.\n\n` +
            `**Warnings:** ${count}\n` +
            `**Reason:** ${reason}`
        )
    );
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on('messageCreate', async message => {
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

        // ----------------------------------------------------
        // HELP
        // ----------------------------------------------------

        if (command === 'help') {
            return reply(message, {
                embeds: [fullHelp()]
            });
        }

        // ----------------------------------------------------
        // PING
        // ----------------------------------------------------

        if (command === 'ping') {
            return reply(
                message,
                box(
                    'vc+',
                    `Pong!\n\n**Latency:** ${client.ws.ping}ms`
                )
            );
        }

        // ----------------------------------------------------
        // VC
        // ----------------------------------------------------

        if (command === 'vc') {
            return handleVC(message, args);
        }

        // ----------------------------------------------------
        // RANK
        // ----------------------------------------------------

        if (command === 'rank') {
            return rankCommand(message, args);
        }

        // ----------------------------------------------------
        // VOUCH
        // ----------------------------------------------------

        if (command === 'vouch') {
            return vouchCommand(message, args);
        }

        // ----------------------------------------------------
        // BAN
        // ----------------------------------------------------

        if (command === 'ban') {
            return banCommand(message, args);
        }

        // ----------------------------------------------------
        // FOREVER BAN
        // ----------------------------------------------------

        if (command === 'foreverban') {
            return foreverBan(message, args);
        }

        // ----------------------------------------------------
        // FOREVER UNBAN
        // ----------------------------------------------------

        if (command === 'foreverunban') {
            return foreverUnban(message, args);
        }

        // ----------------------------------------------------
        // KICK
        // ----------------------------------------------------

        if (command === 'kick') {
            return kickCommand(message, args);
        }

        // ----------------------------------------------------
        // WARNING
        // ----------------------------------------------------

        if (command === 'warning') {
            return warningCommand(message, args);
        }

        // ----------------------------------------------------
        // WARNINGS
        // ----------------------------------------------------

        if (command === 'warnings') {
            const target = await getTarget(message, args[0]);

            if (!target) {
                return reply(
                    message,
                    box(
                        'vc+',
                        'Usage: `-warnings @user`',
                        0xed4245
                    )
                );
            }

            const data = getGuildData(message.guild.id);
            const count = data.warnings.get(target.id) || 0;

            return reply(
                message,
                box(
                    'vc+ • Warnings',
                    `${target} has **${count}** warning(s).`
                )
            );
        }

        // ----------------------------------------------------
        // CLEAR WARNINGS
        // ----------------------------------------------------

        if (command === 'clearwarnings') {
            if (!message.member.permissions.has(
                PermissionFlagsBits.ModerateMembers
            )) {
                return reply(
                    message,
                    box(
                        'vc+',
                        'You need moderation permission.',
                        0xed4245
                    )
                );
            }

            const target = await getTarget(message, args[0]);

            if (!target) {
                return reply(
                    message,
                    box(
                        'vc+',
                        'Usage: `-clearwarnings @user`',
                        0xed4245
                    )
                );
            }

            const data = getGuildData(message.guild.id);

            data.warnings.delete(target.id);

            return reply(
                message,
                box(
                    'vc+',
                    `Warnings cleared for ${target}.`
                )
            );
        }

    } catch (error) {
        console.error('messageCreate error:', error);

        try {
            await message.reply({
                embeds: [
                    box(
                        'vc+ • Error',
                        'Something went wrong while processing that command.',
                        0xed4245
                    )
                ]
            });
        } catch {}
    }
});

// ============================================================
// VOICE SYSTEM
// ============================================================

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const guild = newState.guild;
        const data = getGuildData(guild.id);

        // ----------------------------------------------------
        // USER JOINS JOIN TO CREATE
        // ----------------------------------------------------

        if (
            newState.channelId &&
            newState.channelId === data.triggerId
        ) {
            const member = newState.member;

            if (!member) return;

            if (data.foreverBanned.has(member.id)) {
                await member.voice.disconnect(
                    'vc+ forever ban'
                ).catch(() => {});

                return;
            }

            await moveIntoVC(member);
            return;
        }

        // ----------------------------------------------------
        // USER ENTERS PERSONAL VC
        // ----------------------------------------------------

        if (newState.channelId) {
            const vc = data.vcs.get(newState.channelId);

            if (vc) {
                if (
                    vc.banned.has(newState.id) ||
                    vc.rejected.has(newState.id)
                ) {
                    await newState.member?.voice
                        .disconnect('vc+ VC restriction')
                        .catch(() => {});

                    return;
                }

                if (vc.stfu.has(newState.id)) {
                    await newState.member?.voice
                        .setMute(true, 'vc+ STFU')
                        .catch(() => {});
                }
            }
        }

        // ----------------------------------------------------
        // STFU PROTECTION
        // ----------------------------------------------------

        if (
            oldState.channelId &&
            newState.channelId === oldState.channelId
        ) {
            const vc = data.vcs.get(newState.channelId);

            if (
                vc &&
                vc.stfu.has(newState.id) &&
                !newState.serverMute
            ) {
                await newState.member?.voice
                    .setMute(true, 'vc+ STFU protection')
                    .catch(() => {});
            }
        }

        // ----------------------------------------------------
        // CLEAN EMPTY VCS
        // ----------------------------------------------------

        if (oldState.channelId) {
            const oldChannel = oldState.channel;

            if (!oldChannel) return;

            const oldVC = data.vcs.get(oldChannel.id);

            if (
                oldVC &&
                oldChannel.members.size === 0
            ) {
                data.vcs.delete(oldChannel.id);

                await oldChannel.delete(
                    'vc+ empty temporary VC'
                ).catch(() => {});
            }
        }

    } catch (error) {
        console.error('voiceStateUpdate error:', error);
    }
});

// ============================================================
// SECURITY
// ============================================================

client.on('guildMemberAdd', async member => {
    try {
        const data = getGuildData(member.guild.id);

        if (data.foreverBanned.has(member.id)) {
            await member.ban({
                reason: 'vc+ forever ban'
            }).catch(() => {});
        }
    } catch (error) {
        console.error('guildMemberAdd error:', error);
    }
});

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
                    name: 'vc+',
                    type: 0
                }
            ]
        });
    } catch (error) {
        console.error('Presence error:', error);
    }
});

// ============================================================
// GUILD JOIN
// ============================================================

client.on('guildCreate', guild => {
    console.log(`Joined: ${guild.name} (${guild.id})`);
});

// ============================================================
// GUILD LEAVE
// ============================================================

client.on('guildDelete', guild => {
    console.log(`Left: ${guild.name} (${guild.id})`);

    guildData.delete(guild.id);
});

// ============================================================
// DISCORD ERROR PROTECTION
// ============================================================

client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('shardError', error => {
    console.error('Discord shard error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

// ============================================================
// LOGIN
// ============================================================

async function start() {
    try {
        const token = process.env.DISCORD_TOKEN;

        if (!token) {
            console.error(
                'Missing DISCORD_TOKEN in .env'
            );
            process.exit(1);
        }

        console.log('Starting vc+...');

        await client.login(token);

    } catch (error) {
        console.error(
            'Login failed:',
            error
        );

        setTimeout(() => {
            process.exit(1);
        }, 2000);
    }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    console.log(`${signal} received.`);

    try {
        client.destroy();
    } catch (error) {
        console.error(error);
    }

    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
