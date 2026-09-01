import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ======================================================
// CONFIG
// ======================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ guilds: {} }, null, 2)
    );
}

let db;

try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
    db = { guilds: {} };
}

// ======================================================
// CLIENT
// ======================================================

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

// ======================================================
// DATABASE
// ======================================================

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (err) {
        console.error("DATABASE SAVE ERROR:", err);
    }
}

function defaultGuildData() {
    return {
        ranks: {},
        foreverBanned: [],
        godmode: [],
        vouches: [],
        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },
        roles: {
            vouch: null
        },
        protection: {
            enabled: true,
            channelCreate: true,
            channelDelete: true,
            roleCreate: true,
            roleDelete: true,
            webhookCreate: true
        },
        filters: {
            enabled: false,
            words: [],
            strikes: {},
            logChannelId: null,
            maxStrikes: 3,
            timeoutMinutes: 10,
            warningDeleteMs: 5000
        }
    };
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaultGuildData();
        saveDB();
    }

    const data = db.guilds[guildId];

    data.ranks ??= {};
    data.foreverBanned ??= [];
    data.godmode ??= [];
    data.vouches ??= [];
    data.jtc ??= {};
    data.roles ??= {};
    data.protection ??= {};
    data.filters ??= {};

    return data;
}

// ======================================================
// RANK SYSTEM
// ======================================================

const RANKS = {
    member: 1,
    staff: 2,
    moderator: 3,
    admin: 4,
    director: 5,
    executive: 6,
    coowner: 7,
    owner: 8,
    god: 9,
    founder: 10
};

function normalizeRank(rank) {
    if (!rank) return null;

    return String(rank)
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRank(member) {
    if (!member?.guild) return "member";

    if (member.id === member.guild.ownerId) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);
    const rank = normalizeRank(data.ranks[member.id]);

    return rank && RANKS[rank]
        ? rank
        : "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] ?? 1;
}

function isFounder(member) {
    return (
        member?.guild?.ownerId === member?.id ||
        getRank(member) === "founder"
    );
}

function isGod(member) {
    if (!member) return false;

    const data = getGuildData(member.guild.id);

    return (
        isFounder(member) ||
        getRank(member) === "god" ||
        data.godmode.includes(member.id)
    );
}

function isTrustedExecutor(member) {
    return isGod(member);
}

function canModerate(actor, target) {
    if (!actor || !target) return false;

    if (actor.id === target.id) return false;

    if (isFounder(actor)) return true;

    if (isFounder(target)) return false;

    return getRankLevel(actor) > getRankLevel(target);
}

// ======================================================
// EMBEDS
// ======================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

// ======================================================
// MODERATION DM
// ======================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided.",
    duration = null
) {
    if (!user) return false;

    try {
        const embed = new EmbedBuilder()
            .setTitle(`You were ${action}`)
            .setDescription(
                `You have been **${action}** in **${guild.name}**.`
            )
            .addFields({
                name: "Reason",
                value: String(reason).slice(0, 1024)
            })
            .setTimestamp();

        if (duration) {
            embed.addFields({
                name: "Duration",
                value: String(duration)
            });
        }

        await user.send({
            embeds: [embed]
        });

        return true;
    } catch {
        return false;
    }
}

// ======================================================
// AUTOMOD
// ======================================================

async function handleFilteredMessage(message) {
    if (!message.guild || message.author.bot) {
        return false;
    }

    const data = getGuildData(message.guild.id);
    const filter = data.filters;

    if (!filter.enabled || !filter.words.length) {
        return false;
    }

    const content = message.content.toLowerCase();

    const matchedWord = filter.words.find(word =>
        content.includes(String(word).toLowerCase())
    );

    if (!matchedWord) {
        return false;
    }

    try {
        await message.delete();
    } catch {}

    filter.strikes[message.author.id] =
        (filter.strikes[message.author.id] || 0) + 1;

    const strikes = filter.strikes[message.author.id];

    if (strikes >= filter.maxStrikes) {
        try {
            await message.member.timeout(
                filter.timeoutMinutes * 60 * 1000,
                "AutoMod maximum strikes reached"
            );

            await sendModerationDM(
                message.author,
                message.guild,
                "timed out",
                "AutoMod maximum strikes reached.",
                `${filter.timeoutMinutes} minutes`
            );
        } catch {}
    }

    const logChannel = filter.logChannelId
        ? message.guild.channels.cache.get(filter.logChannelId)
        : null;

    if (logChannel?.isTextBased()) {
        await logChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🛡️ AutoMod")
                    .setDescription(
                        `Filtered message from ${message.author}.`
                    )
                    .addFields(
                        {
                            name: "Matched",
                            value: `\`${String(matchedWord).slice(0, 100)}\``
                        },
                        {
                            name: "Strikes",
                            value: `${strikes}`
                        }
                    )
                    .setTimestamp()
            ]
        }).catch(() => {});
    }

    saveDB();

    return true;
}

// ======================================================
// VC SYSTEM
// ======================================================

const tempVCs = new Map();

function createVCData(guildId, ownerId) {
    return {
        guildId,
        ownerId,
        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        stfu: new Set(),
        locked: false,
        interfaceMessageId: null,
        interfaceChannelId: null
    };
}

function getVCData(channelId) {
    return tempVCs.get(channelId);
}

async function applyVCBan(channel, userId) {
    await channel.permissionOverwrites.edit(
        userId,
        {
            Connect: false
        }
    ).catch(() => {});
}

async function removeVCBan(channel, userId) {
    await channel.permissionOverwrites.delete(
        userId
    ).catch(() => {});
}

// ======================================================
// VC BUTTONS
// ======================================================

function vcButton(
    id,
    label,
    style = ButtonStyle.Secondary
) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style);
}

function buildVCInterface() {
    const row1 = new ActionRowBuilder().addComponents(
        vcButton("vc_kick", "Kick", ButtonStyle.Danger),
        vcButton("vc_disconnect", "Disconnect"),
        vcButton("vc_ban", "Ban", ButtonStyle.Danger),
        vcButton("vc_reject", "Reject", ButtonStyle.Danger),
        vcButton("vc_permit", "Permit", ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
        vcButton("vc_stfu", "STFU", ButtonStyle.Danger),
        vcButton("vc_unstfu", "UNSTFU", ButtonStyle.Success),
        vcButton("vc_lock", "Lock", ButtonStyle.Danger),
        vcButton("vc_unlock", "Unlock", ButtonStyle.Success),
        vcButton("vc_claim", "Claim", ButtonStyle.Primary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        vcButton("vc_transfer", "Transfer", ButtonStyle.Primary),
        vcButton("vc_forceclaim", "Force Claim", ButtonStyle.Danger),
        vcButton("vc_rename", "Rename"),
        vcButton("vc_limit", "Limit"),
        vcButton("vc_refresh", "Refresh")
    );

    return [row1, row2, row3];
}

// ======================================================
// VC CONTROL CHANNEL
// ======================================================

async function updateVCInterface(channel) {
    const vcData = getVCData(channel.id);

    if (!vcData) return;

    const guild = channel.guild;

    let controlChannel = null;

    if (vcData.interfaceChannelId) {
        controlChannel =
            guild.channels.cache.get(
                vcData.interfaceChannelId
            );
    }

    if (!controlChannel) {
        controlChannel = await guild.channels.create({
            name: `vc-control-${channel.id.slice(-4)}`,
            type: ChannelType.GuildText,
            parent: channel.parentId ?? null,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.ReadMessageHistory
                    ],
                    deny: [
                        PermissionFlagsBits.SendMessages
                    ]
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        }).catch(() => null);

        if (!controlChannel) return;

        vcData.interfaceChannelId = controlChannel.id;
    }

    const embed = new EmbedBuilder()
        .setTitle("🎙️ VC CONTROL")
        .setDescription(
            [
                `**Owner:** <@${vcData.ownerId}>`,
                `**Voice Channel:** ${channel}`,
                `**Status:** ${vcData.locked ? "🔒 Locked" : "🔓 Unlocked"}`,
                "",
                "Use the buttons below to control the VC.",
                "",
                "**Member Controls**",
                "Kick • Disconnect • Ban • Reject • Permit",
                "",
                "**VC Controls**",
                "Lock • Unlock • Claim • Transfer",
                "",
                "**Other**",
                "STFU • UNSTFU • Rename • Limit"
            ].join("\n")
        )
        .setTimestamp();

    let message;

    if (vcData.interfaceMessageId) {
        message = await controlChannel.messages
            .fetch(vcData.interfaceMessageId)
            .catch(() => null);
    }

    if (message) {
        await message.edit({
            embeds: [embed],
            components: buildVCInterface()
        }).catch(() => {});
    } else {
        const sent = await controlChannel.send({
            embeds: [embed],
            components: buildVCInterface()
        }).catch(() => null);

        if (sent) {
            vcData.interfaceMessageId = sent.id;
        }
    }

    saveDB();
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const data = getGuildData(member.guild.id);

    if (!data.jtc.enabled || !data.jtc.channelId) {
        return null;
    }

    const jtcChannel =
        member.guild.channels.cache.get(
            data.jtc.channelId
        );

    if (!jtcChannel) return null;

    const category =
        data.jtc.categoryId
            ? member.guild.channels.cache.get(
                data.jtc.categoryId
            )
            : jtcChannel.parent;

    const channel = await member.guild.channels.create({
        name: `${member.user.username}'s VC`,
        type: ChannelType.GuildVoice,
        parent: category?.id ?? null,
        permissionOverwrites: [
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers
                ]
            }
        ]
    }).catch(() => null);

    if (!channel) return null;

    const vcData = createVCData(
        member.guild.id,
        member.id
    );

    tempVCs.set(channel.id, vcData);

    await member.voice.setChannel(channel).catch(() => {});

    await updateVCInterface(channel);

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    const vcData = getVCData(channel.id);

    if (!vcData) return;

    if (channel.members.size > 0) {
        return;
    }

    if (vcData.interfaceChannelId) {
        const interfaceChannel =
            channel.guild.channels.cache.get(
                vcData.interfaceChannelId
            );

        if (interfaceChannel) {
            await interfaceChannel.delete().catch(() => {});
        }
    }

    tempVCs.delete(channel.id);

    await channel.delete().catch(() => {});
}

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setTitle(`📖 ${BOT_NAME} Commands`)
        .setDescription(
            [
                "**General**",
                `\`${PREFIX}help\``,
                "",
                "**Moderation**",
                `\`${PREFIX}ban @user [reason]\``,
                `\`${PREFIX}unban <user ID>\``,
                `\`${PREFIX}banlist\``,
                `\`${PREFIX}kick @user [reason]\``,
                `\`${PREFIX}timeout @user <minutes> [reason]\``,
                `\`${PREFIX}untimeout @user\``,
                `\`${PREFIX}foreverban @user [reason]\``,
                `\`${PREFIX}purge <amount>\``,
                "",
                "**Ranks**",
                `\`${PREFIX}rank @user <rank>\``,
                `\`${PREFIX}godmode @user\``,
                "",
                "**VC**",
                `\`${PREFIX}vc setup\``,
                `\`${PREFIX}vc kick @user\``,
                `\`${PREFIX}vc disconnect @user\``,
                `\`${PREFIX}vc ban @user\``,
                `\`${PREFIX}vc reject @user\``,
                `\`${PREFIX}vc permit @user\``,
                `\`${PREFIX}vc lock\``,
                `\`${PREFIX}vc unlock\``,
                `\`${PREFIX}vc limit <number>\``,
                `\`${PREFIX}vc rename <name>\``,
                `\`${PREFIX}vc transfer @user\``,
                `\`${PREFIX}vc claim\``,
                `\`${PREFIX}vc forceclaim\``,
                `\`${PREFIX}vc stfu @user\``,
                `\`${PREFIX}vc unstfu @user\``,
                "",
                "**AutoMod**",
                `\`${PREFIX}filter on/off\``,
                `\`${PREFIX}filter add <word>\``,
                `\`${PREFIX}filter remove <word>\``,
                `\`${PREFIX}filter list\``,
                `\`${PREFIX}filter log #channel\``,
                `\`${PREFIX}filter strikes @user\``,
                `\`${PREFIX}filter reset @user\``
            ].join("\n")
        )
        .setTimestamp();
}

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (!message.guild || message.author.bot) {
            return;
        }

        const filtered = await handleFilteredMessage(message);

        if (filtered) {
            return;
        }

        if (!message.content.startsWith(PREFIX)) {
            return;
        }

        const parts = message.content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

        const command = parts.shift()?.toLowerCase();
        const args = parts;

        const member = message.member;

        if (!command) return;

        // ==================================================
        // HELP
        // ==================================================

        if (
            command === "help" ||
            command === "commands"
        ) {
            return message.reply({
                embeds: [helpEmbed()]
            });
        }

        // ==================================================
        // FILTER
        // ==================================================

        if (command === "filter") {
            const data = getGuildData(
                message.guild.id
            );

            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can use filter commands."
                        )
                    ]
                });
            }

            const sub = args.shift()?.toLowerCase();

            if (sub === "on") {
                data.filters.enabled = true;
                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "AutoMod Enabled",
                            "The word filter is now enabled."
                        )
                    ]
                });
            }

            if (sub === "off") {
                data.filters.enabled = false;
                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "AutoMod Disabled",
                            "The word filter is now disabled."
                        )
                    ]
                });
            }

            if (sub === "add") {
                const word = args.join(" ").trim();

                if (!word) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Word",
                                `Usage: \`${PREFIX}filter add <word>\``
                            )
                        ]
                    });
                }

                if (!data.filters.words.includes(word)) {
                    data.filters.words.push(word);
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Added",
                            `Added \`${word}\` to the filter.`
                        )
                    ]
                });
            }

            if (sub === "remove") {
                const word = args.join(" ").trim();

                data.filters.words =
                    data.filters.words.filter(
                        x =>
                            x.toLowerCase() !==
                            word.toLowerCase()
                    );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Removed",
                            `Removed \`${word}\` from the filter.`
                        )
                    ]
                });
            }

            if (sub === "list") {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Filtered Words",
                            data.filters.words.length
                                ? data.filters.words
                                    .map(x => `\`${x}\``)
                                    .join(", ")
                                : "No filtered words."
                        )
                    ]
                });
            }

            if (sub === "log") {
                const channel =
                    message.mentions.channels.first();

                if (!channel) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Channel",
                                `Usage: \`${PREFIX}filter log #channel\``
                            )
                        ]
                    });
                }

                data.filters.logChannelId =
                    channel.id;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Log Channel Set",
                            `AutoMod logs will go to ${channel}.`
                        )
                    ]
                });
            }

            if (sub === "strikes") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                const strikes =
                    data.filters.strikes[target.id] || 0;

                return message.reply({
                    embeds: [
                        infoEmbed(
                            "AutoMod Strikes",
                            `${target} has **${strikes}** strike(s).`
                        )
                    ]
                });
            }

            if (sub === "reset") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                delete data.filters.strikes[target.id];

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Strikes Reset",
                            `Reset strikes for ${target}.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Filter Commands",
                        `\`${PREFIX}filter on\`\n` +
                        `\`${PREFIX}filter off\`\n` +
                        `\`${PREFIX}filter add <word>\`\n` +
                        `\`${PREFIX}filter remove <word>\`\n` +
                        `\`${PREFIX}filter list\`\n` +
                        `\`${PREFIX}filter log #channel\`\n` +
                        `\`${PREFIX}filter strikes @user\`\n` +
                        `\`${PREFIX}filter reset @user\``
                    )
                ]
            });
        }

        // ==================================================
        // VC SETUP
        // ==================================================

        if (
            command === "vc" &&
            args[0]?.toLowerCase() === "setup"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can setup the VC system."
                        )
                    ]
                });
            }

            const category =
                message.guild.channels.cache.find(
                    c =>
                        c.type === ChannelType.GuildCategory &&
                        c.name.toLowerCase() === "voice"
                );

            const jtc =
                await message.guild.channels.create({
                    name: "Join To Create",
                    type: ChannelType.GuildVoice,
                    parent: category?.id ?? null
                }).catch(() => null);

            if (!jtc) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Setup Failed",
                            "I couldn't create the Join To Create channel."
                        )
                    ]
                });
            }

            const data = getGuildData(
                message.guild.id
            );

            data.jtc.enabled = true;
            data.jtc.channelId = jtc.id;
            data.jtc.categoryId =
                category?.id ?? null;

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "VC System Enabled",
                        `Join ${jtc} to create your personal VC.`
                    )
                ]
            });
        }

        // ==================================================
        // VC COMMANDS
        // ==================================================

        if (command === "vc") {
            const sub = args.shift()?.toLowerCase();

            const vc = member.voice.channel;

            if (!vc) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Not In VC",
                            "You need to be inside your personal VC."
                        )
                    ]
                });
            }

            const vcData = getVCData(vc.id);

            if (!vcData) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Not A Personal VC",
                            "This isn't a VC controlled by the bot."
                        )
                    ]
                });
            }

            const owner =
                vcData.ownerId === member.id;

            if (
                !owner &&
                !isFounder(member) &&
                sub !== "claim" &&
                sub !== "forceclaim"
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only the VC owner or Founder can control this VC."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (
                [
                    "kick",
                    "disconnect",
                    "ban",
                    "reject",
                    "permit",
                    "transfer",
                    "stfu",
                    "unstfu"
                ].includes(sub) &&
                !target
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            "Mention a user."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // KICK
            // ----------------------------------------------

            if (sub === "kick") {
                if (!canModerate(member, target)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You cannot kick this user."
                            )
                        ]
                    });
                }

                await target.voice
                    .disconnect("VC kick")
                    .catch(() => {});

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "kicked from the VC",
                    `Removed by ${member.user.tag}.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Kicked",
                            `${target} was kicked from the VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // DISCONNECT
            // ----------------------------------------------

            if (sub === "disconnect") {
                if (
                    isFounder(target) &&
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Protected User",
                                "You cannot disconnect the Founder."
                            )
                        ]
                    });
                }

                await target.voice
                    .disconnect("VC disconnect")
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Disconnected",
                            `${target} was disconnected.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // BAN
            // ----------------------------------------------

            if (sub === "ban") {
                if (
                    isFounder(target) &&
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Protected User",
                                "You cannot VC ban the Founder."
                            )
                        ]
                    });
                }

                vcData.banned.add(target.id);

                await applyVCBan(
                    vc,
                    target.id
                );

                await target.voice
                    .disconnect("VC ban")
                    .catch(() => {});

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "banned from the VC",
                    `Banned by ${member.user.tag}.`
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Banned",
                            `${target} is now banned from this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // REJECT
            // ----------------------------------------------

            if (sub === "reject") {
                vcData.rejected.add(target.id);

                await applyVCBan(
                    vc,
                    target.id
                );

                await target.voice
                    .disconnect("VC rejected")
                    .catch(() => {});

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Rejected",
                            `${target} was rejected from the VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // PERMIT
            // ----------------------------------------------

            if (sub === "permit") {
                vcData.banned.delete(target.id);
                vcData.rejected.delete(target.id);
                vcData.permitted.add(target.id);

                await removeVCBan(
                    vc,
                    target.id
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Permitted",
                            `${target} can now join the VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LOCK
            // ----------------------------------------------

            if (sub === "lock") {
                vcData.locked = true;

                await vc.permissionOverwrites.edit(
                    vc.guild.roles.everyone,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                saveDB();
                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Locked",
                            "The VC is now locked."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNLOCK
            // ----------------------------------------------

            if (sub === "unlock") {
                vcData.locked = false;

                await vc.permissionOverwrites.edit(
                    vc.guild.roles.everyone,
                    {
                        Connect: true
                    }
                ).catch(() => {});

                saveDB();
                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Unlocked",
                            "The VC is now unlocked."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LIMIT
            // ----------------------------------------------

            if (sub === "limit") {
                const amount =
                    Number.parseInt(args[0], 10);

                if (
                    Number.isNaN(amount) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Limit",
                                "Use a number from **0 to 99**."
                            )
                        ]
                    });
                }

                await vc.setUserLimit(amount);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Limit Updated",
                            `VC limit set to **${amount || "unlimited"}**.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // RENAME
            // ----------------------------------------------

            if (sub === "rename") {
                const name =
                    args.join(" ").trim();

                if (!name) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Name",
                                `Usage: \`${PREFIX}vc rename <name>\``
                            )
                        ]
                    });
                }

                await vc.setName(
                    name.slice(0, 100)
                );

                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Renamed",
                            `VC renamed to **${name.slice(0, 100)}**.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // TRANSFER
            // ----------------------------------------------

            if (sub === "transfer") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                vcData.ownerId = target.id;

                saveDB();
                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Ownership Transferred",
                            `${target} is now the VC owner.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // CLAIM
            // ----------------------------------------------

            if (sub === "claim") {
                if (
                    vc.members.has(
                        vcData.ownerId
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Cannot Claim",
                                "The current owner is still inside the VC."
                            )
                        ]
                    });
                }

                vcData.ownerId = member.id;

                saveDB();
                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Claimed",
                            "You are now the VC owner."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // FORCE CLAIM
            // ----------------------------------------------

            if (sub === "forceclaim") {
                if (!isGod(member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only God or Founder can force claim a VC."
                            )
                        ]
                    });
                }

                vcData.ownerId = member.id;

                saveDB();
                await updateVCInterface(vc);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Force Claimed",
                            "You are now the VC owner."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // STFU
            // ----------------------------------------------

            if (sub === "stfu") {
                if (!isGod(member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only God or Founder can use STFU."
                            )
                        ]
                    });
                }

                if (
                    isFounder(target) &&
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Protected User",
                                "You cannot STFU the Founder."
                            )
                        ]
                    });
                }

                vcData.stfu.add(target.id);

                await target.voice.setMute(
                    true,
                    "VC STFU"
                ).catch(() => {});

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "STFU Applied",
                            `${target} is now muted in this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNSTFU
            // ----------------------------------------------

            if (sub === "unstfu") {
                if (!isGod(member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only God or Founder can use UNSTFU."
                            )
                        ]
                    });
                }

                vcData.stfu.delete(
                    target.id
                );

                await target.voice.setMute(
                    false,
                    "VC UNSTFU"
                ).catch(() => {});

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "STFU Removed",
                            `${target} can speak again.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    infoEmbed(
                        "VC Commands",
                        "Use the clickable VC control panel or `-help`."
                    )
                ]
            });
        }

        // ==================================================
        // BAN
        // ==================================================

        if (command === "ban") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can ban users."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            `Usage: \`${PREFIX}ban @user [reason]\``
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy Error",
                            "You cannot ban this user."
                        )
                    ]
                });
            }

            const reason =
                args
                    .filter(
                        x =>
                            !x.includes(
                                target.id
                            )
                    )
                    .join(" ") ||
                "No reason provided.";

            await sendModerationDM(
                target.user,
                message.guild,
                "banned",
                reason
            );

            await target.ban({
                reason: `${reason} | By ${member.user.tag}`
            }).catch(() => null);

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Banned",
                        `${target.user.tag} has been banned.`
                    )
                ]
            });
        }

        // ==================================================
        // UNBAN
        // ==================================================

        if (command === "unban") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can use this command."
                        )
                    ]
                });
            }

            const rawId = args[0];

            if (!rawId) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User ID",
                            `Usage: \`${PREFIX}unban <user ID>\``
                        )
                    ]
                });
            }

            const userId =
                rawId.replace(
                    /[<@!>]/g,
                    ""
                );

            if (!/^\d{17,20}$/.test(userId)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid User ID",
                            "Enter a valid Discord user ID."
                        )
                    ]
                });
            }

            const user =
                await client.users
                    .fetch(userId)
                    .catch(() => null);

            if (!user) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "User Not Found",
                            "I couldn't find that Discord user."
                        )
                    ]
                });
            }

            const banInfo =
                await message.guild.bans
                    .fetch(userId)
                    .catch(() => null);

            if (!banInfo) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Not Banned",
                            `**${user.tag}** is not currently banned.`
                        )
                    ]
                });
            }

            try {
                await message.guild.members.unban(
                    userId,
                    `Unban by ${member.user.tag}`
                );

                await sendModerationDM(
                    user,
                    message.guild,
                    "unbanned",
                    `Your ban was removed by ${member.user.tag}.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Unbanned",
                            `**${user.tag}** has been unbanned successfully.`
                        )
                    ]
                });
            } catch (err) {
                console.error(
                    "UNBAN ERROR:",
                    err
                );

                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Unban Failed",
                            "I couldn't unban that user. Make sure the bot has **Ban Members** permission."
                        )
                    ]
                });
            }
        }

        // ==================================================
        // BAN LIST
        // ==================================================

        if (command === "banlist") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only God or Founder can view the ban list."
                        )
                    ]
                });
            }

            const bans =
                await message.guild.bans
                    .fetch()
                    .catch(() => null);

            if (!bans) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Error",
                            "I couldn't retrieve the ban list."
                        )
                    ]
                });
            }

            if (!bans.size) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Ban List",
                            "There are no banned users."
                        )
                    ]
                });
            }

            const list =
                [...bans.values()]
                    .slice(0, 25)
                    .map(
                        (ban, index) =>
                            `**${index + 1}.** ${ban.user.tag}\n` +
                            `ID: \`${ban.user.id}\``
                    )
                    .join("\n\n");

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            `🔨 Ban List — ${bans.size}`
                        )
                        .setDescription(
                            list.slice(0, 4096)
                        )
                        .setTimestamp()
                ]
            });
        }

        // ==================================================
        // KICK
        // ==================================================

        if (command === "kick") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only God or Founder can kick users."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            `Usage: \`${PREFIX}kick @user [reason]\``
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy Error",
                            "You cannot kick this user."
                        )
                    ]
                });
            }

            const reason =
                args
                    .filter(
                        x =>
                            !x.includes(
                                target.id
                            )
                    )
                    .join(" ") ||
                "No reason provided.";

            await sendModerationDM(
                target.user,
                message.guild,
                "kicked",
                reason
            );

            await target.kick(
                `${reason} | By ${member.user.tag}`
            ).catch(() => {});

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Kicked",
                        `${target.user.tag} has been kicked.`
                    )
                ]
            });
        }

        // ==================================================
        // TIMEOUT
        // ==================================================

        if (command === "timeout") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only God or Founder can timeout users."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const minutes =
                Number.parseInt(
                    args.find(x => /^\d+$/.test(x)),
                    10
                );

            if (!target || !minutes) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Usage",
                            `Usage: \`${PREFIX}timeout @user <minutes> [reason]\``
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy Error",
                            "You cannot timeout this user."
                        )
                    ]
                });
            }

            if (
                minutes < 1 ||
                minutes > 40320
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Duration",
                            "Timeout must be between **1 minute and 28 days**."
                        )
                    ]
                });
            }

            const reason =
                args
                    .filter(
                        x =>
                            x !== String(minutes) &&
                            !x.includes(target.id)
                    )
                    .join(" ") ||
                "No reason provided.";

            await target.timeout(
                minutes * 60 * 1000,
                `${reason} | By ${member.user.tag}`
            );

            await sendModerationDM(
                target.user,
                message.guild,
                "timed out",
                reason,
                `${minutes} minutes`
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Timed Out",
                        `${target.user.tag} was timed out for **${minutes} minutes**.`
                    )
                ]
            });
        }

        // ==================================================
        // UNTIMEOUT
        // ==================================================

        if (command === "untimeout") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only God or Founder can remove timeouts."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            `Usage: \`${PREFIX}untimeout @user\``
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy Error",
                            "You cannot modify this user."
                        )
                    ]
                });
            }

            await target.timeout(
                null,
                `Timeout removed by ${member.user.tag}`
            ).catch(() => {});

            return message.reply({
                embeds: [
                    successEmbed(
                        "Timeout Removed",
                        `${target.user.tag} can speak again.`
                    )
                ]
            });
        }

        // ==================================================
        // FOREVER BAN
        // ==================================================

        if (command === "foreverban") {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only Founder can use foreverban."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            `Usage: \`${PREFIX}foreverban @user [reason]\``
                        )
                    ]
                });
            }

            const data =
                getGuildData(
                    message.guild.id
                );

            if (
                !data.foreverBanned.includes(
                    target.id
                )
            ) {
                data.foreverBanned.push(
                    target.id
                );
            }

            const reason =
                args
                    .filter(
                        x =>
                            !x.includes(target.id)
                    )
                    .join(" ") ||
                "Forever ban.";

            await sendModerationDM(
                target.user,
                message.guild,
                "permanently banned",
                reason
            );

            await target.ban({
                reason:
                    `${reason} | Forever ban by ${member.user.tag}`
            }).catch(() => {});

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Forever Ban",
                        `${target.user.tag} has been permanently banned.`
                    )
                ]
            });
        }

        // ==================================================
        // RANK
        // ==================================================

        if (command === "rank") {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only Founder can change ranks."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const rank =
                normalizeRank(
                    args.find(
                        x =>
                            RANKS[
                                normalizeRank(x)
                            ]
                    )
                );

            if (!target || !rank) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Usage",
                            `Usage: \`${PREFIX}rank @user <rank>\`\n\nRanks:\n${Object.keys(RANKS).join(", ")}`
                        )
                    ]
                });
            }

            if (
                isFounder(target) &&
                target.id !== member.id
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Protected User",
                            "The Founder cannot have their rank changed."
                        )
                    ]
                });
            }

            const data =
                getGuildData(
                    message.guild.id
                );

            data.ranks[target.id] = rank;

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Rank Updated",
                        `${target} is now **${rank}**.`
                    )
                ]
            });
        }

        // ==================================================
        // GODMODE
        // ==================================================

        if (command === "godmode") {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only Founder can use godmode."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User",
                            `Usage: \`${PREFIX}godmode @user\``
                        )
                    ]
                });
            }

            const data =
                getGuildData(
                    message.guild.id
                );

            const index =
                data.godmode.indexOf(
                    target.id
                );

            if (index === -1) {
                data.godmode.push(
                    target.id
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Godmode Enabled",
                            `${target} now has **Godmode**.`
                        )
                    ]
                });
            }

            data.godmode.splice(
                index,
                1
            );

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Godmode Disabled",
                        `${target} no longer has Godmode.`
                    )
                ]
            });
        }

        // ==================================================
        // PURGE
        // ==================================================

        if (
            command === "purge" ||
            command === "clear"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only God or Founder can purge messages."
                        )
                    ]
                });
            }

            const amount =
                Number.parseInt(
                    args[0],
                    10
                );

            if (
                Number.isNaN(amount) ||
                amount < 1 ||
                amount > 100
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Amount",
                            "Choose a number from **1 to 100**."
                        )
                    ]
                });
            }

            const deleted =
                await message.channel.bulkDelete(
                    amount,
                    true
                ).catch(() => null);

            if (!deleted) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Purge Failed",
                            "I couldn't delete those messages."
                        )
                    ]
                });
            }

            const response =
                await message.channel.send({
                    embeds: [
                        successEmbed(
                            "Messages Deleted",
                            `Deleted **${deleted.size}** messages.`
                        )
                    ]
                });

            setTimeout(() => {
                response.delete().catch(() => {});
            }, 5000);

            return;
        }
    } catch (err) {
        console.error(
            "COMMAND ERROR:",
            err
        );

        await message.reply({
            embeds: [
                errorEmbed(
                    "Command Error",
                    "Something went wrong while running that command."
                )
            ]
        }).catch(() => {});
    }
});

// ======================================================
// BUTTON INTERACTIONS
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.guild) return;

        // ==================================================
        // BUTTON
        // ==================================================

        if (interaction.isButton()) {
            const channel =
                interaction.channel;

            const vcData =
                tempVCs.get(
                    channel?.guild?.channels?.cache.find(
                        c =>
                            c.type === ChannelType.GuildVoice &&
                            tempVCs.has(c.id) &&
                            tempVCs.get(c.id)
                                .interfaceChannelId === channel.id
                    )?.id
                );

            if (!vcData) {
                return interaction.reply({
                    content: "This VC panel is no longer active.",
                    ephemeral: true
                });
            }

            const voiceChannel =
                interaction.guild.channels.cache.get(
                    [...tempVCs.entries()]
                        .find(
                            ([, data]) =>
                                data === vcData
                        )?.[0]
                );

            if (!voiceChannel) {
                return interaction.reply({
                    content: "The voice channel no longer exists.",
                    ephemeral: true
                });
            }

            const member =
                await interaction.guild.members
                    .fetch(interaction.user.id)
                    .catch(() => null);

            if (!member) return;

            const owner =
                vcData.ownerId === member.id;

            // ----------------------------------------------
            // REFRESH
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_refresh"
            ) {
                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content: "VC panel refreshed.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // CLAIM
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_claim"
            ) {
                if (
                    voiceChannel.members.has(
                        vcData.ownerId
                    )
                ) {
                    return interaction.reply({
                        content:
                            "The current owner is still inside the VC.",
                        ephemeral: true
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content:
                        "You claimed the VC.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // FORCE CLAIM
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_forceclaim"
            ) {
                if (!isGod(member)) {
                    return interaction.reply({
                        content:
                            "Only God or Founder can force claim.",
                        ephemeral: true
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content:
                        "You force claimed the VC.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // OWNER CHECK
            // ----------------------------------------------

            if (
                !owner &&
                !isFounder(member)
            ) {
                return interaction.reply({
                    content:
                        "Only the VC owner or Founder can use this control panel.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // LOCK
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_lock"
            ) {
                vcData.locked = true;

                await voiceChannel
                    .permissionOverwrites
                    .edit(
                        interaction.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content:
                        "VC locked.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // UNLOCK
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_unlock"
            ) {
                vcData.locked = false;

                await voiceChannel
                    .permissionOverwrites
                    .edit(
                        interaction.guild.roles.everyone,
                        {
                            Connect: true
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content:
                        "VC unlocked.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // RENAME MODAL
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_rename"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_rename_modal_${voiceChannel.id}`
                        )
                        .setTitle(
                            "Rename VC"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "vc_name"
                        )
                        .setLabel(
                            "New VC Name"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setMaxLength(100)
                        .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(
                    modal
                );
            }

            // ----------------------------------------------
            // LIMIT MODAL
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_limit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_limit_modal_${voiceChannel.id}`
                        )
                        .setTitle(
                            "VC User Limit"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "vc_limit_amount"
                        )
                        .setLabel(
                            "Limit 0-99"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(
                    modal
                );
            }

            // ----------------------------------------------
            // TARGET ACTIONS
            // ----------------------------------------------

            const targetActions = [
                "vc_kick",
                "vc_disconnect",
                "vc_ban",
                "vc_reject",
                "vc_permit",
                "vc_stfu",
                "vc_unstfu",
                "vc_transfer"
            ];

            if (
                targetActions.includes(
                    interaction.customId
                )
            ) {
                const selector =
                    new UserSelectMenuBuilder()
                        .setCustomId(
                            `target_${interaction.customId}_${voiceChannel.id}`
                        )
                        .setPlaceholder(
                            "Select a member"
                        )
                        .setMinValues(1)
                        .setMaxValues(1);

                return interaction.reply({
                    content:
                        "Select the member you want to control:",
                    components: [
                        new ActionRowBuilder()
                            .addComponents(selector)
                    ],
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // STFU
            // ----------------------------------------------

            if (
                interaction.customId ===
                "vc_stfu"
            ) {
                if (!isGod(member)) {
                    return interaction.reply({
                        content:
                            "Only God or Founder can use STFU.",
                        ephemeral: true
                    });
                }
            }
        }

        // ==================================================
        // USER SELECT
        // ==================================================

        if (interaction.isUserSelectMenu()) {
            const customId =
                interaction.customId;

            if (
                !customId.startsWith(
                    "target_vc_"
                )
            ) {
                return;
            }

            const match =
                customId.match(
                    /^target_(vc_[a-z]+)_([0-9]+)$/
                );

            if (!match) {
                return interaction.update({
                    content:
                        "Invalid VC action.",
                    components: []
                });
            }

            const action =
                match[1];

            const voiceChannelId =
                match[2];

            const voiceChannel =
                interaction.guild.channels.cache.get(
                    voiceChannelId
                );

            const vcData =
                tempVCs.get(
                    voiceChannelId
                );

            if (
                !voiceChannel ||
                !vcData
            ) {
                return interaction.update({
                    content:
                        "This VC no longer exists.",
                    components: []
                });
            }

            const member =
                await interaction.guild.members
                    .fetch(interaction.user.id)
                    .catch(() => null);

            const target =
                await interaction.guild.members
                    .fetch(
                        interaction.values[0]
                    )
                    .catch(() => null);

            if (
                !member ||
                !target
            ) {
                return interaction.update({
                    content:
                        "User not found.",
                    components: []
                });
            }

            if (
                vcData.ownerId !== member.id &&
                !isFounder(member)
            ) {
                return interaction.update({
                    content:
                        "You don't control this VC.",
                    components: []
                });
            }

            if (
                isFounder(target) &&
                !isFounder(member) &&
                [
                    "vc_disconnect",
                    "vc_ban",
                    "vc_stfu"
                ].includes(action)
            ) {
                return interaction.update({
                    content:
                        "The Founder is protected.",
                    components: []
                });
            }

            // KICK
            if (action === "vc_kick") {
                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return interaction.update({
                        content:
                            "You cannot kick this user.",
                        components: []
                    });
                }

                await target.voice
                    .disconnect(
                        "VC panel kick"
                    )
                    .catch(() => {});

                await sendModerationDM(
                    target.user,
                    interaction.guild,
                    "kicked from the VC",
                    `Removed by ${member.user.tag}.`
                );

                return interaction.update({
                    content:
                        `${target.user.tag} was kicked.`,
                    components: []
                });
            }

            // DISCONNECT
            if (
                action ===
                "vc_disconnect"
            ) {
                await target.voice
                    .disconnect(
                        "VC panel disconnect"
                    )
                    .catch(() => {});

                return interaction.update({
                    content:
                        `${target.user.tag} was disconnected.`,
                    components: []
                });
            }

            // BAN
            if (action === "vc_ban") {
                vcData.banned.add(
                    target.id
                );

                await applyVCBan(
                    voiceChannel,
                    target.id
                );

                await target.voice
                    .disconnect(
                        "VC panel ban"
                    )
                    .catch(() => {});

                await sendModerationDM(
                    target.user,
                    interaction.guild,
                    "banned from the VC",
                    `Banned by ${member.user.tag}.`
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    content:
                        `${target.user.tag} was VC banned.`,
                    components: []
                });
            }

            // REJECT
            if (
                action ===
                "vc_reject"
            ) {
                vcData.rejected.add(
                    target.id
                );

                await applyVCBan(
                    voiceChannel,
                    target.id
                );

                await target.voice
                    .disconnect(
                        "VC panel reject"
                    )
                    .catch(() => {});

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    content:
                        `${target.user.tag} was rejected.`,
                    components: []
                });
            }

            // PERMIT
            if (
                action ===
                "vc_permit"
            ) {
                vcData.banned.delete(
                    target.id
                );

                vcData.rejected.delete(
                    target.id
                );

                vcData.permitted.add(
                    target.id
                );

                await removeVCBan(
                    voiceChannel,
                    target.id
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    content:
                        `${target.user.tag} was permitted.`,
                    components: []
                });
            }

            // STFU
            if (
                action ===
                "vc_stfu"
            ) {
                if (!isGod(member)) {
                    return interaction.update({
                        content:
                            "Only God or Founder can STFU users.",
                        components: []
                    });
                }

                vcData.stfu.add(
                    target.id
                );

                await target.voice
                    .setMute(
                        true,
                        "VC panel STFU"
                    )
                    .catch(() => {});

                return interaction.update({
                    content:
                        `${target.user.tag} is muted.`,
                    components: []
                });
            }

            // UNSTFU
            if (
                action ===
                "vc_unstfu"
            ) {
                if (!isGod(member)) {
                    return interaction.update({
                        content:
                            "Only God or Founder can UNSTFU users.",
                        components: []
                    });
                }

                vcData.stfu.delete(
                    target.id
                );

                await target.voice
                    .setMute(
                        false,
                        "VC panel UNSTFU"
                    )
                    .catch(() => {});

                return interaction.update({
                    content:
                        `${target.user.tag} can speak again.`,
                    components: []
                });
            }

            // TRANSFER
            if (
                action ===
                "vc_transfer"
            ) {
                vcData.ownerId =
                    target.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    content:
                        `${target.user.tag} is now the VC owner.`,
                    components: []
                });
            }
        }

        // ==================================================
        // MODALS
        // ==================================================

        if (interaction.isModalSubmit()) {
            const customId =
                interaction.customId;

            // RENAME
            if (
                customId.startsWith(
                    "vc_rename_modal_"
                )
            ) {
                const voiceChannelId =
                    customId.replace(
                        "vc_rename_modal_",
                        ""
                    );

                const voiceChannel =
                    interaction.guild.channels.cache.get(
                        voiceChannelId
                    );

                const vcData =
                    tempVCs.get(
                        voiceChannelId
                    );

                if (
                    !voiceChannel ||
                    !vcData
                ) {
                    return interaction.reply({
                        content:
                            "This VC no longer exists.",
                        ephemeral: true
                    });
                }

                const member =
                    await interaction.guild.members
                        .fetch(interaction.user.id)
                        .catch(() => null);

                if (
                    vcData.ownerId !== member.id &&
                    !isFounder(member)
                ) {
                    return interaction.reply({
                        content:
                            "You don't control this VC.",
                        ephemeral: true
                    });
                }

                const name =
                    interaction.fields.getTextInputValue(
                        "vc_name"
                    );

                await voiceChannel.setName(
                    name.slice(0, 100)
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    content:
                        "VC renamed successfully.",
                    ephemeral: true
                });
            }

            // LIMIT
            if (
                customId.startsWith(
                    "vc_limit_modal_"
                )
            ) {
                const voiceChannelId =
                    customId.replace(
                        "vc_limit_modal_",
                        ""
                    );

                const voiceChannel =
                    interaction.guild.channels.cache.get(
                        voiceChannelId
                    );

                const vcData =
                    tempVCs.get(
                        voiceChannelId
                    );

                if (
                    !voiceChannel ||
                    !vcData
                ) {
                    return interaction.reply({
                        content:
                            "This VC no longer exists.",
                        ephemeral: true
                    });
                }

                const member =
                    await interaction.guild.members
                        .fetch(interaction.user.id)
                        .catch(() => null);

                if (
                    vcData.ownerId !== member.id &&
                    !isFounder(member)
                ) {
                    return interaction.reply({
                        content:
                            "You don't control this VC.",
                        ephemeral: true
                    });
                }

                const amount =
                    Number.parseInt(
                        interaction.fields.getTextInputValue(
                            "vc_limit_amount"
                        ),
                        10
                    );

                if (
                    Number.isNaN(amount) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return interaction.reply({
                        content:
                            "Limit must be between 0 and 99.",
                        ephemeral: true
                    });
                }

                await voiceChannel.setUserLimit(
                    amount
                );

                return interaction.reply({
                    content:
                        `VC limit set to ${amount || "unlimited"}.`,
                    ephemeral: true
                });
            }
        }
    } catch (err) {
        console.error(
            "INTERACTION ERROR:",
            err
        );

        if (!interaction.replied) {
            await interaction.reply({
                content:
                    "Something went wrong.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// VOICE STATE
// ======================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            const member =
                newState.member ||
                oldState.member;

            if (!member) return;

            const data =
                getGuildData(
                    guild.id
                );

            // ==============================================
            // JOIN TO CREATE
            // ==============================================

            if (
                newState.channelId &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                const channel =
                    await createPersonalVC(
                        member
                    );

                if (!channel) return;
            }

            // ==============================================
            // ENTER PERSONAL VC
            // ==============================================

            if (newState.channelId) {
                const vcData =
                    tempVCs.get(
                        newState.channelId
                    );

                if (vcData) {
                    const vc =
                        newState.channel;

                    if (
                        vcData.banned.has(
                            member.id
                        ) ||
                        vcData.rejected.has(
                            member.id
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC restricted"
                            )
                            .catch(() => {});

                        return;
                    }

                    if (
                        vcData.stfu.has(
                            member.id
                        )
                    ) {
                        await member.voice
                            .setMute(
                                true,
                                "Persistent VC STFU"
                            )
                            .catch(() => {});
                    }

                    await updateVCInterface(
                        vc
                    );
                }
            }

            // ==============================================
            // LEAVE PERSONAL VC
            // ==============================================

            if (oldState.channelId) {
                const oldVCData =
                    tempVCs.get(
                        oldState.channelId
                    );

                if (oldVCData) {
                    const oldVC =
                        oldState.channel;

                    await deleteEmptyVC(
                        oldVC
                    );
                }
            }
        } catch (err) {
            console.error(
                "VOICE ERROR:",
                err
            );
        }
    }
);

// ======================================================
// ANTI-NUKE
// ======================================================

const auditTracker = new Map();

function trackAudit(
    guildId,
    action,
    limit,
    windowMs
) {
    const key =
        `${guildId}:${action}`;

    const now = Date.now();

    const existing =
        auditTracker.get(key) || [];

    const recent =
        existing.filter(
            time =>
                now - time <
                windowMs
        );

    recent.push(now);

    auditTracker.set(
        key,
        recent
    );

    return recent.length >= limit;
}

async function getAuditExecutor(
    guild,
    type
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 1
            });

        return logs.entries.first()
            ?.executor;
    } catch {
        return null;
    }
}

async function securityPunish(
    guild,
    user,
    reason
) {
    if (!user) return;

    const member =
        await guild.members
            .fetch(user.id)
            .catch(() => null);

    if (!member) return;

    if (
        member.id === guild.ownerId ||
        isTrustedExecutor(member)
    ) {
        return;
    }

    await member.ban({
        reason
    }).catch(() => {});
}

// CHANNEL CREATE

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) return;

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.channelCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (
                trackAudit(
                    channel.guild.id,
                    "channelCreate",
                    5,
                    10000
                )
            ) {
                await channel.delete().catch(() => {});

                await securityPunish(
                    channel.guild,
                    executor,
                    "Anti-nuke: excessive channel creation"
                );
            }
        } catch (err) {
            console.error(
                "CHANNEL CREATE SECURITY ERROR:",
                err
            );
        }
    }
);

// CHANNEL DELETE

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) return;

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.channelDelete
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

            if (
                trackAudit(
                    channel.guild.id,
                    "channelDelete",
                    3,
                    10000
                )
            ) {
                await securityPunish(
                    channel.guild,
                    executor,
                    "Anti-nuke: excessive channel deletion"
                );
            }
        } catch (err) {
            console.error(
                "CHANNEL DELETE SECURITY ERROR:",
                err
            );
        }
    }
);

// ROLE CREATE

client.on(
    "roleCreate",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.roleCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleCreate
                );

            if (
                trackAudit(
                    role.guild.id,
                    "roleCreate",
                    5,
                    10000
                )
            ) {
                await role.delete().catch(() => {});

                await securityPunish(
                    role.guild,
                    executor,
                    "Anti-nuke: excessive role creation"
                );
            }
        } catch (err) {
            console.error(
                "ROLE CREATE SECURITY ERROR:",
                err
            );
        }
    }
);

// ROLE DELETE

client.on(
    "roleDelete",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.roleDelete
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleDelete
                );

            if (
                trackAudit(
                    role.guild.id,
                    "roleDelete",
                    3,
                    10000
                )
            ) {
                await securityPunish(
                    role.guild,
                    executor,
                    "Anti-nuke: excessive role deletion"
                );
            }
        } catch (err) {
            console.error(
                "ROLE DELETE SECURITY ERROR:",
                err
            );
        }
    }
);

// ======================================================
// FOREVER BAN CHECK
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                data.foreverBanned.includes(
                    member.id
                )
            ) {
                await member.ban({
                    reason:
                        "Forever ban protection"
                }).catch(() => {});
            }
        } catch (err) {
            console.error(
                "FOREVER BAN ERROR:",
                err
            );
        }
    }
);

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    () => {
        console.log(
            `✅ ${BOT_NAME} is online as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: `${PREFIX}help`,
                    type: ActivityType.Watching
                }
            ],
            status: "online"
        });
    }
);

// ======================================================
// ERROR PROTECTION
// ======================================================

client.on(
    "error",
    error => {
        console.error(
            "DISCORD CLIENT ERROR:",
            error
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "SHARD ERROR:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "UNHANDLED REJECTION:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "UNCAUGHT EXCEPTION:",
            error
        );
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown(signal) {
    console.log(
        `${signal} received. Saving database...`
    );

    saveDB();

    try {
        client.destroy();
    } catch {}

    process.exit(0);
}

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

// ======================================================
// LOGIN
// ======================================================

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "❌ DISCORD_TOKEN is missing from your environment variables."
    );
    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
