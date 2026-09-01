import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
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

// ============================================================
// VC+ CONFIG
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
// DATABASE
// ============================================================

function defaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        vouches: {},

        // Users whose vouches were taken/cleared.
        // They cannot self-claim the role while revoked.
        vouchRevoked: {},

        vouchLimit: 5,

        roles: {
            vouch: null
        },

        jtc: {
            categoryId: null,
            channelId: null
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
        },

        tempVCs: {}
    };
}

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return {
                guilds: {}
            };
        }

        const raw = fs.readFileSync(DB_FILE, "utf8");
        const parsed = JSON.parse(raw);

        if (!parsed.guilds || typeof parsed.guilds !== "object") {
            parsed.guilds = {};
        }

        return parsed;
    } catch (error) {
        console.error("[VC+] Database could not be loaded:", error);

        try {
            const backup = `${DB_FILE}.corrupt-${Date.now()}`;
            fs.renameSync(DB_FILE, backup);
            console.error(`[VC+] Corrupt database backed up to ${backup}`);
        } catch {}

        return {
            guilds: {}
        };
    }
}

let db = loadDB();

function saveDB() {
    try {
        const tempFile = `${DB_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(db, null, 2),
            "utf8"
        );

        fs.renameSync(tempFile, DB_FILE);
    } catch (error) {
        console.error("[VC+] Database save failed:", error);
    }
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaultGuildData();
        saveDB();
    }

    const defaults = defaultGuildData();
    const data = db.guilds[guildId];

    data.ranks ??= {};
    data.foreverBanned ??= [];
    data.godmode ??= [];
    data.vouches ??= {};
    data.vouchRevoked ??= {};
    data.vouchLimit ??= defaults.vouchLimit;

    data.roles ??= {};
    data.roles.vouch ??= null;

    data.jtc ??= {};
    data.jtc.categoryId ??= null;
    data.jtc.channelId ??= null;

    data.protection ??= {};
    data.protection.enabled ??= true;
    data.protection.channelCreate ??= true;
    data.protection.channelDelete ??= true;
    data.protection.roleCreate ??= true;
    data.protection.roleDelete ??= true;
    data.protection.webhookCreate ??= true;

    data.filters ??= {};
    data.filters.enabled ??= false;
    data.filters.words ??= [];
    data.filters.strikes ??= {};
    data.filters.logChannelId ??= null;
    data.filters.maxStrikes ??= 3;
    data.filters.timeoutMinutes ??= 10;
    data.filters.warningDeleteMs ??= 5000;

    data.tempVCs ??= {};

    return data;
}

// ============================================================
// RANK SYSTEM
// ============================================================

const RANKS = {
    founder: 10,
    god: 9,
    owner: 8,
    coowner: 7,
    executive: 6,
    director: 5,
    admin: 4,
    moderator: 3,
    staff: 2,
    member: 1
};

const RANK_NAMES = {
    founder: "Founder",
    god: "God",
    owner: "Owner",
    coowner: "Co-Owner",
    executive: "Executive",
    director: "Director",
    admin: "Admin",
    moderator: "Moderator",
    staff: "Staff",
    member: "Member"
};

function normalizeRank(rank) {
    if (!rank) return null;

    const value = rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    return RANKS[value] ? value : null;
}

function getRank(member) {
    if (!member || !member.guild) {
        return "member";
    }

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    return normalizeRank(data.ranks[member.id]) || "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] || 1;
}

function isFounder(member) {
    if (!member?.guild) return false;

    return (
        member.guild.ownerId === member.id ||
        getRank(member) === "founder"
    );
}

function isGod(member) {
    if (!member?.guild) return false;

    if (isFounder(member)) {
        return true;
    }

    const data = getGuildData(member.guild.id);

    return (
        getRank(member) === "god" ||
        data.godmode.includes(member.id)
    );
}

function canManageTarget(actor, target) {
    if (!actor || !target) return false;

    if (actor.id === target.id) {
        return false;
    }

    if (isFounder(actor)) {
        return !isFounder(target);
    }

    return getRankLevel(actor) > getRankLevel(target);
}

function isBotMember(member) {
    return member?.user?.bot === true;
}

// ============================================================
// PLAIN VC+ MESSAGES
// ============================================================

function plain(title, text) {
    return `${BOT_NAME}\n\n> **${title}**\n> ${text}`;
}

async function sendSuccess(message, title, text) {
    return message.reply({
        content: plain(title, text),
        allowedMentions: {
            repliedUser: false
        }
    });
}

async function sendError(message, text) {
    return message.reply({
        content: plain("error", text),
        allowedMentions: {
            repliedUser: false
        }
    });
}

async function sendInfo(message, title, text) {
    return message.reply({
        content: plain(title, text),
        allowedMentions: {
            repliedUser: false
        }
    });
}

async function interactionMessage(interaction, title, text) {
    const content = plain(title, text);

    if (interaction.replied || interaction.deferred) {
        return interaction.editReply({
            content
        }).catch(() => {});
    }

    return interaction.reply({
        content,
        ephemeral: true
    }).catch(() => {});
}

// ============================================================
// SAFE HELPERS
// ============================================================

function getMentionedMember(message) {
    return message.mentions.members.first() || null;
}

function cleanId(value) {
    if (!value) return null;

    return value
        .replace(/[<@!>]/g, "")
        .trim();
}

async function getMember(guild, id) {
    if (!id) return null;

    try {
        return (
            guild.members.cache.get(id) ||
            await guild.members.fetch(id)
        );
    } catch {
        return null;
    }
}

function hasPermission(member, permission) {
    try {
        return member.permissions.has(permission);
    } catch {
        return false;
    }
}

function botMember(guild) {
    return guild.members.me;
}

function botCanManageRole(guild, role) {
    const me = botMember(guild);

    if (!me || !role) {
        return false;
    }

    if (role.managed) {
        return false;
    }

    return role.position < me.roles.highest.position;
}

function botCanManageMember(guild, member) {
    const me = botMember(guild);

    if (!me || !member) {
        return false;
    }

    if (member.id === guild.ownerId) {
        return false;
    }

    return member.roles.highest.position < me.roles.highest.position;
}

// ============================================================
// DM MODERATION NOTIFICATIONS
// ============================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided",
    duration = null
) {
    try {
        let text =
            `You were **${action.toLowerCase()}** in **${guild.name}**.\n\n` +
            `Reason: ${reason}`;

        if (duration) {
            text += `\nDuration: ${duration}`;
        }

        await user.send({
            content: `${BOT_NAME}\n\n> **${action}**\n> ${text}`
        });
    } catch {
        // User has DMs disabled.
    }
}

// ============================================================
// TEMP VC SYSTEM
// ============================================================

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

function serializeVC(vc) {
    return {
        guildId: vc.guildId,
        ownerId: vc.ownerId,

        banned: [...vc.banned],
        rejected: [...vc.rejected],
        permitted: [...vc.permitted],
        stfu: [...vc.stfu],

        locked: vc.locked,

        interfaceMessageId: vc.interfaceMessageId,
        interfaceChannelId: vc.interfaceChannelId
    };
}

function persistVC(channelId) {
    const vc = tempVCs.get(channelId);

    if (!vc) return;

    const data = getGuildData(vc.guildId);

    data.tempVCs[channelId] = serializeVC(vc);

    saveDB();
}

function removePersistedVC(channelId, guildId) {
    const data = getGuildData(guildId);

    delete data.tempVCs[channelId];

    saveDB();
}

async function hydrateTempVCs() {
    for (const guild of client.guilds.cache.values()) {
        const data = getGuildData(guild.id);

        for (const [channelId, raw] of Object.entries(data.tempVCs)) {
            const channel = guild.channels.cache.get(channelId);

            if (
                !channel ||
                channel.type !== ChannelType.GuildVoice
            ) {
                delete data.tempVCs[channelId];
                continue;
            }

            const vc = {
                guildId: raw.guildId,
                ownerId: raw.ownerId,

                banned: new Set(raw.banned || []),
                rejected: new Set(raw.rejected || []),
                permitted: new Set(raw.permitted || []),
                stfu: new Set(raw.stfu || []),

                locked: Boolean(raw.locked),

                interfaceMessageId:
                    raw.interfaceMessageId || null,

                interfaceChannelId:
                    raw.interfaceChannelId || null
            };

            tempVCs.set(channelId, vc);
        }

        saveDB();
    }
}

async function deleteEmptyVC(channel) {
    if (!channel) return;

    const vc = tempVCs.get(channel.id);

    if (!vc) return;

    if (channel.members.size > 0) {
        return;
    }

    try {
        if (vc.interfaceChannelId) {
            const interfaceChannel =
                channel.guild.channels.cache.get(
                    vc.interfaceChannelId
                );

            if (interfaceChannel) {
                await interfaceChannel.delete(
                    "VC+ temporary voice channel empty"
                ).catch(() => {});
            }
        }

        await channel.delete(
            "VC+ temporary voice channel empty"
        ).catch(() => {});
    } catch {}

    tempVCs.delete(channel.id);

    removePersistedVC(
        channel.id,
        channel.guild.id
    );
}

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    const categoryId = data.jtc.categoryId;

    const category = guild.channels.cache.get(categoryId);

    if (!category) {
        return null;
    }

    const safeName =
        member.displayName
            .replace(/[^\w\- ]/g, "")
            .slice(0, 70) ||
        "user";

    let channel;

    try {
        channel = await guild.channels.create({
            name: `vc-${safeName}`,
            type: ChannelType.GuildVoice,
            parent: category.id,
            userLimit: 0
        });
    } catch (error) {
        console.error("[VC+] Failed creating VC:", error);
        return null;
    }

    const vc = createVCData(
        guild.id,
        member.id
    );

    tempVCs.set(channel.id, vc);

    persistVC(channel.id);

    await createVCInterface(channel);

    try {
        await member.voice.setChannel(channel);
    } catch {
        await deleteEmptyVC(channel);
    }

    return channel;
}

// ============================================================
// VC INTERFACE
// ============================================================

function vcButton(id, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style);
}

function buildVCComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        vcButton("vcui_kick", "Kick"),
        vcButton("vcui_disconnect", "Disconnect"),
        vcButton("vcui_ban", "Ban"),
        vcButton("vcui_reject", "Reject"),
        vcButton("vcui_permit", "Permit")
    );

    const row2 = new ActionRowBuilder().addComponents(
        vcButton("vcui_stfu", "STFU"),
        vcButton("vcui_unstfu", "UnSTFU"),
        vcButton("vcui_lock", "Lock"),
        vcButton("vcui_unlock", "Unlock"),
        vcButton("vcui_claim", "Claim")
    );

    const row3 = new ActionRowBuilder().addComponents(
        vcButton("vcui_transfer", "Transfer"),
        vcButton("vcui_forceclaim", "Force Claim"),
        vcButton("vcui_rename", "Rename"),
        vcButton("vcui_limit", "Limit"),
        vcButton("vcui_refresh", "Refresh")
    );

    return [
        row1,
        row2,
        row3
    ];
}

function vcPanelText(channel, vc) {
    return [
        BOT_NAME,
        "",
        `> **voice control**`,
        `> channel: <#${channel.id}>`,
        `> owner: <@${vc.ownerId}>`,
        `> locked: ${vc.locked ? "yes" : "no"}`,
        "",
        "> use the buttons below to control your VC."
    ].join("\n");
}

async function createVCInterface(voiceChannel) {
    const vc = tempVCs.get(voiceChannel.id);

    if (!vc) return null;

    let interfaceChannel = null;

    if (vc.interfaceChannelId) {
        interfaceChannel =
            voiceChannel.guild.channels.cache.get(
                vc.interfaceChannelId
            );
    }

    if (!interfaceChannel) {
        try {
            interfaceChannel =
                await voiceChannel.guild.channels.create({
                    name: `vc-control-${voiceChannel.id.slice(-6)}`,
                    type: ChannelType.GuildText,
                    parent: voiceChannel.parentId || undefined,
                    permissionOverwrites: [
                        {
                            id: voiceChannel.guild.roles.everyone.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel
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
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.ManageMessages
                            ]
                        }
                    ]
                });

            vc.interfaceChannelId =
                interfaceChannel.id;

            persistVC(voiceChannel.id);
        } catch (error) {
            console.error(
                "[VC+] Could not create VC interface:",
                error
            );

            return null;
        }
    }

    let message = null;

    if (vc.interfaceMessageId) {
        try {
            message =
                await interfaceChannel.messages.fetch(
                    vc.interfaceMessageId
                );
        } catch {}
    }

    const payload = {
        content: vcPanelText(
            voiceChannel,
            vc
        ),
        components: buildVCComponents()
    };

    if (message) {
        await message.edit(payload).catch(() => {});
    } else {
        try {
            message =
                await interfaceChannel.send(
                    payload
                );

            vc.interfaceMessageId =
                message.id;

            persistVC(voiceChannel.id);
        } catch {}
    }

    return interfaceChannel;
}

// ============================================================
// VC ACTION PERMISSION
// ============================================================

function vcOwner(member, vc) {
    return (
        isFounder(member) ||
        member.id === vc.ownerId
    );
}

function vcGod(member) {
    return isGod(member);
}

function canUseTargetVCAction(
    actor,
    target,
    vc,
    action
) {
    if (!actor || !target || !vc) {
        return false;
    }

    if (actor.id === target.id) {
        return false;
    }

    if (
        isFounder(target) &&
        !isFounder(actor)
    ) {
        return false;
    }

    if (
        action === "stfu" ||
        action === "unstfu"
    ) {
        return vcGod(actor);
    }

    return vcOwner(actor, vc);
}

// ============================================================
// VC TARGET SELECT
// ============================================================

function targetSelect(action) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(`vcui_target_${action}`)
            .setPlaceholder("select a user")
            .setMinValues(1)
            .setMaxValues(1)
    );
}

// ============================================================
// VC ACTION HANDLER
// ============================================================

async function performVCAction(
    interaction,
    action,
    targetId
) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return interactionMessage(
            interaction,
            "error",
            "you must be inside a temporary VC."
        );
    }

    const channel =
        member.voice.channel;

    const vc = tempVCs.get(channel.id);

    if (!vc) {
        return interactionMessage(
            interaction,
            "error",
            "this is not a VC+ temporary VC."
        );
    }

    const target =
        await getMember(
            interaction.guild,
            targetId
        );

    if (!target) {
        return interactionMessage(
            interaction,
            "error",
            "that user could not be found."
        );
    }

    if (
        !canUseTargetVCAction(
            member,
            target,
            vc,
            action
        )
    ) {
        return interactionMessage(
            interaction,
            "error",
            "you do not have permission to control that user."
        );
    }

    if (
        !botCanManageMember(
            interaction.guild,
            target
        )
    ) {
        return interactionMessage(
            interaction,
            "error",
            "I cannot manage that member because of the role hierarchy."
        );
    }

    try {
        switch (action) {
            case "kick": {
                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return interactionMessage(
                        interaction,
                        "error",
                        "that user is not in this VC."
                    );
                }

                await sendModerationDM(
                    target.user,
                    interaction.guild,
                    "VC Kick",
                    "Removed from a VC+ temporary VC."
                );

                await target.voice.disconnect(
                    "VC+ VC kick"
                );

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} was kicked from the VC.`
                );
            }

            case "disconnect": {
                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return interactionMessage(
                        interaction,
                        "error",
                        "that user is not in this VC."
                    );
                }

                await target.voice.disconnect(
                    "VC+ disconnect"
                );

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} was disconnected.`
                );
            }

            case "ban": {
                vc.banned.add(target.id);
                vc.rejected.delete(target.id);

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false,
                        ViewChannel: false
                    }
                );

                if (
                    target.voice.channelId ===
                    channel.id
                ) {
                    await target.voice.disconnect(
                        "VC+ VC ban"
                    ).catch(() => {});
                }

                persistVC(channel.id);

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} was banned from this VC.`
                );
            }

            case "reject": {
                vc.rejected.add(target.id);
                vc.banned.delete(target.id);

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false
                    }
                );

                if (
                    target.voice.channelId ===
                    channel.id
                ) {
                    await target.voice.disconnect(
                        "VC+ VC reject"
                    ).catch(() => {});
                }

                persistVC(channel.id);

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} was rejected from this VC.`
                );
            }

            case "permit": {
                vc.banned.delete(target.id);
                vc.rejected.delete(target.id);
                vc.permitted.add(target.id);

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: null,
                        ViewChannel: null
                    }
                );

                persistVC(channel.id);

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} is now permitted to join this VC.`
                );
            }

            case "stfu": {
                vc.stfu.add(target.id);

                await target.voice.setMute(
                    true,
                    "VC+ STFU"
                );

                persistVC(channel.id);

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} has been server muted.`
                );
            }

            case "unstfu": {
                vc.stfu.delete(target.id);

                await target.voice.setMute(
                    false,
                    "VC+ UnSTFU"
                );

                persistVC(channel.id);

                return interactionMessage(
                    interaction,
                    "done",
                    `${target} has been server unmuted.`
                );
            }

            default:
                return interactionMessage(
                    interaction,
                    "error",
                    "unknown VC action."
                );
        }
    } catch (error) {
        console.error(
            `[VC+] VC action ${action} failed:`,
            error
        );

        return interactionMessage(
            interaction,
            "error",
            "the action failed. check my permissions and role position."
        );
    }
}

// ============================================================
// VC CLAIM
// ============================================================

async function claimVC(interaction, force = false) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return interactionMessage(
            interaction,
            "error",
            "you must be inside a temporary VC."
        );
    }

    const channel = member.voice.channel;
    const vc = tempVCs.get(channel.id);

    if (!vc) {
        return interactionMessage(
            interaction,
            "error",
            "this is not a VC+ temporary VC."
        );
    }

    const owner =
        await getMember(
            interaction.guild,
            vc.ownerId
        );

    if (
        !force &&
        owner &&
        owner.voice.channelId === channel.id
    ) {
        return interactionMessage(
            interaction,
            "error",
            "the current owner is still inside the VC."
        );
    }

    if (
        force &&
        !isGod(member)
    ) {
        return interactionMessage(
            interaction,
            "error",
            "only God or Founder can force claim a VC."
        );
    }

    vc.ownerId = member.id;

    persistVC(channel.id);

    await createVCInterface(channel);

    return interactionMessage(
        interaction,
        "done",
        `${member} is now the owner of this VC.`
    );
}

// ============================================================
// VC TRANSFER
// ============================================================

async function transferVC(
    interaction,
    targetId
) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return interactionMessage(
            interaction,
            "error",
            "you must be inside a temporary VC."
        );
    }

    const channel = member.voice.channel;
    const vc = tempVCs.get(channel.id);

    if (!vc) {
        return interactionMessage(
            interaction,
            "error",
            "this is not a VC+ temporary VC."
        );
    }

    if (!vcOwner(member, vc)) {
        return interactionMessage(
            interaction,
            "error",
            "only the VC owner or Founder can transfer ownership."
        );
    }

    const target =
        await getMember(
            interaction.guild,
            targetId
        );

    if (!target) {
        return interactionMessage(
            interaction,
            "error",
            "that user could not be found."
        );
    }

    if (
        target.voice.channelId !==
        channel.id
    ) {
        return interactionMessage(
            interaction,
            "error",
            "the new owner must be inside this VC."
        );
    }

    if (
        isFounder(member) &&
        target.id === member.id
    ) {
        return interactionMessage(
            interaction,
            "error",
            "you already own this VC."
        );
    }

    vc.ownerId = target.id;

    persistVC(channel.id);

    await createVCInterface(channel);

    return interactionMessage(
        interaction,
        "done",
        `${target} is now the owner of this VC.`
    );
}

// ============================================================
// VC LOCK
// ============================================================

async function setVCLock(
    interaction,
    locked
) {
    const member = interaction.member;

    if (!member?.voice?.channel) {
        return interactionMessage(
            interaction,
            "error",
            "you must be inside a temporary VC."
        );
    }

    const channel = member.voice.channel;
    const vc = tempVCs.get(channel.id);

    if (!vc) {
        return interactionMessage(
            interaction,
            "error",
            "this is not a VC+ temporary VC."
        );
    }

    if (!vcOwner(member, vc)) {
        return interactionMessage(
            interaction,
            "error",
            "only the VC owner or Founder can change the lock."
        );
    }

    try {
        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
                Connect: locked ? false : null
            }
        );

        if (locked) {
            await channel.permissionOverwrites.edit(
                vc.ownerId,
                {
                    Connect: true
                }
            );
        } else {
            await channel.permissionOverwrites.edit(
                vc.ownerId,
                {
                    Connect: null
                }
            );
        }

        vc.locked = locked;

        persistVC(channel.id);

        await createVCInterface(channel);

        return interactionMessage(
            interaction,
            "done",
            `VC is now ${locked ? "locked" : "unlocked"}.`
        );
    } catch {
        return interactionMessage(
            interaction,
            "error",
            "I could not change the VC lock."
        );
    }
}

// ============================================================
// VC MODALS
// ============================================================

async function showRenameModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("vcui_rename_modal")
        .setTitle("Rename VC");

    const input = new TextInputBuilder()
        .setCustomId("vc_name")
        .setLabel("new VC name")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);
}

async function showLimitModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("vcui_limit_modal")
        .setTitle("Set VC Limit");

    const input = new TextInputBuilder()
        .setCustomId("vc_limit")
        .setLabel("user limit 0-99")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

function getVouchCount(guildId, userId) {
    const data = getGuildData(guildId);

    return Number(data.vouches[userId] || 0);
}

function isVouchRevoked(guildId, userId) {
    const data = getGuildData(guildId);

    return Boolean(data.vouchRevoked[userId]);
}

async function syncVouchRole(member) {
    if (!member?.guild) return;

    const data = getGuildData(member.guild.id);

    if (!data.roles.vouch) {
        return;
    }

    const role =
        member.guild.roles.cache.get(
            data.roles.vouch
        );

    if (!role) {
        return;
    }

    if (!botCanManageRole(member.guild, role)) {
        return;
    }

    const count =
        getVouchCount(
            member.guild.id,
            member.id
        );

    const qualified =
        count >= data.vouchLimit &&
        !isVouchRevoked(
            member.guild.id,
            member.id
        );

    try {
        if (qualified) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(
                    role,
                    "VC+ vouch requirement reached"
                );
            }
        } else {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(
                    role,
                    "VC+ vouch requirement not met or revoked"
                );
            }
        }
    } catch (error) {
        console.error(
            "[VC+] Vouch role sync failed:",
            error
        );
    }
}

async function syncAllVouchRoles(guild) {
    for (const member of guild.members.cache.values()) {
        await syncVouchRole(member);
    }
}

// ============================================================
// MODERATION
// ============================================================

async function commandBan(
    message,
    target,
    reason
) {
    const actor = message.member;

    if (!canManageTarget(actor, target)) {
        return sendError(
            message,
            "you cannot ban that member."
        );
    }

    if (!hasPermission(actor, PermissionFlagsBits.BanMembers)) {
        return sendError(
            message,
            "you do not have the required Discord permission."
        );
    }

    if (!botCanManageMember(message.guild, target)) {
        return sendError(
            message,
            "I cannot ban that member because of the role hierarchy."
        );
    }

    await sendModerationDM(
        target.user,
        message.guild,
        "Ban",
        reason
    );

    try {
        await target.ban({
            reason: `VC+ | ${reason}`
        });

        return sendSuccess(
            message,
            "banned",
            `${target} has been banned.\nreason: ${reason}`
        );
    } catch {
        return sendError(
            message,
            "I could not ban that member."
        );
    }
}

async function commandKick(
    message,
    target,
    reason
) {
    const actor = message.member;

    if (!canManageTarget(actor, target)) {
        return sendError(
            message,
            "you cannot kick that member."
        );
    }

    if (!hasPermission(actor, PermissionFlagsBits.KickMembers)) {
        return sendError(
            message,
            "you do not have the required Discord permission."
        );
    }

    if (!botCanManageMember(message.guild, target)) {
        return sendError(
            message,
            "I cannot kick that member because of the role hierarchy."
        );
    }

    await sendModerationDM(
        target.user,
        message.guild,
        "Kick",
        reason
    );

    try {
        await target.kick(
            `VC+ | ${reason}`
        );

        return sendSuccess(
            message,
            "kicked",
            `${target} has been kicked.\nreason: ${reason}`
        );
    } catch {
        return sendError(
            message,
            "I could not kick that member."
        );
    }
}

async function commandTimeout(
    message,
    target,
    minutes,
    reason
) {
    const actor = message.member;

    if (!canManageTarget(actor, target)) {
        return sendError(
            message,
            "you cannot timeout that member."
        );
    }

    if (!hasPermission(actor, PermissionFlagsBits.ModerateMembers)) {
        return sendError(
            message,
            "you do not have the required Discord permission."
        );
    }

    if (!botCanManageMember(message.guild, target)) {
        return sendError(
            message,
            "I cannot timeout that member because of the role hierarchy."
        );
    }

    const ms =
        Math.min(
            Math.max(minutes, 1),
            40320
        ) * 60 * 1000;

    await sendModerationDM(
        target.user,
        message.guild,
        "Timeout",
        reason,
        `${minutes} minutes`
    );

    try {
        await target.timeout(
            ms,
            `VC+ | ${reason}`
        );

        return sendSuccess(
            message,
            "timeout",
            `${target} has been timed out for ${minutes} minutes.\nreason: ${reason}`
        );
    } catch {
        return sendError(
            message,
            "I could not timeout that member."
        );
    }
}

// ============================================================
// AUT0MOD
// ============================================================

function containsFilteredWord(content, words) {
    const lower = content.toLowerCase();

    return words.find(word =>
        lower.includes(word.toLowerCase())
    ) || null;
}

async function logFilterAction(
    guild,
    text
) {
    const data = getGuildData(guild.id);

    if (!data.filters.logChannelId) {
        return;
    }

    const channel =
        guild.channels.cache.get(
            data.filters.logChannelId
        );

    if (!channel?.isTextBased()) {
        return;
    }

    await channel.send({
        content: `${BOT_NAME}\n\n> **automod**\n> ${text}`
    }).catch(() => {});
}

async function handleAutoMod(message) {
    if (!message.guild) return false;
    if (message.author.bot) return false;

    const data =
        getGuildData(message.guild.id);

    if (!data.filters.enabled) {
        return false;
    }

    if (
        message.member &&
        isGod(message.member)
    ) {
        return false;
    }

    const matched =
        containsFilteredWord(
            message.content,
            data.filters.words
        );

    if (!matched) {
        return false;
    }

    try {
        await message.delete();
    } catch {}

    const userId = message.author.id;

    data.filters.strikes[userId] =
        Number(
            data.filters.strikes[userId] || 0
        ) + 1;

    const strikes =
        data.filters.strikes[userId];

    saveDB();

    await logFilterAction(
        message.guild,
        `${message.author.tag} triggered the filter. word: ${matched}. strikes: ${strikes}`
    );

    const warning =
        await message.channel.send({
            content:
                `${BOT_NAME}\n\n> **automod**\n> ${message.author}, that message was removed.`
        }).catch(() => null);

    if (warning) {
        setTimeout(() => {
            warning.delete().catch(() => {});
        }, data.filters.warningDeleteMs);
    }

    if (
        strikes >=
        data.filters.maxStrikes
    ) {
        const member =
            await getMember(
                message.guild,
                userId
            );

        if (
            member &&
            botCanManageMember(
                message.guild,
                member
            )
        ) {
            const duration =
                data.filters.timeoutMinutes;

            await sendModerationDM(
                member.user,
                message.guild,
                "AutoMod Timeout",
                "Too many filtered messages.",
                `${duration} minutes`
            );

            await member.timeout(
                duration * 60 * 1000,
                "VC+ AutoMod strike limit"
            ).catch(() => {});

            data.filters.strikes[userId] = 0;

            saveDB();
        }
    }

    return true;
}

// ============================================================
// ANTI NUKE
// ============================================================

const securityActions = new Map();

function securityKey(
    guildId,
    executorId,
    action
) {
    return `${guildId}:${executorId}:${action}`;
}

function recordSecurityAction(
    guildId,
    executorId,
    action,
    windowMs
) {
    const key =
        securityKey(
            guildId,
            executorId,
            action
        );

    const now = Date.now();

    const previous =
        securityActions.get(key) || [];

    const filtered =
        previous.filter(
            timestamp =>
                now - timestamp <= windowMs
        );

    filtered.push(now);

    securityActions.set(
        key,
        filtered
    );

    return filtered.length;
}

async function isTrustedExecutor(
    guild,
    executorId
) {
    if (!executorId) return false;

    if (executorId === client.user.id) {
        return true;
    }

    const member =
        await getMember(
            guild,
            executorId
        );

    if (!member) {
        return false;
    }

    return isGod(member);
}

async function punishSecurityExecutor(
    guild,
    executorId,
    reason
) {
    if (!executorId) return;

    if (
        await isTrustedExecutor(
            guild,
            executorId
        )
    ) {
        return;
    }

    try {
        await guild.members.ban(
            executorId,
            {
                reason: `VC+ Anti-Nuke | ${reason}`
            }
        );

        console.log(
            `[VC+] Anti-nuke banned ${executorId}: ${reason}`
        );
    } catch (error) {
        console.error(
            "[VC+] Anti-nuke punishment failed:",
            error
        );
    }
}

async function getRecentAuditExecutor(
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

async function securityChannelCreate(channel) {
    const guild = channel.guild;
    const data = getGuildData(guild.id);

    if (
        !data.protection.enabled ||
        !data.protection.channelCreate
    ) {
        return;
    }

    setTimeout(async () => {
        const executor =
            await getRecentAuditExecutor(
                guild,
                AuditLogEvent.ChannelCreate
            );

        if (!executor) return;

        if (
            await isTrustedExecutor(
                guild,
                executor.id
            )
        ) {
            return;
        }

        const count =
            recordSecurityAction(
                guild.id,
                executor.id,
                "channelCreate",
                10000
            );

        if (count >= 5) {
            await channel.delete(
                "VC+ Anti-Nuke"
            ).catch(() => {});

            await punishSecurityExecutor(
                guild,
                executor.id,
                "5 channel creations within 10 seconds"
            );
        }
    }, 800);
}

async function securityChannelDelete(channel) {
    const guild = channel.guild;
    const data = getGuildData(guild.id);

    if (
        !data.protection.enabled ||
        !data.protection.channelDelete
    ) {
        return;
    }

    setTimeout(async () => {
        const executor =
            await getRecentAuditExecutor(
                guild,
                AuditLogEvent.ChannelDelete
            );

        if (!executor) return;

        if (
            await isTrustedExecutor(
                guild,
                executor.id
            )
        ) {
            return;
        }

        const count =
            recordSecurityAction(
                guild.id,
                executor.id,
                "channelDelete",
                10000
            );

        if (count >= 3) {
            await punishSecurityExecutor(
                guild,
                executor.id,
                "3 channel deletions within 10 seconds"
            );
        }
    }, 800);
}

async function securityRoleCreate(role) {
    const guild = role.guild;
    const data = getGuildData(guild.id);

    if (
        !data.protection.enabled ||
        !data.protection.roleCreate
    ) {
        return;
    }

    setTimeout(async () => {
        const executor =
            await getRecentAuditExecutor(
                guild,
                AuditLogEvent.RoleCreate
            );

        if (!executor) return;

        if (
            await isTrustedExecutor(
                guild,
                executor.id
            )
        ) {
            return;
        }

        const count =
            recordSecurityAction(
                guild.id,
                executor.id,
                "roleCreate",
                10000
            );

        if (count >= 5) {
            await role.delete(
                "VC+ Anti-Nuke"
            ).catch(() => {});

            await punishSecurityExecutor(
                guild,
                executor.id,
                "5 role creations within 10 seconds"
            );
        }
    }, 800);
}

async function securityRoleDelete(role) {
    const guild = role.guild;
    const data = getGuildData(guild.id);

    if (
        !data.protection.enabled ||
        !data.protection.roleDelete
    ) {
        return;
    }

    setTimeout(async () => {
        const executor =
            await getRecentAuditExecutor(
                guild,
                AuditLogEvent.RoleDelete
            );

        if (!executor) return;

        if (
            await isTrustedExecutor(
                guild,
                executor.id
            )
        ) {
            return;
        }

        const count =
            recordSecurityAction(
                guild.id,
                executor.id,
                "roleDelete",
                10000
            );

        if (count >= 3) {
            await punishSecurityExecutor(
                guild,
                executor.id,
                "3 role deletions within 10 seconds"
            );
        }
    }, 800);
}

async function securityWebhookCreate(webhook) {
    const guild = webhook.guild;

    if (!guild) return;

    const data = getGuildData(guild.id);

    if (
        !data.protection.enabled ||
        !data.protection.webhookCreate
    ) {
        return;
    }

    setTimeout(async () => {
        const executor =
            await getRecentAuditExecutor(
                guild,
                AuditLogEvent.WebhookCreate
            );

        if (!executor) return;

        if (
            await isTrustedExecutor(
                guild,
                executor.id
            )
        ) {
            return;
        }

        await punishSecurityExecutor(
            guild,
            executor.id,
            "unauthorized webhook creation"
        );
    }, 800);
}

// ============================================================
// COMMAND HELP
// ============================================================

async function showHelp(message) {
    return sendInfo(
        message,
        "commands",
        [
            "`-help`",
            "",
            "**moderation**",
            "`-ban @user [reason]`",
            "`-kick @user [reason]`",
            "`-timeout @user <minutes> [reason]`",
            "`-untimeout @user`",
            "`-unban <id>`",
            "`-banlist`",
            "`-unbanall confirm`",
            "`-purge <1-100>`",
            "",
            "**VC**",
            "`-vc setup`",
            "`-vc count`",
            "`-vc panel`",
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
            "`-vc forceclaim`",
            "`-vc stfu @user`",
            "`-vc unstfu @user`",
            "",
            "**ranks**",
            "`-rank @user <rank>`",
            "`-godmode @user`",
            "`-foreverban @user`",
            "",
            "**vouches — Founder / Server Owner**",
            "`-vouch give @user`",
            "`-vouch take @user`",
            "`-vouch clear @user`",
            "`-vouch list`",
            "`-vouch role set @role`",
            "`-vouch limit <number>`",
            "",
            "**vouch role**",
            "`-vouchrole view`",
            "`-vouchrole claim`",
            "",
            "**automod**",
            "`-filter on`",
            "`-filter off`",
            "`-filter add <word>`",
            "`-filter remove <word>`",
            "`-filter list`",
            "`-filter log #channel`",
            "`-filter strikes @user`",
            "`-filter reset @user`"
        ].join("\n")
    );
}

// ============================================================
// COMMAND HANDLER
// ============================================================

async function handleCommand(message) {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content =
        message.content.trim();

    if (!content.startsWith(PREFIX)) {
        return;
    }

    const parts =
        content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

    const command =
        parts.shift()?.toLowerCase();

    const args = parts;

    if (!command) return;

    // ========================================================
    // HELP
    // ========================================================

    if (command === "help" || command === "commands") {
        return showHelp(message);
    }

    // ========================================================
    // PING
    // ========================================================

    if (command === "ping") {
        return sendInfo(
            message,
            "pong",
            `latency: ${client.ws.ping}ms`
        );
    }

    // ========================================================
    // RANK
    // ========================================================

    if (command === "rank") {
        if (!isFounder(message.member)) {
            return sendError(
                message,
                "only Founder or Server Owner can change ranks."
            );
        }

        const target =
            getMentionedMember(message);

        const rank =
            normalizeRank(args[1]);

        if (!target || !rank) {
            return sendError(
                message,
                "usage: `-rank @user <rank>`"
            );
        }

        if (target.id === message.author.id) {
            return sendError(
                message,
                "you cannot change your own rank."
            );
        }

        if (
            isFounder(target) &&
            !(
                message.guild.ownerId ===
                message.author.id
            )
        ) {
            return sendError(
                message,
                "the Founder rank cannot be changed."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        data.ranks[target.id] =
            rank;

        saveDB();

        return sendSuccess(
            message,
            "rank updated",
            `${target} is now **${RANK_NAMES[rank]}**.`
        );
    }

    // ========================================================
    // GODMODE
    // ========================================================

    if (command === "godmode") {
        if (!isFounder(message.member)) {
            return sendError(
                message,
                "only Founder or Server Owner can use Godmode."
            );
        }

        const target =
            getMentionedMember(message);

        if (!target) {
            return sendError(
                message,
                "usage: `-godmode @user`"
            );
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

            return sendSuccess(
                message,
                "godmode enabled",
                `${target} now has Godmode.`
            );
        }

        data.godmode.splice(
            index,
            1
        );

        saveDB();

        return sendSuccess(
            message,
            "godmode disabled",
            `${target} no longer has Godmode.`
        );
    }

    // ========================================================
    // FOREVER BAN
    // ========================================================

    if (command === "foreverban") {
        if (!isFounder(message.member)) {
            return sendError(
                message,
                "only Founder or Server Owner can forever ban."
            );
        }

        const target =
            getMentionedMember(message);

        if (!target) {
            return sendError(
                message,
                "usage: `-foreverban @user`"
            );
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

        saveDB();

        await sendModerationDM(
            target.user,
            message.guild,
            "Forever Ban",
            "You have been permanently banned from this server."
        );

        await message.guild.members.ban(
            target.id,
            {
                reason: "VC+ Forever Ban"
            }
        ).catch(() => {});

        return sendSuccess(
            message,
            "forever banned",
            `${target} has been added to the forever-ban list.`
        );
    }

    // ========================================================
    // BAN
    // ========================================================

    if (command === "ban") {
        const target =
            getMentionedMember(message);

        if (!target) {
            return sendError(
                message,
                "usage: `-ban @user [reason]`"
            );
        }

        const reason =
            args.slice(1).join(" ") ||
            "No reason provided";

        return commandBan(
            message,
            target,
            reason
        );
    }

    // ========================================================
    // KICK
    // ========================================================

    if (command === "kick") {
        const target =
            getMentionedMember(message);

        if (!target) {
            return sendError(
                message,
                "usage: `-kick @user [reason]`"
            );
        }

        const reason =
            args.slice(1).join(" ") ||
            "No reason provided";

        return commandKick(
            message,
            target,
            reason
        );
    }

    // ========================================================
    // TIMEOUT
    // ========================================================

    if (command === "timeout") {
        const target =
            getMentionedMember(message);

        const minutes =
            Number(args[1]);

        if (
            !target ||
            !Number.isFinite(minutes)
        ) {
            return sendError(
                message,
                "usage: `-timeout @user <minutes> [reason]`"
            );
        }

        const reason =
            args.slice(2).join(" ") ||
            "No reason provided";

        return commandTimeout(
            message,
            target,
            minutes,
            reason
        );
    }

    // ========================================================
    // UNTIMEOUT
    // ========================================================

    if (command === "untimeout") {
        const target =
            getMentionedMember(message);

        if (!target) {
            return sendError(
                message,
                "usage: `-untimeout @user`"
            );
        }

        if (
            !canManageTarget(
                message.member,
                target
            )
        ) {
            return sendError(
                message,
                "you cannot remove that member's timeout."
            );
        }

        try {
            await target.timeout(
                null,
                "VC+ untimeout"
            );

            return sendSuccess(
                message,
                "untimeout",
                `${target} is no longer timed out.`
            );
        } catch {
            return sendError(
                message,
                "I could not remove that timeout."
            );
        }
    }

    // ========================================================
    // UNBAN
    // ========================================================

    if (command === "unban") {
        if (
            !isFounder(message.member) &&
            !hasPermission(
                message.member,
                PermissionFlagsBits.BanMembers
            )
        ) {
            return sendError(
                message,
                "you do not have permission to unban."
            );
        }

        const id =
            cleanId(args[0]);

        if (!id) {
            return sendError(
                message,
                "usage: `-unban <user id>`"
            );
        }

        try {
            await message.guild.members.unban(
                id,
                "VC+ unban"
            );

            return sendSuccess(
                message,
                "unbanned",
                `<@${id}> has been unbanned.`
            );
        } catch {
            return sendError(
                message,
                "that user could not be unbanned."
            );
        }
    }

    // ========================================================
    // BANLIST
    // ========================================================

    if (command === "banlist") {
        if (
            !isFounder(message.member) &&
            !hasPermission(
                message.member,
                PermissionFlagsBits.BanMembers
            )
        ) {
            return sendError(
                message,
                "you do not have permission to view the ban list."
            );
        }

        try {
            const bans =
                await message.guild.bans.fetch();

            if (bans.size === 0) {
                return sendInfo(
                    message,
                    "ban list",
                    "there are no banned users."
                );
            }

            const lines =
                [...bans.values()]
                    .slice(0, 40)
                    .map(
                        ban =>
                            `<@${ban.user.id}> — ${ban.reason || "no reason"}`
                    );

            return sendInfo(
                message,
                "ban list",
                lines.join("\n")
            );
        } catch {
            return sendError(
                message,
                "I could not retrieve the ban list."
            );
        }
    }

    // ========================================================
    // UNBAN ALL
    // ========================================================

    if (command === "unbanall") {
        if (!isFounder(message.member)) {
            return sendError(
                message,
                "only Founder or Server Owner can use unbanall."
            );
        }

        if (
            args[0]?.toLowerCase() !==
            "confirm"
        ) {
            return sendError(
                message,
                "this removes every server ban. use `-unbanall confirm` to continue."
            );
        }

        try {
            const bans =
                await message.guild.bans.fetch();

            let count = 0;

            for (const ban of bans.values()) {
                await message.guild.members.unban(
                    ban.user.id,
                    "VC+ unbanall"
                ).catch(() => {});

                count++;
            }

            return sendSuccess(
                message,
                "unbanall complete",
                `processed ${count} banned users.`
            );
        } catch {
            return sendError(
                message,
                "unbanall could not be completed."
            );
        }
    }

    // ========================================================
    // PURGE
    // ========================================================

    if (command === "purge") {
        if (
            !hasPermission(
                message.member,
                PermissionFlagsBits.ManageMessages
            )
        ) {
            return sendError(
                message,
                "you do not have permission to purge messages."
            );
        }

        const amount =
            Number(args[0]);

        if (
            !Number.isInteger(amount) ||
            amount < 1 ||
            amount > 100
        ) {
            return sendError(
                message,
                "amount must be between 1 and 100."
            );
        }

        try {
            const deleted =
                await message.channel.bulkDelete(
                    amount,
                    true
                );

            return sendInfo(
                message,
                "purged",
                `deleted ${deleted.size} messages.`
            );
        } catch {
            return sendError(
                message,
                "I could not delete those messages."
            );
        }
    }

    // ========================================================
    // VC COMMANDS
    // ========================================================

    if (command === "vc") {
        const sub =
            args.shift()?.toLowerCase();

        // ----------------------------------------------------
        // SETUP
        // ----------------------------------------------------

        if (sub === "setup") {
            if (!isFounder(message.member)) {
                return sendError(
                    message,
                    "only Founder or Server Owner can set up the VC system."
                );
            }

            const data =
                getGuildData(
                    message.guild.id
                );

            let category =
                message.guild.channels.cache.get(
                    data.jtc.categoryId
                );

            if (
                !category ||
                category.type !==
                ChannelType.GuildCategory
            ) {
                category =
                    await message.guild.channels.create({
                        name: "VC+",
                        type: ChannelType.GuildCategory
                    });

                data.jtc.categoryId =
                    category.id;
            }

            let jtc =
                message.guild.channels.cache.get(
                    data.jtc.channelId
                );

            if (
                !jtc ||
                jtc.type !==
                ChannelType.GuildVoice
            ) {
                jtc =
                    await message.guild.channels.create({
                        name: "Join To Create",
                        type: ChannelType.GuildVoice,
                        parent: category.id
                    });

                data.jtc.channelId =
                    jtc.id;
            }

            saveDB();

            return sendSuccess(
                message,
                "VC setup",
                `join-to-create is ready.\njoin <#${jtc.id}> to create your personal VC.`
            );
        }

        // ----------------------------------------------------
        // COUNT
        // ----------------------------------------------------

        if (sub === "count") {
            const count =
                [...tempVCs.entries()]
                    .filter(
                        ([channelId, vc]) =>
                            vc.guildId ===
                            message.guild.id &&
                            message.guild.channels.cache.has(
                                channelId
                            )
                    ).length;

            return sendInfo(
                message,
                "VC count",
                `there are **${count}** active temporary VCs.`
            );
        }

        // ----------------------------------------------------
        // PANEL
        // ----------------------------------------------------

        if (sub === "panel") {
            if (!message.member.voice.channel) {
                return sendError(
                    message,
                    "you must be inside your temporary VC."
                );
            }

            const channel =
                message.member.voice.channel;

            if (!tempVCs.has(channel.id)) {
                return sendError(
                    message,
                    "this is not a VC+ temporary VC."
                );
            }

            await createVCInterface(channel);

            return sendSuccess(
                message,
                "panel",
                "your VC control panel has been refreshed."
            );
        }

        // ----------------------------------------------------
        // CLAIM
        // ----------------------------------------------------

        if (sub === "claim") {
            const fakeInteraction = {
                member: message.member,
                guild: message.guild,
                reply: async payload =>
                    message.reply(payload),
                editReply: async payload =>
                    message.reply(payload),
                replied: false,
                deferred: false
            };

            return claimVC(
                fakeInteraction,
                false
            );
        }

        // ----------------------------------------------------
        // FORCE CLAIM
        // ----------------------------------------------------

        if (sub === "forceclaim") {
            if (!isGod(message.member)) {
                return sendError(
                    message,
                    "only God or Founder can force claim a VC."
                );
            }

            const fakeInteraction = {
                member: message.member,
                guild: message.guild,
                reply: async payload =>
                    message.reply(payload),
                editReply: async payload =>
                    message.reply(payload),
                replied: false,
                deferred: false
            };

            return claimVC(
                fakeInteraction,
                true
            );
        }

        // ----------------------------------------------------
        // LOCK / UNLOCK
        // ----------------------------------------------------

        if (
            sub === "lock" ||
            sub === "unlock"
        ) {
            const fakeInteraction = {
                member: message.member,
                guild: message.guild,
                reply: async payload =>
                    message.reply(payload),
                editReply: async payload =>
                    message.reply(payload),
                replied: false,
                deferred: false
            };

            return setVCLock(
                fakeInteraction,
                sub === "lock"
            );
        }

        // ----------------------------------------------------
        // TARGET VC ACTIONS
        // ----------------------------------------------------

        const targetActions = [
            "kick",
            "disconnect",
            "ban",
            "reject",
            "permit",
            "stfu",
            "unstfu"
        ];

        if (
            targetActions.includes(sub)
        ) {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    `usage: \`-vc ${sub} @user\``
                );
            }

            if (!message.member.voice.channel) {
                return sendError(
                    message,
                    "you must be inside your temporary VC."
                );
            }

            const channel =
                message.member.voice.channel;

            const vc =
                tempVCs.get(channel.id);

            if (!vc) {
                return sendError(
                    message,
                    "this is not a VC+ temporary VC."
                );
            }

            if (
                !canUseTargetVCAction(
                    message.member,
                    target,
                    vc,
                    sub
                )
            ) {
                return sendError(
                    message,
                    "you do not have permission to perform that action."
                );
            }

            // Direct command versions.
            if (
                sub === "kick" ||
                sub === "disconnect"
            ) {
                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return sendError(
                        message,
                        "that user is not inside this VC."
                    );
                }

                await target.voice.disconnect(
                    `VC+ ${sub}`
                ).catch(() => {});

                return sendSuccess(
                    message,
                    "done",
                    `${target} was ${sub === "kick" ? "kicked" : "disconnected"}.`
                );
            }

            if (sub === "ban") {
                vc.banned.add(
                    target.id
                );

                vc.rejected.delete(
                    target.id
                );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false,
                        ViewChannel: false
                    }
                ).catch(() => {});

                if (
                    target.voice.channelId ===
                    channel.id
                ) {
                    await target.voice.disconnect(
                        "VC+ VC ban"
                    ).catch(() => {});
                }

                persistVC(channel.id);

                return sendSuccess(
                    message,
                    "done",
                    `${target} was banned from the VC.`
                );
            }

            if (sub === "reject") {
                vc.rejected.add(
                    target.id
                );

                vc.banned.delete(
                    target.id
                );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                if (
                    target.voice.channelId ===
                    channel.id
                ) {
                    await target.voice.disconnect(
                        "VC+ reject"
                    ).catch(() => {});
                }

                persistVC(channel.id);

                return sendSuccess(
                    message,
                    "done",
                    `${target} was rejected from the VC.`
                );
            }

            if (sub === "permit") {
                vc.banned.delete(
                    target.id
                );

                vc.rejected.delete(
                    target.id
                );

                vc.permitted.add(
                    target.id
                );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: null,
                        ViewChannel: null
                    }
                ).catch(() => {});

                persistVC(channel.id);

                return sendSuccess(
                    message,
                    "done",
                    `${target} is permitted to join the VC.`
                );
            }

            if (sub === "stfu") {
                await target.voice.setMute(
                    true,
                    "VC+ STFU"
                ).catch(() => {});

                vc.stfu.add(
                    target.id
                );

                persistVC(channel.id);

                return sendSuccess(
                    message,
                    "done",
                    `${target} has been server muted.`
                );
            }

            if (sub === "unstfu") {
                await target.voice.setMute(
                    false,
                    "VC+ UnSTFU"
                ).catch(() => {});

                vc.stfu.delete(
                    target.id
                );

                persistVC(channel.id);

                return sendSuccess(
                    message,
                    "done",
                    `${target} has been server unmuted.`
                );
            }
        }

        // ----------------------------------------------------
        // TRANSFER
        // ----------------------------------------------------

        if (sub === "transfer") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-vc transfer @user`"
                );
            }

            const fakeInteraction = {
                member: message.member,
                guild: message.guild,
                reply: async payload =>
                    message.reply(payload),
                editReply: async payload =>
                    message.reply(payload),
                replied: false,
                deferred: false
            };

            return transferVC(
                fakeInteraction,
                target.id
            );
        }

        // ----------------------------------------------------
        // RENAME
        // ----------------------------------------------------

        if (sub === "rename") {
            if (!message.member.voice.channel) {
                return sendError(
                    message,
                    "you must be inside your temporary VC."
                );
            }

            const channel =
                message.member.voice.channel;

            const vc =
                tempVCs.get(channel.id);

            if (!vc) {
                return sendError(
                    message,
                    "this is not a VC+ temporary VC."
                );
            }

            if (!vcOwner(message.member, vc)) {
                return sendError(
                    message,
                    "only the VC owner or Founder can rename this VC."
                );
            }

            const name =
                args.join(" ").trim();

            if (
                !name ||
                name.length > 100
            ) {
                return sendError(
                    message,
                    "VC name must be between 1 and 100 characters."
                );
            }

            try {
                await channel.setName(
                    name,
                    "VC+ rename"
                );

                await createVCInterface(channel);

                return sendSuccess(
                    message,
                    "renamed",
                    `VC renamed to **${name}**.`
                );
            } catch {
                return sendError(
                    message,
                    "I could not rename the VC."
                );
            }
        }

        // ----------------------------------------------------
        // LIMIT
        // ----------------------------------------------------

        if (sub === "limit") {
            if (!message.member.voice.channel) {
                return sendError(
                    message,
                    "you must be inside your temporary VC."
                );
            }

            const channel =
                message.member.voice.channel;

            const vc =
                tempVCs.get(channel.id);

            if (!vc) {
                return sendError(
                    message,
                    "this is not a VC+ temporary VC."
                );
            }

            if (!vcOwner(message.member, vc)) {
                return sendError(
                    message,
                    "only the VC owner or Founder can change the limit."
                );
            }

            const limit =
                Number(args[0]);

            if (
                !Number.isInteger(limit) ||
                limit < 0 ||
                limit > 99
            ) {
                return sendError(
                    message,
                    "limit must be between 0 and 99."
                );
            }

            try {
                await channel.setUserLimit(
                    limit,
                    "VC+ limit"
                );

                return sendSuccess(
                    message,
                    "limit changed",
                    `VC limit is now **${limit === 0 ? "unlimited" : limit}**.`
                );
            } catch {
                return sendError(
                    message,
                    "I could not change the VC limit."
                );
            }
        }

        return sendError(
            message,
            "unknown VC command. use `-help`."
        );
    }

    // ========================================================
    // VOUCH
    // ========================================================

    if (command === "vouch") {
        if (!isFounder(message.member)) {
            return sendError(
                message,
                "only Founder or Server Owner can manage vouches."
            );
        }

        const sub =
            args.shift()?.toLowerCase();

        const data =
            getGuildData(
                message.guild.id
            );

        // ----------------------------------------------------
        // GIVE
        // ----------------------------------------------------

        if (sub === "give") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-vouch give @user`"
                );
            }

            if (target.user.bot) {
                return sendError(
                    message,
                    "bots cannot receive vouches."
                );
            }

            if (
                target.id ===
                message.author.id
            ) {
                return sendError(
                    message,
                    "you cannot vouch yourself."
                );
            }

            data.vouchRevoked[target.id] =
                false;

            data.vouches[target.id] =
                getVouchCount(
                    message.guild.id,
                    target.id
                ) + 1;

            saveDB();

            await syncVouchRole(target);

            const count =
                getVouchCount(
                    message.guild.id,
                    target.id
                );

            return sendSuccess(
                message,
                "vouch added",
                `${target} now has **${count}** vouches.`
            );
        }

        // ----------------------------------------------------
        // TAKE
        // ----------------------------------------------------

        if (sub === "take") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-vouch take @user`"
                );
            }

            const current =
                getVouchCount(
                    message.guild.id,
                    target.id
                );

            if (current <= 0) {
                return sendError(
                    message,
                    `${target} has no vouches to take.`
                );
            }

            data.vouches[target.id] =
                Math.max(
                    0,
                    current - 1
                );

            // IMPORTANT:
            // Once a vouch is taken, the user is revoked
            // from self-claiming the vouch role.
            data.vouchRevoked[target.id] =
                true;

            saveDB();

            await syncVouchRole(target);

            return sendSuccess(
                message,
                "vouch taken",
                `${target} lost a vouch.\n` +
                `vouches: ${data.vouches[target.id]}\n` +
                `vouch role: removed\n` +
                `self-claim: disabled`
            );
        }

        // ----------------------------------------------------
        // CLEAR
        // ----------------------------------------------------

        if (sub === "clear") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-vouch clear @user`"
                );
            }

            // Completely wipes their vouch information.
            delete data.vouches[target.id];

            // Completely revokes their ability to self claim.
            data.vouchRevoked[target.id] =
                true;

            saveDB();

            await syncVouchRole(target);

            return sendSuccess(
                message,
                "vouches cleared",
                `${target}'s vouches were completely cleared.\n` +
                `vouches: 0\n` +
                `vouch role: removed\n` +
                `self-claim: disabled`
            );
        }

        // ----------------------------------------------------
        // LIST
        // ----------------------------------------------------

        if (sub === "list") {
            const entries =
                Object.entries(
                    data.vouches
                )
                    .filter(
                        ([, count]) =>
                            Number(count) > 0
                    )
                    .sort(
                        (a, b) =>
                            Number(b[1]) -
                            Number(a[1])
                    )
                    .slice(0, 50);

            if (entries.length === 0) {
                return sendInfo(
                    message,
                    "vouches",
                    "there are no active vouches."
                );
            }

            const lines =
                entries.map(
                    ([id, count], index) =>
                        `${index + 1}. <@${id}> — **${count}**`
                );

            return sendInfo(
                message,
                "vouch list",
                lines.join("\n")
            );
        }

        // ----------------------------------------------------
        // ROLE SET
        // ----------------------------------------------------

        if (
            sub === "role" &&
            args[0]?.toLowerCase() === "set"
        ) {
            const role =
                message.mentions.roles.first();

            if (!role) {
                return sendError(
                    message,
                    "usage: `-vouch role set @role`"
                );
            }

            if (role.managed) {
                return sendError(
                    message,
                    "that role is managed and cannot be used."
                );
            }

            if (
                !botCanManageRole(
                    message.guild,
                    role
                )
            ) {
                return sendError(
                    message,
                    "I cannot manage that role. Move it below my bot role."
                );
            }

            data.roles.vouch =
                role.id;

            saveDB();

            await syncAllVouchRoles(
                message.guild
            );

            return sendSuccess(
                message,
                "vouch role set",
                `${role} is now the VC+ vouch role.`
            );
        }

        // ----------------------------------------------------
        // LIMIT
        // ----------------------------------------------------

        if (sub === "limit") {
            const limit =
                Number(args[0]);

            if (
                !Number.isInteger(limit) ||
                limit < 1 ||
                limit > 100000
            ) {
                return sendError(
                    message,
                    "vouch limit must be between 1 and 100000."
                );
            }

            data.vouchLimit =
                limit;

            saveDB();

            await syncAllVouchRoles(
                message.guild
            );

            return sendSuccess(
                message,
                "vouch limit",
                `users now need **${limit}** vouches to qualify for the role.`
            );
        }

        return sendError(
            message,
            "unknown vouch command."
        );
    }

    // ========================================================
    // VOUCH ROLE
    // ========================================================

    if (command === "vouchrole") {
        const data =
            getGuildData(
                message.guild.id
            );

        const sub =
            args[0]?.toLowerCase();

        // ----------------------------------------------------
        // VIEW
        // ----------------------------------------------------

        if (sub === "view") {
            const role =
                data.roles.vouch
                    ? message.guild.roles.cache.get(
                        data.roles.vouch
                    )
                    : null;

            return sendInfo(
                message,
                "vouch role",
                [
                    `role: ${role || "not configured"}`,
                    `required vouches: ${data.vouchLimit}`,
                    `your vouches: ${getVouchCount(message.guild.id, message.author.id)}`,
                    `your status: ${isVouchRevoked(message.guild.id, message.author.id) ? "revoked" : "eligible"}`
                ].join("\n")
            );
        }

        // ----------------------------------------------------
        // CLAIM
        // ----------------------------------------------------

        if (sub === "claim") {
            const role =
                data.roles.vouch
                    ? message.guild.roles.cache.get(
                        data.roles.vouch
                    )
                    : null;

            if (!role) {
                return sendError(
                    message,
                    "the vouch role has not been configured."
                );
            }

            const count =
                getVouchCount(
                    message.guild.id,
                    message.author.id
                );

            // A taken/cleared vouch permanently blocks
            // self-claim until Founder gives a new vouch.
            if (
                isVouchRevoked(
                    message.guild.id,
                    message.author.id
                )
            ) {
                return sendError(
                    message,
                    "your vouch status has been revoked. you cannot self-claim the vouch role."
                );
            }

            if (
                count <
                data.vouchLimit
            ) {
                return sendError(
                    message,
                    `you need ${data.vouchLimit} vouches. you currently have ${count}.`
                );
            }

            if (
                !botCanManageRole(
                    message.guild,
                    role
                )
            ) {
                return sendError(
                    message,
                    "I cannot assign the vouch role because of the role hierarchy."
                );
            }

            try {
                await message.member.roles.add(
                    role,
                    "VC+ vouch role self claim"
                );

                return sendSuccess(
                    message,
                    "role claimed",
                    `you received ${role}.`
                );
            } catch {
                return sendError(
                    message,
                    "I could not give you the role."
                );
            }
        }

        return sendError(
            message,
            "usage: `-vouchrole view` or `-vouchrole claim`."
        );
    }

    // ========================================================
    // FILTER
    // ========================================================

    if (command === "filter") {
        if (!isGod(message.member)) {
            return sendError(
                message,
                "only God or Founder can manage AutoMod."
            );
        }

        const sub =
            args.shift()?.toLowerCase();

        const data =
            getGuildData(
                message.guild.id
            );

        if (sub === "on") {
            data.filters.enabled =
                true;

            saveDB();

            return sendSuccess(
                message,
                "automod",
                "word filtering is now enabled."
            );
        }

        if (sub === "off") {
            data.filters.enabled =
                false;

            saveDB();

            return sendSuccess(
                message,
                "automod",
                "word filtering is now disabled."
            );
        }

        if (sub === "add") {
            const word =
                args.join(" ").trim().toLowerCase();

            if (!word) {
                return sendError(
                    message,
                    "usage: `-filter add <word>`"
                );
            }

            if (
                !data.filters.words.includes(
                    word
                )
            ) {
                data.filters.words.push(
                    word
                );
            }

            saveDB();

            return sendSuccess(
                message,
                "filter added",
                `added **${word}** to the filter.`
            );
        }

        if (sub === "remove") {
            const word =
                args.join(" ").trim().toLowerCase();

            const index =
                data.filters.words.indexOf(
                    word
                );

            if (index === -1) {
                return sendError(
                    message,
                    "that word is not in the filter."
                );
            }

            data.filters.words.splice(
                index,
                1
            );

            saveDB();

            return sendSuccess(
                message,
                "filter removed",
                `removed **${word}** from the filter.`
            );
        }

        if (sub === "list") {
            return sendInfo(
                message,
                "filter list",
                data.filters.words.length
                    ? data.filters.words
                        .map(
                            word =>
                                `• ${word}`
                        )
                        .join("\n")
                    : "no filtered words."
            );
        }

        if (sub === "log") {
            const channel =
                message.mentions.channels.first();

            if (!channel) {
                return sendError(
                    message,
                    "usage: `-filter log #channel`"
                );
            }

            data.filters.logChannelId =
                channel.id;

            saveDB();

            return sendSuccess(
                message,
                "automod log",
                `AutoMod logs will be sent to ${channel}.`
            );
        }

        if (sub === "strikes") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-filter strikes @user`"
                );
            }

            const strikes =
                Number(
                    data.filters.strikes[target.id] ||
                    0
                );

            return sendInfo(
                message,
                "strikes",
                `${target} has **${strikes}** AutoMod strikes.`
            );
        }

        if (sub === "reset") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return sendError(
                    message,
                    "usage: `-filter reset @user`"
                );
            }

            data.filters.strikes[target.id] =
                0;

            saveDB();

            return sendSuccess(
                message,
                "strikes reset",
                `${target}'s AutoMod strikes have been reset.`
            );
        }

        return sendError(
            message,
            "unknown filter command."
        );
    }
}

// ============================================================
// INTERACTIONS
// ============================================================

async function handleInteraction(interaction) {
    if (!interaction.guild) {
        return;
    }

    // ========================================================
    // BUTTONS
    // ========================================================

    if (interaction.isButton()) {
        const id =
            interaction.customId;

        if (
            !id.startsWith("vcui_")
        ) {
            return;
        }

        if (id === "vcui_refresh") {
            const channel =
                interaction.member?.voice?.channel;

            if (!channel) {
                return interactionMessage(
                    interaction,
                    "error",
                    "you must be inside your temporary VC."
                );
            }

            if (!tempVCs.has(channel.id)) {
                return interactionMessage(
                    interaction,
                    "error",
                    "this is not a VC+ temporary VC."
                );
            }

            await createVCInterface(channel);

            return interactionMessage(
                interaction,
                "refreshed",
                "VC panel refreshed."
            );
        }

        if (id === "vcui_claim") {
            return claimVC(
                interaction,
                false
            );
        }

        if (id === "vcui_forceclaim") {
            return claimVC(
                interaction,
                true
            );
        }

        if (id === "vcui_lock") {
            return setVCLock(
                interaction,
                true
            );
        }

        if (id === "vcui_unlock") {
            return setVCLock(
                interaction,
                false
            );
        }

        if (id === "vcui_rename") {
            const member =
                interaction.member;

            const channel =
                member?.voice?.channel;

            const vc =
                channel
                    ? tempVCs.get(channel.id)
                    : null;

            if (!vc) {
                return interactionMessage(
                    interaction,
                    "error",
                    "you must be inside your temporary VC."
                );
            }

            if (!vcOwner(member, vc)) {
                return interactionMessage(
                    interaction,
                    "error",
                    "only the VC owner or Founder can rename the VC."
                );
            }

            return showRenameModal(
                interaction
            );
        }

        if (id === "vcui_limit") {
            const member =
                interaction.member;

            const channel =
                member?.voice?.channel;

            const vc =
                channel
                    ? tempVCs.get(channel.id)
                    : null;

            if (!vc) {
                return interactionMessage(
                    interaction,
                    "error",
                    "you must be inside your temporary VC."
                );
            }

            if (!vcOwner(member, vc)) {
                return interactionMessage(
                    interaction,
                    "error",
                    "only the VC owner or Founder can change the limit."
                );
            }

            return showLimitModal(
                interaction
            );
        }

        const targetActions = [
            "kick",
            "disconnect",
            "ban",
            "reject",
            "permit",
            "stfu",
            "unstfu"
        ];

        const action =
            id.replace(
                "vcui_",
                ""
            );

        if (
            targetActions.includes(
                action
            )
        ) {
            return interaction.reply({
                content:
                    `${BOT_NAME}\n\n> **select target**\n> choose the user you want to ${action}.`,
                components: [
                    targetSelect(action)
                ],
                ephemeral: true
            });
        }

        return;
    }

    // ========================================================
    // USER SELECT
    // ========================================================

    if (interaction.isUserSelectMenu()) {
        const id =
            interaction.customId;

        if (
            !id.startsWith(
                "vcui_target_"
            )
        ) {
            return;
        }

        const action =
            id.replace(
                "vcui_target_",
                ""
            );

        const targetId =
            interaction.values[0];

        return performVCAction(
            interaction,
            action,
            targetId
        );
    }

    // ========================================================
    // MODALS
    // ========================================================

    if (interaction.isModalSubmit()) {
        // ----------------------------------------------------
        // RENAME
        // ----------------------------------------------------

        if (
            interaction.customId ===
            "vcui_rename_modal"
        ) {
            const member =
                interaction.member;

            const channel =
                member?.voice?.channel;

            if (!channel) {
                return interactionMessage(
                    interaction,
                    "error",
                    "you must be inside your temporary VC."
                );
            }

            const vc =
                tempVCs.get(channel.id);

            if (!vc) {
                return interactionMessage(
                    interaction,
                    "error",
                    "this is not a VC+ temporary VC."
                );
            }

            if (!vcOwner(member, vc)) {
                return interactionMessage(
                    interaction,
                    "error",
                    "only the VC owner or Founder can rename the VC."
                );
            }

            const name =
                interaction.fields
                    .getTextInputValue(
                        "vc_name"
                    )
                    .trim();

            if (
                !name ||
                name.length > 100
            ) {
                return interactionMessage(
                    interaction,
                    "error",
                    "VC name must be between 1 and 100 characters."
                );
            }

            try {
                await channel.setName(
                    name,
                    "VC+ modal rename"
                );

                await createVCInterface(
                    channel
                );

                return interactionMessage(
                    interaction,
                    "renamed",
                    `VC renamed to **${name}**.`
                );
            } catch {
                return interactionMessage(
                    interaction,
                    "error",
                    "I could not rename the VC."
                );
            }
        }

        // ----------------------------------------------------
        // LIMIT
        // ----------------------------------------------------

        if (
            interaction.customId ===
            "vcui_limit_modal"
        ) {
            const member =
                interaction.member;

            const channel =
                member?.voice?.channel;

            if (!channel) {
                return interactionMessage(
                    interaction,
                    "error",
                    "you must be inside your temporary VC."
                );
            }

            const vc =
                tempVCs.get(channel.id);

            if (!vc) {
                return interactionMessage(
                    interaction,
                    "error",
                    "this is not a VC+ temporary VC."
                );
            }

            if (!vcOwner(member, vc)) {
                return interactionMessage(
                    interaction,
                    "error",
                    "only the VC owner or Founder can change the limit."
                );
            }

            const limit =
                Number(
                    interaction.fields
                        .getTextInputValue(
                            "vc_limit"
                        )
                );

            if (
                !Number.isInteger(limit) ||
                limit < 0 ||
                limit > 99
            ) {
                return interactionMessage(
                    interaction,
                    "error",
                    "limit must be between 0 and 99."
                );
            }

            try {
                await channel.setUserLimit(
                    limit,
                    "VC+ modal limit"
                );

                return interactionMessage(
                    interaction,
                    "limit changed",
                    `VC limit is now **${limit === 0 ? "unlimited" : limit}**.`
                );
            } catch {
                return interactionMessage(
                    interaction,
                    "error",
                    "I could not change the VC limit."
                );
            }
        }
    }
}

// ============================================================
// MESSAGE EVENT
// ============================================================

client.on(
    "messageCreate",
    message => {
        void (async () => {
            try {
                if (
                    await handleAutoMod(
                        message
                    )
                ) {
                    return;
                }

                await handleCommand(
                    message
                );
            } catch (error) {
                console.error(
                    "[VC+] messageCreate error:",
                    error
                );

                try {
                    await message.reply({
                        content: plain(
                            "error",
                            "something went wrong while processing that command."
                        ),
                        allowedMentions: {
                            repliedUser: false
                        }
                    });
                } catch {}
            }
        })();
    }
);

// ============================================================
// INTERACTION EVENT
// ============================================================

client.on(
    "interactionCreate",
    interaction => {
        void (async () => {
            try {
                await handleInteraction(
                    interaction
                );
            } catch (error) {
                console.error(
                    "[VC+] interactionCreate error:",
                    error
                );

                await interactionMessage(
                    interaction,
                    "error",
                    "something went wrong while processing that action."
                );
            }
        })();
    }
);

// ============================================================
// JOIN TO CREATE
// ============================================================

client.on(
    "voiceStateUpdate",
    (oldState, newState) => {
        void (async () => {
            try {
                const guild =
                    newState.guild;

                const data =
                    getGuildData(
                        guild.id
                    );

                // Joined Join-To-Create
                if (
                    newState.channelId &&
                    newState.channelId ===
                    data.jtc.channelId &&
                    oldState.channelId !==
                    newState.channelId
                ) {
                    const member =
                        newState.member;

                    if (
                        member &&
                        !member.user.bot
                    ) {
                        await createPersonalVC(
                            member
                        );
                    }
                }

                // Left temporary VC.
                if (
                    oldState.channelId &&
                    oldState.channelId !==
                    newState.channelId
                ) {
                    const oldChannel =
                        oldState.channel;

                    if (oldChannel) {
                        await deleteEmptyVC(
                            oldChannel
                        );
                    }
                }
            } catch (error) {
                console.error(
                    "[VC+] voiceStateUpdate error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// FOREVER BAN CHECK
// ============================================================

client.on(
    "guildMemberAdd",
    member => {
        void (async () => {
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
                    await member.send({
                        content:
                            `${BOT_NAME}\n\n> **forever ban**\n> you are permanently banned from this server.`
                    }).catch(() => {});

                    await member.ban({
                        reason:
                            "VC+ Forever Ban List"
                    }).catch(() => {});
                }
            } catch (error) {
                console.error(
                    "[VC+] guildMemberAdd error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// CHANNEL CREATE
// ============================================================

client.on(
    "channelCreate",
    channel => {
        void (async () => {
            try {
                if (channel.guild) {
                    await securityChannelCreate(
                        channel
                    );
                }
            } catch (error) {
                console.error(
                    "[VC+] channelCreate error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// CHANNEL DELETE
// ============================================================

client.on(
    "channelDelete",
    channel => {
        void (async () => {
            try {
                if (channel.guild) {
                    await securityChannelDelete(
                        channel
                    );
                }

                const vc =
                    tempVCs.get(
                        channel.id
                    );

                if (vc) {
                    tempVCs.delete(
                        channel.id
                    );

                    removePersistedVC(
                        channel.id,
                        vc.guildId
                    );
                }
            } catch (error) {
                console.error(
                    "[VC+] channelDelete error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// ROLE CREATE
// ============================================================

client.on(
    "roleCreate",
    role => {
        void (async () => {
            try {
                await securityRoleCreate(
                    role
                );
            } catch (error) {
                console.error(
                    "[VC+] roleCreate error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// ROLE DELETE
// ============================================================

client.on(
    "roleDelete",
    role => {
        void (async () => {
            try {
                await securityRoleDelete(
                    role
                );
            } catch (error) {
                console.error(
                    "[VC+] roleDelete error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// WEBHOOK CREATE
// ============================================================

client.on(
    "webhookUpdate",
    (channel) => {
        // Discord's webhookUpdate event doesn't directly
        // provide the created webhook. Audit-log protection
        // is handled separately when possible.
        void (async () => {
            try {
                const guild =
                    channel.guild;

                const data =
                    getGuildData(
                        guild.id
                    );

                if (
                    !data.protection.enabled ||
                    !data.protection.webhookCreate
                ) {
                    return;
                }

                setTimeout(async () => {
                    const executor =
                        await getRecentAuditExecutor(
                            guild,
                            AuditLogEvent.WebhookCreate
                        );

                    if (!executor) {
                        return;
                    }

                    if (
                        await isTrustedExecutor(
                            guild,
                            executor.id
                        )
                    ) {
                        return;
                    }

                    await punishSecurityExecutor(
                        guild,
                        executor.id,
                        "unauthorized webhook activity"
                    );
                }, 800);
            } catch (error) {
                console.error(
                    "[VC+] webhook protection error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// READY
// ============================================================

client.once(
    "ready",
    () => {
        void (async () => {
            try {
                console.log(
                    `[VC+] Logged in as ${client.user.tag}`
                );

                client.user.setPresence({
                    status: "online",
                    activities: [
                        {
                            name: "-help",
                            type: ActivityType.Watching
                        }
                    ]
                });

                await hydrateTempVCs();

                // Clean stale empty VCs.
                for (
                    const channelId
                    of tempVCs.keys()
                ) {
                    const channel =
                        client.channels.cache.get(
                            channelId
                        );

                    if (
                        channel &&
                        channel.type ===
                        ChannelType.GuildVoice
                    ) {
                        await deleteEmptyVC(
                            channel
                        );
                    }
                }

                console.log(
                    `[VC+] Loaded ${tempVCs.size} temporary VCs.`
                );
            } catch (error) {
                console.error(
                    "[VC+] ready error:",
                    error
                );
            }
        })();
    }
);

// ============================================================
// CLIENT ERRORS
// ============================================================

client.on(
    "error",
    error => {
        console.error(
            "[VC+] Discord client error:",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[VC+] Discord warning:",
            warning
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "[VC+] Shard error:",
            error
        );
    }
);

// ============================================================
// PROCESS ERROR PROTECTION
// ============================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+] Unhandled promise rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[VC+] Uncaught exception:",
            error
        );

        // Do not intentionally terminate the process here.
        // The bot logs the exception instead.
    }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `[VC+] ${signal} received. Saving database...`
    );

    saveDB();

    try {
        client.destroy();
    } catch {}

    process.exit(0);
}

process.on(
    "SIGINT",
    () => {
        void shutdown("SIGINT");
    }
);

process.on(
    "SIGTERM",
    () => {
        void shutdown("SIGTERM");
    }
);

// ============================================================
// START BOT
// ============================================================

if (!TOKEN) {
    console.error(
        "[VC+] DISCORD_TOKEN is missing."
    );

    console.error(
        "[VC+] Set your Discord bot token as the DISCORD_TOKEN environment variable."
    );
} else {
    client.login(TOKEN).catch(
        error => {
            console.error(
                "[VC+] Login failed:",
                error
            );
        }
    );
}
