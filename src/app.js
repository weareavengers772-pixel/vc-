import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    AuditLogEvent,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("Missing DISCORD_TOKEN environment variable.");
    process.exit(1);
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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
});

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

const RANK_NAMES = {
    member: "Member",
    staff: "Staff",
    moderator: "Moderator",
    admin: "Admin",
    director: "Director",
    executive: "Executive",
    coowner: "Co Owner",
    owner: "Owner",
    god: "God",
    founder: "Founder"
};

// ======================================================
// TEMP VC STORAGE
// ======================================================

const tempVCs = new Map();

// ======================================================
// DATABASE
// ======================================================

function defaultGuildData() {
    return {
        ranks: {},
        foreverBanned: [],
        godmode: [],

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },

        logs: {
            categoryId: null,
            channelId: null
        },

        roles: {
            founder: null,
            god: null,
            owner: null,
            coowner: null,
            executive: null,
            director: null,
            admin: null,
            moderator: null,
            staff: null
        },

        protection: {
            channelCreate: true,
            channelDelete: true,
            roleCreate: true,
            roleDelete: true,
            webhookCreate: true
        },

        filter: {
            enabled: false,
            words: [],
            log: true,
            maxStrikes: 3,
            strikes: {}
        }
    };
}

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify({}, null, 4)
            );
        }

        return JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
    } catch (error) {
        console.error("Database load error:", error);
        return {};
    }
}

let database = loadDatabase();

function saveDatabase() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 4)
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] = defaultGuildData();
        saveDatabase();
    }

    return database[guildId];
}

// ======================================================
// RANK HELPERS
// ======================================================

function normalizeRank(rank) {
    if (!rank) return null;

    return rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRank(member) {
    if (!member) return "member";

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    const manualRank = data.ranks[member.id];

    if (
        manualRank &&
        RANKS[manualRank] &&
        RANKS[manualRank] > RANKS.member
    ) {
        return manualRank;
    }

    let highest = "member";

    for (const [rank, roleId] of Object.entries(data.roles)) {
        if (!roleId) continue;

        if (member.roles.cache.has(roleId)) {
            if (RANKS[rank] > RANKS[highest]) {
                highest = rank;
            }
        }
    }

    if (
        member.permissions.has(
            PermissionFlagsBits.Administrator
        ) &&
        RANKS.admin > RANKS[highest]
    ) {
        highest = "admin";
    }

    return highest;
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

    const data = getGuildData(member.guild.id);

    return (
        isFounder(member) ||
        getRankLevel(member) >= RANKS.god ||
        data.godmode.includes(member.id)
    );
}

function canModerate(member) {
    return getRankLevel(member) >= RANKS.moderator;
}

function isTrustedExecutor(member) {
    if (!member) return false;

    return (
        isFounder(member) ||
        getRankLevel(member) >= RANKS.god
    );
}

// ======================================================
// EMBEDS
// ======================================================

function vcEmbed(message) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: BOT_NAME
        })
        .setDescription(`✦ ${message}`)
        .setFooter({
            text: BOT_NAME
        });
}

function replySuccess(message) {
    return vcEmbed(message);
}

function replyError(message) {
    return vcEmbed(`**Error**\n${message}`);
}

function replyInfo(message) {
    return vcEmbed(message);
}

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: BOT_NAME
        })
        .setDescription(`
✦ **VC+ COMMANDS**

**VOICE CHANNELS**
\`${PREFIX}vc setup\`
\`${PREFIX}vc kick @user\`
\`${PREFIX}vc disconnect @user\`
\`${PREFIX}vc ban @user\`
\`${PREFIX}vc reject @user\`
\`${PREFIX}vc permit @user\`
\`${PREFIX}vc lock\`
\`${PREFIX}vc unlock\`
\`${PREFIX}vc transfer @user\`
\`${PREFIX}vc claim\`
\`${PREFIX}vc forceclaim\`
\`${PREFIX}vc rename <name>\`
\`${PREFIX}vc limit <number>\`
\`${PREFIX}vc stfu @user\`
\`${PREFIX}vc unstfu @user\`

**MODERATION**
\`${PREFIX}ban @user [reason]\`
\`${PREFIX}unban <userId>\`
\`${PREFIX}banlist\`
\`${PREFIX}kick @user [reason]\`
\`${PREFIX}timeout @user <minutes> [reason]\`
\`${PREFIX}untimeout @user\`
\`${PREFIX}foreverban @user [reason]\`
\`${PREFIX}purge <amount>\`
\`${PREFIX}clear <amount>\`

**RANKS**
\`${PREFIX}rank @user <rank>\`
\`${PREFIX}godmode on/off\`
\`${PREFIX}godmode @user on/off\`

**FILTER**
\`${PREFIX}filter on/off\`
\`${PREFIX}filter add <word>\`
\`${PREFIX}filter remove <word>\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on/off\`
\`${PREFIX}filter strikes <number>\`
\`${PREFIX}filter reset @user\`

**GENERAL**
\`${PREFIX}help\`
\`${PREFIX}commands\`

━━━━━━━━━━━━━━━━━━━━

**RANK HIERARCHY**

Founder
God
Owner
Co Owner
Executive
Director
Admin
Moderator
Staff
Member
        `)
        .setFooter({
            text: BOT_NAME
        });
}

// ======================================================
// VC DATA
// ======================================================

function createVCData(guildId, ownerId) {
    return {
        guildId,
        ownerId,
        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        stfu: new Set(),
        locked: false,
        controlChannelId: null
    };
}

function getVCData(channelId) {
    return tempVCs.get(channelId);
}

function isVCOwner(member, channel) {
    const vcData = getVCData(channel.id);

    if (!vcData) return false;

    return (
        vcData.ownerId === member.id ||
        isFounder(member)
    );
}

function getMemberVC(member) {
    if (!member?.voice?.channel) return null;

    return member.voice.channel;
}

// ======================================================
// TARGET RESOLVER
// ======================================================

async function resolveMember(guild, input) {
    if (!input) return null;

    const id = input.replace(/[<@!>]/g, "");

    if (!/^\d{15,25}$/.test(id)) {
        return null;
    }

    try {
        return await guild.members.fetch(id);
    } catch {
        return null;
    }
}

// ======================================================
// VC INTERFACE
// ======================================================

function createVCButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_lock")
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unlock")
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_kick")
                .setLabel("Kick")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_ban")
                .setLabel("Ban")
                .setStyle(ButtonStyle.Danger)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_permit")
                .setLabel("Permit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_rename")
                .setLabel("Rename")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_limit")
                .setLabel("Limit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_transfer")
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Secondary)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_claim")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_stfu")
                .setLabel("STFU")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unstfu")
                .setLabel("UnSTFU")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_delete")
                .setLabel("Delete VC")
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

function createVCInterfaceEmbed(channel, vcData) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: BOT_NAME
        })
        .setTitle("VC+")
        .setDescription(`
**Personal Voice Channel**

Owner: <@${vcData.ownerId}>

Use the controls below to manage this voice channel.

**Available Controls**
Lock / Unlock
Kick / Ban
Permit
Rename
Limit
Transfer
Claim
STFU / UnSTFU
Delete VC
        `)
        .addFields({
            name: "Voice Channel",
            value: `<#${channel.id}>`,
            inline: false
        })
        .setFooter({
            text: BOT_NAME
        });
}

// ======================================================
// CREATE VC INTERFACE
// ======================================================

async function createVCInterface(channel, vcData) {
    try {
        /*
         * Discord's voice-channel text chat is attached directly
         * to the voice channel. The interface message is sent
         * directly to that channel.
         */

        const message = await channel.send({
            embeds: [
                createVCInterfaceEmbed(channel, vcData)
            ],
            components: createVCButtons()
        });

        return message;
    } catch (error) {
        console.error(
            `Could not create VC interface for ${channel.id}:`,
            error
        );

        return null;
    }
}

// ======================================================
// JAIL LOGS
// ======================================================

async function createLogSystem(guild) {
    const data = getGuildData(guild.id);

    try {
        let category = null;

        if (data.logs.categoryId) {
            category =
                guild.channels.cache.get(
                    data.logs.categoryId
                );
        }

        if (!category) {
            category =
                await guild.channels.create({
                    name: "VC+ Logs",
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [
                                PermissionFlagsBits.ViewChannel
                            ]
                        }
                    ]
                });

            data.logs.categoryId = category.id;
        }

        let logChannel = null;

        if (data.logs.channelId) {
            logChannel =
                guild.channels.cache.get(
                    data.logs.channelId
                );
        }

        if (!logChannel) {
            logChannel =
                await guild.channels.create({
                    name: "jailed-logs",
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [
                                PermissionFlagsBits.ViewChannel
                            ]
                        }
                    ]
                });

            data.logs.channelId = logChannel.id;
        }

        saveDatabase();

        return logChannel;
    } catch (error) {
        console.error(
            `Log setup error in ${guild.name}:`,
            error
        );

        return null;
    }
}

async function sendLog(
    guild,
    type,
    description,
    moderation = false
) {
    try {
        const data = getGuildData(guild.id);

        const channel =
            guild.channels.cache.get(
                data.logs.channelId
            ) ||
            await createLogSystem(guild);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name: BOT_NAME
            })
            .setTitle(type)
            .setDescription(description)
            .setFooter({
                text: "VC+ • jailed-logs"
            })
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error("Logging error:", error);
    }
}

// ======================================================
// MODERATION DM
// ======================================================

async function sendModerationDM(
    member,
    action,
    reason
) {
    try {
        await member.send({
            embeds: [
                vcEmbed(`
**Moderation Action**

Action: **${action}**

Reason: **${reason || "No reason provided"}**

Server: **${member.guild.name}**
                `)
            ]
        });
    } catch {
        // DMs closed
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    let category = null;

    if (data.jtc.categoryId) {
        category =
            guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    if (!category) {
        category =
            await guild.channels.create({
                name: "Voice Channels",
                type: ChannelType.GuildCategory
            });

        data.jtc.categoryId = category.id;
        saveDatabase();
    }

    const voiceChannel =
        await guild.channels.create({
            name: `${member.user.username} VC`
                .slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: category.id
        });

    const vcData =
        createVCData(
            guild.id,
            member.id
        );

    tempVCs.set(
        voiceChannel.id,
        vcData
    );

    try {
        await member.voice.setChannel(
            voiceChannel
        );
    } catch (error) {
        console.error(
            "Could not move member:",
            error
        );
    }

    await createVCInterface(
        voiceChannel,
        vcData
    );

    await sendLog(
        guild,
        "Voice Channel Created",
        `Owner: <@${member.id}>\nChannel: <#${voiceChannel.id}>`
    );

    return voiceChannel;
}

// ======================================================
// DELETE PERSONAL VC
// ======================================================

async function deletePersonalVC(channelId) {
    const vcData =
        tempVCs.get(channelId);

    if (!vcData) return;

    const guild =
        client.guilds.cache.get(
            vcData.guildId
        );

    if (!guild) {
        tempVCs.delete(channelId);
        return;
    }

    const voiceChannel =
        guild.channels.cache.get(channelId);

    if (voiceChannel) {
        try {
            await voiceChannel.delete(
                "VC+ personal channel cleanup"
            );
        } catch {}
    }

    tempVCs.delete(channelId);

    await sendLog(
        guild,
        "Voice Channel Deleted",
        `Owner: <@${vcData.ownerId}>`
    );
}

// ======================================================
// VC PERMISSION HELPERS
// ======================================================

async function permitMember(
    channel,
    member
) {
    const vcData =
        getVCData(channel.id);

    if (!vcData) return;

    vcData.permitted.add(
        member.id
    );

    vcData.rejected.delete(
        member.id
    );

    vcData.banned.delete(
        member.id
    );

    try {
        await channel.permissionOverwrites.edit(
            member.id,
            {
                ViewChannel: true,
                Connect: true
            }
        );
    } catch {}

    if (channel.isVoiceBased()) {
        try {
            await channel.send({
                embeds: [
                    vcEmbed(
                        `<@${member.id}> has been permitted to join this VC.`
                    )
                ]
            });
        } catch {}
    }
}

async function denyMember(
    channel,
    member
) {
    try {
        await channel.permissionOverwrites.edit(
            member.id,
            {
                ViewChannel: false,
                Connect: false
            }
        );
    } catch {}
}

// ======================================================
// VC TARGET ACTIONS
// ======================================================

async function kickFromVC(
    channel,
    target
) {
    if (!target.voice.channel) return;

    if (
        target.voice.channel.id !==
        channel.id
    ) {
        return;
    }

    try {
        await target.voice.setChannel(null);
    } catch {}
}

async function banFromVC(
    channel,
    target
) {
    const vcData =
        getVCData(channel.id);

    if (!vcData) return;

    vcData.banned.add(
        target.id
    );

    vcData.rejected.delete(
        target.id
    );

    vcData.permitted.delete(
        target.id
    );

    await denyMember(
        channel,
        target
    );

    await kickFromVC(
        channel,
        target
    );
}

async function rejectFromVC(
    channel,
    target
) {
    const vcData =
        getVCData(channel.id);

    if (!vcData) return;

    vcData.rejected.add(
        target.id
    );

    vcData.permitted.delete(
        target.id
    );

    await denyMember(
        channel,
        target
    );

    await kickFromVC(
        channel,
        target
    );
}

// ======================================================
// MODAL HELPERS
// ======================================================

function targetModal(
    customId,
    title,
    label
) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("target")
                    .setLabel(label)
                    .setPlaceholder(
                        "User ID or @mention"
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            )
        );
}

function renameModal() {
    return new ModalBuilder()
        .setCustomId("vc_rename_modal")
        .setTitle("Rename VC")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("name")
                    .setLabel("New VC Name")
                    .setPlaceholder(
                        "Enter a new name"
                    )
                    .setMaxLength(100)
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            )
        );
}

function limitModal() {
    return new ModalBuilder()
        .setCustomId("vc_limit_modal")
        .setTitle("Set VC Limit")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("limit")
                    .setLabel("User Limit")
                    .setPlaceholder(
                        "0 - 99"
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true)
            )
        );
}

// ======================================================
// INTERACTION HANDLER
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isButton() &&
                !interaction.isModalSubmit()
            ) {
                return;
            }

            const channel =
                interaction.channel;

            if (
                !channel ||
                !channel.isVoiceBased()
            ) {
                await interaction.reply({
                    embeds: [
                        replyError(
                            "This interface can only be used from the voice channel it belongs to."
                        )
                    ],
                    ephemeral: true
                });

                return;
            }

            const vcData =
                getVCData(channel.id);

            if (!vcData) {
                await interaction.reply({
                    embeds: [
                        replyError(
                            "This is not an active VC+ personal channel."
                        )
                    ],
                    ephemeral: true
                });

                return;
            }

            const member =
                interaction.member;

            // ------------------------------------------
            // BUTTONS
            // ------------------------------------------

            if (interaction.isButton()) {

                if (
                    interaction.customId ===
                    "vc_claim"
                ) {
                    const owner =
                        channel.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        owner &&
                        owner.voice.channel?.id ===
                        channel.id
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "The current owner is still in the VC."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.ownerId =
                        member.id;

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `You are now the owner of <#${channel.id}>.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_lock"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.locked = true;

                    await channel.permissionOverwrites.edit(
                        channel.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                "The VC is now locked."
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_unlock"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.locked = false;

                    await channel.permissionOverwrites.edit(
                        channel.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                "The VC is now unlocked."
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_kick"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_kick_modal",
                            "Kick User",
                            "User to kick"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_ban"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_ban_modal",
                            "Ban User",
                            "User to ban"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_permit"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_permit_modal",
                            "Permit User",
                            "User to permit"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_rename"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        renameModal()
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_limit"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        limitModal()
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_transfer"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can use this."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_transfer_modal",
                            "Transfer Ownership",
                            "New VC owner"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_stfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can use STFU."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_stfu_modal",
                            "STFU User",
                            "User to mute"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_unstfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can use UnSTFU."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.showModal(
                        targetModal(
                            "vc_unstfu_modal",
                            "UnSTFU User",
                            "User to unmute"
                        )
                    );

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_delete"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only the VC owner or Founder can delete this VC."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                "Deleting your VC..."
                            )
                        ],
                        ephemeral: true
                    });

                    await deletePersonalVC(
                        channel.id
                    );

                    return;
                }
            }

            // ------------------------------------------
            // MODALS
            // ------------------------------------------

            if (
                interaction.isModalSubmit()
            ) {
                if (
                    !isVCOwner(
                        member,
                        channel
                    ) &&
                    !interaction.customId.startsWith(
                        "vc_stfu"
                    ) &&
                    !interaction.customId.startsWith(
                        "vc_unstfu"
                    )
                ) {
                    await interaction.reply({
                        embeds: [
                            replyError(
                                "You do not have permission to control this VC."
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                const targetInput =
                    interaction.fields.getTextInputValue(
                        "target"
                    );

                if (
                    interaction.customId ===
                    "vc_kick_modal"
                ) {
                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await kickFromVC(
                        channel,
                        target
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> was kicked from the VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_ban_modal"
                ) {
                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await banFromVC(
                        channel,
                        target
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> is now banned from this VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_permit_modal"
                ) {
                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await permitMember(
                        channel,
                        target
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> has been permitted.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_transfer_modal"
                ) {
                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.ownerId =
                        target.id;

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> is now the owner of this VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_stfu_modal"
                ) {
                    if (!isGod(member)) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can use STFU."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.stfu.add(
                        target.id
                    );

                    try {
                        await target.voice.setMute(
                            true
                        );
                    } catch {}

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> has been STFU'd.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_unstfu_modal"
                ) {
                    if (!isGod(member)) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can use UnSTFU."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    const target =
                        await resolveMember(
                            interaction.guild,
                            targetInput
                        );

                    if (!target) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "I could not find that member."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    try {
                        await target.voice.setMute(
                            false
                        );
                    } catch {}

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> has been UnSTFU'd.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_rename_modal"
                ) {
                    const name =
                        interaction.fields.getTextInputValue(
                            "name"
                        );

                    const cleanName =
                        name.trim().slice(0, 100);

                    if (!cleanName) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "Enter a valid VC name."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await channel.setName(
                        cleanName
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `VC renamed to **${cleanName}**.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }

                if (
                    interaction.customId ===
                    "vc_limit_modal"
                ) {
                    const amount =
                        Number(
                            interaction.fields.getTextInputValue(
                                "limit"
                            )
                        );

                    if (
                        !Number.isInteger(amount) ||
                        amount < 0 ||
                        amount > 99
                    ) {
                        await interaction.reply({
                            embeds: [
                                replyError(
                                    "The limit must be a whole number from 0 to 99."
                                )
                            ],
                            ephemeral: true
                        });

                        return;
                    }

                    await channel.setUserLimit(
                        amount
                    );

                    await interaction.reply({
                        embeds: [
                            replySuccess(
                                `VC user limit set to **${amount === 0 ? "Unlimited" : amount}**.`
                            )
                        ],
                        ephemeral: true
                    });

                    return;
                }
            }
        } catch (error) {
            console.error(
                "Interaction error:",
                error
            );

            if (!interaction.replied) {
                try {
                    await interaction.reply({
                        embeds: [
                            replyError(
                                "Something went wrong while processing that action."
                            )
                        ],
                        ephemeral: true
                    });
                } catch {}
            }
        }
    }
);

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

            const member =
                newState.member ||
                oldState.member;

            if (!member) return;

            const data =
                getGuildData(guild.id);

            // ------------------------------------------
            // JOIN TO CREATE
            // ------------------------------------------

            if (
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                await createPersonalVC(
                    member
                );

                return;
            }

            // ------------------------------------------
            // JOIN PERSONAL VC
            // ------------------------------------------

            const joinedVC =
                newState.channel;

            if (
                joinedVC &&
                tempVCs.has(
                    joinedVC.id
                )
            ) {
                const vcData =
                    getVCData(
                        joinedVC.id
                    );

                // Give access to VC text chat
                try {
                    await joinedVC.permissionOverwrites.edit(
                        member.id,
                        {
                            ViewChannel: true
                        }
                    );
                } catch {}

                // Banned
                if (
                    vcData.banned.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setChannel(
                            null
                        );
                    } catch {}

                    return;
                }

                // Rejected
                if (
                    vcData.rejected.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setChannel(
                            null
                        );
                    } catch {}

                    return;
                }

                // Locked
                if (
                    vcData.locked &&
                    member.id !==
                        vcData.ownerId &&
                    !vcData.permitted.has(
                        member.id
                    ) &&
                    !isFounder(member)
                ) {
                    try {
                        await member.voice.setChannel(
                            null
                        );
                    } catch {}

                    return;
                }

                // STFU
                if (
                    vcData.stfu.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setMute(
                            true
                        );
                    } catch {}
                }
            }

            // ------------------------------------------
            // LEAVE PERSONAL VC
            // ------------------------------------------

            const leftVC =
                oldState.channel;

            if (
                leftVC &&
                tempVCs.has(
                    leftVC.id
                )
            ) {
                const vcData =
                    getVCData(
                        leftVC.id
                    );

                try {
                    await leftVC.permissionOverwrites.delete(
                        member.id
                    );
                } catch {}

                if (
                    leftVC.members.size === 0
                ) {
                    await deletePersonalVC(
                        leftVC.id
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
// MESSAGE COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                message.author.bot ||
                !message.guild
            ) {
                return;
            }

            const data =
                getGuildData(
                    message.guild.id
                );

            // ------------------------------------------
            // FILTER
            // ------------------------------------------

            if (
                data.filter.enabled &&
                !isTrustedExecutor(
                    message.member
                )
            ) {
                const content =
                    message.content.toLowerCase();

                const matched =
                    data.filter.words.find(
                        word =>
                            content.includes(
                                word.toLowerCase()
                            )
                    );

                if (matched) {
                    try {
                        await message.delete();
                    } catch {}

                    if (
                        data.filter.log
                    ) {
                        await sendLog(
                            message.guild,
                            "Filter Triggered",
                            `User: <@${message.author.id}>\nWord: \`${matched}\``
                        );
                    }

                    data.filter.strikes[
                        message.author.id
                    ] =
                        (
                            data.filter.strikes[
                                message.author.id
                            ] || 0
                        ) + 1;

                    saveDatabase();

                    const strikes =
                        data.filter.strikes[
                            message.author.id
                        ];

                    if (
                        strikes >=
                        data.filter.maxStrikes
                    ) {
                        try {
                            await message.member.timeout(
                                10 * 60 * 1000,
                                "VC+ filter"
                            );
                        } catch {}
                    }

                    return;
                }
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

            // ------------------------------------------
            // HELP
            // ------------------------------------------

            if (
                command === "help" ||
                command === "commands"
            ) {
                await message.reply({
                    embeds: [
                        helpEmbed()
                    ]
                });

                return;
            }

            // ------------------------------------------
            // VC COMMAND
            // ------------------------------------------

            if (command === "vc") {
                const sub =
                    args.shift()?.toLowerCase();

                // --------------------------------------
                // SETUP
                // --------------------------------------

                if (
                    sub === "setup"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can set up Join To Create."
                                )
                            ]
                        });

                        return;
                    }

                    let category =
                        message.guild.channels.cache.find(
                            c =>
                                c.type ===
                                    ChannelType.GuildCategory &&
                                c.name ===
                                    "Voice Channels"
                        );

                    if (!category) {
                        category =
                            await message.guild.channels.create({
                                name: "Voice Channels",
                                type: ChannelType.GuildCategory
                            });
                    }

                    let joinChannel =
                        message.guild.channels.cache.get(
                            data.jtc.channelId
                        );

                    if (!joinChannel) {
                        joinChannel =
                            await message.guild.channels.create({
                                name: "Join To Create",
                                type: ChannelType.GuildVoice,
                                parent: category.id
                            });
                    }

                    data.jtc.enabled =
                        true;

                    data.jtc.channelId =
                        joinChannel.id;

                    data.jtc.categoryId =
                        category.id;

                    saveDatabase();

                    await createLogSystem(
                        message.guild
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Join To Create is ready.\n\nJoin <#${joinChannel.id}> and VC+ will create your personal VC.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // GET CURRENT VC
                // --------------------------------------

                const channel =
                    getMemberVC(
                        message.member
                    );

                if (!channel) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You are not in a voice channel."
                            )
                        ]
                    });

                    return;
                }

                const vcData =
                    getVCData(
                        channel.id
                    );

                if (!vcData) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You are not inside a VC+ personal channel."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // OWNER CHECK
                // --------------------------------------

                const ownerOnly = [
                    "kick",
                    "disconnect",
                    "ban",
                    "reject",
                    "permit",
                    "lock",
                    "unlock",
                    "transfer",
                    "claim",
                    "rename",
                    "limit"
                ];

                if (
                    ownerOnly.includes(
                        sub
                    ) &&
                    !isVCOwner(
                        message.member,
                        channel
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Only the VC owner or Founder can use that command."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // KICK
                // --------------------------------------

                if (
                    sub === "kick" ||
                    sub === "disconnect"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    await kickFromVC(
                        channel,
                        target
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> was kicked from the VC.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // BAN
                // --------------------------------------

                if (
                    sub === "ban"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    await banFromVC(
                        channel,
                        target
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> is banned from this VC.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // REJECT
                // --------------------------------------

                if (
                    sub === "reject"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    await rejectFromVC(
                        channel,
                        target
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> has been rejected from this VC.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // PERMIT
                // --------------------------------------

                if (
                    sub === "permit"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    await permitMember(
                        channel,
                        target
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `<@${target.id}> is now permitted.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // LOCK
                // --------------------------------------

                if (
                    sub === "lock"
                ) {
                    vcData.locked =
                        true;

                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "VC locked."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // UNLOCK
                // --------------------------------------

                if (
                    sub === "unlock"
                ) {
                    vcData.locked =
                        false;

                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "VC unlocked."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // TRANSFER
                // --------------------------------------

                if (
                    sub === "transfer"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    vcData.ownerId =
                        target.id;

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `VC ownership transferred to <@${target.id}>.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // CLAIM
                // --------------------------------------

                if (
                    sub === "claim"
                ) {
                    const owner =
                        message.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        owner &&
                        owner.voice.channel?.id ===
                        channel.id
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "The current owner is still in the VC."
                                )
                            ]
                        });

                        return;
                    }

                    vcData.ownerId =
                        message.author.id;

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "You now own this VC."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // FORCE CLAIM
                // --------------------------------------

                if (
                    sub === "forceclaim"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Only Founder can force claim a VC."
                                )
                            ]
                        });

                        return;
                    }

                    vcData.ownerId =
                        message.author.id;

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "You force claimed this VC."
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // RENAME
                // --------------------------------------

                if (
                    sub === "rename"
                ) {
                    const name =
                        args.join(" ")
                            .trim()
                            .slice(0, 100);

                    if (!name) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Enter a new VC name."
                                )
                            ]
                        });

                        return;
                    }

                    await channel.setName(
                        name
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `VC renamed to **${name}**.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // LIMIT
                // --------------------------------------

                if (
                    sub === "limit"
                ) {
                    const limit =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Limit must be between 0 and 99."
                                )
                            ]
                        });

                        return;
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `VC limit set to **${limit === 0 ? "Unlimited" : limit}**.`
                            )
                        ]
                    });

                    return;
                }

                // --------------------------------------
                // STFU
                // --------------------------------------

                if (
                    sub === "stfu" ||
                    sub === "unstfu"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Only Founder or God can use this command."
                                )
                            ]
                        });

                        return;
                    }

                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        sub === "stfu"
                    ) {
                        vcData.stfu.add(
                            target.id
                        );

                        try {
                            await target.voice.setMute(
                                true
                            );
                        } catch {}

                        await message.reply({
                            embeds: [
                                replySuccess(
                                    `<@${target.id}> has been STFU'd.`
                                )
                            ]
                        });
                    } else {
                        vcData.stfu.delete(
                            target.id
                        );

                        try {
                            await target.voice.setMute(
                                false
                            );
                        } catch {}

                        await message.reply({
                            embeds: [
                                replySuccess(
                                    `<@${target.id}> has been UnSTFU'd.`
                                )
                            ]
                        });
                    }

                    return;
                }

                return;
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command === "ban"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Mention a valid member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You cannot moderate someone with an equal or higher rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided";

                await sendModerationDM(
                    target,
                    "Ban",
                    reason
                );

                await target.ban({
                    reason
                });

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> has been banned.`
                        )
                    ]
                });

                await sendLog(
                    message.guild,
                    "Member Banned",
                    `Moderator: <@${message.author.id}>\nTarget: <@${target.id}>\nReason: ${reason}`,
                    true
                );

                return;
            }

            // ==================================================
            // UNBAN
            // ==================================================

            if (
                command === "unban"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const userId =
                    args[0];

                if (!userId) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Provide a user ID."
                            )
                        ]
                    });

                    return;
                }

                try {
                    await message.guild.members.unban(
                        userId
                    );

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `<@${userId}> has been unbanned.`
                            )
                        ]
                    });
                } catch {
                    await message.reply({
                        embeds: [
                            replyError(
                                "That user is not banned or the ID is invalid."
                            )
                        ]
                    });
                }

                return;
            }

            // ==================================================
            // BANLIST
            // ==================================================

            if (
                command === "banlist"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const bans =
                    await message.guild.bans.fetch();

                const list =
                    [...bans.values()]
                        .slice(0, 50)
                        .map(
                            ban =>
                                `<@${ban.user.id}> — ${ban.user.username}`
                        )
                        .join("\n");

                await message.reply({
                    embeds: [
                        vcEmbed(`
**Ban List**

${list || "No banned users."}
                        `)
                    ]
                });

                return;
            }

            // ==================================================
            // KICK
            // ==================================================

            if (
                command === "kick"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Mention a valid member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You cannot moderate someone with an equal or higher rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided";

                await sendModerationDM(
                    target,
                    "Kick",
                    reason
                );

                await target.kick(
                    reason
                );

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> has been kicked.`
                        )
                    ]
                });

                await sendLog(
                    message.guild,
                    "Member Kicked",
                    `Moderator: <@${message.author.id}>\nTarget: <@${target.id}>\nReason: ${reason}`,
                    true
                );

                return;
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command === "timeout"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                const minutes =
                    Number(args[1]);

                if (
                    !target ||
                    !Number.isFinite(
                        minutes
                    ) ||
                    minutes <= 0 ||
                    minutes > 40320
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Usage: -timeout @user <minutes> [reason]"
                            )
                        ]
                    });

                    return;
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You cannot timeout someone with an equal or higher rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.slice(2).join(" ") ||
                    "No reason provided";

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                await sendModerationDM(
                    target,
                    "Timeout",
                    reason
                );

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> has been timed out for **${minutes} minutes**.`
                        )
                    ]
                });

                await sendLog(
                    message.guild,
                    "Member Timed Out",
                    `Moderator: <@${message.author.id}>\nTarget: <@${target.id}>\nDuration: ${minutes} minutes\nReason: ${reason}`,
                    true
                );

                return;
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command === "untimeout"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Mention a valid member."
                            )
                        ]
                    });

                    return;
                }

                await target.timeout(
                    null
                );

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> is no longer timed out.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Only Founder or God can use Forever Ban."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Mention a valid member."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "Forever banned";

                if (
                    !data.foreverBanned.includes(
                        target.id
                    )
                ) {
                    data.foreverBanned.push(
                        target.id
                    );
                }

                saveDatabase();

                await sendModerationDM(
                    target,
                    "Forever Ban",
                    reason
                );

                await target.ban({
                    reason
                });

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> has been permanently banned from this server.`
                        )
                    ]
                });

                await sendLog(
                    message.guild,
                    "Forever Ban",
                    `Executor: <@${message.author.id}>\nTarget: <@${target.id}>\nReason: ${reason}`,
                    true
                );

                return;
            }

            // ==================================================
            // PURGE / CLEAR
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "You need Moderator or higher."
                            )
                        ]
                    });

                    return;
                }

                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(
                        amount
                    ) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Enter a number from 1 to 100."
                            )
                        ]
                    });

                    return;
                }

                try {
                    const deleted =
                        await message.channel.bulkDelete(
                            amount,
                            true
                        );

                    const response =
                        await message.channel.send({
                            embeds: [
                                replySuccess(
                                    `Deleted **${deleted.size}** messages.`
                                )
                            ]
                        });

                    setTimeout(
                        () =>
                            response.delete()
                                .catch(() => {}),
                        3000
                    );
                } catch {
                    await message.reply({
                        embeds: [
                            replyError(
                                "I could not delete those messages."
                            )
                        ]
                    });
                }

                return;
            }

            // ==================================================
            // RANK
            // ==================================================

            if (
                command === "rank"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Only Founder can change ranks."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                const requested =
                    normalizeRank(
                        args[1]
                    );

                if (
                    !target ||
                    !requested ||
                    !RANKS[requested]
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Usage: -rank @user <rank>"
                            )
                        ]
                    });

                    return;
                }

                if (
                    requested ===
                    "founder"
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Founder is reserved for the server owner."
                            )
                        ]
                    });

                    return;
                }

                data.ranks[
                    target.id
                ] = requested;

                saveDatabase();

                await message.reply({
                    embeds: [
                        replySuccess(
                            `<@${target.id}> is now **${RANK_NAMES[requested]}**.`
                        )
                    ]
                });

                await sendLog(
                    message.guild,
                    "Rank Updated",
                    `Founder: <@${message.author.id}>\nUser: <@${target.id}>\nRank: ${RANK_NAMES[requested]}`
                );

                return;
            }

            // ==================================================
            // GODMODE
            // ==================================================

            if (
                command === "godmode"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Only Founder can control Godmode."
                            )
                        ]
                    });

                    return;
                }

                let target =
                    message.member;

                let mode =
                    args[0]?.toLowerCase();

                if (
                    args[0]?.startsWith(
                        "<@"
                    )
                ) {
                    target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    mode =
                        args[1]?.toLowerCase();
                }

                if (
                    !target ||
                    !["on", "off"].includes(
                        mode
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Usage: -godmode on/off or -godmode @user on/off"
                            )
                        ]
                    });

                    return;
                }

                if (
                    mode === "on"
                ) {
                    if (
                        !data.godmode.includes(
                            target.id
                        )
                    ) {
                        data.godmode.push(
                            target.id
                        );
                    }
                } else {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );
                }

                saveDatabase();

                await message.reply({
                    embeds: [
                        replySuccess(
                            `Godmode **${mode}** for <@${target.id}>.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command === "filter"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    await message.reply({
                        embeds: [
                            replyError(
                                "Only Founder or God can manage the filter."
                            )
                        ]
                    });

                    return;
                }

                const sub =
                    args.shift()?.toLowerCase();

                if (
                    sub === "on"
                ) {
                    data.filter.enabled =
                        true;

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "Filter enabled."
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "off"
                ) {
                    data.filter.enabled =
                        false;

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                "Filter disabled."
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "add"
                ) {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    if (!word) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Enter a word to add."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        !data.filter.words.includes(
                            word
                        )
                    ) {
                        data.filter.words.push(
                            word
                        );
                    }

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Added \`${word}\` to the filter.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "remove"
                ) {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    data.filter.words =
                        data.filter.words.filter(
                            x =>
                                x !== word
                        );

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Removed \`${word}\` from the filter.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "list"
                ) {
                    await message.reply({
                        embeds: [
                            vcEmbed(`
**Filtered Words**

${
    data.filter.words.length
        ? data.filter.words
            .map(x => `\`${x}\``)
            .join(", ")
        : "No filtered words."
}
                            `)
                        ]
                    });

                    return;
                }

                if (
                    sub === "log"
                ) {
                    const setting =
                        args[0]?.toLowerCase();

                    if (
                        !["on", "off"].includes(
                            setting
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Use -filter log on or -filter log off."
                                )
                            ]
                        });

                        return;
                    }

                    data.filter.log =
                        setting === "on";

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Filter logging ${setting}.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "strikes"
                ) {
                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(
                            amount
                        ) ||
                        amount < 1
                    ) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Enter a valid strike number."
                                )
                            ]
                        });

                        return;
                    }

                    data.filter.maxStrikes =
                        amount;

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Filter max strikes set to **${amount}**.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    sub === "reset"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        await message.reply({
                            embeds: [
                                replyError(
                                    "Mention a valid member."
                                )
                            ]
                        });

                        return;
                    }

                    delete data.filter.strikes[
                        target.id
                    ];

                    saveDatabase();

                    await message.reply({
                        embeds: [
                            replySuccess(
                                `Reset filter strikes for <@${target.id}>.`
                            )
                        ]
                    });

                    return;
                }

                await message.reply({
                    embeds: [
                        replyInfo(`
**Filter Commands**

\`${PREFIX}filter on\`
\`${PREFIX}filter off\`
\`${PREFIX}filter add <word>\`
\`${PREFIX}filter remove <word>\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on/off\`
\`${PREFIX}filter strikes <number>\`
\`${PREFIX}filter reset @user\`
                        `)
                    ]
                });

                return;
            }
        } catch (error) {
            console.error(
                "Message command error:",
                error
            );

            try {
                await message.reply({
                    embeds: [
                        replyError(
                            "VC+ encountered an error while processing that command."
                        )
                    ]
                });
            } catch {}
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
                        "VC+ Forever Ban"
                });

                await sendLog(
                    member.guild,
                    "Forever Ban Enforced",
                    `<@${member.id}> attempted to join but is permanently banned.`
                );
            }
        } catch (error) {
            console.error(
                "Forever ban error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE
// ======================================================

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

        const entry =
            logs.entries.first();

        if (!entry) return null;

        return entry.executor;
    } catch {
        return null;
    }
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

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                isTrustedExecutor(member)
            ) {
                return;
            }

            await sendLog(
                channel.guild,
                "Unauthorized Channel Create",
                `Executor: <@${executor.id}>\nChannel: **${channel.name}**`
            );

            try {
                await channel.delete(
                    "VC+ anti-nuke"
                );
            } catch {}
        } catch (error) {
            console.error(
                "Channel create security error:",
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

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                isTrustedExecutor(member)
            ) {
                return;
            }

            await sendLog(
                channel.guild,
                "Unauthorized Channel Delete",
                `Executor: <@${executor.id}>\nChannel: **${channel.name}**`
            );
        } catch (error) {
            console.error(
                "Channel delete security error:",
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

            const member =
                await role.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                isTrustedExecutor(member)
            ) {
                return;
            }

            await sendLog(
                role.guild,
                "Unauthorized Role Create",
                `Executor: <@${executor.id}>\nRole: **${role.name}**`
            );

            try {
                await role.delete(
                    "VC+ anti-nuke"
                );
            } catch {}
        } catch (error) {
            console.error(
                "Role create security error:",
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

            const member =
                await role.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                isTrustedExecutor(member)
            ) {
                return;
            }

            await sendLog(
                role.guild,
                "Unauthorized Role Delete",
                `Executor: <@${executor.id}>\nRole: **${role.name}**`
            );
        } catch (error) {
            console.error(
                "Role delete security error:",
                error
            );
        }
    }
);

// ======================================================
// WEBHOOK SECURITY
// ======================================================

client.on(
    "webhooksUpdate",
    async channel => {
        try {
            if (!channel.guild) return;

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.webhookCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.WebhookCreate
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                isTrustedExecutor(member)
            ) {
                return;
            }

            await sendLog(
                channel.guild,
                "Unauthorized Webhook",
                `Executor: <@${executor.id}>\nChannel: <#${channel.id}>`
            );
        } catch (error) {
            console.error(
                "Webhook security error:",
                error
            );
        }
    }
);

// ======================================================
// GUILD JOIN
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            getGuildData(
                guild.id
            );

            await createLogSystem(
                guild
            );

            const channel =
                guild.systemChannel ||
                guild.channels.cache.find(
                    c =>
                        c.type ===
                            ChannelType.GuildText &&
                        c
                            .permissionsFor(
                                guild.members.me
                            )
                            ?.has(
                                PermissionFlagsBits.SendMessages
                            )
                );

            if (channel) {
                await channel.send({
                    embeds: [
                        vcEmbed(`
**VC+ is now online.**

Use \`${PREFIX}help\` to view all commands.

Use \`${PREFIX}vc setup\` to create the Join To Create system.

VC+ security and moderation systems are ready.
                        `)
                    ]
                });
            }
        } catch (error) {
            console.error(
                "Guild join error:",
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
    async () => {
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

        for (
            const guild of client.guilds.cache.values()
        ) {
            try {
                getGuildData(
                    guild.id
                );

                await createLogSystem(
                    guild
                );
            } catch (error) {
                console.error(
                    `Startup setup failed in ${guild.name}:`,
                    error
                );
            }
        }
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
    "warn",
    warning => {
        console.warn(
            "Discord warning:",
            warning
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
// LOGIN
// ======================================================

client.login(TOKEN);
