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

if (!db.guilds) {
    db.guilds = {};
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("[DB SAVE ERROR]", error);
    }
}

function defaultGuildData() {
    return {
        ranks: {},
        foreverBanned: [],
        godmode: [],
        vouches: {},

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },

        roles: {
            vouch: null
        },

        vouchSettings: {
            limit: 5
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
    data.vouches ??= {};

    data.jtc ??= {
        enabled: false,
        channelId: null,
        categoryId: null
    };

    data.roles ??= {
        vouch: null
    };

    data.vouchSettings ??= {
        limit: 5
    };

    data.protection ??= {
        enabled: true,
        channelCreate: true,
        channelDelete: true,
        roleCreate: true,
        roleDelete: true,
        webhookCreate: true
    };

    data.filters ??= {
        enabled: false,
        words: [],
        strikes: {},
        logChannelId: null,
        maxStrikes: 3,
        timeoutMinutes: 10,
        warningDeleteMs: 5000
    };

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

    const value = String(rank)
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (value === "member") return "member";
    if (value === "staff") return "staff";
    if (value === "moderator" || value === "mod") return "moderator";
    if (value === "admin" || value === "administrator") return "admin";
    if (value === "director") return "director";
    if (value === "executive" || value === "exec") return "executive";
    if (value === "coowner") return "coowner";
    if (value === "owner") return "owner";
    if (value === "god" || value === "godmode") return "god";
    if (value === "founder") return "founder";

    return null;
}

function getRank(member) {
    if (!member) return "member";

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);
    const savedRank = normalizeRank(data.ranks[member.id]);

    return savedRank || "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] || 1;
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

    if (isFounder(member)) return true;

    if (getRankLevel(member) >= RANKS.god) {
        return true;
    }

    const data = getGuildData(member.guild.id);

    return data.godmode.includes(member.id);
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

function successEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`✅ ${description}`)
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription(`❌ ${description}`)
        .setTimestamp();
}

function infoEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(`ℹ️ ${description}`)
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
// MODERATION DMS
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
            .setColor(
                action.toLowerCase().includes("ban")
                    ? 0xed4245
                    : 0xfee75c
            )
            .setTitle(`${BOT_NAME} • Moderation Notice`)
            .addFields(
                {
                    name: "Server",
                    value: guild.name,
                    inline: true
                },
                {
                    name: "Action",
                    value: action,
                    inline: true
                },
                {
                    name: "Reason",
                    value: reason || "No reason provided."
                }
            )
            .setTimestamp();

        if (duration) {
            embed.addFields({
                name: "Duration",
                value: duration
            });
        }

        embed.setFooter({
            text: `${BOT_NAME} Moderation`
        });

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

function containsFilteredWord(content, words) {
    const lower = content.toLowerCase();

    return words.some(word => {
        const clean = String(word).toLowerCase().trim();

        if (!clean) return false;

        return lower.includes(clean);
    });
}

async function handleFilteredMessage(message) {
    if (!message.guild || message.author.bot) {
        return false;
    }

    const data = getGuildData(message.guild.id);
    const filter = data.filters;

    if (!filter.enabled || filter.words.length === 0) {
        return false;
    }

    if (!containsFilteredWord(message.content, filter.words)) {
        return false;
    }

    const userId = message.author.id;

    filter.strikes[userId] =
        (filter.strikes[userId] || 0) + 1;

    saveDB();

    await message.delete().catch(() => {});

    const warning = await message.channel.send({
        embeds: [
            errorEmbed(
                `${message.author}, your message was removed because it matched the server filter. Strike **${filter.strikes[userId]}/${filter.maxStrikes}**.`
            )
        ]
    }).catch(() => null);

    if (warning) {
        setTimeout(() => {
            warning.delete().catch(() => {});
        }, filter.warningDeleteMs);
    }

    if (filter.strikes[userId] >= filter.maxStrikes) {
        const member = await message.guild.members
            .fetch(userId)
            .catch(() => null);

        if (member && member.moderatable) {
            const timeoutMs =
                filter.timeoutMinutes * 60 * 1000;

            await sendModerationDM(
                member.user,
                message.guild,
                "Timeout",
                "Automatic moderation: too many filtered-message strikes.",
                `${filter.timeoutMinutes} minutes`
            );

            await member.timeout(
                timeoutMs,
                "VC+ AutoMod: maximum filter strikes"
            ).catch(() => {});

            filter.strikes[userId] = 0;
            saveDB();
        }
    }

    if (filter.logChannelId) {
        const logChannel = message.guild.channels.cache.get(
            filter.logChannelId
        );

        if (logChannel?.isTextBased()) {
            logChannel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xed4245)
                        .setTitle("AutoMod Action")
                        .addFields(
                            {
                                name: "User",
                                value: `${message.author.tag} (${message.author.id})`
                            },
                            {
                                name: "Action",
                                value: "Filtered message deleted"
                            },
                            {
                                name: "Strikes",
                                value: `${filter.strikes[userId]}/${filter.maxStrikes}`
                            }
                        )
                        .setTimestamp()
                ]
            }).catch(() => {});
        }
    }

    return true;
}

// ======================================================
// VOUCH SYSTEM
// ======================================================

function getVouchCount(guildId, userId) {
    const data = getGuildData(guildId);

    return Number(data.vouches[userId] || 0);
}

async function updateVouchRole(guild, member) {
    if (!guild || !member) return;

    const data = getGuildData(guild.id);

    const roleId = data.roles.vouch;
    const limit = Number(data.vouchSettings.limit || 0);

    if (!roleId || !limit) return;

    const role = guild.roles.cache.get(roleId);

    if (!role) return;

    const count = getVouchCount(
        guild.id,
        member.id
    );

    if (count >= limit) {
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(
                role,
                `Reached ${limit} vouches`
            ).catch(() => {});
        }
    } else {
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(
                role,
                `Vouches below ${limit}`
            ).catch(() => {});
        }
    }
}

async function giveVouch(guild, target) {
    const data = getGuildData(guild.id);

    data.vouches[target.id] =
        getVouchCount(guild.id, target.id) + 1;

    saveDB();

    await updateVouchRole(guild, target);

    return data.vouches[target.id];
}

async function takeVouch(guild, target) {
    const data = getGuildData(guild.id);

    const current =
        getVouchCount(guild.id, target.id);

    data.vouches[target.id] =
        Math.max(0, current - 1);

    saveDB();

    await updateVouchRole(guild, target);

    return data.vouches[target.id];
}

async function clearVouches(guild, target) {
    const data = getGuildData(guild.id);

    data.vouches[target.id] = 0;

    saveDB();

    await updateVouchRole(guild, target);

    return 0;
}

function getTopVouches(guild, limit = 10) {
    const data = getGuildData(guild.id);

    return Object.entries(data.vouches)
        .map(([userId, count]) => ({
            userId,
            count: Number(count) || 0
        }))
        .filter(x => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

// ======================================================
// VOUCH ROLE
// ======================================================

async function setVouchRole(guild, role) {
    const data = getGuildData(guild.id);

    data.roles.vouch = role.id;

    saveDB();

    for (const member of guild.members.cache.values()) {
        await updateVouchRole(guild, member);
    }
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

function getTempVC(channelId) {
    return tempVCs.get(channelId);
}

function isTempVC(channelId) {
    return tempVCs.has(channelId);
}

// ======================================================
// VC PERMISSIONS
// ======================================================

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
// VC INTERFACE
// ======================================================

function buildVCInterfaceComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("vc_kick")
            .setLabel("Kick")
            .setEmoji("👢")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("vc_disconnect")
            .setLabel("Disconnect")
            .setEmoji("🔌")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("vc_ban")
            .setLabel("VC Ban")
            .setEmoji("🚫")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("vc_reject")
            .setLabel("Reject")
            .setEmoji("⛔")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("vc_permit")
            .setLabel("Permit")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("vc_stfu")
            .setLabel("STFU")
            .setEmoji("🔇")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("vc_unstfu")
            .setLabel("UnSTFU")
            .setEmoji("🔊")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("vc_lock")
            .setLabel("Lock")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("vc_unlock")
            .setLabel("Unlock")
            .setEmoji("🔓")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("vc_claim")
            .setLabel("Claim")
            .setEmoji("👑")
            .setStyle(ButtonStyle.Primary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("vc_transfer")
            .setLabel("Transfer")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("vc_forceclaim")
            .setLabel("Force Claim")
            .setEmoji("⚡")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("vc_rename")
            .setLabel("Rename")
            .setEmoji("✏️")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("vc_limit")
            .setLabel("Limit")
            .setEmoji("👥")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("vc_refresh")
            .setLabel("Refresh")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2, row3];
}

// ======================================================
// VC CONTROL CHANNEL
// ======================================================

async function ensureVCInterfaceChannel(channel) {
    const vc = getTempVC(channel.id);

    if (!vc) return null;

    if (vc.interfaceChannelId) {
        const existing = channel.guild.channels.cache.get(
            vc.interfaceChannelId
        );

        if (existing?.isTextBased()) {
            return existing;
        }
    }

    const safeName =
        `vc-control-${channel.id}`.slice(0, 100);

    const controlChannel =
        await channel.guild.channels.create({
            name: safeName,
            type: ChannelType.GuildText,
            parent: channel.parentId || null,
            topic: `VC+ control panel for ${channel.name}`,

            permissionOverwrites: [
                {
                    id: channel.guild.roles.everyone.id,
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
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ]
        })
        .catch(() => null);

    if (!controlChannel) {
        return null;
    }

    vc.interfaceChannelId = controlChannel.id;

    saveDB();

    return controlChannel;
}

// ======================================================
// UPDATE VC INTERFACE
// ======================================================

async function updateVCInterface(channel) {
    const vc = getTempVC(channel.id);

    if (!vc) return;

    const interfaceChannel =
        await ensureVCInterfaceChannel(channel);

    if (!interfaceChannel?.isTextBased()) {
        return;
    }

    const owner =
        channel.guild.members.cache.get(vc.ownerId);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎛️ VC+ Control Panel")
        .setDescription(
            [
                `**Voice Channel:** ${channel.name}`,
                `**Owner:** ${owner ? owner : `<@${vc.ownerId}>`}`,
                `**Members:** ${channel.members.size}`,
                `**Status:** ${vc.locked ? "🔒 Locked" : "🔓 Unlocked"}`,
                "",
                "**Click the buttons below to control the VC.**",
                "",
                "Target actions will open a member selector.",
                "You do not need to type commands."
            ].join("\n")
        )
        .addFields({
            name: "VC Count",
            value: `${channel.members.size}/${channel.userLimit || "∞"}`,
            inline: true
        })
        .setFooter({
            text: `${BOT_NAME} • Click controls`
        })
        .setTimestamp();

    const payload = {
        embeds: [embed],
        components: buildVCInterfaceComponents()
    };

    if (vc.interfaceMessageId) {
        const oldMessage =
            await interfaceChannel.messages
                .fetch(vc.interfaceMessageId)
                .catch(() => null);

        if (oldMessage) {
            await oldMessage.edit(payload).catch(() => {});
            return;
        }
    }

    const newMessage =
        await interfaceChannel.send(payload)
            .catch(() => null);

    if (newMessage) {
        vc.interfaceMessageId = newMessage.id;
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const data = getGuildData(member.guild.id);

    if (!data.jtc.enabled) {
        return null;
    }

    const category =
        data.jtc.categoryId
            ? member.guild.channels.cache.get(
                data.jtc.categoryId
            )
            : null;

    const channel =
        await member.guild.channels.create({
            name: `${member.displayName}'s VC`,
            type: ChannelType.GuildVoice,
            parent: category?.id || null,

            userLimit: 0,

            permissionOverwrites: [
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.Stream,
                        PermissionFlagsBits.MoveMembers,
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.DeafenMembers,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ]
        })
        .catch(error => {
            console.error("[VC CREATE ERROR]", error);
            return null;
        });

    if (!channel) {
        return null;
    }

    const vcData =
        createVCData(
            member.guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await member.voice
        .setChannel(channel)
        .catch(() => {});

    await updateVCInterface(channel);

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    const vc = getTempVC(channel.id);

    if (!vc) return;

    if (channel.members.size > 0) {
        return;
    }

    const interfaceChannelId =
        vc.interfaceChannelId;

    tempVCs.delete(channel.id);

    await channel.delete(
        "VC+ temporary voice channel cleanup"
    ).catch(() => {});

    if (interfaceChannelId) {
        const interfaceChannel =
            channel.guild.channels.cache.get(
                interfaceChannelId
            );

        if (interfaceChannel) {
            await interfaceChannel.delete(
                "VC+ control panel cleanup"
            ).catch(() => {});
        }
    }
}

// ======================================================
// VC SELECT MENU
// ======================================================

async function showVCTargetSelector(
    interaction,
    action,
    placeholder
) {
    const select =
        new UserSelectMenuBuilder()
            .setCustomId(`vc_target_${action}`)
            .setPlaceholder(placeholder)
            .setMinValues(1)
            .setMaxValues(1);

    const row =
        new ActionRowBuilder()
            .addComponents(select);

    await interaction.reply({
        embeds: [
            infoEmbed(
                "Select the member you want to target."
            )
        ],
        components: [row],
        ephemeral: true
    });
}

// ======================================================
// GET CURRENT VC
// ======================================================

function getInteractionVC(interaction) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return null;
    }

    return getTempVC(
        member.voice.channel.id
    );
}

// ======================================================
// VC TARGET ACTION
// ======================================================

async function executeVCTargetAction(
    interaction,
    action,
    target
) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "You must be inside a personal VC."
                )
            ],
            ephemeral: true
        });
    }

    const channel = member.voice.channel;
    const vc = getTempVC(channel.id);

    if (!vc) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "This is not a VC+ personal voice channel."
                )
            ],
            ephemeral: true
        });
    }

    const founder =
        isFounder(member);

    const god =
        isGod(member);

    const owner =
        vc.ownerId === member.id;

    if (
        [
            "kick",
            "disconnect",
            "ban",
            "reject",
            "permit",
            "lock",
            "unlock",
            "transfer",
            "rename",
            "limit",
            "refresh"
        ].includes(action)
    ) {
        if (!owner && !founder) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can do that."
                    )
                ],
                ephemeral: true
            });
        }
    }

    if (action === "stfu" || action === "unstfu") {
        if (!god) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "God or Founder rank is required."
                    )
                ],
                ephemeral: true
            });
        }
    }

    if (action === "forceclaim") {
        if (!god) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "God or Founder rank is required."
                    )
                ],
                ephemeral: true
            });
        }
    }

    if (!target) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "That member could not be found."
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // KICK
    // --------------------------------------------------

    if (action === "kick") {
        if (!canModerate(member, target)) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "You cannot kick someone at or above your rank."
                    )
                ],
                ephemeral: true
            });
        }

        await sendModerationDM(
            target.user,
            interaction.guild,
            "VC Kick",
            `Removed from ${channel.name}.`
        );

        await target.voice
            .disconnect(`VC+ Kick by ${member.user.tag}`)
            .catch(() => {});

        return interaction.reply({
            embeds: [
                successEmbed(
                    `Kicked ${target} from the VC.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------

    if (action === "disconnect") {
        if (
            isFounder(target) &&
            !isFounder(member)
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "You cannot disconnect the Founder."
                    )
                ],
                ephemeral: true
            });
        }

        await target.voice
            .disconnect(
                `VC+ Disconnect by ${member.user.tag}`
            )
            .catch(() => {});

        return interaction.reply({
            embeds: [
                successEmbed(
                    `Disconnected ${target}.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // VC BAN
    // --------------------------------------------------

    if (action === "ban") {
        if (
            isFounder(target) &&
            !isFounder(member)
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "You cannot VC ban the Founder."
                    )
                ],
                ephemeral: true
            });
        }

        vc.banned.add(target.id);
        vc.rejected.delete(target.id);
        vc.permitted.delete(target.id);

        await applyVCBan(
            channel,
            target.id
        );

        await sendModerationDM(
            target.user,
            interaction.guild,
            "VC Ban",
            `You were VC banned from ${channel.name}.`
        );

        await target.voice
            .disconnect(
                `VC+ VC Ban by ${member.user.tag}`
            )
            .catch(() => {});

        return interaction.reply({
            embeds: [
                successEmbed(
                    `VC banned ${target}.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // REJECT
    // --------------------------------------------------

    if (action === "reject") {
        vc.rejected.add(target.id);
        vc.permitted.delete(target.id);

        return interaction.reply({
            embeds: [
                successEmbed(
                    `${target} is now rejected from this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // PERMIT
    // --------------------------------------------------

    if (action === "permit") {
        vc.permitted.add(target.id);
        vc.rejected.delete(target.id);
        vc.banned.delete(target.id);

        await removeVCBan(
            channel,
            target.id
        );

        return interaction.reply({
            embeds: [
                successEmbed(
                    `${target} is now permitted in this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // STFU
    // --------------------------------------------------

    if (action === "stfu") {
        if (
            isFounder(target) &&
            !isFounder(member)
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "You cannot STFU the Founder."
                    )
                ],
                ephemeral: true
            });
        }

        vc.stfu.add(target.id);

        await target.voice
            .setMute(
                true,
                `VC+ STFU by ${member.user.tag}`
            )
            .catch(() => {});

        return interaction.reply({
            embeds: [
                successEmbed(
                    `${target} is now STFU'd in this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // UNSTFU
    // --------------------------------------------------

    if (action === "unstfu") {
        vc.stfu.delete(target.id);

        await target.voice
            .setMute(
                false,
                `VC+ UNSTFU by ${member.user.tag}`
            )
            .catch(() => {});

        return interaction.reply({
            embeds: [
                successEmbed(
                    `${target} is no longer STFU'd.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // TRANSFER
    // --------------------------------------------------

    if (action === "transfer") {
        vc.ownerId = target.id;

        await channel.permissionOverwrites
            .edit(target.id, {
                Connect: true,
                Speak: true,
                Stream: true,
                MoveMembers: true,
                MuteMembers: true,
                DeafenMembers: true,
                ManageChannels: true
            })
            .catch(() => {});

        await updateVCInterface(channel);

        return interaction.reply({
            embeds: [
                successEmbed(
                    `VC ownership transferred to ${target}.`
                )
            ],
            ephemeral: true
        });
    }

    // --------------------------------------------------
    // FORCE CLAIM
    // --------------------------------------------------

    if (action === "forceclaim") {
        vc.ownerId = target.id;

        await channel.permissionOverwrites
            .edit(target.id, {
                Connect: true,
                Speak: true,
                Stream: true,
                MoveMembers: true,
                MuteMembers: true,
                DeafenMembers: true,
                ManageChannels: true
            })
            .catch(() => {});

        await updateVCInterface(channel);

        return interaction.reply({
            embeds: [
                successEmbed(
                    `Force claimed the VC for ${target}.`
                )
            ],
            ephemeral: true
        });
    }

    return interaction.reply({
        embeds: [
            errorEmbed(
                "Unknown VC action."
            )
        ],
        ephemeral: true
    });
}

// ======================================================
// VC BUTTONS / SELECTS / MODALS
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) {
            const id = interaction.customId;

            const targetActions = {
                vc_kick: ["kick", "Select a member to kick."],
                vc_disconnect: ["disconnect", "Select a member to disconnect."],
                vc_ban: ["ban", "Select a member to VC ban."],
                vc_reject: ["reject", "Select a member to reject."],
                vc_permit: ["permit", "Select a member to permit."],
                vc_stfu: ["stfu", "Select a member to STFU."],
                vc_unstfu: ["unstfu", "Select a member to unSTFU."],
                vc_transfer: ["transfer", "Select the new VC owner."],
                vc_forceclaim: ["forceclaim", "Select the member to force claim for."]
            };

            if (targetActions[id]) {
                const [action, placeholder] =
                    targetActions[id];

                return showVCTargetSelector(
                    interaction,
                    action,
                    placeholder
                );
            }

            const member = interaction.member;

            if (!member?.voice?.channel) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "You must be inside your personal VC."
                        )
                    ],
                    ephemeral: true
                });
            }

            const channel =
                member.voice.channel;

            const vc =
                getTempVC(channel.id);

            if (!vc) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "This is not a VC+ personal VC."
                        )
                    ],
                    ephemeral: true
                });
            }

            const owner =
                vc.ownerId === member.id;

            const founder =
                isFounder(member);

            const god =
                isGod(member);

            // LOCK
            if (id === "vc_lock") {
                if (!owner && !founder) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Only the VC owner or Founder can lock this VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                vc.locked = true;

                await channel.permissionOverwrites
                    .edit(
                        interaction.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "VC locked."
                        )
                    ],
                    ephemeral: true
                });
            }

            // UNLOCK
            if (id === "vc_unlock") {
                if (!owner && !founder) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Only the VC owner or Founder can unlock this VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                vc.locked = false;

                await channel.permissionOverwrites
                    .edit(
                        interaction.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "VC unlocked."
                        )
                    ],
                    ephemeral: true
                });
            }

            // CLAIM
            if (id === "vc_claim") {
                if (
                    channel.members.has(vc.ownerId)
                ) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "The current VC owner is still in the VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                vc.ownerId = member.id;

                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "You claimed the VC."
                        )
                    ],
                    ephemeral: true
                });
            }

            // RENAME
            if (id === "vc_rename") {
                if (!owner && !founder) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Only the VC owner or Founder can rename it."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId("vc_rename_modal")
                        .setTitle("Rename VC");

                const input =
                    new TextInputBuilder()
                        .setCustomId("vc_name")
                        .setLabel("New VC name")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(100)
                        .setPlaceholder("Enter the new VC name");

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(modal);
            }

            // LIMIT
            if (id === "vc_limit") {
                if (!owner && !founder) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Only the VC owner or Founder can change the limit."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId("vc_limit_modal")
                        .setTitle("VC User Limit");

                const input =
                    new TextInputBuilder()
                        .setCustomId("vc_limit_value")
                        .setLabel("User limit")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(2)
                        .setPlaceholder("0 = unlimited");

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(modal);
            }

            // REFRESH
            if (id === "vc_refresh") {
                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            "VC interface refreshed."
                        )
                    ],
                    ephemeral: true
                });
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
                    "vc_target_"
                )
            ) {
                return;
            }

            const action =
                customId.replace(
                    "vc_target_",
                    ""
                );

            const targetId =
                interaction.values[0];

            const target =
                await interaction.guild.members
                    .fetch(targetId)
                    .catch(() => null);

            if (!target) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "Member not found."
                        )
                    ],
                    ephemeral: true
                });
            }

            return executeVCTargetAction(
                interaction,
                action,
                target
            );
        }

        // ==================================================
        // MODALS
        // ==================================================

        if (interaction.isModalSubmit()) {
            const member =
                interaction.member;

            if (!member?.voice?.channel) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "You must be inside your VC."
                        )
                    ],
                    ephemeral: true
                });
            }

            const channel =
                member.voice.channel;

            const vc =
                getTempVC(channel.id);

            if (!vc) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
                            "This is not a VC+ personal VC."
                        )
                    ],
                    ephemeral: true
                });
            }

            const owner =
                vc.ownerId === member.id;

            const founder =
                isFounder(member);

            if (!owner && !founder) {
                return interaction.reply({
                    embeds: [
                        errorEmbed(
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
                const newName =
                    interaction.fields
                        .getTextInputValue(
                            "vc_name"
                        )
                        .trim();

                if (!newName) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "Enter a valid VC name."
                            )
                        ],
                        ephemeral: true
                    });
                }

                await channel
                    .setName(
                        newName.slice(0, 100)
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            `VC renamed to **${newName.slice(0, 100)}**.`
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
                const raw =
                    interaction.fields
                        .getTextInputValue(
                            "vc_limit_value"
                        )
                        .trim();

                const limit =
                    Number(raw);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return interaction.reply({
                        embeds: [
                            errorEmbed(
                                "The limit must be a whole number from 0 to 99."
                            )
                        ],
                        ephemeral: true
                    });
                }

                await channel
                    .setUserLimit(limit)
                    .catch(() => {});

                await updateVCInterface(channel);

                return interaction.reply({
                    embeds: [
                        successEmbed(
                            limit === 0
                                ? "VC user limit set to unlimited."
                                : `VC user limit set to **${limit}**.`
                        )
                    ],
                    ephemeral: true
                });
            }
        }
    } catch (error) {
        console.error(
            "[INTERACTION ERROR]",
            error
        );

        if (!interaction.replied &&
            !interaction.deferred) {
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "Something went wrong while processing that."
                    )
                ],
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${BOT_NAME} • Commands`)
        .setDescription(
            [
                `Prefix: \`${PREFIX}\``,
                "",
                "**🎙️ VC**",
                "`-vc setup`",
                "`-vc panel`",
                "`-vc count`",
                "`-vc kick @user`",
                "`-vc disconnect @user`",
                "`-vc ban @user`",
                "`-vc reject @user`",
                "`-vc permit @user`",
                "`-vc lock`",
                "`-vc unlock`",
                "`-vc limit <0-99>`",
                "`-vc rename <name>`",
                "`-vc transfer @user`",
                "`-vc claim`",
                "`-vc forceclaim @user`",
                "`-vc stfu @user`",
                "`-vc unstfu @user`",
                "",
                "**⭐ VOUCHES**",
                "`-vouch give @user`",
                "`-vouch take @user`",
                "`-vouch clear @user`",
                "`-vouch list`",
                "`-vouch role set @role`",
                "`-vouch limit <number>`",
                "`-vouchrole view`",
                "",
                "**🛡️ MODERATION**",
                "`-ban @user`",
                "`-unban <user ID>`",
                "`-unbanall`",
                "`-banlist`",
                "`-kick @user`",
                "`-timeout @user <minutes>`",
                "`-untimeout @user`",
                "`-foreverban @user`",
                "`-rank @user <rank>`",
                "`-godmode @user`",
                "`-purge <amount>`",
                "",
                "**🔒 FILTER**",
                "`-filter on`",
                "`-filter off`",
                "`-filter add <word>`",
                "`-filter remove <word>`",
                "`-filter list`",
                "`-filter log <#channel>`",
                "`-filter strikes @user`",
                "`-filter reset @user`"
            ].join("\n")
        )
        .setFooter({
            text: `${BOT_NAME}`
        });
}

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (
            !message.guild ||
            message.author.bot
        ) {
            return;
        }

        const filtered =
            await handleFilteredMessage(message);

        if (filtered) {
            return;
        }

        if (
            !message.content.startsWith(
                PREFIX
            )
        ) {
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
            await message.guild.members
                .fetch(message.author.id)
                .catch(() => message.member);

        const data =
            getGuildData(message.guild.id);

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
        // VOUCH GIVE
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "give"
        ) {
            const target =
                message.mentions.members.first();

            if (!target) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-vouch give @user`"
                        )
                    ]
                });
            }

            if (
                target.user.bot
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot give vouches to bots."
                        )
                    ]
                });
            }

            if (
                target.id === member.id
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot vouch yourself."
                        )
                    ]
                });
            }

            const count =
                await giveVouch(
                    message.guild,
                    target
                );

            return message.reply({
                embeds: [
                    successEmbed(
                        `${target} received a vouch. They now have **${count}** vouch${count === 1 ? "" : "es"}.`
                    )
                ]
            });
        }

        // ==================================================
        // VOUCH TAKE
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "take"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Usage: `-vouch take @user`"
                        )
                    ]
                });
            }

            const count =
                await takeVouch(
                    message.guild,
                    target
                );

            return message.reply({
                embeds: [
                    successEmbed(
                        `Removed one vouch from ${target}. They now have **${count}**.`
                    )
                ]
            });
        }

        // ==================================================
        // VOUCH CLEAR
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "clear"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Usage: `-vouch clear @user`"
                        )
                    ]
                });
            }

            await clearVouches(
                message.guild,
                target
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        `Cleared all vouches from ${target}.`
                    )
                ]
            });
        }

        // ==================================================
        // VOUCH LIST
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "list"
        ) {
            const top =
                getTopVouches(
                    message.guild,
                    10
                );

            if (!top.length) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "There are no vouches yet."
                        )
                    ]
                });
            }

            const lines = [];

            for (
                let i = 0;
                i < top.length;
                i++
            ) {
                const entry = top[i];

                const user =
                    await client.users
                        .fetch(entry.userId)
                        .catch(() => null);

                lines.push(
                    `**${i + 1}.** ${user ? user.tag : `<@${entry.userId}>`} — **${entry.count}**`
                );
            }

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle("⭐ Vouch Leaderboard")
                        .setDescription(
                            lines.join("\n")
                        )
                        .setTimestamp()
                ]
            });
        }

        // ==================================================
        // VOUCH ROLE SET
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "role" &&
            args[1]?.toLowerCase() === "set"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
                        )
                    ]
                });
            }

            const role =
                message.mentions.roles.first();

            if (!role) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-vouch role set @role`"
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
                        errorEmbed(
                            "I cannot manage that role. Move my bot role above it."
                        )
                    ]
                });
            }

            await setVouchRole(
                message.guild,
                role
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        `Vouch role set to ${role}.`
                    )
                ]
            });
        }

        // ==================================================
        // VOUCH LIMIT
        // ==================================================

        if (
            command === "vouch" &&
            args[0]?.toLowerCase() === "limit"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
                        )
                    ]
                });
            }

            const limit =
                Number(args[1]);

            if (
                !Number.isInteger(limit) ||
                limit < 1 ||
                limit > 100000
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-vouch limit <number>`"
                        )
                    ]
                });
            }

            data.vouchSettings.limit =
                limit;

            saveDB();

            for (
                const guildMember
                of message.guild.members.cache.values()
            ) {
                await updateVouchRole(
                    message.guild,
                    guildMember
                );
            }

            return message.reply({
                embeds: [
                    successEmbed(
                        `Vouch role requirement set to **${limit}** vouches.`
                    )
                ]
            });
        }

        // ==================================================
        // VOUCHROLE VIEW
        // ==================================================

        if (
            command === "vouchrole" &&
            args[0]?.toLowerCase() === "view"
        ) {
            const role =
                data.roles.vouch
                    ? message.guild.roles.cache.get(
                        data.roles.vouch
                    )
                    : null;

            const limit =
                data.vouchSettings.limit;

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle("⭐ Vouch Role")
                        .addFields(
                            {
                                name: "Role",
                                value: role
                                    ? `${role}`
                                    : "Not set",
                                inline: true
                            },
                            {
                                name: "Requirement",
                                value: `${limit} vouches`,
                                inline: true
                            }
                        )
                        .setTimestamp()
                ]
            });
        }

        // ==================================================
        // UNBAN
        // ==================================================

        if (
            command === "unban"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
                        )
                    ]
                });
            }

            const userId =
                args[0]
                    ?.replace(/[<@!>]/g, "");

            if (
                !userId ||
                !/^\d{17,20}$/.test(userId)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-unban <user ID>`"
                        )
                    ]
                });
            }

            const banned =
                await message.guild.bans
                    .fetch(userId)
                    .catch(() => null);

            if (!banned) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "That user is not banned."
                        )
                    ]
                });
            }

            const result =
                await message.guild.members
                    .unban(
                        userId,
                        `VC+ Unban by ${member.user.tag}`
                    )
                    .catch(() => null);

            if (!result) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "I could not unban that user."
                        )
                    ]
                });
            }

            await sendModerationDM(
                result,
                message.guild,
                "Unbanned",
                `You were unbanned from ${message.guild.name}.`
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        `Unbanned **${result.tag}**.`
                    )
                ]
            });
        }

        // ==================================================
        // UNBAN ALL
        // ==================================================

        if (
            command === "unbanall"
        ) {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Founder rank is required for `-unbanall`."
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
                            "I could not fetch the server ban list."
                        )
                    ]
                });
            }

            if (!bans.size) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "There are no banned users."
                        )
                    ]
                });
            }

            let success = 0;
            let failed = 0;

            for (
                const ban of bans.values()
            ) {
                const result =
                    await message.guild.members
                        .unban(
                            ban.user.id,
                            `VC+ Unban All by ${member.user.tag}`
                        )
                        .catch(() => null);

                if (result) {
                    success++;

                    await sendModerationDM(
                        ban.user,
                        message.guild,
                        "Unbanned",
                        "The server's ban list was cleared by the Founder."
                    );
                } else {
                    failed++;
                }
            }

            return message.reply({
                embeds: [
                    successEmbed(
                        `Unban all finished.\n\n**Unbanned:** ${success}\n**Failed:** ${failed}`
                    )
                ]
            });
        }

        // ==================================================
        // BAN LIST
        // ==================================================

        if (
            command === "banlist"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Could not fetch bans."
                        )
                    ]
                });
            }

            if (!bans.size) {
                return message.reply({
                    embeds: [
                        infoEmbed(
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
                            `**${index + 1}.** ${ban.user.tag} — \`${ban.user.id}\``
                    )
                    .join("\n");

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xed4245)
                        .setTitle("🔨 Server Ban List")
                        .setDescription(list)
                        .setFooter({
                            text: `${bans.size} total ban(s)`
                        })
                        .setTimestamp()
                ]
            });
        }

        // ==================================================
        // FILTER
        // ==================================================

        if (
            command === "filter"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
                        )
                    ]
                });
            }

            const sub =
                args[0]?.toLowerCase();

            if (sub === "on") {
                data.filters.enabled = true;
                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "AutoMod filter enabled."
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
                            "AutoMod filter disabled."
                        )
                    ]
                });
            }

            if (sub === "add") {
                const word =
                    args.slice(1).join(" ").trim();

                if (!word) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-filter add <word>`"
                            )
                        ]
                    });
                }

                if (
                    !data.filters.words.includes(word)
                ) {
                    data.filters.words.push(word);
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            `Added \`${word}\` to the filter.`
                        )
                    ]
                });
            }

            if (sub === "remove") {
                const word =
                    args.slice(1).join(" ").trim();

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
                            `Removed \`${word}\` from the filter.`
                        )
                    ]
                });
            }

            if (sub === "list") {
                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x5865f2)
                            .setTitle("🔒 Filter Words")
                            .setDescription(
                                data.filters.words.length
                                    ? data.filters.words
                                        .map(x => `\`${x}\``)
                                        .join(", ")
                                    : "No filtered words."
                            )
                            .addFields({
                                name: "Status",
                                value: data.filters.enabled
                                    ? "Enabled"
                                    : "Disabled"
                            })
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
                                "Usage: `-filter log #channel`"
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
                            `Filter log channel set to ${channel}.`
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
                                "Usage: `-filter strikes @user`"
                            )
                        ]
                    });
                }

                const strikes =
                    data.filters.strikes[target.id] || 0;

                return message.reply({
                    embeds: [
                        infoEmbed(
                            `${target} has **${strikes}** filter strike(s).`
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
                                "Usage: `-filter reset @user`"
                            )
                        ]
                    });
                }

                data.filters.strikes[target.id] = 0;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            `Reset filter strikes for ${target}.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Use `-filter on`, `off`, `add`, `remove`, `list`, `log`, `strikes`, or `reset`."
                    )
                ]
            });
        }

        // ==================================================
        // VC COMMANDS
        // ==================================================

        if (
            command === "vc"
        ) {
            const sub =
                args.shift()?.toLowerCase();

            // ----------------------------------------------
            // SETUP
            // ----------------------------------------------

            if (sub === "setup") {
                if (!isGod(member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "God or Founder rank is required."
                            )
                        ]
                    });
                }

                let category = null;

                if (message.channel.parent) {
                    category =
                        message.channel.parent;
                }

                const jtc =
                    await message.guild.channels.create({
                        name: "➕・join-to-create",
                        type: ChannelType.GuildVoice,
                        parent: category?.id || null
                    }).catch(() => null);

                if (!jtc) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "I could not create the Join-to-Create channel."
                            )
                        ]
                    });
                }

                data.jtc.enabled = true;
                data.jtc.channelId = jtc.id;
                data.jtc.categoryId =
                    category?.id || null;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            `Join-to-Create enabled.\n\nJoin ${jtc} to create a personal VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // PANEL
            // ----------------------------------------------

            if (sub === "panel") {
                const channel =
                    member.voice.channel;

                if (!channel) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Join your personal VC first."
                            )
                        ]
                    });
                }

                if (!isTempVC(channel.id)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "This is not a VC+ personal VC."
                            )
                        ]
                    });
                }

                await updateVCInterface(
                    channel
                );

                const vc =
                    getTempVC(channel.id);

                const control =
                    vc?.interfaceChannelId
                        ? message.guild.channels.cache.get(
                            vc.interfaceChannelId
                        )
                        : null;

                return message.reply({
                    embeds: [
                        successEmbed(
                            control
                                ? `Your clickable VC interface is ${control}.`
                                : "The VC interface was refreshed."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // COUNT
            // ----------------------------------------------

            if (sub === "count") {
                const channel =
                    member.voice.channel;

                if (!channel) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "You are not in a VC."
                            )
                        ]
                    });
                }

                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x5865f2)
                            .setTitle("🎙️ VC Count")
                            .addFields(
                                {
                                    name: "Channel",
                                    value: channel.name,
                                    inline: true
                                },
                                {
                                    name: "Members",
                                    value: `${channel.members.size}`,
                                    inline: true
                                },
                                {
                                    name: "Limit",
                                    value: channel.userLimit
                                        ? `${channel.userLimit}`
                                        : "Unlimited",
                                    inline: true
                                }
                            )
                    ]
                });
            }

            const channel =
                member.voice.channel;

            if (!channel) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You must be inside a VC."
                        )
                    ]
                });
            }

            const vc =
                getTempVC(channel.id);

            if (!vc) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "This is not a VC+ personal VC."
                        )
                    ]
                });
            }

            const owner =
                vc.ownerId === member.id;

            const founder =
                isFounder(member);

            const god =
                isGod(member);

            // ----------------------------------------------
            // OWNER CHECK
            // ----------------------------------------------

            if (
                !owner &&
                !founder &&
                sub !== "forceclaim" &&
                sub !== "stfu" &&
                sub !== "unstfu"
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Only the VC owner or Founder can control this VC."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            // ----------------------------------------------
            // KICK
            // ----------------------------------------------

            if (sub === "kick") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc kick @user`"
                            )
                        ]
                    });
                }

                if (!canModerate(member, target)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot kick someone at or above your rank."
                            )
                        ]
                    });
                }

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "VC Kick",
                    `Removed from ${channel.name}.`
                );

                await target.voice
                    .disconnect(
                        `VC+ Kick by ${member.user.tag}`
                    )
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            `Kicked ${target}.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // DISCONNECT
            // ----------------------------------------------

            if (sub === "disconnect") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc disconnect @user`"
                            )
                        ]
                    });
                }

                if (
                    isFounder(target) &&
                    !founder
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot disconnect the Founder."
                            )
                        ]
                    });
                }

                await target.voice
                    .disconnect(
                        `VC+ Disconnect by ${member.user.tag}`
                    )
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            `Disconnected ${target}.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // VC BAN
            // ----------------------------------------------

            if (sub === "ban") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc ban @user`"
                            )
                        ]
                    });
                }

                if (
                    isFounder(target) &&
                    !founder
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot VC ban the Founder."
                            )
                        ]
                    });
                }

                vc.banned.add(target.id);

                await applyVCBan(
                    channel,
                    target.id
                );

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "VC Ban",
                    `You were VC banned from ${channel.name}.`
                );

                await target.voice
                    .disconnect(
                        `VC+ VC Ban by ${member.user.tag}`
                    )
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            `VC banned ${target}.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // REJECT
            // ----------------------------------------------

            if (sub === "reject") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc reject @user`"
                            )
                        ]
                    });
                }

                vc.rejected.add(target.id);
                vc.permitted.delete(target.id);

                return message.reply({
                    embeds: [
                        successEmbed(
                            `${target} is rejected from the VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // PERMIT
            // ----------------------------------------------

            if (sub === "permit") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc permit @user`"
                            )
                        ]
                    });
                }

                vc.permitted.add(target.id);
                vc.rejected.delete(target.id);
                vc.banned.delete(target.id);

                await removeVCBan(
                    channel,
                    target.id
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            `${target} is permitted in the VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LOCK
            // ----------------------------------------------

            if (sub === "lock") {
                vc.locked = true;

                await channel.permissionOverwrites
                    .edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC locked."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNLOCK
            // ----------------------------------------------

            if (sub === "unlock") {
                vc.locked = false;

                await channel.permissionOverwrites
                    .edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC unlocked."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LIMIT
            // ----------------------------------------------

            if (sub === "limit") {
                const limit =
                    Number(args[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc limit <0-99>`"
                            )
                        ]
                    });
                }

                await channel
                    .setUserLimit(limit)
                    .catch(() => {});

                await updateVCInterface(channel);

                return message.reply({
                    embeds: [
                        successEmbed(
                            limit === 0
                                ? "VC limit set to unlimited."
                                : `VC limit set to **${limit}**.`
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
                                "Usage: `-vc rename <name>`"
                            )
                        ]
                    });
                }

                await channel
                    .setName(
                        name.slice(0, 100)
                    )
                    .catch(() => {});

                await updateVCInterface(channel);

                return message.reply({
                    embeds: [
                        successEmbed(
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
                                "Usage: `-vc transfer @user`"
                            )
                        ]
                    });
                }

                vc.ownerId =
                    target.id;

                await updateVCInterface(
                    channel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            `VC transferred to ${target}.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // CLAIM
            // ----------------------------------------------

            if (sub === "claim") {
                if (
                    channel.members.has(
                        vc.ownerId
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "The current owner is still in the VC."
                            )
                        ]
                    });
                }

                vc.ownerId =
                    member.id;

                await updateVCInterface(
                    channel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "You claimed the VC."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // FORCECLAIM
            // ----------------------------------------------

            if (sub === "forceclaim") {
                if (!god) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "God or Founder rank is required."
                            )
                        ]
                    });
                }

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc forceclaim @user`"
                            )
                        ]
                    });
                }

                vc.ownerId =
                    target.id;

                await updateVCInterface(
                    channel
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            `VC force claimed for ${target}.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // STFU
            // ----------------------------------------------

            if (sub === "stfu") {
                if (!god) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "God or Founder rank is required."
                            )
                        ]
                    });
                }

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc stfu @user`"
                            )
                        ]
                    });
                }

                if (
                    isFounder(target) &&
                    !founder
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot STFU the Founder."
                            )
                        ]
                    });
                }

                vc.stfu.add(
                    target.id
                );

                await target.voice
                    .setMute(
                        true,
                        `VC+ STFU by ${member.user.tag}`
                    )
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            `${target} is now STFU'd.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNSTFU
            // ----------------------------------------------

            if (sub === "unstfu") {
                if (!god) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "God or Founder rank is required."
                            )
                        ]
                    });
                }

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-vc unstfu @user`"
                            )
                        ]
                    });
                }

                vc.stfu.delete(
                    target.id
                );

                await target.voice
                    .setMute(
                        false,
                        `VC+ UNSTFU by ${member.user.tag}`
                    )
                    .catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            `${target} is no longer STFU'd.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Use `-help` to see all VC commands."
                    )
                ]
            });
        }

        // ==================================================
        // BAN
        // ==================================================

        if (
            command === "ban"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Usage: `-ban @user`"
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot ban someone at or above your rank."
                        )
                    ]
                });
            }

            await sendModerationDM(
                target.user,
                message.guild,
                "Ban",
                `Banned by ${member.user.tag}.`
            );

            const result =
                await target.ban({
                    reason:
                        `VC+ Ban by ${member.user.tag}`
                }).catch(() => null);

            if (!result) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "I could not ban that user."
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    successEmbed(
                        `Banned ${target.user.tag}.`
                    )
                ]
            });
        }

        // ==================================================
        // KICK
        // ==================================================

        if (
            command === "kick"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Usage: `-kick @user`"
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot kick someone at or above your rank."
                        )
                    ]
                });
            }

            await sendModerationDM(
                target.user,
                message.guild,
                "Kick",
                `Kicked by ${member.user.tag}.`
            );

            const result =
                await target.kick(
                    `VC+ Kick by ${member.user.tag}`
                ).catch(() => null);

            if (!result) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "I could not kick that user."
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    successEmbed(
                        `Kicked ${target.user.tag}.`
                    )
                ]
            });
        }

        // ==================================================
        // TIMEOUT
        // ==================================================

        if (
            command === "timeout"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const minutes =
                Number(
                    args.find(x =>
                        /^\d+$/.test(x)
                    )
                );

            if (
                !target ||
                !Number.isInteger(minutes)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-timeout @user <minutes>`"
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot timeout someone at or above your rank."
                        )
                    ]
                });
            }

            const timeoutMinutes =
                Math.min(
                    Math.max(minutes, 1),
                    40320
                );

            await sendModerationDM(
                target.user,
                message.guild,
                "Timeout",
                `Timed out by ${member.user.tag}.`,
                `${timeoutMinutes} minutes`
            );

            const result =
                await target.timeout(
                    timeoutMinutes * 60 * 1000,
                    `VC+ Timeout by ${member.user.tag}`
                ).catch(() => null);

            if (!result) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "I could not timeout that user."
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    successEmbed(
                        `Timed out ${target.user.tag} for **${timeoutMinutes} minutes**.`
                    )
                ]
            });
        }

        // ==================================================
        // UNTIMEOUT
        // ==================================================

        if (
            command === "untimeout"
        ) {
            if (!isGod(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "God or Founder rank is required."
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
                            "Usage: `-untimeout @user`"
                        )
                    ]
                });
            }

            if (!canModerate(member, target)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "You cannot untimeout someone at or above your rank."
                        )
                    ]
                });
            }

            await target.timeout(
                null,
                `VC+ Untimeout by ${member.user.tag}`
            ).catch(() => {});

            await sendModerationDM(
                target.user,
                message.guild,
                "Timeout Removed",
                `Your timeout was removed by ${member.user.tag}.`
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        `Removed timeout from ${target.user.tag}.`
                    )
                ]
            });
        }

        // ==================================================
        // FOREVER BAN
        // ==================================================

        if (
            command === "foreverban"
        ) {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Founder rank is required."
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
                            "Usage: `-foreverban @user`"
                        )
                    ]
                });
            }

            if (
                !data.foreverBanned.includes(
                    target.id
                )
            ) {
                data.foreverBanned.push(
                    target.id
                );
            }

            saveDB();

            await sendModerationDM(
                target.user,
                message.guild,
                "Forever Ban",
                "You were permanently banned from this server."
            );

            await target.ban({
                reason:
                    `VC+ Forever Ban by ${member.user.tag}`
            }).catch(() => {});

            return message.reply({
                embeds: [
                    successEmbed(
                        `${target.user.tag} is now permanently banned.`
                    )
                ]
            });
        }

        // ==================================================
        // RANK
        // ==================================================

        if (
            command === "rank"
        ) {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Founder rank is required."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const rankInput =
                args.find(
                    x =>
                        normalizeRank(x)
                );

            const rank =
                normalizeRank(
                    rankInput
                );

            if (!target || !rank) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage: `-rank @user <rank>`"
                        )
                    ]
                });
            }

            if (
                target.id ===
                message.guild.ownerId
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "The server owner already has Founder rank."
                        )
                    ]
                });
            }

            data.ranks[target.id] =
                rank;

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        `${target} is now **${rank}** rank.`
                    )
                ]
            });
        }

        // ==================================================
        // GODMODE
        // ==================================================

        if (
            command === "godmode"
        ) {
            if (!isFounder(member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Founder rank is required."
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
                            "Usage: `-godmode @user`"
                        )
                    ]
                });
            }

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
                            `${target} has been given **Godmode**.`
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
                        `Removed Godmode from ${target}.`
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
                            "God or Founder rank is required."
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
                            "Usage: `-purge <1-100>`"
                        )
                    ]
                });
            }

            const deleted =
                await message.channel
                    .bulkDelete(
                        amount,
                        true
                    )
                    .catch(() => null);

            if (!deleted) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "I could not delete those messages."
                        )
                    ]
                });
            }

            const response =
                await message.channel.send({
                    embeds: [
                        successEmbed(
                            `Deleted **${deleted.size}** messages.`
                        )
                    ]
                }).catch(() => null);

            if (response) {
                setTimeout(() => {
                    response.delete().catch(() => {});
                }, 5000);
            }

            return;
        }

    } catch (error) {
        console.error(
            "[MESSAGE ERROR]",
            error
        );

        await message.reply({
            embeds: [
                errorEmbed(
                    "Something went wrong while running that command."
                )
            ]
        }).catch(() => {});
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

            const data =
                getGuildData(
                    guild.id
                );

            // ==================================================
            // JTC CREATE
            // ==================================================

            if (
                data.jtc.enabled &&
                data.jtc.channelId &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                const member =
                    newState.member;

                if (member) {
                    await createPersonalVC(
                        member
                    );
                }
            }

            // ==================================================
            // TEMP VC
            // ==================================================

            if (newState.channelId) {
                const vc =
                    getTempVC(
                        newState.channelId
                    );

                if (vc) {
                    const channel =
                        newState.channel;

                    // Persistent STFU
                    if (
                        vc.stfu.has(
                            newState.id
                        )
                    ) {
                        await newState
                            .setMute(
                                true,
                                "VC+ persistent STFU"
                            )
                            .catch(() => {});
                    }

                    // Persistent VC ban
                    if (
                        vc.banned.has(
                            newState.id
                        )
                    ) {
                        await newState
                            .disconnect(
                                "VC+ banned from this VC"
                            )
                            .catch(() => {});

                        return;
                    }

                    // Reject
                    if (
                        vc.rejected.has(
                            newState.id
                        ) &&
                        !vc.permitted.has(
                            newState.id
                        )
                    ) {
                        await newState
                            .disconnect(
                                "VC+ rejected from this VC"
                            )
                            .catch(() => {});

                        return;
                    }

                    // Lock
                    if (
                        vc.locked &&
                        newState.id !==
                            vc.ownerId &&
                        !isGod(
                            newState.member
                        )
                    ) {
                        await newState
                            .disconnect(
                                "VC+ VC is locked"
                            )
                            .catch(() => {});

                        return;
                    }

                    await updateVCInterface(
                        channel
                    );
                }
            }

            // ==================================================
            // OLD VC UPDATE / CLEANUP
            // ==================================================

            if (oldState.channelId) {
                const oldVC =
                    getTempVC(
                        oldState.channelId
                    );

                if (oldVC) {
                    const oldChannel =
                        oldState.channel;

                    await updateVCInterface(
                        oldChannel
                    );

                    await deleteEmptyVC(
                        oldChannel
                    );
                }
            }

            // ==================================================
            // NEW VC UPDATE
            // ==================================================

            if (newState.channelId) {
                const newVC =
                    getTempVC(
                        newState.channelId
                    );

                if (newVC) {
                    await updateVCInterface(
                        newState.channel
                    );
                }
            }

        } catch (error) {
            console.error(
                "[VOICE STATE ERROR]",
                error
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
                        "VC+ Forever Ban protection"
                }).catch(() => {});
            }
        } catch (error) {
            console.error(
                "[FOREVER BAN ERROR]",
                error
            );
        }
    }
);

// ======================================================
// SECURITY / ANTI-NUKE
// ======================================================

const securityTracker = new Map();

function getSecurityData(
    guildId,
    action
) {
    const key =
        `${guildId}:${action}`;

    if (!securityTracker.has(key)) {
        securityTracker.set(
            key,
            []
        );
    }

    return securityTracker.get(
        key
    );
}

function addSecurityAction(
    guildId,
    action
) {
    const list =
        getSecurityData(
            guildId,
            action
        );

    const now =
        Date.now();

    list.push(now);

    while (
        list.length &&
        now - list[0] > 10000
    ) {
        list.shift();
    }

    return list.length;
}

async function getAuditExecutor(
    guild,
    type
) {
    const logs =
        await guild.fetchAuditLogs({
            type,
            limit: 1
        }).catch(() => null);

    if (!logs) return null;

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

    return guild.members
        .fetch(
            entry.executorId
        )
        .catch(() => null);
}

async function securityPunish(
    guild,
    executor,
    reason
) {
    if (!executor) return;

    if (
        isTrustedExecutor(
            executor
        )
    ) {
        return;
    }

    await sendModerationDM(
        executor.user,
        guild,
        "Security Ban",
        reason
    );

    await executor.ban({
        reason:
            `VC+ Security: ${reason}`
    }).catch(() => {});
}

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

            const count =
                addSecurityAction(
                    channel.guild.id,
                    "channelCreate"
                );

            if (count >= 5) {
                const executor =
                    await getAuditExecutor(
                        channel.guild,
                        AuditLogEvent.ChannelCreate
                    );

                if (
                    channel.id !==
                    data.jtc.channelId
                ) {
                    await channel.delete(
                        "VC+ Anti-Nuke"
                    ).catch(() => {});
                }

                await securityPunish(
                    channel.guild,
                    executor,
                    "Too many channels were created in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[CHANNEL CREATE SECURITY ERROR]",
                error
            );
        }
    }
);

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

            const count =
                addSecurityAction(
                    channel.guild.id,
                    "channelDelete"
                );

            if (count >= 3) {
                const executor =
                    await getAuditExecutor(
                        channel.guild,
                        AuditLogEvent.ChannelDelete
                    );

                await securityPunish(
                    channel.guild,
                    executor,
                    "Too many channels were deleted in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[CHANNEL DELETE SECURITY ERROR]",
                error
            );
        }
    }
);

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

            const count =
                addSecurityAction(
                    role.guild.id,
                    "roleCreate"
                );

            if (count >= 5) {
                const executor =
                    await getAuditExecutor(
                        role.guild,
                        AuditLogEvent.RoleCreate
                    );

                await role.delete(
                    "VC+ Anti-Nuke"
                ).catch(() => {});

                await securityPunish(
                    role.guild,
                    executor,
                    "Too many roles were created in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[ROLE CREATE SECURITY ERROR]",
                error
            );
        }
    }
);

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

            const count =
                addSecurityAction(
                    role.guild.id,
                    "roleDelete"
                );

            if (count >= 3) {
                const executor =
                    await getAuditExecutor(
                        role.guild,
                        AuditLogEvent.RoleDelete
                    );

                await securityPunish(
                    role.guild,
                    executor,
                    "Too many roles were deleted in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[ROLE DELETE SECURITY ERROR]",
                error
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
            "===================================="
        );

        console.log(
            `${BOT_NAME} is online.`
        );

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Serving ${client.guilds.cache.size} server(s)`
        );

        console.log(
            "===================================="
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
            "[CLIENT ERROR]",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[CLIENT WARN]",
            warning
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[UNHANDLED REJECTION]",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[UNCAUGHT EXCEPTION]",
            error
        );
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown() {
    console.log(
        "[VC+] Shutting down..."
    );

    saveDB();

    client.destroy();

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
        "ERROR: DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
