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
// DATA
// ============================================================

// guildId -> setup information
const guildData = new Map();

// channelId -> temporary VC information
const vcData = new Map();

// ============================================================
// RANKS
// ============================================================

const RANKS = {
    founder: 'Founder',
    god: 'God',
    owner: 'Owner',
    coowner: 'Co-Owner',
    executive: 'Executive',
    director: 'Director',
    admin: 'Admin',
    moderator: 'Moderator',
    staff: 'Staff',
    member: 'Member'
};

// ============================================================
// EMBEDS
// ============================================================

function helpEmbed(command, description, syntax, example, access) {
    const embed = new EmbedBuilder()
        .setTitle(`${BOT_NAME} help`)
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

function error(message) {
    return `❌ ${message}`;
}

function success(message) {
    return `✅ ${message}`;
}

// ============================================================
// RANK CHECKING
// ============================================================

function hasRank(member, rankNames) {
    if (!member) return false;

    return member.roles.cache.some(role =>
        rankNames.includes(role.name.toLowerCase())
    );
}

function isFounder(member) {
    return hasRank(member, ['founder']);
}

function isGod(member) {
    return hasRank(member, ['founder', 'god']);
}

function isServerOwner(member) {
    return member?.guild?.ownerId === member?.id;
}

function isStaff(member) {
    return (
        isServerOwner(member) ||
        hasRank(member, [
            'founder',
            'god',
            'owner',
            'co-owner',
            'executive',
            'director',
            'admin',
            'moderator',
            'staff'
        ])
    );
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
// VC OWNER
// ============================================================

function getVC(channelId) {
    return vcData.get(channelId);
}

function ownsVC(member, channel) {
    const data = getVC(channel.id);

    if (!data) return false;

    return (
        data.ownerId === member.id ||
        isServerOwner(member) ||
        isGod(member)
    );
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member, triggerChannel) {
    const guild = member.guild;

    const setup = guildData.get(guild.id);

    if (!setup) return null;

    const existing = guild.channels.cache.find(
        channel =>
            channel.type === ChannelType.GuildVoice &&
            vcData.has(channel.id) &&
            vcData.get(channel.id).ownerId === member.id
    );

    if (existing) {
        return existing;
    }

    const name = `${member.displayName}'s VC`.slice(0, 100);

    const vc = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: setup.categoryId || null,
        userLimit: setup.userLimit || 0,
        bitrate: setup.bitrate || 64000,
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
                    PermissionFlagsBits.Stream,
                    PermissionFlagsBits.UseVAD
                ]
            }
        ]
    });

    vcData.set(vc.id, {
        ownerId: member.id,
        banned: new Set(),
        rejected: new Set(),
        muted: new Set()
    });

    return vc;
}

// ============================================================
// VC PERMISSION CHECK
// ============================================================

function canControlVC(member, channel) {
    return ownsVC(member, channel);
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

        // ====================================================
        // HELP
        // ====================================================

        if (command === 'help') {
            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`${BOT_NAME} help`)
                        .setDescription([
                            '**Moderation**',
                            '`-ban @user`',
                            '`-foreverban @user`',
                            '`-unban <id>`',
                            '`-kick @user`',
                            '`-timeout @user <minutes>`',
                            '`-untimeout @user`',
                            '',
                            '**Ranks**',
                            '`-rank @user <rank>`',
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
                            '',
                            '**Other**',
                            '`-ping`',
                            '`-help`'
                        ].join('\n'))
                ]
            });
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
        // ====================================================

        if (command === 'rank') {
            if (!isServerOwner(message.member)) {
                return message.reply({
                    embeds: [
                        helpEmbed(
                            'rank',
                            'Give a rank to a member.',
                            '-rank @user <rank>',
                            '-rank @user admin',
                            'Only the server owner can assign ranks.'
                        )
                    ]
                });
            }

            const target = message.mentions.members.first();
            const rank = args[1]?.toLowerCase();

            if (!target || !rank || !RANKS[rank]) {
                return message.reply({
                    embeds: [
                        helpEmbed(
                            'rank',
                            'Give a rank to a member.',
                            '-rank @user <rank>',
                            '-rank @user admin',
                            `Available ranks: ${Object.keys(RANKS).join(', ')}`
                        )
                    ]
                });
            }

            try {
                const rankNames = Object.values(RANKS);

                const oldRoles = target.roles.cache.filter(
                    role => rankNames.includes(role.name)
                );

                if (oldRoles.size) {
                    await target.roles.remove(oldRoles);
                }

                let role = message.guild.roles.cache.find(
                    r => r.name === RANKS[rank]
                );

                if (!role) {
                    role = await message.guild.roles.create({
                        name: RANKS[rank],
                        reason: `${BOT_NAME} rank system`
                    });
                }

                await target.roles.add(role);

                return message.reply(
                    success(`${target} is now **${role.name}**.`)
                );
            } catch {
                return message.reply(
                    error(
                        'I could not manage that role. Make sure my bot role is above the rank role.'
                    )
                );
            }
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === 'ban' || command === 'foreverban') {
            const forever = command === 'foreverban';

            if (forever) {
                if (!isGod(message.member)) {
                    return message.reply({
                        embeds: [
                            helpEmbed(
                                'foreverban',
                                'Permanently ban a member from the Discord server.',
                                '-foreverban @user',
                                '-foreverban @user',
                                'Founder and God only.'
                            )
                        ]
                    });
                }
            } else if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return message.reply(
                    error('You need **Ban Members** permission.')
                );
            }

            const target = await getTarget(
                message,
                args[0]
            );

            if (!target) {
                return message.reply(
                    error('Please mention a member.')
                );
            }

            if (target.id === message.author.id) {
                return message.reply(
                    error('You cannot ban yourself.')
                );
            }

            if (!target.bannable) {
                return message.reply(
                    error('I cannot ban that member. Check role hierarchy.')
                );
            }

            try {
                await target.ban({
                    reason: forever
                        ? `${BOT_NAME} foreverban`
                        : 'Server ban'
                });

                return message.reply(
                    success(
                        `**${target.user.tag}** has been permanently banned from this Discord server.`
                    )
                );
            } catch {
                return message.reply(
                    error('Failed to ban that member.')
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
                    error('You need **Ban Members** permission.')
                );
            }

            const id = args[0];

            if (!id) {
                return message.reply({
                    embeds: [
                        helpEmbed(
                            'unban',
                            'Remove a server ban.',
                            '-unban <user ID>',
                            '-unban 123456789'
                        )
                    ]
                });
            }

            try {
                await message.guild.members.unban(id);

                return message.reply(
                    success(`User **${id}** has been unbanned.`)
                );
            } catch {
                return message.reply(
                    error('That user is not banned or the ID is invalid.')
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
                    error('You need **Kick Members** permission.')
                );
            }

            const target = await getTarget(
                message,
                args[0]
            );

            if (!target) {
                return message.reply(
                    error('Please mention a member.')
                );
            }

            if (!target.kickable) {
                return message.reply(
                    error('I cannot kick that member.')
                );
            }

            try {
                await target.kick('Server kick');

                return message.reply(
                    success(`**${target.user.tag}** has been kicked.`)
                );
            } catch {
                return message.reply(
                    error('Failed to kick the member.')
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
                    error('You need **Moderate Members** permission.')
                );
            }

            const target = await getTarget(
                message,
                args[0]
            );

            const minutes = Number(args[1]);

            if (
                !target ||
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return message.reply(
                    error('Usage: `-timeout @user <minutes>`')
                );
            }

            try {
                await target.timeout(
                    Math.min(minutes, 40320) * 60000,
                    'Server timeout'
                );

                return message.reply(
                    success(
                        `**${target.user.tag}** has been timed out for **${minutes} minutes**.`
                    )
                );
            } catch {
                return message.reply(
                    error('Failed to timeout that member.')
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
                    error('You need **Moderate Members** permission.')
                );
            }

            const target = await getTarget(
                message,
                args[0]
            );

            if (!target) {
                return message.reply(
                    error('Please mention a member.')
                );
            }

            try {
                await target.timeout(
                    null,
                    'Timeout removed'
                );

                return message.reply(
                    success(`Timeout removed from ${target}.`)
                );
            } catch {
                return message.reply(
                    error('Failed to remove timeout.')
                );
            }
        }

        // ====================================================
        // VC
        // ====================================================

        if (command === 'vc') {
            const sub = args.shift()?.toLowerCase();

            // ------------------------------------------------
            // VC HELP
            // ------------------------------------------------

            if (!sub || sub === 'help') {
                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`${BOT_NAME} VC help`)
                            .setDescription([
                                '`-vc setup` — Create Join to Create',
                                '`-vc kick @user` — Remove from your VC',
                                '`-vc ban @user` — Ban from your VC',
                                '`-vc unban @user` — Remove VC ban',
                                '`-vc reject @user` — Reject from VC',
                                '`-vc permit @user` — Permit user',
                                '`-vc lock` — Lock your VC',
                                '`-vc unlock` — Unlock your VC',
                                '`-vc limit <number>` — Set VC limit',
                                '`-vc rename <name>` — Rename VC',
                                '`-vc transfer @user` — Transfer VC',
                                '`-vc stfu @user` — Server mute',
                                '`-vc unstfu @user` — Remove VC mute'
                            ].join('\n'))
                    ]
                });
            }

            // ------------------------------------------------
            // SETUP
            // ------------------------------------------------

            if (sub === 'setup') {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ManageChannels
                    )
                ) {
                    return message.reply(
                        error('You need **Manage Channels** permission.')
                    );
                }

                if (guildData.has(message.guild.id)) {
                    return message.reply(
                        error('VC+ is already set up in this server.')
                    );
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
                            permissionOverwrites: [
                                {
                                    id: message.guild.roles.everyone.id,
                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.Connect
                                    ]
                                }
                            ]
                        });

                    guildData.set(message.guild.id, {
                        categoryId: category.id,
                        triggerId: trigger.id,
                        userLimit: 0,
                        bitrate: 64000
                    });

                    return message.reply(
                        success(
                            `VC+ is ready.\n\nJoin **${trigger.name}** and I'll automatically create and move you into your own VC.`
                        )
                    );
                } catch (err) {
                    console.error('VC setup error:', err);

                    return message.reply(
                        error(
                            'VC setup failed. Make sure I have **Manage Channels**, **Move Members**, and **Manage Roles** permissions.'
                        )
                    );
                }
            }

            // ------------------------------------------------
            // USER MUST BE IN VC
            // ------------------------------------------------

            const channel = message.member.voice.channel;

            if (!channel) {
                return message.reply(
                    error('You must be inside your VC.')
                );
            }

            const data = getVC(channel.id);

            if (!data) {
                return message.reply(
                    error('This is not a vc+ personal VC.')
                );
            }

            // ------------------------------------------------
            // OWNER / GOD / SERVER OWNER
            // ------------------------------------------------

            if (!canControlVC(message.member, channel)) {
                return message.reply(
                    error(
                        'Only the owner of this VC, Server Owner, Founder, or God can control this VC.'
                    )
                );
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
                    'transfer',
                    'stfu',
                    'unstfu'
                ].includes(sub)
            ) {
                const target = await getTarget(
                    message,
                    args[0]
                );

                if (!target) {
                    return message.reply(
                        error(`Usage: \`-vc ${sub} @user\``)
                    );
                }

                // ==========================================
                // VC KICK
                // ==========================================

                if (sub === 'kick') {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return message.reply(
                            error('That user is not in your VC.')
                        );
                    }

                    await target.voice.disconnect(
                        'VC owner kick'
                    ).catch(() => {});

                    return message.reply(
                        success(`${target} was kicked from your VC.`)
                    );
                }

                // ==========================================
                // VC BAN
                // ==========================================

                if (sub === 'ban') {
                    data.banned.add(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            'VC ban'
                        ).catch(() => {});
                    }

                    return message.reply(
                        success(`${target} is banned from your VC.`)
                    );
                }

                // ==========================================
                // VC UNBAN
                // ==========================================

                if (sub === 'unban') {
                    data.banned.delete(target.id);

                    return message.reply(
                        success(`${target} is unbanned from your VC.`)
                    );
                }

                // ==========================================
                // VC REJECT
                // ==========================================

                if (sub === 'reject') {
                    data.rejected.add(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            'VC reject'
                        ).catch(() => {});
                    }

                    return message.reply(
                        success(`${target} was rejected from your VC.`)
                    );
                }

                // ==========================================
                // VC PERMIT
                // ==========================================

                if (sub === 'permit') {
                    data.rejected.delete(target.id);
                    data.banned.delete(target.id);

                    return message.reply(
                        success(`${target} can now join your VC.`)
                    );
                }

                // ==========================================
                // TRANSFER
                // ==========================================

                if (sub === 'transfer') {
                    data.ownerId = target.id;

                    return message.reply(
                        success(`VC ownership transferred to ${target}.`)
                    );
                }

                // ==========================================
                // STFU
                // ==========================================

                if (sub === 'stfu') {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return message.reply(
                            error('That user is not in your VC.')
                        );
                    }

                    data.muted.add(target.id);

                    await target.voice.setMute(
                        true,
                        'vc+ stfu'
                    ).catch(() => {});

                    return message.reply(
                        success(`${target} is now server-muted.`)
                    );
                }

                // ==========================================
                // UNSTFU
                // ==========================================

                if (sub === 'unstfu') {
                    data.muted.delete(target.id);

                    await target.voice.setMute(
                        false,
                        'vc+ unstfu'
                    ).catch(() => {});

                    return message.reply(
                        success(`${target} can speak again.`)
                    );
                }
            }

            // ------------------------------------------------
            // LOCK
            // ------------------------------------------------

            if (sub === 'lock') {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    );

                    return message.reply(
                        success('Your VC is now locked.')
                    );
                } catch {
                    return message.reply(
                        error('I could not lock your VC.')
                    );
                }
            }

            // ------------------------------------------------
            // UNLOCK
            // ------------------------------------------------

            if (sub === 'unlock') {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    );

                    return message.reply(
                        success('Your VC is now unlocked.')
                    );
                } catch {
                    return message.reply(
                        error('I could not unlock your VC.')
                    );
                }
            }

            // ------------------------------------------------
            // LIMIT
            // ------------------------------------------------

            if (sub === 'limit') {
                const limit = Number(args[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return message.reply(
                        error('Usage: `-vc limit 0-99`')
                    );
                }

                try {
                    await channel.setUserLimit(limit);

                    return message.reply(
                        success(`VC limit set to **${limit}**.`)
                    );
                } catch {
                    return message.reply(
                        error('I could not change the VC limit.')
                    );
                }
            }

            // ------------------------------------------------
            // RENAME
            // ------------------------------------------------

            if (sub === 'rename') {
                const name = args.join(' ').trim();

                if (!name) {
                    return message.reply(
                        error('Usage: `-vc rename <name>`')
                    );
                }

                try {
                    await channel.setName(
                        name.slice(0, 100)
                    );

                    return message.reply(
                        success(
                            `VC renamed to **${name.slice(0, 100)}**.`
                        )
                    );
                } catch {
                    return message.reply(
                        error('I could not rename your VC.')
                    );
                }
            }

            return message.reply({
                embeds: [
                    helpEmbed(
                        `vc ${sub}`,
                        'Manage your personal vc+ voice channel.',
                        `-vc ${sub} @user`,
                        `-vc ${sub} @user`
                    )
                ]
            });
        }

        // ====================================================
        // UNKNOWN COMMAND
        // ====================================================

        return message.reply({
            embeds: [
                helpEmbed(
                    command,
                    'Unknown command.',
                    '-help',
                    '-help'
                )
            ]
        });

    } catch (err) {
        // NEVER let one command crash the bot
        console.error(
            `${BOT_NAME} command error:`,
            err
        );

        try {
            await message.reply(
                error('Something went wrong while running that command.')
            );
        } catch {
            // Ignore failed error replies
        }
    }
});

// ============================================================
// VOICE SYSTEM
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const guild = newState.guild;

            if (!guild) return;

            // ================================================
            // NEW VC JOIN
            // ================================================

            if (newState.channelId) {
                const setup = guildData.get(guild.id);

                // User joined Join to Create
                if (
                    setup &&
                    newState.channelId === setup.triggerId
                ) {
                    const member = newState.member;

                    if (!member) return;

                    // Create VC
                    const vc =
                        await createPersonalVC(
                            member,
                            newState.channel
                        );

                    if (!vc) return;

                    // Move user instantly
                    await member.voice.setChannel(
                        vc,
                        'vc+ Join to Create'
                    ).catch(err => {
                        console.error(
                            'VC move error:',
                            err
                        );
                    });

                    return;
                }

                // ============================================
                // CHECK VC BANS / REJECTS
                // ============================================

                const data =
                    vcData.get(newState.channelId);

                if (data && newState.member) {
                    const id = newState.member.id;

                    if (
                        data.banned.has(id) ||
                        data.rejected.has(id)
                    ) {
                        await newState.member.voice
                            .disconnect(
                                'vc+ VC restriction'
                            )
                            .catch(() => {});

                        return;
                    }

                    // ========================================
                    // STFU PROTECTION
                    // ========================================

                    if (data.muted.has(id)) {
                        await newState.member.voice
                            .setMute(
                                true,
                                'vc+ stfu protection'
                            )
                            .catch(() => {});
                    }
                }
            }

            // ================================================
            // STFU PROTECTION
            // ================================================

            if (
                newState.channelId &&
                newState.serverMute === false
            ) {
                const data =
                    vcData.get(newState.channelId);

                if (
                    data &&
                    data.muted.has(newState.id)
                ) {
                    await newState.member?.voice
                        .setMute(
                            true,
                            'vc+ stfu protection'
                        )
                        .catch(() => {});
                }
            }

            // ================================================
            // DELETE EMPTY PERSONAL VC
            // ================================================

            if (oldState.channelId) {
                const oldChannel =
                    oldState.channel;

                if (!oldChannel) return;

                const data =
                    vcData.get(oldChannel.id);

                if (!data) return;

                if (oldChannel.members.size === 0) {
                    vcData.delete(oldChannel.id);

                    await oldChannel.delete(
                        'vc+ temporary VC empty'
                    ).catch(() => {});
                }
            }

        } catch (err) {
            // Voice errors should NEVER crash the bot
            console.error(
                `${BOT_NAME} voice error:`,
                err
            );
        }
    }
);

// ============================================================
// DISCONNECT CLEANUP
// ============================================================

client.on('voiceStateUpdate', async oldState => {
    try {
        if (!oldState.channelId) return;

        const channel = oldState.channel;

        if (!channel) return;

        const data = vcData.get(channel.id);

        if (!data) return;

        if (channel.members.size === 0) {
            vcData.delete(channel.id);

            await channel.delete(
                'vc+ empty temporary channel'
            ).catch(() => {});
        }
    } catch (err) {
        console.error(
            'VC cleanup error:',
            err
        );
    }
});

// ============================================================
// READY
// ============================================================

client.once('ready', () => {
    console.log('=================================');
    console.log(`${BOT_NAME} is online`);
    console.log(`Bot: ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log('=================================');

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
    } catch (err) {
        console.error(
            'Presence error:',
            err
        );
    }
});

// ============================================================
// GUILD EVENTS
// ============================================================

client.on('guildCreate', guild => {
    console.log(
        `${BOT_NAME} joined ${guild.name}`
    );
});

client.on('guildDelete', guild => {
    guildData.delete(guild.id);

    for (const [channelId, data] of vcData) {
        const channel =
            guild.channels.cache.get(channelId);

        if (channel) {
            vcData.delete(channelId);
        }
    }

    console.log(
        `${BOT_NAME} left ${guild.name}`
    );
});

// ============================================================
// ERROR PROTECTION
// ============================================================

client.on('error', err => {
    console.error(
        `${BOT_NAME} client error:`,
        err
    );
});

client.on('warn', warning => {
    console.warn(
        `${BOT_NAME} warning:`,
        warning
    );
});

client.on('shardError', err => {
    console.error(
        `${BOT_NAME} shard error:`,
        err
    );
});

process.on(
    'unhandledRejection',
    err => {
        console.error(
            `${BOT_NAME} unhandled rejection:`,
            err
        );
    }
);

process.on(
    'uncaughtException',
    err => {
        console.error(
            `${BOT_NAME} uncaught exception:`,
            err
        );
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

        console.log(
            `Starting ${BOT_NAME}...`
        );

        await client.login(token);

    } catch (err) {
        console.error(
            `${BOT_NAME} failed to start:`,
            err
        );

        setTimeout(
            () => process.exit(1),
            2000
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
    } catch (err) {
        console.error(err);
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

start();
