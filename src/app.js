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

// ======================================================
// DATABASE
// ======================================================

let db;

try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
    db = { guilds: {} };
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("Database save error:", error);
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

    return db.guilds[guildId];
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
    if (!rank) return "member";

    const value = String(rank).toLowerCase();

    if (RANKS[value]) {
        return value;
    }

    return "member";
}

function getRank(member) {
    if (!member) return "member";

    const guildData = getGuildData(member.guild.id);

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    return normalizeRank(
        guildData.ranks[member.id]
    );
}

function getRankLevel(member) {
    return RANKS[getRank(member)] ?? 1;
}

function isFounder(member) {
    if (!member) return false;

    return (
        member.guild.ownerId === member.id ||
        getRank(member) === "founder"
    );
}

function isGod(member) {
    if (!member) return false;

    const guildData = getGuildData(member.guild.id);

    return (
        isFounder(member) ||
        getRank(member) === "god" ||
        guildData.godmode.includes(member.id)
    );
}

function isTrustedExecutor(member) {
    return isGod(member);
}

function canModerate(actor, target) {
    if (!actor || !target) return false;

    if (actor.id === target.id) {
        return false;
    }

    if (isFounder(actor)) {
        return true;
    }

    if (isFounder(target)) {
        return false;
    }

    return getRankLevel(actor) > getRankLevel(target);
}

// ======================================================
// EMBEDS
// ======================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
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
// AUTO MOD FILTER
// ======================================================

async function handleFilteredMessage(message) {
    if (!message.guild) return false;
    if (message.author.bot) return false;

    const data = getGuildData(message.guild.id);

    if (!data.filters.enabled) {
        return false;
    }

    if (isGod(message.member)) {
        return false;
    }

    const content = message.content.toLowerCase();

    const matched = data.filters.words.some(word =>
        content.includes(String(word).toLowerCase())
    );

    if (!matched) {
        return false;
    }

    try {
        await message.delete();
    } catch {}

    if (!data.filters.strikes[message.author.id]) {
        data.filters.strikes[message.author.id] = 0;
    }

    data.filters.strikes[message.author.id]++;

    const strikes =
        data.filters.strikes[message.author.id];

    if (strikes >= data.filters.maxStrikes) {
        try {
            await message.member.timeout(
                data.filters.timeoutMinutes * 60 * 1000,
                "Automatic filter strike limit reached"
            );
        } catch {}

        data.filters.strikes[message.author.id] = 0;
    }

    saveDB();

    if (data.filters.logChannelId) {
        const logChannel =
            message.guild.channels.cache.get(
                data.filters.logChannelId
            );

        if (logChannel?.isTextBased()) {
            await logChannel.send({
                embeds: [
                    infoEmbed(
                        "Filtered Message",
                        `User: ${message.author}\nStrikes: ${strikes}`
                    )
                ]
            }).catch(() => {});
        }
    }

    return true;
}

// ======================================================
// TEMP VOICE CHANNEL SYSTEM
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
    const data = getVCData(channel.id);

    if (!data) return;

    data.banned.add(userId);

    try {
        await channel.permissionOverwrites.edit(
            userId,
            {
                Connect: false,
                Speak: false
            }
        );
    } catch {}

    const member =
        channel.guild.members.cache.get(userId);

    if (member?.voice?.channelId === channel.id) {
        await member.voice.disconnect().catch(() => {});
    }
}

async function removeVCBan(channel, userId) {
    const data = getVCData(channel.id);

    if (!data) return;

    data.banned.delete(userId);

    try {
        await channel.permissionOverwrites.delete(
            userId
        );
    } catch {}
}

// ======================================================
// VC INTERFACE
// ======================================================

function vcButton(
    id,
    label,
    emoji,
    style = ButtonStyle.Secondary
) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(style);
}

function buildVCInterface() {
    const row1 = new ActionRowBuilder().addComponents(
        vcButton(
            "vc_kick",
            "Kick",
            "👢",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_disconnect",
            "Disconnect",
            "🔌",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_ban",
            "Ban",
            "🔨",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_reject",
            "Reject",
            "🚫",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_permit",
            "Permit",
            "✅",
            ButtonStyle.Success
        )
    );

    const row2 = new ActionRowBuilder().addComponents(
        vcButton(
            "vc_stfu",
            "STFU",
            "🔇",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_unstfu",
            "Unmute",
            "🔊",
            ButtonStyle.Success
        ),

        vcButton(
            "vc_lock",
            "Lock",
            "🔒",
            ButtonStyle.Danger
        ),

        vcButton(
            "vc_unlock",
            "Unlock",
            "🔓",
            ButtonStyle.Success
        )
    );

    const row3 = new ActionRowBuilder().addComponents(
        vcButton(
            "vc_transfer",
            "Transfer",
            "👑",
            ButtonStyle.Primary
        ),

        vcButton(
            "vc_claim",
            "Claim",
            "🏆",
            ButtonStyle.Primary
        ),

        vcButton(
            "vc_forceclaim",
            "Force Claim",
            "⚡",
            ButtonStyle.Primary
        ),

        vcButton(
            "vc_rename",
            "Rename",
            "✏️",
            ButtonStyle.Secondary
        ),

        vcButton(
            "vc_limit",
            "Limit",
            "👥",
            ButtonStyle.Secondary
        )
    );

    const row4 = new ActionRowBuilder().addComponents(
        vcButton(
            "vc_refresh",
            "Refresh",
            "🔄",
            ButtonStyle.Secondary
        )
    );

    return [
        row1,
        row2,
        row3,
        row4
    ];
}

// ======================================================
// PRIVATE VC CONTROL CHANNEL
// ======================================================

async function syncInterfacePermissions(
    voiceChannel,
    interfaceChannel
) {
    try {
        await interfaceChannel.permissionOverwrites.edit(
            voiceChannel.guild.roles.everyone,
            {
                ViewChannel: false,
                ReadMessageHistory: false
            }
        );

        await interfaceChannel.permissionOverwrites.edit(
            client.user.id,
            {
                ViewChannel: true,
                SendMessages: true,
                EmbedLinks: true,
                ReadMessageHistory: true
            }
        );

        const vcData = getVCData(voiceChannel.id);

        if (!vcData) return;

        await interfaceChannel.permissionOverwrites.edit(
            vcData.ownerId,
            {
                ViewChannel: true,
                ReadMessageHistory: true
            }
        );

        for (const member of voiceChannel.members.values()) {
            await interfaceChannel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: true,
                    ReadMessageHistory: true
                }
            );
        }
    } catch {}
}

async function updateVCInterface(channel) {
    const data = getVCData(channel.id);

    if (!data) return;

    let interfaceChannel = null;

    if (data.interfaceChannelId) {
        interfaceChannel =
            channel.guild.channels.cache.get(
                data.interfaceChannelId
            );
    }

    if (
        !interfaceChannel ||
        interfaceChannel.type !== ChannelType.GuildText
    ) {
        interfaceChannel =
            await channel.guild.channels.create({
                name: "vc-control",
                type: ChannelType.GuildText,
                parent: channel.parentId ?? undefined,
                permissionOverwrites: [
                    {
                        id: channel.guild.roles.everyone.id,
                        deny: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory
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

        if (!interfaceChannel) return;

        data.interfaceChannelId =
            interfaceChannel.id;
    }

    await syncInterfacePermissions(
        channel,
        interfaceChannel
    );

    const owner =
        channel.guild.members.cache.get(
            data.ownerId
        );

    const embed = new EmbedBuilder()
        .setTitle(`🎙️ ${channel.name}`)
        .setDescription(
            `👑 Owner: ${owner?.user?.tag ?? "Unknown"}\n\n` +
            `👥 Members: ${channel.members.size}\n` +
            `${data.locked ? "🔒 Locked" : "🔓 Unlocked"}`
        )
        .setTimestamp();

    try {
        if (data.interfaceMessageId) {
            const oldMessage =
                await interfaceChannel.messages
                    .fetch(data.interfaceMessageId)
                    .catch(() => null);

            if (oldMessage) {
                await oldMessage.edit({
                    embeds: [embed],
                    components: buildVCInterface()
                });

                return;
            }
        }

        const message =
            await interfaceChannel.send({
                embeds: [embed],
                components: buildVCInterface()
            });

        data.interfaceMessageId =
            message.id;

    } catch {}

    saveDB();
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const guildData =
        getGuildData(member.guild.id);

    if (!guildData.jtc.enabled) {
        return null;
    }

    const jtc =
        member.guild.channels.cache.get(
            guildData.jtc.channelId
        );

    if (
        !jtc ||
        jtc.type !== ChannelType.GuildVoice
    ) {
        return null;
    }

    const category =
        guildData.jtc.categoryId
            ? member.guild.channels.cache.get(
                guildData.jtc.categoryId
            )
            : null;

    const channel =
        await member.guild.channels.create({
            name: `🎙️・${member.user.username}`,
            type: ChannelType.GuildVoice,
            parent:
                category?.type === ChannelType.GuildCategory
                    ? category.id
                    : undefined,

            permissionOverwrites: [
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.Stream,
                        PermissionFlagsBits.UseVAD
                    ]
                }
            ]
        }).catch(() => null);

    if (!channel) return null;

    const vcData =
        createVCData(
            member.guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await member.voice.setChannel(
        channel
    ).catch(() => {});

    await updateVCInterface(channel);

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    const data = getVCData(channel.id);

    if (!data) return;

    if (channel.members.size > 0) {
        return;
    }

    if (data.interfaceChannelId) {
        const interfaceChannel =
            channel.guild.channels.cache.get(
                data.interfaceChannelId
            );

        if (interfaceChannel) {
            await interfaceChannel.delete()
                .catch(() => {});
        }
    }

    await channel.delete()
        .catch(() => {});

    tempVCs.delete(channel.id);
}

// ======================================================
// VC MEMBER TARGET MENU
// ======================================================

function targetMenu(action) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(`vc_target_${action}`)
            .setPlaceholder("Select a member")
            .setMinValues(1)
            .setMaxValues(1)
    );
}

// ======================================================
// HELP
// ======================================================

function generalHelp() {
    return [
        "General Commands",
        "",
        "-help",
        "-vc setup",
        "",
        "Moderation",
        "-ban @user [reason]",
        "-unban userID",
        "-banlist",
        "-kick @user [reason]",
        "-timeout @user minutes [reason]",
        "-untimeout @user",
        "-foreverban @user [reason]",
        "-purge amount",
        "",
        "Ranks",
        "-rank @user rank",
        "-godmode @user",
        "",
        "Voice",
        "-vc setup",
        "-vc kick @user",
        "-vc disconnect @user",
        "-vc ban @user",
        "-vc reject @user",
        "-vc permit @user",
        "-vc lock",
        "-vc unlock",
        "-vc limit amount",
        "-vc rename name",
        "-vc transfer @user",
        "-vc claim",
        "-vc forceclaim",
        "-vc stfu @user",
        "-vc unstfu @user",
        "",
        "Filter",
        "-filter on",
        "-filter off",
        "-filter add word",
        "-filter remove word",
        "-filter list",
        "-filter log #channel",
        "-filter strikes @user",
        "-filter reset @user"
    ].join("\n");
}

// ======================================================
// COMMAND HANDLER
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;

        const filtered =
            await handleFilteredMessage(message);

        if (filtered) return;

        if (!message.content.startsWith(PREFIX)) {
            return;
        }

        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()?.toLowerCase();

        if (!command) return;

        const member =
            message.member;

        const guildData =
            getGuildData(
                message.guild.id
            );

        // ==================================================
        // HELP
        // ==================================================

        if (command === "help") {
            return message.reply({
                embeds: [
                    infoEmbed(
                        "Help",
                        generalHelp()
                    )
                ]
            });
        }

        // ==================================================
        // FILTER
        // ==================================================

        if (command === "filter") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "You do not have permission to use this command."
                        )
                    ]
                });
            }

            const sub =
                args.shift()?.toLowerCase();

            if (!sub) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Filter",
                            "Use -filter on, -filter off, -filter add, -filter remove, -filter list, -filter log, -filter strikes, or -filter reset."
                        )
                    ]
                });
            }

            if (sub === "on") {
                guildData.filters.enabled = true;
                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Filter Enabled",
                            "The message filter is now enabled."
                        )
                    ]
                });
            }

            if (sub === "off") {
                guildData.filters.enabled = false;
                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Filter Disabled",
                            "The message filter is now disabled."
                        )
                    ]
                });
            }

            if (sub === "add") {
                const word =
                    args.join(" ").trim();

                if (!word) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Word",
                                "Provide a word to add."
                            )
                        ]
                    });
                }

                if (
                    !guildData.filters.words.includes(
                        word.toLowerCase()
                    )
                ) {
                    guildData.filters.words.push(
                        word.toLowerCase()
                    );
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Added",
                            `Added "${word}" to the filter.`
                        )
                    ]
                });
            }

            if (sub === "remove") {
                const word =
                    args.join(" ").trim();

                guildData.filters.words =
                    guildData.filters.words.filter(
                        x =>
                            x.toLowerCase() !==
                            word.toLowerCase()
                    );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Removed",
                            `Removed "${word}" from the filter.`
                        )
                    ]
                });
            }

            if (sub === "list") {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Filtered Words",
                            guildData.filters.words.length
                                ? guildData.filters.words.join("\n")
                                : "No filtered words are configured."
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
                                "Mention a channel."
                            )
                        ]
                    });
                }

                guildData.filters.logChannelId =
                    channel.id;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Log Channel Set",
                            `Filter logs will be sent to ${channel}.`
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
                    guildData.filters.strikes[
                        target.id
                    ] ?? 0;

                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Strikes",
                            `${target.user.tag} has ${strikes} strike(s).`
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

                delete guildData.filters.strikes[
                    target.id
                ];

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Strikes Reset",
                            `Reset strikes for ${target.user.tag}.`
                        )
                    ]
                });
            }
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
                            "Access Denied",
                            "You do not have permission to set up the voice system."
                        )
                    ]
                });
            }

            const existing =
                guildData.jtc.channelId
                    ? message.guild.channels.cache.get(
                        guildData.jtc.channelId
                    )
                    : null;

            if (
                existing &&
                existing.type === ChannelType.GuildVoice
            ) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Voice System",
                            `The Join To Create channel is already configured: ${existing}`
                        )
                    ]
                });
            }

            let category =
                message.guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildCategory &&
                        channel.name.toLowerCase() ===
                            "voice"
                );

            if (!category) {
                category =
                    await message.guild.channels.create({
                        name: "voice",
                        type: ChannelType.GuildCategory
                    }).catch(() => null);
            }

            const jtc =
                await message.guild.channels.create({
                    name: "Join To Create",
                    type: ChannelType.GuildVoice,
                    parent: category?.id
                }).catch(() => null);

            if (!jtc) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Setup Failed",
                            "The voice system could not be created."
                        )
                    ]
                });
            }

            guildData.jtc.enabled = true;
            guildData.jtc.channelId = jtc.id;
            guildData.jtc.categoryId =
                category?.id ?? null;

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Voice System Ready",
                        `Join ${jtc} to create a personal voice channel.`
                    )
                ]
            });
        }

        // ==================================================
        // VC COMMANDS
        // ==================================================

        if (command === "vc") {
            const sub =
                args.shift()?.toLowerCase();

            if (!sub) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Voice",
                            "Use the VC interface or a supported -vc command."
                        )
                    ]
                });
            }

            const voiceChannel =
                member.voice.channel;

            if (
                !voiceChannel ||
                !getVCData(voiceChannel.id)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "No Personal VC",
                            "You must be inside your personal voice channel."
                        )
                    ]
                });
            }

            const vcData =
                getVCData(
                    voiceChannel.id
                );

            const isOwner =
                vcData.ownerId === member.id;

            if (
                !isOwner &&
                !isFounder(member)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "Only the VC owner or Founder can control this channel."
                        )
                    ]
                });
            }

            if (sub === "lock") {
                vcData.locked = true;

                for (const user of voiceChannel.members.values()) {
                    await voiceChannel.permissionOverwrites.edit(
                        user.id,
                        {
                            Connect: true
                        }
                    ).catch(() => {});
                }

                await voiceChannel.permissionOverwrites.edit(
                    message.guild.roles.everyone,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Voice Locked",
                            "The voice channel is now locked."
                        )
                    ]
                });
            }

            if (sub === "unlock") {
                vcData.locked = false;

                await voiceChannel.permissionOverwrites.edit(
                    message.guild.roles.everyone,
                    {
                        Connect: true
                    }
                ).catch(() => {});

                for (const userId of vcData.banned) {
                    await voiceChannel.permissionOverwrites.edit(
                        userId,
                        {
                            Connect: false
                        }
                    ).catch(() => {});
                }

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Voice Unlocked",
                            "The voice channel is now unlocked."
                        )
                    ]
                });
            }

            if (sub === "rename") {
                const name =
                    args.join(" ").trim();

                if (!name) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Name",
                                "Provide a new channel name."
                            )
                        ]
                    });
                }

                const cleanName =
                    name
                        .replace(/[^\p{L}\p{N}\s._-]/gu, "")
                        .slice(0, 100)
                        .trim();

                if (!cleanName) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Name",
                                "That channel name is not valid."
                            )
                        ]
                    });
                }

                await voiceChannel.setName(
                    cleanName
                );

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Voice Renamed",
                            `The channel has been renamed to ${cleanName}.`
                        )
                    ]
                });
            }

            if (sub === "limit") {
                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Limit",
                                "The limit must be between 0 and 99."
                            )
                        ]
                    });
                }

                await voiceChannel.setUserLimit(
                    amount
                );

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Limit Updated",
                            `The voice channel limit is now ${amount === 0 ? "unlimited" : amount}.`
                        )
                    ]
                });
            }

            if (sub === "claim") {
                if (
                    voiceChannel.members.has(
                        vcData.ownerId
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Claim Failed",
                                "The current owner is still in the voice channel."
                            )
                        ]
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Voice Claimed",
                            "You are now the owner of this voice channel."
                        )
                    ]
                });
            }

            if (sub === "forceclaim") {
                if (!isFounder(member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only Founder can force claim a voice channel."
                            )
                        ]
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Voice Force Claimed",
                            "You are now the owner of this voice channel."
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    errorEmbed(
                        "Unknown VC Command",
                        "That voice command does not exist."
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
                            "Access Denied",
                            "You do not have permission to use this command."
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
                            "Mention a user to ban."
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy",
                            "You cannot moderate that user."
                        )
                    ]
                });
            }

            const reason =
                args.slice(
                    1
                ).join(" ") ||
                "No reason provided.";

            await sendModerationDM(
                target.user,
                message.guild,
                "banned",
                reason
            );

            await target.ban({
                reason
            }).catch(() => {});

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
                            "Access Denied",
                            "You do not have permission to use this command."
                        )
                    ]
                });
            }

            const userId =
                args[0];

            if (
                !userId ||
                !/^\d{17,20}$/.test(userId)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid User ID",
                            "Provide a valid Discord user ID."
                        )
                    ]
                });
            }

            const ban =
                await message.guild.bans
                    .fetch(userId)
                    .catch(() => null);

            if (!ban) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Not Banned",
                            "That user is not banned."
                        )
                    ]
                });
            }

            await message.guild.members.unban(
                userId,
                "Unbanned by moderator"
            );

            guildData.foreverBanned =
                guildData.foreverBanned.filter(
                    id => id !== userId
                );

            saveDB();

            await sendModerationDM(
                ban.user,
                message.guild,
                "unbanned",
                "Your ban was removed."
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Unbanned",
                        `${ban.user.tag} has been unbanned.`
                    )
                ]
            });
        }

        // ==================================================
        // BAN LIST
        // ==================================================

        if (command === "banlist") {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "You do not have permission to use this command."
                        )
                    ]
                });
            }

            const bans =
                await message.guild.bans.fetch();

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
                        ban =>
                            `${ban.user.tag} (${ban.user.id})`
                    )
                    .join("\n");

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Ban List",
                        list
                    )
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
                            "Access Denied",
                            "You do not have permission to use this command."
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
                            "Mention a user to kick."
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy",
                            "You cannot moderate that user."
                        )
                    ]
                });
            }

            const reason =
                args.slice(1).join(" ") ||
                "No reason provided.";

            await sendModerationDM(
                target.user,
                message.guild,
                "kicked",
                reason
            );

            await target.kick(
                reason
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
                            "Access Denied",
                            "You do not have permission to use this command."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const minutes =
                Number(args[1]);

            if (!target || !Number.isInteger(minutes)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Usage",
                            "Use -timeout @user minutes reason."
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
                            "Timeout duration must be between 1 and 40320 minutes."
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy",
                            "You cannot moderate that user."
                        )
                    ]
                });
            }

            const reason =
                args.slice(2).join(" ") ||
                "No reason provided.";

            await sendModerationDM(
                target.user,
                message.guild,
                "timed out",
                reason,
                `${minutes} minutes`
            );

            await target.timeout(
                minutes * 60 * 1000,
                reason
            ).catch(() => {});

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Timed Out",
                        `${target.user.tag} has been timed out for ${minutes} minutes.`
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
                            "Access Denied",
                            "You do not have permission to use this command."
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
                            "Mention a user."
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Hierarchy",
                            "You cannot moderate that user."
                        )
                    ]
                });
            }

            await target.timeout(
                null,
                "Timeout removed"
            ).catch(() => {});

            await sendModerationDM(
                target.user,
                message.guild,
                "untimeouted",
                "Your timeout was removed."
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "Timeout Removed",
                        `${target.user.tag} is no longer timed out.`
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
                            "Access Denied",
                            "Only Founder can use this command."
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
                            "Mention a user."
                        )
                    ]
                });
            }

            const reason =
                args.slice(1).join(" ") ||
                "Forever banned.";

            if (
                !guildData.foreverBanned.includes(
                    target.id
                )
            ) {
                guildData.foreverBanned.push(
                    target.id
                );
            }

            saveDB();

            await sendModerationDM(
                target.user,
                message.guild,
                "permanently banned",
                reason
            );

            await target.ban({
                reason
            }).catch(() => {});

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
                            "Access Denied",
                            "Only Founder can change ranks."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const rank =
                normalizeRank(args[1]);

            if (
                !target ||
                !RANKS[rank]
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Rank",
                            "Use a valid rank: member, staff, moderator, admin, director, executive, coowner, owner, god, founder."
                        )
                    ]
                });
            }

            guildData.ranks[target.id] =
                rank;

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Rank Updated",
                        `${target.user.tag} is now ${rank}.`
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
                            "Access Denied",
                            "Only Founder can manage godmode."
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
                            "Mention a user."
                        )
                    ]
                });
            }

            const index =
                guildData.godmode.indexOf(
                    target.id
                );

            if (index === -1) {
                guildData.godmode.push(
                    target.id
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Godmode Enabled",
                            `${target.user.tag} now has godmode.`
                        )
                    ]
                });
            }

            guildData.godmode.splice(
                index,
                1
            );

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Godmode Disabled",
                        `${target.user.tag} no longer has godmode.`
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
                            "Access Denied",
                            "You do not have permission to use this command."
                        )
                    ]
                });
            }

            const amount =
                Number(args[0]);

            if (
                !Number.isInteger(amount) ||
                amount < 1 ||
                amount > 100
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Amount",
                            "Amount must be between 1 and 100."
                        )
                    ]
                });
            }

            await message.channel.bulkDelete(
                amount,
                true
            ).catch(() => {});

            return;
        }
    } catch (error) {
        console.error(
            "Message command error:",
            error
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
        // BUTTONS
        // ==================================================

        if (interaction.isButton()) {
            const member =
                await interaction.guild.members.fetch(
                    interaction.user.id
                ).catch(() => null);

            if (!member) return;

            let vcData = null;
            let voiceChannel = null;

            for (const [
                channelId,
                data
            ] of tempVCs.entries()) {
                if (
                    data.interfaceChannelId ===
                    interaction.channelId
                ) {
                    vcData = data;

                    voiceChannel =
                        interaction.guild.channels.cache.get(
                            channelId
                        );

                    break;
                }
            }

            if (
                !vcData ||
                !voiceChannel
            ) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "Voice Channel",
                            "This voice channel no longer exists."
                        )
                    ],
                    ephemeral: true
                });
            }

            const owner =
                vcData.ownerId ===
                member.id;

            const founder =
                isFounder(member);

            if (
                !owner &&
                !founder
            ) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "Only the VC owner or Founder can use this interface."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // REFRESH
            // ==================================================

            if (
                interaction.customId ===
                "vc_refresh"
            ) {
                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Interface Refreshed",
                            "The voice interface has been refreshed."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // CLAIM
            // ==================================================

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
                        embeds: [
                            errorEmbed(
                                "Claim Failed",
                                "The current owner is still in the channel."
                            )
                        ],
                        ephemeral: true
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Voice Claimed",
                            "You are now the owner."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // FORCE CLAIM
            // ==================================================

            if (
                interaction.customId ===
                "vc_forceclaim"
            ) {
                if (!founder) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only Founder can force claim a voice channel."
                            )
                        ],
                        ephemeral: true
                    });
                }

                vcData.ownerId =
                    member.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Voice Force Claimed",
                            "You are now the owner."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // LOCK
            // ==================================================

            if (
                interaction.customId ===
                "vc_lock"
            ) {
                vcData.locked = true;

                await voiceChannel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                for (
                    const user of voiceChannel.members.values()
                ) {
                    await voiceChannel.permissionOverwrites.edit(
                        user.id,
                        {
                            Connect: true
                        }
                    ).catch(() => {});
                }

                for (
                    const userId of vcData.banned
                ) {
                    await voiceChannel.permissionOverwrites.edit(
                        userId,
                        {
                            Connect: false
                        }
                    ).catch(() => {});
                }

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Voice Locked",
                            "The voice channel is now locked."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // UNLOCK
            // ==================================================

            if (
                interaction.customId ===
                "vc_unlock"
            ) {
                vcData.locked = false;

                await voiceChannel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        Connect: true
                    }
                ).catch(() => {});

                for (
                    const userId of vcData.banned
                ) {
                    await voiceChannel.permissionOverwrites.edit(
                        userId,
                        {
                            Connect: false
                        }
                    ).catch(() => {});
                }

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Voice Unlocked",
                            "The voice channel is now unlocked."
                        )
                    ],
                    ephemeral: true
                });
            }

            // ==================================================
            // RENAME MODAL
            // ==================================================

            if (
                interaction.customId ===
                "vc_rename"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "vc_rename_modal"
                        )
                        .setTitle(
                            "Rename Voice Channel"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "vc_name"
                        )
                        .setLabel(
                            "Channel Name"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setMaxLength(100)
                        .setPlaceholder(
                            "Enter a new channel name"
                        );

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(
                    modal
                );
            }

            // ==================================================
            // LIMIT MODAL
            // ==================================================

            if (
                interaction.customId ===
                "vc_limit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "vc_limit_modal"
                        )
                        .setTitle(
                            "Set Voice Limit"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "vc_limit_amount"
                        )
                        .setLabel(
                            "User Limit"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setMaxLength(2)
                        .setPlaceholder(
                            "0 = unlimited"
                        );

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(
                    modal
                );
            }

            // ==================================================
            // TARGET ACTION MENU
            // ==================================================

            const targetActions = {
                vc_kick: "kick",
                vc_disconnect: "disconnect",
                vc_ban: "ban",
                vc_reject: "reject",
                vc_permit: "permit",
                vc_stfu: "stfu",
                vc_unstfu: "unstfu",
                vc_transfer: "transfer"
            };

            if (
                targetActions[
                    interaction.customId
                ]
            ) {
                const action =
                    targetActions[
                        interaction.customId
                    ];

                if (
                    action === "stfu" ||
                    action === "unstfu"
                ) {
                    if (!isGod(member)) {
                        return interaction.reply({
                            embeds: [
                                errorEmbed(
                                    "Access Denied",
                                    "Only God or Founder can use this control."
                                )
                            ],
                            ephemeral: true
                        });
                    }
                }

                return interaction.reply({
                    components: [
                        targetMenu(action)
                    ],
                    ephemeral: true
                });
            }
        }

        // ==================================================
        // USER SELECT
        // ==================================================

        if (
            interaction.isUserSelectMenu()
        ) {
            if (
                !interaction.customId.startsWith(
                    "vc_target_"
                )
            ) {
                return;
            }

            const member =
                await interaction.guild.members.fetch(
                    interaction.user.id
                ).catch(() => null);

            if (!member) return;

            let voiceChannel = null;
            let vcData = null;

            for (const [
                channelId,
                data
            ] of tempVCs.entries()) {
                if (
                    data.interfaceChannelId ===
                    interaction.channelId
                ) {
                    voiceChannel =
                        interaction.guild.channels.cache.get(
                            channelId
                        );

                    vcData = data;

                    break;
                }
            }

            if (
                !voiceChannel ||
                !vcData
            ) {
                return interaction.update({
                    embeds: [
                        errorEmbed(
                            "Voice Channel",
                            "This voice channel no longer exists."
                        )
                    ],
                    components: []
                });
            }

            if (
                vcData.ownerId !== member.id &&
                !isFounder(member)
            ) {
                return interaction.update({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "Only the VC owner or Founder can do that."
                        )
                    ],
                    components: []
                });
            }

            const targetId =
                interaction.values[0];

            const target =
                await interaction.guild.members.fetch(
                    targetId
                ).catch(() => null);

            if (!target) {
                return interaction.update({
                    embeds: [
                        errorEmbed(
                            "User Not Found",
                            "That user could not be found."
                        )
                    ],
                    components: []
                });
            }

            const action =
                interaction.customId
                    .replace(
                        "vc_target_",
                        ""
                    );

            if (
                target.id ===
                member.id
            ) {
                return interaction.update({
                    embeds: [
                        errorEmbed(
                            "Invalid Target",
                            "You cannot target yourself."
                        )
                    ],
                    components: []
                });
            }

            if (
                isFounder(target) &&
                !isFounder(member)
            ) {
                return interaction.update({
                    embeds: [
                        errorEmbed(
                            "Hierarchy",
                            "You cannot target Founder."
                        )
                    ],
                    components: []
                });
            }

            // KICK
            if (action === "kick") {
                if (
                    target.voice.channelId ===
                    voiceChannel.id
                ) {
                    await target.voice.disconnect()
                        .catch(() => {});
                }

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Kicked",
                            `${target.user.tag} has been disconnected from the voice channel.`
                        )
                    ],
                    components: []
                });
            }

            // DISCONNECT
            if (action === "disconnect") {
                if (
                    target.voice.channelId ===
                    voiceChannel.id
                ) {
                    await target.voice.disconnect()
                        .catch(() => {});
                }

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Disconnected",
                            `${target.user.tag} has been disconnected.`
                        )
                    ],
                    components: []
                });
            }

            // BAN
            if (action === "ban") {
                await applyVCBan(
                    voiceChannel,
                    target.id
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Banned",
                            `${target.user.tag} is banned from this voice channel.`
                        )
                    ],
                    components: []
                });
            }

            // REJECT
            if (action === "reject") {
                vcData.rejected.add(
                    target.id
                );

                await voiceChannel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                if (
                    target.voice.channelId ===
                    voiceChannel.id
                ) {
                    await target.voice.disconnect()
                        .catch(() => {});
                }

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Rejected",
                            `${target.user.tag} cannot join this voice channel.`
                        )
                    ],
                    components: []
                });
            }

            // PERMIT
            if (action === "permit") {
                vcData.rejected.delete(
                    target.id
                );

                vcData.banned.delete(
                    target.id
                );

                await voiceChannel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: true
                    }
                ).catch(() => {});

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Permitted",
                            `${target.user.tag} can now join this voice channel.`
                        )
                    ],
                    components: []
                });
            }

            // STFU
            if (action === "stfu") {
                vcData.stfu.add(
                    target.id
                );

                if (
                    target.voice.channelId ===
                    voiceChannel.id
                ) {
                    await target.voice.setMute(
                        true,
                        "Voice interface mute"
                    ).catch(() => {});
                }

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Muted",
                            `${target.user.tag} has been muted.`
                        )
                    ],
                    components: []
                });
            }

            // UNSTFU
            if (action === "unstfu") {
                vcData.stfu.delete(
                    target.id
                );

                if (
                    target.voice.channelId ===
                    voiceChannel.id
                ) {
                    await target.voice.setMute(
                        false,
                        "Voice interface unmute"
                    ).catch(() => {});
                }

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Member Unmuted",
                            `${target.user.tag} has been unmuted.`
                        )
                    ],
                    components: []
                });
            }

            // TRANSFER
            if (action === "transfer") {
                vcData.ownerId =
                    target.id;

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.update({
                    embeds: [
                        successEmbed(
                            "Ownership Transferred",
                            `${target.user.tag} is now the owner.`
                        )
                    ],
                    components: []
                });
            }
        }

        // ==================================================
        // MODALS
        // ==================================================

        if (interaction.isModalSubmit()) {
            const member =
                await interaction.guild.members.fetch(
                    interaction.user.id
                ).catch(() => null);

            if (!member) return;

            let voiceChannel = null;
            let vcData = null;

            for (const [
                channelId,
                data
            ] of tempVCs.entries()) {
                if (
                    data.interfaceChannelId ===
                    interaction.channelId
                ) {
                    voiceChannel =
                        interaction.guild.channels.cache.get(
                            channelId
                        );

                    vcData = data;

                    break;
                }
            }

            if (
                !voiceChannel ||
                !vcData
            ) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "Voice Channel",
                            "This voice channel no longer exists."
                        )
                    ],
                    ephemeral: true
                });
            }

            if (
                vcData.ownerId !== member.id &&
                !isFounder(member)
            ) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "Access Denied",
                            "Only the VC owner or Founder can do that."
                        )
                    ],
                    ephemeral: true
                });
            }

            // RENAME
            if (
                interaction.customId ===
                "vc_rename_modal"
            ) {
                const name =
                    interaction.fields.getTextInputValue(
                        "vc_name"
                    );

                const cleanName =
                    name
                        .replace(/[^\p{L}\p{N}\s._-]/gu, "")
                        .slice(0, 100)
                        .trim();

                if (!cleanName) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Name",
                                "That channel name is not valid."
                            )
                        ],
                        ephemeral: true
                    });
                }

                await voiceChannel.setName(
                    cleanName
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "Voice Renamed",
                            `The channel has been renamed to ${cleanName}.`
                        )
                    ],
                    ephemeral: true
                });
            }

            // LIMIT
            if (
                interaction.customId ===
                "vc_limit_modal"
            ) {
                const amount =
                    Number(
                        interaction.fields.getTextInputValue(
                            "vc_limit_amount"
                        )
                    );

                if (
                    !Number.isInteger(amount) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Limit",
                                "The limit must be between 0 and 99."
                            )
                        ],
                        ephemeral: true
                    });
                }

                await voiceChannel.setUserLimit(
                    amount
                );

                await updateVCInterface(
                    voiceChannel
                );

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "User Limit Updated",
                            `The voice channel limit is now ${amount === 0 ? "unlimited" : amount}.`
                        )
                    ],
                    ephemeral: true
                });
            }
        }
    } catch (error) {
        console.error(
            "Interaction error:",
            error
        );

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "Interaction Error",
                        "Something went wrong while processing that action."
                    )
                ],
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

            if (!guild) return;

            const guildData =
                getGuildData(
                    guild.id
                );

            // JOIN TO CREATE
            if (
                newState.channelId &&
                newState.channelId ===
                    guildData.jtc.channelId
            ) {
                const member =
                    newState.member;

                if (member) {
                    await createPersonalVC(
                        member
                    );
                }

                return;
            }

            // ENTER TEMP VC
            if (newState.channelId) {
                const channel =
                    guild.channels.cache.get(
                        newState.channelId
                    );

                const vcData =
                    channel
                        ? getVCData(channel.id)
                        : null;

                if (
                    channel &&
                    vcData &&
                    newState.member
                ) {
                    const userId =
                        newState.member.id;

                    if (
                        vcData.banned.has(
                            userId
                        ) ||
                        vcData.rejected.has(
                            userId
                        )
                    ) {
                        await newState.member.voice
                            .disconnect()
                            .catch(() => {});

                        return;
                    }

                    if (
                        vcData.stfu.has(
                            userId
                        )
                    ) {
                        await newState.member.voice
                            .setMute(
                                true,
                                "Persistent voice mute"
                            )
                            .catch(() => {});
                    }

                    await syncInterfacePermissions(
                        channel,
                        guild.channels.cache.get(
                            vcData.interfaceChannelId
                        )
                    );
                }
            }

            // LEAVE TEMP VC
            if (oldState.channelId) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (oldChannel) {
                    const vcData =
                        getVCData(
                            oldChannel.id
                        );

                    if (vcData) {
                        await updateVCInterface(
                            oldChannel
                        );

                        await deleteEmptyVC(
                            oldChannel
                        );
                    }
                }
            }

            // UPDATE NEW CHANNEL
            if (newState.channelId) {
                const newChannel =
                    guild.channels.cache.get(
                        newState.channelId
                    );

                if (
                    newChannel &&
                    getVCData(newChannel.id)
                ) {
                    await updateVCInterface(
                        newChannel
                    );
                }
            }
        } catch (error) {
            console.error(
                "Voice state error:",
                error
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
    executorId,
    action
) {
    const key =
        `${guildId}:${executorId}:${action}`;

    const now = Date.now();

    const entries =
        auditTracker.get(key) ?? [];

    const recent =
        entries.filter(
            time =>
                now - time < 10000
        );

    recent.push(now);

    auditTracker.set(
        key,
        recent
    );

    return recent.length;
}

async function getAuditExecutor(
    guild,
    type
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 5
            });

        const entry =
            logs.entries.first();

        if (!entry) return null;

        if (
            Date.now() -
                entry.createdTimestamp >
            10000
        ) {
            return null;
        }

        return entry.executor;
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
        await guild.members.fetch(
            user.id
        ).catch(() => null);

    if (!member) return;

    if (isFounder(member)) {
        return;
    }

    try {
        await member.ban({
            reason
        });
    } catch {}

    const data =
        getGuildData(
            guild.id
        );

    if (
        !data.foreverBanned.includes(
            user.id
        )
    ) {
        data.foreverBanned.push(
            user.id
        );
    }

    saveDB();
}

client.on(
    "channelCreate",
    async channel => {
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

        if (!executor) return;

        if (
            executor.id ===
            client.user.id
        ) {
            return;
        }

        const count =
            trackAudit(
                channel.guild.id,
                executor.id,
                "channelCreate"
            );

        if (count >= 5) {
            await channel.delete()
                .catch(() => {});

            await securityPunish(
                channel.guild,
                executor,
                "Anti-nuke: excessive channel creation"
            );
        }
    }
);

client.on(
    "channelDelete",
    async channel => {
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

        if (!executor) return;

        if (
            executor.id ===
            client.user.id
        ) {
            return;
        }

        const count =
            trackAudit(
                channel.guild.id,
                executor.id,
                "channelDelete"
            );

        if (count >= 3) {
            await securityPunish(
                channel.guild,
                executor,
                "Anti-nuke: excessive channel deletion"
            );
        }
    }
);

client.on(
    "roleCreate",
    async role => {
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

        if (!executor) return;

        if (
            executor.id ===
            client.user.id
        ) {
            return;
        }

        const count =
            trackAudit(
                role.guild.id,
                executor.id,
                "roleCreate"
            );

        if (count >= 5) {
            await role.delete()
                .catch(() => {});

            await securityPunish(
                role.guild,
                executor,
                "Anti-nuke: excessive role creation"
            );
        }
    }
);

client.on(
    "roleDelete",
    async role => {
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

        if (!executor) return;

        if (
            executor.id ===
            client.user.id
        ) {
            return;
        }

        const count =
            trackAudit(
                role.guild.id,
                executor.id,
                "roleDelete"
            );

        if (count >= 3) {
            await securityPunish(
                role.guild,
                executor,
                "Anti-nuke: excessive role deletion"
            );
        }
    }
);

// ======================================================
// FOREVER BAN PROTECTION
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        const data =
            getGuildData(
                member.guild.id
            );

        if (
            !data.foreverBanned.includes(
                member.id
            )
        ) {
            return;
        }

        await member.ban({
            reason:
                "Forever ban protection"
        }).catch(() => {});
    }
);

// ======================================================
// ERROR PROTECTION
// ======================================================

client.on(
    "error",
    error => {
        console.error(
            "Discord client error:",
            error
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "Discord shard error:",
            error
        );
    }
);

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

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    () => {
        console.log(
            `${BOT_NAME} is online as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: "VC+",
                    type: ActivityType.Watching
                }
            ],
            status: "online"
        });
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown() {
    try {
        saveDB();

        for (const [
            channelId
        ] of tempVCs) {
            const channel =
                client.channels.cache.get(
                    channelId
                );

            if (channel) {
                await deleteEmptyVC(
                    channel
                ).catch(() => {});
            }
        }

        await client.destroy();
    } catch (error) {
        console.error(
            "Shutdown error:",
            error
        );
    }

    process.exit(0);
}

process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);

// ======================================================
// LOGIN
// ======================================================

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
