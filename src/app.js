import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from "discord.js";
import "dotenv/config";

// ============================================================
// VC+
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

const PREFIX = "-";

// ============================================================
// RANKS
// These are EXISTING server roles.
// The bot does NOT create them.
// ============================================================

const RANKS = [
    "Founder",
    "God",
    "Owner",
    "Co-Owner",
    "Executive",
    "Director",
    "Admin",
    "Moderator",
    "Staff",
    "Member"
];

const vcData = new Map();
const guildData = new Map();

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, fields = []) {
    const e = new EmbedBuilder()
        .setTitle(`vc+ • ${title}`)
        .setDescription(description)
        .addFields(fields)
        .setTimestamp();

    return e;
}

function help(command, description, syntax, access = "Everyone") {
    return box("Help", "", [
        { name: "Command", value: `\`${command}\`` },
        { name: "Description", value: description },
        { name: "Syntax", value: `\`${syntax}\`` },
        { name: "Access", value: access }
    ]);
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(member) {
    if (!member) return null;

    for (const rank of RANKS) {
        if (
            member.roles.cache.some(
                r => r.name.toLowerCase() === rank.toLowerCase()
            )
        ) {
            return rank;
        }
    }

    return null;
}

function isFounder(member) {
    return (
        member.guild.ownerId === member.id ||
        getRank(member) === "Founder"
    );
}

function isGod(member) {
    return isFounder(member) || getRank(member) === "God";
}

function canModerate(member) {
    return (
        isGod(member) ||
        member.permissions.has(PermissionFlagsBits.BanMembers) ||
        member.permissions.has(PermissionFlagsBits.KickMembers)
    );
}

// ============================================================
// TARGET
// ============================================================

async function targetMember(message, input) {
    if (!input) return null;

    const mention = message.mentions.members.first();
    if (mention) return mention;

    const id = input.replace(/[<@!>]/g, "");

    if (!/^\d{17,20}$/.test(id)) return null;

    return message.guild.members.fetch(id).catch(() => null);
}

// ============================================================
// VC OWNER
// ============================================================

function getVC(member) {
    if (!member?.voice?.channelId) return null;
    return vcData.get(member.voice.channelId) || null;
}

function ownsVC(member) {
    const data = getVC(member);
    if (!data) return false;

    return (
        data.ownerId === member.id ||
        isFounder(member)
    );
}

// ============================================================
// RANK PROTECTION
// ============================================================

function protectedMember(member) {
    return isGod(member);
}

// ============================================================
// ERROR SAFE REPLY
// ============================================================

async function safeReply(message, payload) {
    try {
        return await message.reply(payload);
    } catch (err) {
        console.error("Reply error:", err.message);
    }
}

// ============================================================
// HELP
// ============================================================

function mainHelp() {
    return box(
        "Commands",
        [
            "**Moderation**",
            "`-ban @user`",
            "`-foreverban @user`",
            "`-unban <id>`",
            "`-kick @user`",
            "`-timeout @user <minutes>`",
            "`-untimeout @user`",
            "",
            "**Ranks**",
            "`-rank @user <rank>`",
            "`-ranks`",
            "`-vouch @user`",
            "`-vouch add @user`",
            "`-vouch remove @user`",
            "`-vouches @user`",
            "",
            "**Voice**",
            "`-vc setup`",
            "`-vc kick @user`",
            "`-vc ban @user`",
            "`-vc unban @user`",
            "`-vc reject @user`",
            "`-vc permit @user`",
            "`-vc lock`",
            "`-vc unlock`",
            "`-vc limit <number>`",
            "`-vc rename <name>`",
            "`-vc transfer @user`",
            "`-vc stfu @user`",
            "`-vc interface`",
            "`-interface`",
            "",
            "**Other**",
            "`-ping`",
            "`-help`"
        ].join("\n")
    );
}

// ============================================================
// READY
// ============================================================

client.once("ready", () => {
    console.log(`vc+ online as ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);

    client.user.setPresence({
        status: "online",
        activities: [
            {
                name: "-help | vc+",
                type: 0
            }
        ]
    });
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on("messageCreate", async message => {
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

        if (command === "help") {
            return safeReply(message, {
                embeds: [mainHelp()]
            });
        }

        // ====================================================
        // PING
        // ====================================================

        if (command === "ping") {
            return safeReply(
                message,
                `vc+ • Pong! ${client.ws.ping}ms`
            );
        }

        // ====================================================
        // RANKS
        // ====================================================

        if (command === "ranks") {
            return safeReply(message, {
                embeds: [
                    box(
                        "Rank List",
                        RANKS
                            .map((r, i) => `${i + 1}. **${r}**`)
                            .join("\n")
                    )
                ]
            });
        }

        // ====================================================
        // RANK
        // ====================================================

        if (command === "rank") {
            if (!message.guild.ownerId === message.author.id) {
                return safeReply(message, {
                    embeds: [
                        help(
                            "-rank",
                            "Assign an existing server rank.",
                            "-rank @user <rank>",
                            "Server Owner"
                        )
                    ]
                });
            }

            if (message.author.id !== message.guild.ownerId) {
                return safeReply(message, {
                    embeds: [
                        help(
                            "-rank",
                            "Assign an existing server rank.",
                            "-rank @user <rank>",
                            "Server Owner"
                        )
                    ]
                });
            }

            const target = await targetMember(
                message,
                args[0]
            );

            const rankName = args
                .slice(1)
                .join(" ")
                .toLowerCase();

            const rank = RANKS.find(
                r => r.toLowerCase() === rankName
            );

            if (!target || !rank) {
                return safeReply(message, {
                    embeds: [
                        help(
                            "-rank",
                            "Assign an existing server rank.",
                            "-rank @user <rank>",
                            "Server Owner"
                        )
                    ]
                });
            }

            const role = message.guild.roles.cache.find(
                r => r.name.toLowerCase() === rank.toLowerCase()
            );

            if (!role) {
                return safeReply(
                    message,
                    "vc+ • That rank role does not exist. Create it first."
                );
            }

            try {
                await target.roles.add(role);

                return safeReply(
                    message,
                    `vc+ • ${target} is now **${rank}**.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • I cannot manage that role. Put my bot role above it."
                );
            }
        }

        // ====================================================
        // VOUCH
        // ====================================================

        if (
            command === "vouch" ||
            command === "vouches"
        ) {
            const sub = args[0]?.toLowerCase();

            const guild = guildData.get(message.guild.id) || {
                vouches: new Map(),
                vouchLimit: 1
            };

            guildData.set(message.guild.id, guild);

            if (!isFounder(message.member)) {
                return safeReply(message, {
                    embeds: [
                        help(
                            "-vouch",
                            "Manage Founder vouches.",
                            "-vouch add @user",
                            "Founder only"
                        )
                    ]
                });
            }

            const target = await targetMember(
                message,
                sub === "add" ||
                sub === "remove"
                    ? args[1]
                    : args[0]
            );

            if (!target) {
                return safeReply(
                    message,
                    "vc+ • Mention a valid member."
                );
            }

            let count =
                guild.vouches.get(target.id) || 0;

            if (
                command === "vouches" ||
                !sub ||
                sub === "check"
            ) {
                return safeReply(
                    message,
                    `vc+ • ${target} has **${count}** vouch(es).`
                );
            }

            if (sub === "add") {
                count++;
                guild.vouches.set(
                    target.id,
                    count
                );

                return safeReply(
                    message,
                    `vc+ • Added a vouch to ${target}.\nVouches: **${count}**`
                );
            }

            if (sub === "remove") {
                count = Math.max(0, count - 1);

                guild.vouches.set(
                    target.id,
                    count
                );

                return safeReply(
                    message,
                    `vc+ • Removed a vouch from ${target}.\nVouches: **${count}**`
                );
            }

            return safeReply(message, {
                embeds: [
                    help(
                        "-vouch",
                        "Add or remove a Founder vouch.",
                        "-vouch add @user",
                        "Founder only"
                    )
                ]
            });
        }

        // ====================================================
        // BAN
        // ====================================================

        if (
            command === "ban" ||
            command === "foreverban"
        ) {
            if (
                command === "foreverban" &&
                !isGod(message.member)
            ) {
                return safeReply(message, {
                    embeds: [
                        help(
                            "-foreverban",
                            "Permanently ban a member from the guild.",
                            "-foreverban @user",
                            "Founder / God only"
                        )
                    ]
                });
            }

            if (
                command === "ban" &&
                !(
                    isGod(message.member) ||
                    message.member.permissions.has(
                        PermissionFlagsBits.BanMembers
                    )
                )
            ) {
                return safeReply(
                    message,
                    "vc+ • You do not have permission to ban members."
                );
            }

            const target = await targetMember(
                message,
                args[0]
            );

            if (!target) {
                return safeReply(
                    message,
                    `vc+ • Usage: \`-${command} @user\``
                );
            }

            if (protectedMember(target)) {
                return safeReply(
                    message,
                    "vc+ • You cannot ban a Founder or God."
                );
            }

            if (!target.bannable) {
                return safeReply(
                    message,
                    "vc+ • I cannot ban this member. Check role hierarchy."
                );
            }

            try {
                await target.ban({
                    reason:
                        command === "foreverban"
                            ? "vc+ forever ban"
                            : "vc+ ban"
                });

                return safeReply(
                    message,
                    `vc+ • **${target.user.tag}** has been ${command === "foreverban" ? "permanently banned" : "banned"}.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • Ban failed."
                );
            }
        }

        // ====================================================
        // UNBAN
        // ====================================================

        if (command === "unban") {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.BanMembers
                )
            ) {
                return safeReply(
                    message,
                    "vc+ • You need Ban Members permission."
                );
            }

            const id = args[0];

            if (!id) {
                return safeReply(
                    message,
                    "vc+ • Usage: `-unban <userID>`"
                );
            }

            try {
                await message.guild.members.unban(id);

                return safeReply(
                    message,
                    `vc+ • **${id}** has been unbanned.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • User could not be unbanned."
                );
            }
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === "kick") {
            if (
                !(
                    isGod(message.member) ||
                    message.member.permissions.has(
                        PermissionFlagsBits.KickMembers
                    )
                )
            ) {
                return safeReply(
                    message,
                    "vc+ • You do not have permission to kick members."
                );
            }

            const target = await targetMember(
                message,
                args[0]
            );

            if (!target) {
                return safeReply(
                    message,
                    "vc+ • Usage: `-kick @user`"
                );
            }

            if (protectedMember(target)) {
                return safeReply(
                    message,
                    "vc+ • You cannot kick a Founder or God."
                );
            }

            if (!target.kickable) {
                return safeReply(
                    message,
                    "vc+ • I cannot kick this member."
                );
            }

            try {
                await target.kick("vc+ kick");

                return safeReply(
                    message,
                    `vc+ • **${target.user.tag}** has been kicked.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • Kick failed."
                );
            }
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === "timeout") {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                return safeReply(
                    message,
                    "vc+ • You need Moderate Members permission."
                );
            }

            const target = await targetMember(
                message,
                args[0]
            );

            const minutes = Number(args[1]);

            if (
                !target ||
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return safeReply(
                    message,
                    "vc+ • Usage: `-timeout @user <minutes>`"
                );
            }

            if (protectedMember(target)) {
                return safeReply(
                    message,
                    "vc+ • You cannot timeout a Founder or God."
                );
            }

            try {
                await target.timeout(
                    Math.min(minutes, 40320) * 60000,
                    "vc+ timeout"
                );

                return safeReply(
                    message,
                    `vc+ • ${target} timed out for **${minutes} minutes**.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • Timeout failed."
                );
            }
        }

        // ====================================================
        // UNTIMEOUT
        // ====================================================

        if (command === "untimeout") {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                return safeReply(
                    message,
                    "vc+ • You need Moderate Members permission."
                );
            }

            const target = await targetMember(
                message,
                args[0]
            );

            if (!target) {
                return safeReply(
                    message,
                    "vc+ • Usage: `-untimeout @user`"
                );
            }

            try {
                await target.timeout(null);

                return safeReply(
                    message,
                    `vc+ • Timeout removed from ${target}.`
                );
            } catch {
                return safeReply(
                    message,
                    "vc+ • Failed to remove timeout."
                );
            }
        }

        // ====================================================
        // VC
        // ====================================================

        if (command === "vc") {
            const sub = args.shift()?.toLowerCase();

            // ==================================================
            // VC HELP
            // ==================================================

            if (!sub) {
                return safeReply(message, {
                    embeds: [
                        box(
                            "Voice Commands",
                            [
                                "`-vc setup`",
                                "`-vc kick @user`",
                                "`-vc ban @user`",
                                "`-vc unban @user`",
                                "`-vc reject @user`",
                                "`-vc permit @user`",
                                "`-vc lock`",
                                "`-vc unlock`",
                                "`-vc limit 10`",
                                "`-vc rename name`",
                                "`-vc transfer @user`",
                                "`-vc stfu @user`",
                                "`-vc interface`"
                            ].join("\n")
                        )
                    ]
                });
            }

            // ==================================================
            // VC SETUP
            // ==================================================

            if (sub === "setup") {
                if (
                    !(
                        isFounder(message.member) ||
                        message.member.permissions.has(
                            PermissionFlagsBits.ManageChannels
                        )
                    )
                ) {
                    return safeReply(
                        message,
                        "vc+ • You need Manage Channels permission."
                    );
                }

                try {
                    const existing = message.guild.channels.cache.find(
                        c =>
                            c.type === ChannelType.GuildVoice &&
                            c.name.toLowerCase() === "join to create"
                    );

                    if (existing) {
                        return safeReply(
                            message,
                            `vc+ • Join to Create already exists: ${existing}`
                        );
                    }

                    const category =
                        await message.guild.channels.create({
                            name: "Voice Channels",
                            type: ChannelType.GuildCategory
                        });

                    const trigger =
                        await message.guild.channels.create({
                            name: "Join to Create",
                            type: ChannelType.GuildVoice,
                            parent: category.id
                        });

                    guildData.set(
                        message.guild.id,
                        {
                            ...(guildData.get(message.guild.id) || {}),
                            triggerId: trigger.id
                        }
                    );

                    return safeReply(message, {
                        embeds: [
                            box(
                                "Setup Complete",
                                `Join **${trigger.name}** and vc+ will automatically create your personal VC and move you into it.`
                            )
                        ]
                    });
                } catch (err) {
                    console.error("VC setup:", err);

                    return safeReply(
                        message,
                        "vc+ • VC setup failed. Make sure the bot has **Manage Channels** and its role is high enough."
                    );
                }
            }

            // ==================================================
            // INTERFACE
            // ==================================================

            if (
                sub === "interface"
            ) {
                return sendVCInterface(message);
            }

            const channel =
                message.member.voice.channel;

            if (!channel) {
                return safeReply(message, {
                    embeds: [
                        help(
                            `-vc ${sub}`,
                            "Manage your personal voice channel.",
                            `-vc ${sub} <option>`,
                            "Join your VC first."
                        )
                    ]
                });
            }

            const data =
                vcData.get(channel.id);

            if (!data) {
                return safeReply(
                    message,
                    "vc+ • This is not a vc+ personal VC."
                );
            }

            if (!ownsVC(message.member)) {
                return safeReply(
                    message,
                    "vc+ • Only the VC owner or Founder can control this VC."
                );
            }

            // ==================================================
            // TARGET COMMANDS
            // ==================================================

            if (
                [
                    "kick",
                    "ban",
                    "unban",
                    "reject",
                    "permit",
                    "transfer"
                ].includes(sub)
            ) {
                const target =
                    await targetMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        `vc+ • Usage: \`-vc ${sub} @user\``
                    );
                }

                if (
                    protectedMember(target) &&
                    !isFounder(message.member)
                ) {
                    return safeReply(
                        message,
                        "vc+ • God/Founder members are protected."
                    );
                }

                // KICK
                if (sub === "kick") {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return safeReply(
                            message,
                            "vc+ • That member is not in your VC."
                        );
                    }

                    await target.voice.disconnect(
                        "vc+ VC kick"
                    ).catch(() => {});

                    return safeReply(
                        message,
                        `vc+ • ${target} was kicked from the VC.`
                    );
                }

                // BAN
                if (sub === "ban") {
                    data.banned.add(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            "vc+ VC ban"
                        ).catch(() => {});
                    }

                    return safeReply(
                        message,
                        `vc+ • ${target} was banned from this VC.`
                    );
                }

                // UNBAN
                if (sub === "unban") {
                    data.banned.delete(target.id);

                    return safeReply(
                        message,
                        `vc+ • ${target} can join this VC again.`
                    );
                }

                // REJECT
                if (sub === "reject") {
                    data.rejected.add(target.id);

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            "vc+ VC reject"
                        ).catch(() => {});
                    }

                    return safeReply(
                        message,
                        `vc+ • ${target} was rejected from this VC.`
                    );
                }

                // PERMIT
                if (sub === "permit") {
                    data.rejected.delete(target.id);
                    data.banned.delete(target.id);
                    data.permitted.add(target.id);

                    return safeReply(
                        message,
                        `vc+ • ${target} was permitted.`
                    );
                }

                // TRANSFER
                if (sub === "transfer") {
                    data.ownerId = target.id;

                    return safeReply(
                        message,
                        `vc+ • VC ownership transferred to ${target}.`
                    );
                }
            }

            // ==================================================
            // LOCK
            // ==================================================

            if (sub === "lock") {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    return safeReply(
                        message,
                        "vc+ • Your VC is now locked."
                    );
                } catch {
                    return safeReply(
                        message,
                        "vc+ • Failed to lock VC."
                    );
                }
            }

            // ==================================================
            // UNLOCK
            // ==================================================

            if (sub === "unlock") {
                try {
                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    return safeReply(
                        message,
                        "vc+ • Your VC is now unlocked."
                    );
                } catch {
                    return safeReply(
                        message,
                        "vc+ • Failed to unlock VC."
                    );
                }
            }

            // ==================================================
            // LIMIT
            // ==================================================

            if (sub === "limit") {
                const limit = Number(args[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return safeReply(
                        message,
                        "vc+ • Usage: `-vc limit 0-99`"
                    );
                }

                try {
                    await channel.setUserLimit(limit);

                    return safeReply(
                        message,
                        `vc+ • User limit set to **${limit}**.`
                    );
                } catch {
                    return safeReply(
                        message,
                        "vc+ • Failed to change limit."
                    );
                }
            }

            // ==================================================
            // RENAME
            // ==================================================

            if (sub === "rename") {
                const name =
                    args.join(" ").trim();

                if (!name) {
                    return safeReply(
                        message,
                        "vc+ • Usage: `-vc rename My VC`"
                    );
                }

                try {
                    await channel.setName(
                        name.slice(0, 100)
                    );

                    return safeReply(
                        message,
                        `vc+ • VC renamed to **${name.slice(0, 100)}**.`
                    );
                } catch {
                    return safeReply(
                        message,
                        "vc+ • Failed to rename VC."
                    );
                }
            }

            // ==================================================
            // STFU
            // ==================================================

            if (sub === "stfu") {
                const target =
                    await targetMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        "vc+ • Usage: `-vc stfu @user`"
                    );
                }

                if (
                    protectedMember(target)
                ) {
                    return safeReply(
                        message,
                        "vc+ • You cannot STFU a Founder or God."
                    );
                }

                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return safeReply(
                        message,
                        "vc+ • That member is not in your VC."
                    );
                }

                data.stfu.add(target.id);

                await target.voice.setMute(
                    true,
                    "vc+ STFU"
                ).catch(() => {});

                return safeReply(
                    message,
                    `vc+ • ${target} is now muted.`
                );
            }

            return safeReply(message, {
                embeds: [
                    help(
                        `-vc ${sub}`,
                        "Manage your personal VC.",
                        "-vc <command>",
                        "Owner / Founder"
                    )
                ]
            });
        }

        // ====================================================
        // INTERFACE SHORTCUT
        // ====================================================

        if (command === "interface") {
            return sendVCInterface(message);
        }

    } catch (error) {
        console.error(
            "messageCreate error:",
            error
        );

        await safeReply(
            message,
            "vc+ • Something went wrong while processing that command."
        );
    }
});

// ============================================================
// VC INTERFACE
// ============================================================

async function sendVCInterface(message) {
    const channel =
        message.member.voice.channel;

    if (!channel) {
        return safeReply(
            message,
            "vc+ • Join your VC first."
        );
    }

    const data =
        vcData.get(channel.id);

    if (!data) {
        return safeReply(
            message,
            "vc+ • This is not a vc+ personal VC."
        );
    }

    if (!ownsVC(message.member)) {
        return safeReply(
            message,
            "vc+ • Only the VC owner or Founder can use the interface."
        );
    }

    const row1 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_lock")
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unlock")
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("vc_interface_help")
                .setLabel("Commands")
                .setStyle(ButtonStyle.Primary)
        );

    return safeReply(message, {
        embeds: [
            box(
                "VC Interface",
                [
                    `**Owner:** <@${data.ownerId}>`,
                    `**Channel:** ${channel}`,
                    "",
                    "**Commands**",
                    "`-vc kick @user`",
                    "`-vc ban @user`",
                    "`-vc reject @user`",
                    "`-vc permit @user`",
                    "`-vc unban @user`",
                    "`-vc lock`",
                    "`-vc unlock`",
                    "`-vc limit 10`",
                    "`-vc rename name`",
                    "`-vc transfer @user`",
                    "`-vc stfu @user`"
                ].join("\n")
            )
        ],
        components: [row1]
    });
}

// ============================================================
// INTERFACE BUTTONS
// ============================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) return;

        const channel =
            interaction.member?.voice?.channel;

        if (!channel) {
            return interaction.reply({
                content: "vc+ • Join your VC first.",
                ephemeral: true
            });
        }

        const data =
            vcData.get(channel.id);

        if (!data) {
            return interaction.reply({
                content: "vc+ • This is not a vc+ VC.",
                ephemeral: true
            });
        }

        if (!ownsVC(interaction.member)) {
            return interaction.reply({
                content:
                    "vc+ • Only the VC owner or Founder can use this.",
                ephemeral: true
            });
        }

        if (interaction.customId === "vc_lock") {
            await channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    Connect: false
                }
            );

            return interaction.reply({
                content: "vc+ • VC locked.",
                ephemeral: true
            });
        }

        if (interaction.customId === "vc_unlock") {
            await channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    Connect: null
                }
            );

            return interaction.reply({
                content: "vc+ • VC unlocked.",
                ephemeral: true
            });
        }

        if (
            interaction.customId ===
            "vc_interface_help"
        ) {
            return interaction.reply({
                embeds: [
                    box(
                        "VC Commands",
                        [
                            "`-vc kick @user`",
                            "`-vc ban @user`",
                            "`-vc unban @user`",
                            "`-vc reject @user`",
                            "`-vc permit @user`",
                            "`-vc lock`",
                            "`-vc unlock`",
                            "`-vc limit 10`",
                            "`-vc rename name`",
                            "`-vc transfer @user`",
                            "`-vc stfu @user`"
                        ].join("\n")
                    )
                ],
                ephemeral: true
            });
        }
    } catch (error) {
        console.error(
            "interaction error:",
            error
        );
    }
});

// ============================================================
// JOIN TO CREATE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            if (!newState.guild) return;

            const guild =
                newState.guild;

            const config =
                guildData.get(guild.id);

            // ------------------------------------------------
            // CREATE VC
            // ------------------------------------------------

            if (
                config?.triggerId &&
                newState.channelId ===
                    config.triggerId
            ) {
                const member =
                    newState.member;

                if (!member) return;

                const name =
                    `${member.displayName} vc`
                        .slice(0, 100);

                const vc =
                    await guild.channels.create({
                        name,
                        type: ChannelType.GuildVoice,
                        parent:
                            newState.channel?.parentId ||
                            null,
                        userLimit: 0
                    });

                const data = {
                    ownerId: member.id,
                    banned: new Set(),
                    rejected: new Set(),
                    permitted: new Set(),
                    stfu: new Set()
                };

                vcData.set(
                    vc.id,
                    data
                );

                await member.voice.setChannel(
                    vc
                ).catch(() => {});

                // Interface message in VC chat
                try {
                    await vc.send({
                        embeds: [
                            box(
                                "VC Created",
                                [
                                    `**Owner:** ${member}`,
                                    "",
                                    "Use `-interface` to open your VC controls.",
                                    "",
                                    "**Quick Commands**",
                                    "`-vc kick @user`",
                                    "`-vc ban @user`",
                                    "`-vc reject @user`",
                                    "`-vc permit @user`",
                                    "`-vc lock`",
                                    "`-vc unlock`",
                                    "`-vc limit 10`",
                                    "`-vc rename name`",
                                    "`-vc stfu @user`"
                                ].join("\n")
                            )
                        ]
                    });
                } catch {
                    // Voice text chat may not be available.
                }

                return;
            }

            // ------------------------------------------------
            // VC SECURITY
            // ------------------------------------------------

            const data =
                newState.channelId
                    ? vcData.get(
                        newState.channelId
                    )
                    : null;

            if (data && newState.member) {
                const member =
                    newState.member;

                if (
                    data.banned.has(member.id) ||
                    data.rejected.has(member.id)
                ) {
                    await member.voice.disconnect(
                        "vc+ rejected/banned"
                    ).catch(() => {});

                    return;
                }

                // Auto unmute Founder/God
                if (
                    isGod(member) &&
                    member.voice.serverMute
                ) {
                    await member.voice.setMute(
                        false,
                        "vc+ rank protection"
                    ).catch(() => {});
                }

                // STFU protection
                if (
                    data.stfu.has(member.id) &&
                    !protectedMember(member)
                ) {
                    if (!member.voice.serverMute) {
                        await member.voice.setMute(
                            true,
                            "vc+ STFU protection"
                        ).catch(() => {});
                    }
                }
            }

            // ------------------------------------------------
            // EMPTY VC CLEANUP
            // ------------------------------------------------

            if (
                oldState.channelId &&
                vcData.has(oldState.channelId)
            ) {
                const oldChannel =
                    oldState.channel;

                if (
                    oldChannel &&
                    oldChannel.members.size === 0
                ) {
                    vcData.delete(
                        oldChannel.id
                    );

                    await oldChannel.delete(
                        "vc+ empty temporary VC"
                    ).catch(() => {});
                }
            }
        } catch (error) {
            console.error(
                "voiceStateUpdate error:",
                error
            );
        }
    }
);

// ============================================================
// GOD / FOUNDER AUTO UNMUTE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            if (!newState.member) return;

            const member =
                newState.member;

            if (!isGod(member)) return;

            if (
                newState.serverMute
            ) {
                await member.voice.setMute(
                    false,
                    "vc+ Founder/God protection"
                ).catch(() => {});
            }
        } catch (error) {
            console.error(
                "rank protection error:",
                error
            );
        }
    }
);

// ============================================================
// SAFETY
// ============================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught exception:",
            error
        );
    }
);

client.on(
    "error",
    error => {
        console.error(
            "Discord client error:",
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
        "Missing DISCORD_TOKEN in .env"
    );
    process.exit(1);
}

client.login(token).catch(error => {
    console.error(
        "Login failed:",
        error
    );
});
