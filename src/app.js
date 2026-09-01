import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// CONFIG
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("[VC+] DISCORD_TOKEN is missing.");
    process.exit(1);
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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Message
    ]
});

// ============================================================
// DATABASE
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_GUILD_DATA = {
    ranks: {},
    godmode: [],
    foreverBanned: [],
    vouches: {},
    vouchRevoked: {},
    vouchLimit: 5,

    roles: {
        vouch: null
    },

    jtc: {
        channelId: null,
        categoryId: null
    },

    tempVCs: {},

    filters: {
        enabled: false,
        words: [],
        strikes: {},
        maxStrikes: 3,
        timeoutMinutes: 10
    }
};

let db = {};

function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_GUILD_DATA));
}

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            db = {};
            saveDatabase();
            return;
        }

        const raw = fs.readFileSync(DATA_FILE, "utf8");

        if (!raw.trim()) {
            db = {};
            saveDatabase();
            return;
        }

        db = JSON.parse(raw);

        if (!db || typeof db !== "object") {
            db = {};
        }

        for (const guildId of Object.keys(db)) {
            ensureGuildData(guildId);
        }

        saveDatabase();

        console.log("[VC+] Database loaded.");
    } catch (error) {
        console.error("[VC+] Database load error:", error);
        db = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 4),
            "utf8"
        );
    } catch (error) {
        console.error("[VC+] Database save error:", error);
    }
}

function ensureGuildData(guildId) {
    if (!db[guildId]) {
        db[guildId] = cloneDefault();
        return db[guildId];
    }

    const current = db[guildId];

    current.ranks ??= {};
    current.godmode ??= [];
    current.foreverBanned ??= [];
    current.vouches ??= {};
    current.vouchRevoked ??= {};
    current.vouchLimit ??= 5;

    current.roles ??= {};
    current.roles.vouch ??= null;

    current.jtc ??= {};
    current.jtc.channelId ??= null;
    current.jtc.categoryId ??= null;

    current.tempVCs ??= {};

    current.filters ??= {};
    current.filters.enabled ??= false;
    current.filters.words ??= [];
    current.filters.strikes ??= {};
    current.filters.maxStrikes ??= 3;
    current.filters.timeoutMinutes ??= 10;

    return current;
}

function guildData(guild) {
    return ensureGuildData(guild.id);
}

loadDatabase();

// ============================================================
// MESSAGE STYLE
// ============================================================

function plain(title, text) {
    return `${BOT_NAME}\n\n> **${title}**\n> ${text}`;
}

function replyError(message, text) {
    return message.reply(
        plain("Error", text)
    ).catch(() => {});
}

async function safeInteractionReply(interaction, title, text, ephemeral = true) {
    const content = plain(title, text);

    try {
        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp({
                content,
                ephemeral
            });
        }

        return await interaction.reply({
            content,
            ephemeral
        });
    } catch {
        return null;
    }
}

// ============================================================
// RANK SYSTEM
// ============================================================

const RANK_LEVELS = {
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

function normalizeRank(rank) {
    if (!rank) {
        return null;
    }

    const value = String(rank)
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (value === "coowner") return "coowner";

    if (Object.prototype.hasOwnProperty.call(RANK_LEVELS, value)) {
        return value;
    }

    return null;
}

function getRankName(member, guild) {
    if (!member || !guild) {
        return "member";
    }

    if (member.id === guild.ownerId) {
        return "founder";
    }

    const data = guildData(guild);
    const stored = normalizeRank(data.ranks[member.id]);

    return stored || "member";
}

function getRankLevel(member, guild) {
    return RANK_LEVELS[getRankName(member, guild)] ?? 1;
}

function isServerOwner(member, guild) {
    return Boolean(
        member &&
        guild &&
        member.id === guild.ownerId
    );
}

function isFounder(member) {
    if (!member?.guild) {
        return false;
    }

    return (
        isServerOwner(member, member.guild) ||
        getRankName(member, member.guild) === "founder"
    );
}

function isGod(member) {
    if (!member?.guild) {
        return false;
    }

    if (isFounder(member)) {
        return true;
    }

    const data = guildData(member.guild);

    return (
        getRankLevel(member, member.guild) >= RANK_LEVELS.god ||
        data.godmode.includes(member.id)
    );
}

function canManageTarget(actor, target) {
    if (!actor || !target) {
        return false;
    }

    if (actor.id === target.id) {
        return false;
    }

    if (isServerOwner(actor, actor.guild)) {
        return true;
    }

    const actorLevel = getRankLevel(actor, actor.guild);
    const targetLevel = getRankLevel(target, target.guild);

    return actorLevel > targetLevel;
}

function isFounderOnly(member) {
    return isFounder(member);
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function getMentionedMember(message) {
    return message.mentions.members.first() || null;
}

function getMentionedRole(message) {
    return message.mentions.roles.first() || null;
}

function cleanReason(parts) {
    return parts.join(" ").trim() || "No reason provided";
}

function parsePositiveInteger(value, fallback = null) {
    const number = Number.parseInt(value, 10);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return number;
}

function hasBotPermission(guild, permission) {
    const me = guild.members.me;

    if (!me) {
        return false;
    }

    return me.permissions.has(permission);
}

function getBotMember(guild) {
    return guild.members.me;
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

function getVouchCount(guild, userId) {
    const data = guildData(guild);
    return Number(data.vouches[userId] || 0);
}

function isVouchRevoked(guild, userId) {
    const data = guildData(guild);
    return Boolean(data.vouchRevoked[userId]);
}

function canBotManageRole(guild, role) {
    const me = getBotMember(guild);

    if (!me || !role) {
        return false;
    }

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return false;
    }

    return role.position < me.roles.highest.position;
}

async function syncVouchRole(guild, member) {
    const data = guildData(guild);

    if (!data.roles.vouch) {
        return;
    }

    const role = guild.roles.cache.get(data.roles.vouch);

    if (!role) {
        data.roles.vouch = null;
        saveDatabase();
        return;
    }

    if (!canBotManageRole(guild, role)) {
        return;
    }

    const count = getVouchCount(guild, member.id);
    const limit = Math.max(1, Number(data.vouchLimit || 5));
    const revoked = isVouchRevoked(guild, member.id);

    try {
        if (count >= limit && !revoked) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        } else {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
            }
        }
    } catch (error) {
        console.error("[VC+] Vouch role sync error:", error);
    }
}

async function syncAllVouchRoles(guild) {
    const data = guildData(guild);

    if (!data.roles.vouch) {
        return;
    }

    const role = guild.roles.cache.get(data.roles.vouch);

    if (!role || !canBotManageRole(guild, role)) {
        return;
    }

    for (const member of guild.members.cache.values()) {
        await syncVouchRole(guild, member);
    }
}

// ============================================================
// TEMP VC HELPERS
// ============================================================

function getTempVC(guild, channelId) {
    const data = guildData(guild);
    return data.tempVCs[channelId] || null;
}

function isTempVC(guild, channelId) {
    return Boolean(getTempVC(guild, channelId));
}

function isVCManager(member, channel) {
    const record = getTempVC(member.guild, channel.id);

    if (!record) {
        return false;
    }

    if (isFounder(member)) {
        return true;
    }

    return record.ownerId === member.id;
}

function canUseNormalVCControl(member, channel) {
    const record = getTempVC(member.guild, channel.id);

    if (!record) {
        return false;
    }

    return record.ownerId === member.id || isFounder(member);
}

// ============================================================
// VC INTERFACE
// ============================================================

function buildVCInterface(ownerId, founder = false) {
    const rows = [];

    rows.push(
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
                .setCustomId("vc_claim")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_rename")
                .setLabel("Rename")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_limit")
                .setLabel("Limit")
                .setStyle(ButtonStyle.Secondary)
        )
    );

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_permit")
                .setLabel("Permit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_reject")
                .setLabel("Reject")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_kick")
                .setLabel("Kick")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_transfer")
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_settings")
                .setLabel("Settings")
                .setStyle(ButtonStyle.Secondary)
        )
    );

    if (founder) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vc_stfu")
                    .setLabel("STFU")
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId("vc_unstfu")
                    .setLabel("Unstfu")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_ban")
                    .setLabel("VC Ban")
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId("vc_unban")
                    .setLabel("VC Unban")
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    }

    return rows;
}

async function sendVCInterface(channel) {
    const record = getTempVC(channel.guild, channel.id);

    if (!record) {
        return null;
    }

    const owner = channel.guild.members.cache.get(record.ownerId);

    if (!owner) {
        return null;
    }

    const message = await channel.send({
        content: plain(
            "Voice Channel Interface",
            `Owner: ${owner}\nUse the controls below to manage this VC.`
        ),
        components: buildVCInterface(
            record.ownerId,
            true
        )
    });

    record.interfaceMessageId = message.id;
    saveDatabase();

    return message;
}

async function refreshVCInterface(channel) {
    const record = getTempVC(channel.guild, channel.id);

    if (!record || !record.interfaceMessageId) {
        return;
    }

    try {
        const message = await channel.messages.fetch(
            record.interfaceMessageId
        );

        const owner = channel.guild.members.cache.get(
            record.ownerId
        );

        await message.edit({
            content: plain(
                "Voice Channel Interface",
                `Owner: ${owner ? owner : record.ownerId}\nUse the controls below to manage this VC.`
            ),
            components: buildVCInterface(
                record.ownerId,
                true
            )
        });
    } catch {
        try {
            await sendVCInterface(channel);
        } catch {}
    }
}

// ============================================================
// CREATE TEMP VC
// ============================================================

async function createTempVC(member) {
    const guild = member.guild;
    const data = guildData(guild);

    const categoryId = data.jtc.categoryId;

    if (!categoryId) {
        return null;
    }

    const category = guild.channels.cache.get(categoryId);

    if (!category || category.type !== ChannelType.GuildCategory) {
        return null;
    }

    const channelName = `${member.displayName}'s VC`
        .slice(0, 100);

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: category.id,

        userLimit: 0,

        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.Speak
                ]
            },
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers
                ]
            }
        ]
    });

    data.tempVCs[channel.id] = {
        ownerId: member.id,
        locked: false,
        banned: [],
        permitted: [],
        stfu: [],
        interfaceMessageId: null
    };

    saveDatabase();

    try {
        await sendVCInterface(channel);
    } catch (error) {
        console.error(
            "[VC+] Failed to send VC interface:",
            error
        );
    }

    return channel;
}

// ============================================================
// DELETE TEMP VC
// ============================================================

async function deleteTempVC(channel) {
    const data = guildData(channel.guild);

    delete data.tempVCs[channel.id];

    saveDatabase();

    try {
        if (channel.deletable) {
            await channel.delete("Temporary VC cleanup");
        }
    } catch (error) {
        console.error(
            "[VC+] Failed to delete temporary VC:",
            error
        );
    }
}

// ============================================================
// CLEANUP
// ============================================================

async function cleanupEmptyTempVCs(guild) {
    const data = guildData(guild);

    for (const channelId of Object.keys(data.tempVCs)) {
        const channel = guild.channels.cache.get(channelId);

        if (!channel) {
            delete data.tempVCs[channelId];
            continue;
        }

        if (channel.type !== ChannelType.GuildVoice) {
            delete data.tempVCs[channelId];
            continue;
        }

        if (channel.members.size === 0) {
            await deleteTempVC(channel);
        }
    }

    saveDatabase();
}

// ============================================================
// FILTER SYSTEM
// ============================================================

function messageContainsFilteredWord(content, words) {
    const lower = content.toLowerCase();

    return words.some(word => {
        const clean = String(word).trim().toLowerCase();

        if (!clean) {
            return false;
        }

        return lower.includes(clean);
    });
}

async function processVCFilter(message) {
    if (!message.guild) {
        return false;
    }

    const data = guildData(message.guild);

    if (!data.filters.enabled) {
        return false;
    }

    if (!isTempVC(message.guild, message.channel.id)) {
        return false;
    }

    if (!data.filters.words.length) {
        return false;
    }

    if (!message.member) {
        return false;
    }

    if (isFounder(message.member)) {
        return false;
    }

    if (
        message.author.bot ||
        message.webhookId
    ) {
        return false;
    }

    if (
        !messageContainsFilteredWord(
            message.content,
            data.filters.words
        )
    ) {
        return false;
    }

    try {
        await message.delete();
    } catch {}

    const userId = message.author.id;

    data.filters.strikes[userId] =
        Number(data.filters.strikes[userId] || 0) + 1;

    const strikes = data.filters.strikes[userId];
    const maxStrikes = Math.max(
        1,
        Number(data.filters.maxStrikes || 3)
    );

    saveDatabase();

    if (strikes >= maxStrikes) {
        const timeoutMinutes = Math.max(
            1,
            Number(data.filters.timeoutMinutes || 10)
        );

        try {
            if (
                message.member.moderatable &&
                hasBotPermission(
                    message.guild,
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                await message.member.timeout(
                    timeoutMinutes * 60 * 1000,
                    "VC+ automatic chat filter"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Filter timeout error:",
                error
            );
        }

        data.filters.strikes[userId] = 0;
        saveDatabase();

        try {
            await message.channel.send(
                plain(
                    "VC Filter",
                    `${message.author} reached the maximum number of filter strikes and was timed out for ${timeoutMinutes} minutes.`
                )
            );
        } catch {}
    } else {
        try {
            await message.channel.send(
                plain(
                    "VC Filter",
                    `${message.author} received a filter strike. Strikes: ${strikes}/${maxStrikes}.`
                )
            );
        } catch {}
    }

    return true;
}

// ============================================================
// MODAL HELPERS
// ============================================================

function userModal(customId, title, label) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("user_id")
                    .setLabel(label)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder("Enter the user ID")
            )
        );
}

function getModalUserId(interaction) {
    return interaction.fields
        .getTextInputValue("user_id")
        .trim()
        .replace(/[<@!>]/g, "");
}

// ============================================================
// BUTTON INTERACTIONS
// ============================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) {
            return;
        }

        const id = interaction.customId;

        if (!id.startsWith("vc_")) {
            return;
        }

        if (!interaction.guild) {
            return safeInteractionReply(
                interaction,
                "Error",
                "This control can only be used in a server."
            );
        }

        if (
            !interaction.channel ||
            interaction.channel.type !== ChannelType.GuildVoice
        ) {
            return safeInteractionReply(
                interaction,
                "Error",
                "This interface is only valid inside a temporary voice channel."
            );
        }

        const channel = interaction.channel;
        const member = interaction.member;

        const record = getTempVC(
            interaction.guild,
            channel.id
        );

        if (!record) {
            return safeInteractionReply(
                interaction,
                "Error",
                "This voice channel is no longer managed by VC+."
            );
        }

        const founderOnlyButtons = [
            "vc_stfu",
            "vc_unstfu",
            "vc_ban",
            "vc_unban"
        ];

        if (
            founderOnlyButtons.includes(id) &&
            !isFounder(member)
        ) {
            return safeInteractionReply(
                interaction,
                "Access Denied",
                "Only the Founder or Server Owner can use this control."
            );
        }

        if (
            !founderOnlyButtons.includes(id) &&
            !canUseNormalVCControl(member, channel)
        ) {
            return safeInteractionReply(
                interaction,
                "Access Denied",
                "You do not own this temporary VC."
            );
        }

        if (id === "vc_lock") {
            record.locked = true;

            await channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    Connect: false
                }
            );

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "VC Locked",
                "This temporary VC is now locked."
            );
        }

        if (id === "vc_unlock") {
            record.locked = false;

            await channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    Connect: null
                }
            );

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "VC Unlocked",
                "This temporary VC is now unlocked."
            );
        }

        if (id === "vc_claim") {
            if (
                record.ownerId !== member.id &&
                record.ownerId !== interaction.guild.ownerId
            ) {
                const oldOwner =
                    interaction.guild.members.cache.get(
                        record.ownerId
                    );

                if (
                    oldOwner &&
                    channel.members.has(oldOwner.id) &&
                    !isFounder(member)
                ) {
                    return safeInteractionReply(
                        interaction,
                        "Claim Failed",
                        "The current owner is still inside this VC."
                    );
                }
            }

            record.ownerId = member.id;

            await channel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    SendMessages: true,
                    MoveMembers: true,
                    MuteMembers: true,
                    DeafenMembers: true
                }
            );

            saveDatabase();

            await refreshVCInterface(channel);

            return safeInteractionReply(
                interaction,
                "VC Claimed",
                "You are now the owner of this temporary VC."
            );
        }

        if (id === "vc_rename") {
            const modal = new ModalBuilder()
                .setCustomId("vc_modal_rename")
                .setTitle("Rename Voice Channel")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("name")
                            .setLabel("New channel name")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMaxLength(100)
                    )
                );

            return interaction.showModal(modal);
        }

        if (id === "vc_limit") {
            const modal = new ModalBuilder()
                .setCustomId("vc_modal_limit")
                .setTitle("Set Voice Limit")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("limit")
                            .setLabel("User limit")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder("0 to 99")
                    )
                );

            return interaction.showModal(modal);
        }

        if (id === "vc_permit") {
            return interaction.showModal(
                userModal(
                    "vc_modal_permit",
                    "Permit User",
                    "User ID"
                )
            );
        }

        if (id === "vc_reject") {
            return interaction.showModal(
                userModal(
                    "vc_modal_reject",
                    "Reject User",
                    "User ID"
                )
            );
        }

        if (id === "vc_kick") {
            return interaction.showModal(
                userModal(
                    "vc_modal_kick",
                    "Kick User",
                    "User ID"
                )
            );
        }

        if (id === "vc_transfer") {
            return interaction.showModal(
                userModal(
                    "vc_modal_transfer",
                    "Transfer Ownership",
                    "User ID"
                )
            );
        }

        if (id === "vc_stfu") {
            return interaction.showModal(
                userModal(
                    "vc_modal_stfu",
                    "STFU",
                    "User ID"
                )
            );
        }

        if (id === "vc_unstfu") {
            return interaction.showModal(
                userModal(
                    "vc_modal_unstfu",
                    "Unstfu",
                    "User ID"
                )
            );
        }

        if (id === "vc_ban") {
            return interaction.showModal(
                userModal(
                    "vc_modal_ban",
                    "VC Ban",
                    "User ID"
                )
            );
        }

        if (id === "vc_unban") {
            return interaction.showModal(
                userModal(
                    "vc_modal_unban",
                    "VC Unban",
                    "User ID"
                )
            );
        }

        if (id === "vc_settings") {
            const users = channel.members.size;
            const limit = channel.userLimit || "No limit";

            return safeInteractionReply(
                interaction,
                "VC Settings",
                `Owner: <@${record.ownerId}>\nLocked: ${record.locked ? "Yes" : "No"}\nUsers: ${users}\nLimit: ${limit}\nVC Bans: ${record.banned.length}\nSTFU List: ${record.stfu.length}`
            );
        }
    } catch (error) {
        console.error("[VC+] Button interaction error:", error);

        return safeInteractionReply(
            interaction,
            "Error",
            "Something went wrong while processing that control."
        );
    }
});

// ============================================================
// MODAL INTERACTIONS
// ============================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isModalSubmit()) {
            return;
        }

        if (!interaction.customId.startsWith("vc_modal_")) {
            return;
        }

        if (!interaction.guild) {
            return;
        }

        const channel = interaction.channel;

        if (
            !channel ||
            channel.type !== ChannelType.GuildVoice
        ) {
            return safeInteractionReply(
                interaction,
                "Error",
                "This modal must be used from a temporary VC."
            );
        }

        const record = getTempVC(
            interaction.guild,
            channel.id
        );

        if (!record) {
            return safeInteractionReply(
                interaction,
                "Error",
                "This VC is no longer managed by VC+."
            );
        }

        const member = interaction.member;

        const founderOnlyModals = [
            "vc_modal_stfu",
            "vc_modal_unstfu",
            "vc_modal_ban",
            "vc_modal_unban"
        ];

        if (
            founderOnlyModals.includes(interaction.customId) &&
            !isFounder(member)
        ) {
            return safeInteractionReply(
                interaction,
                "Access Denied",
                "Only the Founder or Server Owner can use this control."
            );
        }

        if (
            !founderOnlyModals.includes(interaction.customId) &&
            !canUseNormalVCControl(member, channel)
        ) {
            return safeInteractionReply(
                interaction,
                "Access Denied",
                "You do not own this temporary VC."
            );
        }

        // ----------------------------------------------------
        // RENAME
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_rename") {
            const name = interaction.fields
                .getTextInputValue("name")
                .trim();

            if (!name) {
                return safeInteractionReply(
                    interaction,
                    "Error",
                    "A channel name is required."
                );
            }

            await channel.setName(
                name.slice(0, 100),
                "VC owner renamed temporary VC"
            );

            return safeInteractionReply(
                interaction,
                "VC Renamed",
                `The VC was renamed to ${name.slice(0, 100)}.`
            );
        }

        // ----------------------------------------------------
        // LIMIT
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_limit") {
            const value = parsePositiveInteger(
                interaction.fields.getTextInputValue("limit")
            );

            if (
                value === null ||
                value < 0 ||
                value > 99
            ) {
                return safeInteractionReply(
                    interaction,
                    "Error",
                    "The user limit must be a number from 0 to 99."
                );
            }

            await channel.setUserLimit(value);

            return safeInteractionReply(
                interaction,
                "VC Limit",
                `The VC user limit is now ${value === 0 ? "unlimited" : value}.`
            );
        }

        const userId = getModalUserId(interaction);

        let target;

        try {
            target = await interaction.guild.members.fetch(
                userId
            );
        } catch {
            return safeInteractionReply(
                interaction,
                "Error",
                "That user could not be found."
            );
        }

        // ----------------------------------------------------
        // PERMIT
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_permit") {
            record.permitted = [
                ...new Set([
                    ...record.permitted,
                    target.id
                ])
            ];

            record.banned = record.banned.filter(
                id => id !== target.id
            );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    SendMessages: true
                }
            );

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "User Permitted",
                `${target} can now join this VC.`
            );
        }

        // ----------------------------------------------------
        // REJECT
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_reject") {
            record.banned = [
                ...new Set([
                    ...record.banned,
                    target.id
                ])
            ];

            record.permitted = record.permitted.filter(
                id => id !== target.id
            );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: false
                }
            );

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.disconnect(
                        "Rejected from temporary VC"
                    );
                } catch {}
            }

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "User Rejected",
                `${target} can no longer join this VC.`
            );
        }

        // ----------------------------------------------------
        // KICK
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_kick") {
            if (!channel.members.has(target.id)) {
                return safeInteractionReply(
                    interaction,
                    "Error",
                    "That user is not inside this VC."
                );
            }

            try {
                await target.voice.disconnect(
                    "Kicked from temporary VC"
                );
            } catch {
                return safeInteractionReply(
                    interaction,
                    "Error",
                    "I could not disconnect that user."
                );
            }

            return safeInteractionReply(
                interaction,
                "User Kicked",
                `${target} was removed from the VC.`
            );
        }

        // ----------------------------------------------------
        // TRANSFER
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_transfer") {
            if (!channel.members.has(target.id)) {
                return safeInteractionReply(
                    interaction,
                    "Error",
                    "The new owner must be inside the VC."
                );
            }

            record.ownerId = target.id;

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    SendMessages: true,
                    MoveMembers: true,
                    MuteMembers: true,
                    DeafenMembers: true
                }
            );

            saveDatabase();

            await refreshVCInterface(channel);

            return safeInteractionReply(
                interaction,
                "Ownership Transferred",
                `${target} is now the owner of this VC.`
            );
        }

        // ----------------------------------------------------
        // STFU
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_stfu") {
            record.stfu = [
                ...new Set([
                    ...record.stfu,
                    target.id
                ])
            ];

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.setMute(
                        true,
                        "VC+ STFU"
                    );
                } catch {}
            }

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "STFU Applied",
                `${target} has been server muted in this VC.`
            );
        }

        // ----------------------------------------------------
        // UNSTFU
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_unstfu") {
            record.stfu = record.stfu.filter(
                id => id !== target.id
            );

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.setMute(
                        false,
                        "VC+ Unstfu"
                    );
                } catch {}
            }

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "STFU Removed",
                `${target} is no longer on the VC STFU list.`
            );
        }

        // ----------------------------------------------------
        // VC BAN
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_ban") {
            record.banned = [
                ...new Set([
                    ...record.banned,
                    target.id
                ])
            ];

            record.permitted = record.permitted.filter(
                id => id !== target.id
            );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: false,
                    Connect: false
                }
            );

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.disconnect(
                        "VC+ VC ban"
                    );
                } catch {}
            }

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "VC Ban",
                `${target} is banned from this VC.`
            );
        }

        // ----------------------------------------------------
        // VC UNBAN
        // ----------------------------------------------------

        if (interaction.customId === "vc_modal_unban") {
            record.banned = record.banned.filter(
                id => id !== target.id
            );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: null,
                    Connect: null,
                    Speak: null
                }
            );

            saveDatabase();

            return safeInteractionReply(
                interaction,
                "VC Unban",
                `${target} is no longer banned from this VC.`
            );
        }
    } catch (error) {
        console.error("[VC+] Modal interaction error:", error);

        return safeInteractionReply(
            interaction,
            "Error",
            "Something went wrong while processing that request."
        );
    }
});

// ============================================================
// VC COMMAND HANDLER
// ============================================================

async function handleVCCommand(message, args) {
    const guild = message.guild;
    const member = message.member;
    const data = guildData(guild);

    const sub = (args.shift() || "help").toLowerCase();

    // ========================================================
    // HELP
    // ========================================================

    if (sub === "help") {
        return message.reply(
            plain(
                "VC Commands",
                [
                    "-vc help",
                    "-vc info",
                    "-vc lock",
                    "-vc unlock",
                    "-vc claim",
                    "-vc rename <name>",
                    "-vc limit <number>",
                    "-vc permit @user",
                    "-vc reject @user",
                    "-vc kick @user",
                    "-vc transfer @user",
                    "",
                    "Founder only:",
                    "-vc setup",
                    "-vc setup #category",
                    "-vc setup filter",
                    "-vc setup filter on",
                    "-vc setup filter off",
                    "-vc setup filter add <word>",
                    "-vc setup filter remove <word>",
                    "-vc setup filter list",
                    "-vc setup filter strikes <number>",
                    "-vc setup filter timeout <minutes>",
                    "-vc channel #channel",
                    "-vc category #category",
                    "-vc reset",
                    "-vc list",
                    "-vc delete",
                    "-vc stfu @user",
                    "-vc unstfu @user",
                    "-vc ban @user",
                    "-vc unban @user"
                ].join("\n")
            )
        );
    }

    // ========================================================
    // INFO
    // ========================================================

    if (sub === "info") {
        const channel =
            message.member.voice.channel;

        if (!channel || !isTempVC(guild, channel.id)) {
            return replyError(
                message,
                "You must be inside a VC created by VC+."
            );
        }

        const record = getTempVC(
            guild,
            channel.id
        );

        return message.reply(
            plain(
                "VC Info",
                `Owner: <@${record.ownerId}>\nLocked: ${record.locked ? "Yes" : "No"}\nUsers: ${channel.members.size}\nLimit: ${channel.userLimit || "Unlimited"}\nVC Bans: ${record.banned.length}\nSTFU List: ${record.stfu.length}`
            )
        );
    }

    // ========================================================
    // NORMAL VC OWNER COMMANDS
    // ========================================================

    const normalVCCommands = [
        "lock",
        "unlock",
        "claim",
        "rename",
        "limit",
        "permit",
        "reject",
        "kick",
        "transfer"
    ];

    if (normalVCCommands.includes(sub)) {
        const channel =
            member.voice.channel;

        if (
            !channel ||
            channel.type !== ChannelType.GuildVoice ||
            !isTempVC(guild, channel.id)
        ) {
            return replyError(
                message,
                "You must be inside a temporary VC created by VC+."
            );
        }

        const record = getTempVC(
            guild,
            channel.id
        );

        if (
            record.ownerId !== member.id &&
            !isFounder(member)
        ) {
            return replyError(
                message,
                "You do not own this temporary VC."
            );
        }

        if (sub === "lock") {
            record.locked = true;

            await channel.permissionOverwrites.edit(
                guild.roles.everyone,
                {
                    Connect: false
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC Locked",
                    "This VC is now locked."
                )
            );
        }

        if (sub === "unlock") {
            record.locked = false;

            await channel.permissionOverwrites.edit(
                guild.roles.everyone,
                {
                    Connect: null
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC Unlocked",
                    "This VC is now unlocked."
                )
            );
        }

        if (sub === "claim") {
            const currentOwner =
                guild.members.cache.get(
                    record.ownerId
                );

            if (
                currentOwner &&
                channel.members.has(currentOwner.id) &&
                !isFounder(member) &&
                currentOwner.id !== member.id
            ) {
                return replyError(
                    message,
                    "The current owner is still inside the VC."
                );
            }

            record.ownerId = member.id;

            await channel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    SendMessages: true,
                    MoveMembers: true,
                    MuteMembers: true,
                    DeafenMembers: true
                }
            );

            saveDatabase();

            await refreshVCInterface(channel);

            return message.reply(
                plain(
                    "VC Claimed",
                    "You are now the owner of this VC."
                )
            );
        }

        if (sub === "rename") {
            const name = args.join(" ").trim();

            if (!name) {
                return replyError(
                    message,
                    "Usage: -vc rename <name>"
                );
            }

            await channel.setName(
                name.slice(0, 100),
                "VC owner renamed temporary VC"
            );

            return message.reply(
                plain(
                    "VC Renamed",
                    `The VC was renamed to ${name.slice(0, 100)}.`
                )
            );
        }

        if (sub === "limit") {
            const value = parsePositiveInteger(
                args[0]
            );

            if (
                value === null ||
                value < 0 ||
                value > 99
            ) {
                return replyError(
                    message,
                    "Usage: -vc limit <number>\nThe limit must be between 0 and 99."
                );
            }

            await channel.setUserLimit(value);

            return message.reply(
                plain(
                    "VC Limit",
                    `The VC limit is now ${value === 0 ? "unlimited" : value}.`
                )
            );
        }

        if (
            sub === "permit" ||
            sub === "reject" ||
            sub === "kick" ||
            sub === "transfer"
        ) {
            const target =
                getMentionedMember(message);

            if (!target) {
                return replyError(
                    message,
                    `Usage: -vc ${sub} @user`
                );
            }

            if (sub === "permit") {
                record.permitted = [
                    ...new Set([
                        ...record.permitted,
                        target.id
                    ])
                ];

                record.banned =
                    record.banned.filter(
                        id => id !== target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel: true,
                        Connect: true,
                        Speak: true,
                        SendMessages: true
                    }
                );

                saveDatabase();

                return message.reply(
                    plain(
                        "User Permitted",
                        `${target} can now join this VC.`
                    )
                );
            }

            if (sub === "reject") {
                record.banned = [
                    ...new Set([
                        ...record.banned,
                        target.id
                    ])
                ];

                record.permitted =
                    record.permitted.filter(
                        id => id !== target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false
                    }
                );

                if (channel.members.has(target.id)) {
                    try {
                        await target.voice.disconnect(
                            "Rejected from temporary VC"
                        );
                    } catch {}
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "User Rejected",
                        `${target} can no longer join this VC.`
                    )
                );
            }

            if (sub === "kick") {
                if (!channel.members.has(target.id)) {
                    return replyError(
                        message,
                        "That user is not inside your VC."
                    );
                }

                try {
                    await target.voice.disconnect(
                        "Kicked from temporary VC"
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not disconnect that user."
                    );
                }

                return message.reply(
                    plain(
                        "User Kicked",
                        `${target} was removed from the VC.`
                    )
                );
            }

            if (sub === "transfer") {
                if (!channel.members.has(target.id)) {
                    return replyError(
                        message,
                        "The new owner must be inside the VC."
                    );
                }

                record.ownerId = target.id;

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel: true,
                        Connect: true,
                        Speak: true,
                        SendMessages: true,
                        MoveMembers: true,
                        MuteMembers: true,
                        DeafenMembers: true
                    }
                );

                saveDatabase();

                await refreshVCInterface(channel);

                return message.reply(
                    plain(
                        "Ownership Transferred",
                        `${target} is now the owner of this VC.`
                    )
                );
            }
        }
    }

    // ========================================================
    // FOUNDER ONLY
    // ========================================================

    if (!isFounderOnly(member)) {
        return replyError(
            message,
            "This VC command is restricted to the Founder or Server Owner."
        );
    }

    // ========================================================
    // SETUP
    // ========================================================

    if (sub === "setup") {
        const next = (args.shift() || "").toLowerCase();

        // ----------------------------------------------------
        // FILTER
        // ----------------------------------------------------

        if (next === "filter") {
            const filterAction =
                (args.shift() || "").toLowerCase();

            if (!filterAction) {
                return message.reply(
                    plain(
                        "VC Filter",
                        [
                            "-vc setup filter on",
                            "-vc setup filter off",
                            "-vc setup filter add <word>",
                            "-vc setup filter remove <word>",
                            "-vc setup filter list",
                            "-vc setup filter strikes <number>",
                            "-vc setup filter timeout <minutes>"
                        ].join("\n")
                    )
                );
            }

            if (filterAction === "on") {
                data.filters.enabled = true;
                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        "The VC text filter is now enabled."
                    )
                );
            }

            if (filterAction === "off") {
                data.filters.enabled = false;
                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        "The VC text filter is now disabled."
                    )
                );
            }

            if (filterAction === "add") {
                const word = args.join(" ")
                    .trim()
                    .toLowerCase();

                if (!word) {
                    return replyError(
                        message,
                        "Usage: -vc setup filter add <word>"
                    );
                }

                if (data.filters.words.includes(word)) {
                    return replyError(
                        message,
                        "That word is already in the filter."
                    );
                }

                data.filters.words.push(word);
                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        `Added ${word} to the filter.`
                    )
                );
            }

            if (filterAction === "remove") {
                const word = args.join(" ")
                    .trim()
                    .toLowerCase();

                if (!word) {
                    return replyError(
                        message,
                        "Usage: -vc setup filter remove <word>"
                    );
                }

                data.filters.words =
                    data.filters.words.filter(
                        item => item !== word
                    );

                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        `Removed ${word} from the filter.`
                    )
                );
            }

            if (filterAction === "list") {
                return message.reply(
                    plain(
                        "VC Filter",
                        `Enabled: ${data.filters.enabled ? "Yes" : "No"}\nWords: ${data.filters.words.length ? data.filters.words.join(", ") : "None"}\nMax strikes: ${data.filters.maxStrikes}\nTimeout: ${data.filters.timeoutMinutes} minutes`
                    )
                );
            }

            if (filterAction === "strikes") {
                const number =
                    parsePositiveInteger(args[0]);

                if (
                    number === null ||
                    number < 1 ||
                    number > 20
                ) {
                    return replyError(
                        message,
                        "The maximum strikes must be between 1 and 20."
                    );
                }

                data.filters.maxStrikes = number;
                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        `The maximum strikes is now ${number}.`
                    )
                );
            }

            if (filterAction === "timeout") {
                const minutes =
                    parsePositiveInteger(args[0]);

                if (
                    minutes === null ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "The timeout must be between 1 and 40320 minutes."
                    );
                }

                data.filters.timeoutMinutes =
                    minutes;

                saveDatabase();

                return message.reply(
                    plain(
                        "VC Filter",
                        `The filter timeout is now ${minutes} minutes.`
                    )
                );
            }

            return replyError(
                message,
                "Unknown filter command."
            );
        }

        // ----------------------------------------------------
        // SETUP CATEGORY
        // ----------------------------------------------------

        let category =
            message.mentions.channels.find(
                channel =>
                    channel.type ===
                    ChannelType.GuildCategory
            );

        if (!category) {
            category =
                guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildCategory &&
                        channel.name.toLowerCase() ===
                            "voice"
                );
        }

        if (!category) {
            category = await guild.channels.create({
                name: "VOICE",
                type: ChannelType.GuildCategory
            });
        }

        let trigger =
            data.jtc.channelId
                ? guild.channels.cache.get(
                    data.jtc.channelId
                )
                : null;

        if (
            !trigger ||
            trigger.type !== ChannelType.GuildVoice
        ) {
            trigger =
                guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildVoice &&
                        channel.name.toLowerCase() ===
                            "vc-user"
                );
        }

        if (!trigger) {
            trigger = await guild.channels.create({
                name: "VC-USER",
                type: ChannelType.GuildVoice,
                parent: category.id
            });
        } else if (trigger.parentId !== category.id) {
            try {
                await trigger.setParent(
                    category.id
                );
            } catch {
                return replyError(
                    message,
                    "I found VC-USER, but I could not move it into the selected category."
                );
            }
        }

        data.jtc.channelId = trigger.id;
        data.jtc.categoryId = category.id;

        saveDatabase();

        return message.reply(
            plain(
                "Join To Create",
                `VC-USER is configured.\nCategory: ${category.name}\nTrigger: ${trigger.name}`
            )
        );
    }

    // ========================================================
    // CHANNEL
    // ========================================================

    if (sub === "channel") {
        const channel =
            message.mentions.channels.first();

        if (
            !channel ||
            channel.type !== ChannelType.GuildVoice
        ) {
            return replyError(
                message,
                "Usage: -vc channel #voice-channel"
            );
        }

        data.jtc.channelId = channel.id;
        data.jtc.categoryId =
            channel.parentId || null;

        saveDatabase();

        return message.reply(
            plain(
                "Join To Create",
                `${channel} is now the VC-USER trigger channel.`
            )
        );
    }

    // ========================================================
    // CATEGORY
    // ========================================================

    if (sub === "category") {
        const category =
            message.mentions.channels.find(
                channel =>
                    channel.type ===
                    ChannelType.GuildCategory
            );

        if (!category) {
            return replyError(
                message,
                "Usage: -vc category #category"
            );
        }

        data.jtc.categoryId =
            category.id;

        saveDatabase();

        return message.reply(
            plain(
                "VC Category",
                `Temporary VCs will now be created in ${category}.`
            )
        );
    }

    // ========================================================
    // RESET
    // ========================================================

    if (sub === "reset") {
        for (const channelId of Object.keys(data.tempVCs)) {
            const channel =
                guild.channels.cache.get(channelId);

            if (channel) {
                try {
                    await channel.delete(
                        "VC+ configuration reset"
                    );
                } catch {}
            }

            delete data.tempVCs[channelId];
        }

        data.jtc.channelId = null;
        data.jtc.categoryId = null;

        saveDatabase();

        return message.reply(
            plain(
                "VC Reset",
                "All temporary VCs were removed and the Join To Create configuration was reset."
            )
        );
    }

    // ========================================================
    // LIST
    // ========================================================

    if (sub === "list") {
        const entries =
            Object.entries(data.tempVCs);

        if (!entries.length) {
            return message.reply(
                plain(
                    "VC List",
                    "There are no active temporary VCs."
                )
            );
        }

        const lines = [];

        for (const [channelId, record] of entries) {
            const channel =
                guild.channels.cache.get(
                    channelId
                );

            if (!channel) {
                continue;
            }

            lines.push(
                `${channel} — Owner: <@${record.ownerId}>`
            );
        }

        return message.reply(
            plain(
                "VC List",
                lines.length
                    ? lines.join("\n")
                    : "There are no active temporary VCs."
            )
        );
    }

    // ========================================================
    // DELETE
    // ========================================================

    if (sub === "delete") {
        let deleted = 0;

        for (const channelId of Object.keys(data.tempVCs)) {
            const channel =
                guild.channels.cache.get(channelId);

            if (!channel) {
                delete data.tempVCs[channelId];
                continue;
            }

            if (channel.members.size > 0) {
                continue;
            }

            try {
                await channel.delete(
                    "VC+ Founder cleanup"
                );

                delete data.tempVCs[channelId];
                deleted++;
            } catch {}
        }

        saveDatabase();

        return message.reply(
            plain(
                "VC Delete",
                `Deleted ${deleted} empty temporary VC${deleted === 1 ? "" : "s"}.`
            )
        );
    }

    // ========================================================
    // FOUNDER STFU / BAN
    // ========================================================

    if (
        sub === "stfu" ||
        sub === "unstfu" ||
        sub === "ban" ||
        sub === "unban"
    ) {
        const target =
            getMentionedMember(message);

        if (!target) {
            return replyError(
                message,
                `Usage: -vc ${sub} @user`
            );
        }

        const channel =
            member.voice.channel;

        if (
            !channel ||
            !isTempVC(guild, channel.id)
        ) {
            return replyError(
                message,
                "You must be inside a temporary VC to use this command."
            );
        }

        const record =
            getTempVC(guild, channel.id);

        if (sub === "stfu") {
            record.stfu = [
                ...new Set([
                    ...record.stfu,
                    target.id
                ])
            ];

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.setMute(
                        true,
                        "VC+ Founder STFU"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "STFU",
                    `${target} has been added to the VC STFU list.`
                )
            );
        }

        if (sub === "unstfu") {
            record.stfu =
                record.stfu.filter(
                    id => id !== target.id
                );

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.setMute(
                        false,
                        "VC+ Founder Unstfu"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "Unstfu",
                    `${target} has been removed from the VC STFU list.`
                )
            );
        }

        if (sub === "ban") {
            record.banned = [
                ...new Set([
                    ...record.banned,
                    target.id
                ])
            ];

            record.permitted =
                record.permitted.filter(
                    id => id !== target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: false,
                    Connect: false
                }
            );

            if (channel.members.has(target.id)) {
                try {
                    await target.voice.disconnect(
                        "VC+ Founder VC ban"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "VC Ban",
                    `${target} is now banned from this VC.`
                )
            );
        }

        if (sub === "unban") {
            record.banned =
                record.banned.filter(
                    id => id !== target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel: null,
                    Connect: null,
                    Speak: null
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC Unban",
                    `${target} is no longer banned from this VC.`
                )
            );
        }
    }

    return replyError(
        message,
        "Unknown VC command. Use -vc help."
    );
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on("messageCreate", async message => {
    try {
        if (
            message.author.bot ||
            !message.guild ||
            !message.content.startsWith(PREFIX)
        ) {
            return;
        }

        // VC FILTER RUNS BEFORE COMMAND PROCESSING
        if (await processVCFilter(message)) {
            return;
        }

        const raw =
            message.content.slice(
                PREFIX.length
            ).trim();

        if (!raw) {
            return;
        }

        const parts =
            raw.split(/\s+/);

        const command =
            parts.shift().toLowerCase();

        const args = parts;

        // ====================================================
        // HELP
        // ====================================================

        if (command === "help") {
            return message.reply(
                plain(
                    "Commands",
                    [
                        "-help",
                        "",
                        "VC:",
                        "-vc help",
                        "-vc info",
                        "-vc lock",
                        "-vc unlock",
                        "-vc claim",
                        "-vc rename <name>",
                        "-vc limit <number>",
                        "-vc permit @user",
                        "-vc reject @user",
                        "-vc kick @user",
                        "-vc transfer @user",
                        "",
                        "Founder only VC:",
                        "-vc setup",
                        "-vc setup #category",
                        "-vc setup filter",
                        "-vc channel #channel",
                        "-vc category #category",
                        "-vc reset",
                        "-vc list",
                        "-vc delete",
                        "-vc stfu @user",
                        "-vc unstfu @user",
                        "-vc ban @user",
                        "-vc unban @user",
                        "",
                        "Ranks:",
                        "-rank @user",
                        "-rank @user <rank>",
                        "",
                        "Security:",
                        "-godmode @user",
                        "-godmode @user off",
                        "",
                        "Vouch:",
                        "-vouch @user",
                        "-vouch give @user",
                        "-vouch take @user",
                        "-vouch limit",
                        "-vouch limit <number>",
                        "-vouch role",
                        "-vouch role set @role",
                        "-vouch clear",
                        "",
                        "Moderation:",
                        "-kick @user [reason]",
                        "-ban @user [reason]",
                        "-unban @user",
                        "-unbanall",
                        "-foreverban @user",
                        "-timeout @user <minutes> [reason]",
                        "-untimeout @user",
                        "-purge <amount>"
                    ].join("\n")
                )
            );
        }

        // ====================================================
        // VC
        // ====================================================

        if (command === "vc") {
            return handleVCCommand(
                message,
                args
            );
        }

        const member =
            message.member;

        // ====================================================
        // RANK
        // ====================================================

        if (command === "rank") {
            if (
                !isFounder(member)
            ) {
                return replyError(
                    message,
                    "Only the Founder or Server Owner can change ranks."
                );
            }

            const target =
                getMentionedMember(message);

            const rank =
                normalizeRank(
                    args.find(
                        arg =>
                            !arg.startsWith("<@")
                    )
                );

            if (!target) {
                return replyError(
                    message,
                    "Usage: -rank @user <rank>"
                );
            }

            if (!rank) {
                return message.reply(
                    plain(
                        "Rank",
                        `Current rank for ${target}: ${getRankName(target, message.guild)}`
                    )
                );
            }

            if (
                rank === "founder" &&
                !isServerOwner(
                    member,
                    message.guild
                )
            ) {
                return replyError(
                    message,
                    "Only the actual Server Owner can assign Founder."
                );
            }

            if (
                target.id === message.guild.ownerId
            ) {
                return replyError(
                    message,
                    "The Server Owner cannot have their rank changed."
                );
            }

            const data =
                guildData(message.guild);

            data.ranks[target.id] =
                rank;

            if (rank !== "god") {
                if (rank !== "founder") {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !== target.id
                        );
                }
            }

            saveDatabase();

            return message.reply(
                plain(
                    "Rank Updated",
                    `${target} is now ${rank}.`
                )
            );
        }

        // ====================================================
        // GODMODE
        // ====================================================

        if (command === "godmode") {
            if (!isFounder(member)) {
                return replyError(
                    message,
                    "Only the Founder or Server Owner can manage Godmode."
                );
            }

            const target =
                getMentionedMember(message);

            if (!target) {
                return replyError(
                    message,
                    "Usage: -godmode @user or -godmode @user off"
                );
            }

            const data =
                guildData(message.guild);

            const off =
                args.some(
                    arg =>
                        arg.toLowerCase() ===
                        "off"
                );

            if (off) {
                data.godmode =
                    data.godmode.filter(
                        id =>
                            id !== target.id
                    );

                saveDatabase();

                return message.reply(
                    plain(
                        "Godmode",
                        `Godmode was removed from ${target}.`
                    )
                );
            }

            if (
                !data.godmode.includes(
                    target.id
                )
            ) {
                data.godmode.push(
                    target.id
                );
            }

            saveDatabase();

            return message.reply(
                plain(
                    "Godmode",
                    `${target} now has Godmode.`
                )
            );
        }

        // ====================================================
        // VOUCH
        // ====================================================

        if (command === "vouch") {
            const data =
                guildData(message.guild);

            const sub =
                (args.shift() || "").toLowerCase();

            // -----------------------------------------------
            // VOUCH LOOKUP
            // -----------------------------------------------

            if (!sub) {
                return message.reply(
                    plain(
                        "Vouch",
                        [
                            "-vouch @user",
                            "-vouch give @user",
                            "-vouch take @user",
                            "-vouch limit",
                            "-vouch limit <number>",
                            "-vouch role",
                            "-vouch role set @role",
                            "-vouch clear"
                        ].join("\n")
                    )
                );
            }

            if (
                sub.startsWith("<@")
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "That user could not be found."
                    );
                }

                return message.reply(
                    plain(
                        "Vouch",
                        `${target} has ${getVouchCount(message.guild, target.id)} vouch${getVouchCount(message.guild, target.id) === 1 ? "" : "es"}.`
                    )
                );
            }

            // -----------------------------------------------
            // GIVE
            // -----------------------------------------------

            if (sub === "give") {
                if (!isGod(member)) {
                    return replyError(
                        message,
                        "Only Founder or God can give vouches."
                    );
                }

                const target =
                    getMentionedMember(message);

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -vouch give @user"
                    );
                }

                data.vouches[target.id] =
                    getVouchCount(
                        message.guild,
                        target.id
                    ) + 1;

                data.vouchRevoked[target.id] =
                    false;

                saveDatabase();

                await syncVouchRole(
                    message.guild,
                    target
                );

                return message.reply(
                    plain(
                        "Vouch",
                        `${target} now has ${data.vouches[target.id]} vouch${data.vouches[target.id] === 1 ? "" : "es"}.`
                    )
                );
            }

            // -----------------------------------------------
            // TAKE
            // -----------------------------------------------

            if (sub === "take") {
                if (!isGod(member)) {
                    return replyError(
                        message,
                        "Only Founder or God can take vouches."
                    );
                }

                const target =
                    getMentionedMember(message);

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -vouch take @user"
                    );
                }

                const current =
                    getVouchCount(
                        message.guild,
                        target.id
                    );

                data.vouches[target.id] =
                    Math.max(
                        0,
                        current - 1
                    );

                data.vouchRevoked[target.id] =
                    true;

                saveDatabase();

                await syncVouchRole(
                    message.guild,
                    target
                );

                return message.reply(
                    plain(
                        "Vouch",
                        `${target} now has ${data.vouches[target.id]} vouch${data.vouches[target.id] === 1 ? "" : "es"}.`
                    )
                );
            }

            // -----------------------------------------------
            // LIMIT
            // -----------------------------------------------

            if (sub === "limit") {
                if (
                    !isFounder(member)
                ) {
                    return replyError(
                        message,
                        "Only the Founder or Server Owner can change the vouch limit."
                    );
                }

                const value =
                    parsePositiveInteger(
                        args[0]
                    );

                if (
                    value === null
                ) {
                    return message.reply(
                        plain(
                            "Vouch Limit",
                            `The current vouch limit is ${data.vouchLimit}.`
                        )
                    );
                }

                if (
                    value < 1 ||
                    value > 1000
                ) {
                    return replyError(
                        message,
                        "The vouch limit must be between 1 and 1000."
                    );
                }

                data.vouchLimit =
                    value;

                saveDatabase();

                await syncAllVouchRoles(
                    message.guild
                );

                return message.reply(
                    plain(
                        "Vouch Limit",
                        `The vouch limit is now ${value}.`
                    )
                );
            }

            // -----------------------------------------------
            // ROLE
            // -----------------------------------------------

            if (sub === "role") {
                if (
                    !isFounder(member)
                ) {
                    return replyError(
                        message,
                        "Only the Founder or Server Owner can manage the vouch role."
                    );
                }

                const action =
                    (args.shift() || "").toLowerCase();

                if (action !== "set") {
                    const role =
                        data.roles.vouch
                            ? message.guild.roles.cache.get(
                                data.roles.vouch
                            )
                            : null;

                    return message.reply(
                        plain(
                            "Vouch Role",
                            role
                                ? `Current vouch role: ${role}`
                                : "No vouch role is configured."
                        )
                    );
                }

                const role =
                    getMentionedRole(message);

                if (!role) {
                    return replyError(
                        message,
                        "Usage: -vouch role set @role"
                    );
                }

                if (
                    !canBotManageRole(
                        message.guild,
                        role
                    )
                ) {
                    return replyError(
                        message,
                        "I cannot manage that role. Make sure my highest role is above it and I have Manage Roles."
                    );
                }

                data.roles.vouch =
                    role.id;

                saveDatabase();

                await syncAllVouchRoles(
                    message.guild
                );

                return message.reply(
                    plain(
                        "Vouch Role",
                        `${role} is now the vouch role.`
                    )
                );
            }

            // -----------------------------------------------
            // CLEAR
            // -----------------------------------------------

            if (sub === "clear") {
                if (
                    !isServerOwner(
                        member,
                        message.guild
                    )
                ) {
                    return replyError(
                        message,
                        "Only the actual Server Owner can clear all vouches."
                    );
                }

                data.vouches = {};
                data.vouchRevoked = {};

                saveDatabase();

                await syncAllVouchRoles(
                    message.guild
                );

                return message.reply(
                    plain(
                        "Vouch",
                        "All vouches have been cleared."
                    )
                );
            }

            return replyError(
                message,
                "Unknown vouch command."
            );
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === "kick") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return replyError(
                    message,
                    "Usage: -kick @user [reason]"
                );
            }

            if (
                !canManageTarget(
                    member,
                    target
                )
            ) {
                return replyError(
                    message,
                    "You cannot kick this user because of the rank hierarchy."
                );
            }

            if (!target.kickable) {
                return replyError(
                    message,
                    "I cannot kick that user. Check my role hierarchy and permissions."
                );
            }

            const reason =
                cleanReason(args);

            await target.kick(
                `VC+: ${reason}`
            );

            return message.reply(
                plain(
                    "Kick",
                    `${target.user.tag} was kicked.\nReason: ${reason}`
                )
            );
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === "ban") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return replyError(
                    message,
                    "Usage: -ban @user [reason]"
                );
            }

            if (
                !canManageTarget(
                    member,
                    target
                )
            ) {
                return replyError(
                    message,
                    "You cannot ban this user because of the rank hierarchy."
                );
            }

            if (!target.bannable) {
                return replyError(
                    message,
                    "I cannot ban that user. Check my role hierarchy and permissions."
                );
            }

            const reason =
                cleanReason(args);

            await target.ban({
                reason: `VC+: ${reason}`
            });

            return message.reply(
                plain(
                    "Ban",
                    `${target.user.tag} was banned.\nReason: ${reason}`
                )
            );
        }

        // ====================================================
        // UNBAN
        // ====================================================

        if (command === "unban") {
            if (
                !isGod(member)
            ) {
                return replyError(
                    message,
                    "You do not have permission to unban users."
                );
            }

            const userId =
                args[0]?.replace(
                    /[^0-9]/g,
                    ""
                );

            if (!userId) {
                return replyError(
                    message,
                    "Usage: -unban <user ID>"
                );
            }

            try {
                const ban =
                    await message.guild.bans.fetch(
                        userId
                    );

                await message.guild.members.unban(
                    userId,
                    `VC+: unbanned by ${message.author.tag}`
                );

                return message.reply(
                    plain(
                        "Unban",
                        `${ban.user.tag} was unbanned.`
                    )
                );
            } catch {
                return replyError(
                    message,
                    "That user is not currently banned or could not be unbanned."
                );
            }
        }

        // ====================================================
        // UNBAN ALL
        // FOUNDER + SERVER OWNER ONLY
        // ====================================================

        if (command === "unbanall") {
            if (
                !isFounder(member)
            ) {
                return replyError(
                    message,
                    "Only the Founder or Server Owner can use -unbanall."
                );
            }

            let bans;

            try {
                bans =
                    await message.guild.bans.fetch();
            } catch {
                return replyError(
                    message,
                    "I could not retrieve the server ban list."
                );
            }

            if (!bans.size) {
                return message.reply(
                    plain(
                        "Unban All",
                        "There are no banned users."
                    )
                );
            }

            let count = 0;

            for (const ban of bans.values()) {
                try {
                    await message.guild.members.unban(
                        ban.user.id,
                        `VC+: unbanall by ${message.author.tag}`
                    );

                    count++;
                } catch (error) {
                    console.error(
                        "[VC+] Unbanall error:",
                        error
                    );
                }
            }

            return message.reply(
                plain(
                    "Unban All",
                    `Unbanned ${count} user${count === 1 ? "" : "s"}.`
                )
            );
        }

        // ====================================================
        // FOREVER BAN
        // FOUNDER + SERVER OWNER ONLY
        // ====================================================

        if (command === "foreverban") {
            if (
                !isFounder(member)
            ) {
                return replyError(
                    message,
                    "Only the Founder or Server Owner can use -foreverban."
                );
            }

            const target =
                getMentionedMember(message);

            const userId =
                target?.id ||
                args[0]?.replace(
                    /[^0-9]/g,
                    ""
                );

            if (!userId) {
                return replyError(
                    message,
                    "Usage: -foreverban @user"
                );
            }

            data.foreverBanned = [
                ...new Set([
                    ...data.foreverBanned,
                    userId
                ])
            ];

            saveDatabase();

            try {
                await message.guild.members.ban(
                    userId,
                    {
                        reason: `VC+: permanent Founder ban by ${message.author.tag}`
                    }
                );
            } catch {}

            return message.reply(
                plain(
                    "Forever Ban",
                    `<@${userId}> has been permanently banned from this server.`
                )
            );
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === "timeout") {
            const target =
                getMentionedMember(message);

            const minutes =
                parsePositiveInteger(
                    args[0]
                );

            if (!target || minutes === null) {
                return replyError(
                    message,
                    "Usage: -timeout @user <minutes> [reason]"
                );
            }

            if (
                minutes < 1 ||
                minutes > 40320
            ) {
                return replyError(
                    message,
                    "Timeout must be between 1 and 40320 minutes."
                );
            }

            if (
                !canManageTarget(
                    member,
                    target
                )
            ) {
                return replyError(
                    message,
                    "You cannot timeout this user because of the rank hierarchy."
                );
            }

            if (!target.moderatable) {
                return replyError(
                    message,
                    "I cannot timeout that user."
                );
            }

            const reason =
                cleanReason(
                    args.slice(1)
                );

            await target.timeout(
                minutes * 60 * 1000,
                `VC+: ${reason}`
            );

            return message.reply(
                plain(
                    "Timeout",
                    `${target.user.tag} was timed out for ${minutes} minute${minutes === 1 ? "" : "s"}.\nReason: ${reason}`
                )
            );
        }

        // ====================================================
        // UNTIMEOUT
        // ====================================================

        if (command === "untimeout") {
            const target =
                getMentionedMember(message);

            if (!target) {
                return replyError(
                    message,
                    "Usage: -untimeout @user"
                );
            }

            if (
                !canManageTarget(
                    member,
                    target
                )
            ) {
                return replyError(
                    message,
                    "You cannot remove this user's timeout because of the rank hierarchy."
                );
            }

            if (!target.moderatable) {
                return replyError(
                    message,
                    "I cannot modify that user's timeout."
                );
            }

            await target.timeout(
                null,
                `VC+: timeout removed by ${message.author.tag}`
            );

            return message.reply(
                plain(
                    "Timeout Removed",
                    `${target.user.tag} is no longer timed out.`
                )
            );
        }

        // ====================================================
        // PURGE
        // ====================================================

        if (command === "purge") {
            const amount =
                parsePositiveInteger(
                    args[0]
                );

            if (
                amount === null ||
                amount < 1 ||
                amount > 100
            ) {
                return replyError(
                    message,
                    "Usage: -purge <1-100>"
                );
            }

            const canPurge =
                isGod(member) ||
                getRankLevel(
                    member,
                    message.guild
                ) >=
                RANK_LEVELS.moderator;

            if (!canPurge) {
                return replyError(
                    message,
                    "You do not have permission to purge messages."
                );
            }

            if (
                !hasBotPermission(
                    message.guild,
                    PermissionFlagsBits.ManageMessages
                )
            ) {
                return replyError(
                    message,
                    "I need Manage Messages to purge messages."
                );
            }

            const deleted =
                await message.channel.bulkDelete(
                    amount + 1,
                    true
                );

            return message.channel.send(
                plain(
                    "Purge",
                    `Deleted ${Math.max(0, deleted.size - 1)} message${deleted.size - 1 === 1 ? "" : "s"}.`
                )
            );
        }
    } catch (error) {
        console.error(
            "[VC+] messageCreate error:",
            error
        );

        return replyError(
            message,
            "An unexpected error occurred while processing that command."
        );
    }
});

// ============================================================
// JOIN TO CREATE
// ============================================================

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        const guild =
            newState.guild || oldState.guild;

        const data =
            guildData(guild);

        // ----------------------------------------------------
        // USER JOINED VC-USER
        // ----------------------------------------------------

        if (
            newState.channelId &&
            data.jtc.channelId &&
            newState.channelId ===
                data.jtc.channelId
        ) {
            const member =
                newState.member;

            if (!member) {
                return;
            }

            const tempVC =
                await createTempVC(member);

            if (tempVC) {
                try {
                    await member.voice.setChannel(
                        tempVC
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Failed moving member to temp VC:",
                        error
                    );

                    try {
                        await tempVC.delete(
                            "VC+ failed to move creator"
                        );
                    } catch {}

                    delete data.tempVCs[
                        tempVC.id
                    ];

                    saveDatabase();
                }
            }
        }

        // ----------------------------------------------------
        // USER ENTERED TEMP VC
        // ----------------------------------------------------

        if (
            newState.channelId &&
            isTempVC(
                guild,
                newState.channelId
            )
        ) {
            const channel =
                newState.channel;

            const record =
                getTempVC(
                    guild,
                    newState.channelId
                );

            if (!record) {
                return;
            }

            const member =
                newState.member;

            if (
                record.banned.includes(
                    member.id
                )
            ) {
                try {
                    await member.voice.disconnect(
                        "VC+ temporary VC ban"
                    );
                } catch {}

                return;
            }

            if (
                record.stfu.includes(
                    member.id
                )
            ) {
                try {
                    await member.voice.setMute(
                        true,
                        "VC+ STFU list"
                    );
                } catch {}
            }

            if (
                record.locked &&
                member.id !== record.ownerId &&
                !record.permitted.includes(
                    member.id
                ) &&
                !isFounder(member)
            ) {
                try {
                    await member.voice.disconnect(
                        "VC+ locked VC"
                    );
                } catch {}
            }
        }

        // ----------------------------------------------------
        // CLEANUP
        // ----------------------------------------------------

        await cleanupEmptyTempVCs(guild);
    } catch (error) {
        console.error(
            "[VC+] voiceStateUpdate error:",
            error
        );
    }
});

// ============================================================
// FOREVER BAN PROTECTION
// ============================================================

client.on("guildMemberAdd", async member => {
    try {
        const data =
            guildData(member.guild);

        if (
            data.foreverBanned.includes(
                member.id
            )
        ) {
            try {
                await member.ban({
                    reason:
                        "VC+ permanent ban protection"
                });
            } catch (error) {
                console.error(
                    "[VC+] Forever ban enforcement error:",
                    error
                );
            }
        }

        await syncVouchRole(
            member.guild,
            member
        );
    } catch (error) {
        console.error(
            "[VC+] guildMemberAdd error:",
            error
        );
    }
});

// ============================================================
// GUILD DELETE CLEANUP
// ============================================================

client.on("guildDelete", guild => {
    try {
        delete db[guild.id];
        saveDatabase();
    } catch (error) {
        console.error(
            "[VC+] Guild cleanup error:",
            error
        );
    }
});

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
    console.log(
        `[VC+] Logged in as ${client.user.tag}`
    );

    client.user.setPresence({
        activities: [
            {
                name: `${BOT_NAME} | ${PREFIX}help`,
                type: ActivityType.Watching
            }
        ],
        status: "online"
    });

    for (const guild of client.guilds.cache.values()) {
        ensureGuildData(guild.id);

        try {
            await cleanupEmptyTempVCs(guild);
        } catch (error) {
            console.error(
                `[VC+] Startup cleanup failed in ${guild.id}:`,
                error
            );
        }
    }

    saveDatabase();
});

// ============================================================
// ERROR PROTECTION
// ============================================================

client.on("error", error => {
    console.error(
        "[VC+] Discord client error:",
        error
    );
});

client.on("warn", warning => {
    console.warn(
        "[VC+] Discord warning:",
        warning
    );
});

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+] Unhandled rejection:",
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
    }
);

// ============================================================
// SAFE SHUTDOWN
// ============================================================

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `[VC+] Received ${signal}. Saving database...`
    );

    saveDatabase();

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

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
