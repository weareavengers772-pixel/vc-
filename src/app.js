import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Collection
} from "discord.js";

/*
=========================================================
                    VC+ DISCORD BOT
=========================================================

Prefix:
-

Main systems:
- Help / Ping
- Moderation
- Forever bans
- VC+ ranks
- Godmode
- Vouches
- Filter
- Join To Create
- Temporary VC management
- VC interface
- Multi-page panel

Discord.js:
v14+

=========================================================
*/

// =======================================================
// CONFIG
// =======================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

const DATA_DIR = path.join(process.cwd(), "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

const DEFAULT_DATA = {
    guilds: {}
};

let db = DEFAULT_DATA;

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch {
        db = DEFAULT_DATA;
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (err) {
        console.error("Database save error:", err);
    }
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            godmode: [],
            vouches: {},
            vouchRole: null,
            foreverBans: [],
            filters: [],
            temporaryVCs: {},
            jtcCategory: null,
            jtcChannel: null,
            interfaceChannel: null
        };

        saveDB();
    }

    return db.guilds[guildId];
}

// =======================================================
// CLIENT
// =======================================================

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
        Partials.GuildMember
    ]
});

// =======================================================
// RANK SYSTEM
// =======================================================

const RANKS = [
    "founder",
    "god",
    "owner",
    "co-owner",
    "executive",
    "director",
    "admin",
    "moderator",
    "staff",
    "member"
];

const RANK_DISPLAY = {
    founder: "Founder",
    god: "God",
    owner: "Owner",
    "co-owner": "CoOwner",
    executive: "Executive",
    director: "Director",
    admin: "Admin",
    moderator: "Moderator",
    staff: "Staff",
    member: "Member"
};

const RANK_LEVEL = {
    founder: 100,
    god: 90,
    owner: 80,
    "co-owner": 70,
    executive: 60,
    director: 50,
    admin: 40,
    moderator: 30,
    staff: 20,
    member: 10
};

function normalizeRank(rank) {
    rank = rank
        .toLowerCase()
        .trim()
        .replace("_", "-");

    if (rank === "coowner") {
        return "co-owner";
    }

    if (rank === "co owner") {
        return "co-owner";
    }

    return rank;
}

function getRank(guild, userId) {
    if (guild.ownerId === userId) {
        return "founder";
    }

    const data = getGuildData(guild.id);

    return data.ranks[userId] || "member";
}

function getRankLevel(guild, userId) {
    const rank = getRank(guild, userId);
    return RANK_LEVEL[rank] || 10;
}

function hasRank(guild, userId, minimumRank) {
    return (
        getRankLevel(guild, userId) >=
        RANK_LEVEL[minimumRank]
    );
}

function canManageUser(guild, executorId, targetId) {
    if (guild.ownerId === executorId) {
        return true;
    }

    if (executorId === targetId) {
        return false;
    }

    return (
        getRankLevel(guild, executorId) >
        getRankLevel(guild, targetId)
    );
}

function isServerOwner(message) {
    return message.guild &&
        message.guild.ownerId === message.author.id;
}

// =======================================================
// EMBEDS
// =======================================================

function vcEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`VC+  •  ${title}`)
        .setDescription(description)
        .setColor(0x5865f2)
        .setFooter({
            text: "VC+"
        })
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setTitle("VC+  •  Error")
        .setDescription(description)
        .setColor(0xed4245);
}

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`VC+  •  ${title}`)
        .setDescription(description)
        .setColor(0x57f287);
}

async function reply(message, embed) {
    try {
        return await message.reply({
            embeds: [embed]
        });
    } catch {
        return null;
    }
}

// =======================================================
// PERMISSION HELPERS
// =======================================================

function requireRank(message, rank) {
    if (!hasRank(message.guild, message.author.id, rank)) {
        reply(
            message,
            errorEmbed(
                `You need **${RANK_DISPLAY[rank]}** or higher to use this command.`
            )
        );

        return false;
    }

    return true;
}

function requireOwner(message) {
    if (!isServerOwner(message)) {
        reply(
            message,
            errorEmbed(
                "Only the **Server Owner** can use this command."
            )
        );

        return false;
    }

    return true;
}

// =======================================================
// READY
// =======================================================

client.once("ready", () => {
    console.log("=================================");
    console.log(`${BOT_NAME} is online.`);
    console.log(`Logged in as ${client.user.tag}`);
    console.log("=================================");

    client.user.setPresence({
        activities: [
            {
                name: `${PREFIX}help | VC+`,
                type: 0
            }
        ],
        status: "online"
    });
});

// =======================================================
// HELP PANEL
// =======================================================

const HELP_PAGES = [
    {
        title: "Home",
        description:
            "Welcome to **VC+**.\n\nUse the buttons below to browse every VC+ command category.",
        fields: [
            {
                name: "Pages",
                value:
                    "🛡️ Moderation\n🏆 Ranks\n⭐ Vouches\n🎙️ Voice\n⚙️ Filter"
            }
        ]
    },
    {
        title: "Moderation",
        description:
            "`-ban @user [reason]`\n" +
            "`-unban USER_ID`\n" +
            "`-unbanall`\n" +
            "`-kick @user [reason]`\n" +
            "`-timeout @user [minutes] [reason]`\n" +
            "`-untimeout @user`\n" +
            "`-foreverban @user [reason]`\n" +
            "`-unforeverban USER_ID`\n" +
            "`-purge amount`\n" +
            "`-clear amount`"
    },
    {
        title: "Ranks",
        description:
            "`-rank @user`\n" +
            "`-rank @user founder`\n" +
            "`-rank @user god`\n" +
            "`-rank @user owner`\n" +
            "`-rank @user co-owner`\n" +
            "`-rank @user executive`\n" +
            "`-rank @user director`\n" +
            "`-rank @user admin`\n" +
            "`-rank @user moderator`\n" +
            "`-rank @user staff`\n" +
            "`-rank @user member`\n" +
            "`-removerank @user`\n" +
            "`-ranklist`"
    },
    {
        title: "Godmode",
        description:
            "`-godmode @user`\n" +
            "`-godmode remove @user`\n\n" +
            "Godmode gives the selected user the VC+ internal godmode permission."
    },
    {
        title: "Vouches",
        description:
            "`-vouch role set @Role`\n" +
            "`-vouch role`\n" +
            "`-vouch give @user reason`\n" +
            "`-vouch clear @user`\n" +
            "`-vouch clear everyone`\n" +
            "`-vouch list`\n" +
            "`-vouches @user`"
    },
    {
        title: "Filter",
        description:
            "`-filter add word`\n" +
            "`-filter remove word`\n\n" +
            "VC+ automatically checks normal messages against configured filters."
    },
    {
        title: "Voice",
        description:
            "`-vc setup`\n" +
            "`-vc kick @user`\n" +
            "`-vc disconnect @user`\n" +
            "`-vc ban @user`\n" +
            "`-vc reject @user`\n" +
            "`-vc permit @user`\n" +
            "`-vc lock`\n" +
            "`-vc unlock`\n" +
            "`-vc limit 5`\n" +
            "`-vc rename New Name`\n" +
            "`-vc transfer @user`\n" +
            "`-vc claim`\n" +
            "`-vc forceclaim`\n" +
            "`-vc stfu @user`\n" +
            "`-vc unstfu @user`\n" +
            "`-interface`"
    }
];

function buildHelpEmbed(page) {
    const data = HELP_PAGES[page];

    return new EmbedBuilder()
        .setTitle(`VC+  •  ${data.title}`)
        .setDescription(data.description)
        .setColor(0x5865f2)
        .setFooter({
            text: `VC+ Help  •  Page ${page + 1}/${HELP_PAGES.length}`
        });
}

function buildHelpButtons(page) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("vcplus_help_back")
            .setLabel("Back")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

        new ButtonBuilder()
            .setCustomId("vcplus_help_home")
            .setLabel("Home")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("vcplus_help_next")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === HELP_PAGES.length - 1)
    );
}

// =======================================================
// MESSAGE COMMAND HANDLER
// =======================================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    if (!message.guild) return;

    const content = message.content.trim();

    // ===================================================
    // FILTER
    // ===================================================

    const guildData = getGuildData(message.guild.id);

    if (
        !content.startsWith(PREFIX) &&
        guildData.filters.length > 0
    ) {
        const lower = content.toLowerCase();

        const matched = guildData.filters.find(word =>
            lower.includes(word.toLowerCase())
        );

        if (
            matched &&
            !hasRank(
                message.guild,
                message.author.id,
                "moderator"
            )
        ) {
            try {
                await message.delete();
            } catch {}

            return;
        }
    }

    if (!content.startsWith(PREFIX)) {
        return;
    }

    const args = content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    if (!command) return;

    const member =
        message.mentions.members.first();

    // ===================================================
    // PING
    // ===================================================

    if (command === "ping") {
        return reply(
            message,
            vcEmbed(
                "Ping",
                `Pong!\nLatency: **${client.ws.ping}ms**`
            )
        );
    }

    // ===================================================
    // HELP
    // ===================================================

    if (command === "help") {
        return message.reply({
            embeds: [buildHelpEmbed(0)],
            components: [buildHelpButtons(0)]
        });
    }

    // ===================================================
    // BAN
    // ===================================================

    if (command === "ban") {
        if (!requireRank(message, "moderator")) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-ban @user [reason]`"
                )
            );
        }

        if (
            !canManageUser(
                message.guild,
                message.author.id,
                member.id
            )
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot ban someone with an equal or higher VC+ rank."
                )
            );
        }

        const reason =
            args.join(" ") || "No reason provided";

        try {
            await member.ban({
                reason
            });

            return reply(
                message,
                successEmbed(
                    "User Banned",
                    `${member} was permanently banned.\n**Reason:** ${reason}`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not ban that member. Check my role position and permissions."
                )
            );
        }
    }

    // ===================================================
    // UNBAN
    // ===================================================

    if (command === "unban") {
        if (!requireRank(message, "moderator")) return;

        const id = args[0];

        if (!id) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-unban USER_ID`"
                )
            );
        }

        try {
            await message.guild.members.unban(id);

            return reply(
                message,
                successEmbed(
                    "User Unbanned",
                    `Successfully unbanned **${id}**.`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "That user is not banned or the ID is invalid."
                )
            );
        }
    }

    // ===================================================
    // UNBAN ALL
    // ===================================================

    if (command === "unbanall") {
        if (!requireRank(message, "admin")) return;

        try {
            const bans =
                await message.guild.bans.fetch();

            let count = 0;

            for (const ban of bans.values()) {
                try {
                    await message.guild.members.unban(
                        ban.user.id
                    );

                    count++;
                } catch {}
            }

            return reply(
                message,
                successEmbed(
                    "Unban All",
                    `Removed **${count}** bans.`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not process the server bans."
                )
            );
        }
    }

    // ===================================================
    // KICK
    // ===================================================

    if (command === "kick") {
        if (!requireRank(message, "moderator")) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-kick @user [reason]`"
                )
            );
        }

        if (
            !canManageUser(
                message.guild,
                message.author.id,
                member.id
            )
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot kick someone with an equal or higher VC+ rank."
                )
            );
        }

        const reason =
            args.join(" ") || "No reason provided";

        try {
            await member.kick(reason);

            return reply(
                message,
                successEmbed(
                    "User Kicked",
                    `${member.user.tag} was kicked.\n**Reason:** ${reason}`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not kick that member."
                )
            );
        }
    }

    // ===================================================
    // TIMEOUT
    // ===================================================

    if (command === "timeout") {
        if (!requireRank(message, "moderator")) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-timeout @user [minutes] [reason]`"
                )
            );
        }

        const minutes = Number(args.shift());

        if (
            !Number.isFinite(minutes) ||
            minutes <= 0
        ) {
            return reply(
                message,
                errorEmbed(
                    "Enter a valid timeout duration in minutes."
                )
            );
        }

        if (
            !canManageUser(
                message.guild,
                message.author.id,
                member.id
            )
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot timeout someone with an equal or higher VC+ rank."
                )
            );
        }

        const reason =
            args.join(" ") || "No reason provided";

        try {
            await member.timeout(
                minutes * 60 * 1000,
                reason
            );

            return reply(
                message,
                successEmbed(
                    "User Timed Out",
                    `${member} was timed out for **${minutes} minutes**.\n**Reason:** ${reason}`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not timeout that member."
                )
            );
        }
    }

    // ===================================================
    // UNTIMEOUT
    // ===================================================

    if (command === "untimeout") {
        if (!requireRank(message, "moderator")) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-untimeout @user`"
                )
            );
        }

        try {
            await member.timeout(null);

            return reply(
                message,
                successEmbed(
                    "Timeout Removed",
                    `${member}'s timeout has been removed.`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not remove that timeout."
                )
            );
        }
    }

    // ===================================================
    // FOREVER BAN
    // ===================================================

    if (command === "foreverban") {
        if (!requireRank(message, "admin")) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-foreverban @user [reason]`"
                )
            );
        }

        const reason =
            args.join(" ") || "Forever banned";

        if (
            !guildData.foreverBans.includes(member.id)
        ) {
            guildData.foreverBans.push(member.id);
        }

        saveDB();

        try {
            await member.ban({
                reason
            });

            return reply(
                message,
                successEmbed(
                    "Forever Ban",
                    `${member.user.tag} has been added to the VC+ permanent ban list.`
                )
            );
        } catch {
            return reply(
                message,
                errorEmbed(
                    "The user was added to the permanent list, but I could not ban them."
                )
            );
        }
    }

    // ===================================================
    // UNFOREVERBAN
    // ===================================================

    if (command === "unforeverban") {
        if (!requireRank(message, "admin")) return;

        const id = args[0];

        if (!id) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-unforeverban USER_ID`"
                )
            );
        }

        guildData.foreverBans =
            guildData.foreverBans.filter(
                x => x !== id
            );

        saveDB();

        return reply(
            message,
            successEmbed(
                "Forever Ban Removed",
                `**${id}** has been removed from the VC+ permanent ban list.`
            )
        );
    }

    // ===================================================
    // PURGE / CLEAR
    // ===================================================

    if (
        command === "purge" ||
        command === "clear"
    ) {
        if (!requireRank(message, "moderator")) return;

        const amount = Number(args[0]);

        if (
            !Number.isInteger(amount) ||
            amount < 1 ||
            amount > 100
        ) {
            return reply(
                message,
                errorEmbed(
                    "Amount must be between **1 and 100**."
                )
            );
        }

        try {
            const deleted =
                await message.channel.bulkDelete(
                    amount,
                    true
                );

            const msg = await message.channel.send({
                embeds: [
                    successEmbed(
                        "Messages Cleared",
                        `Deleted **${deleted.size}** messages.`
                    )
                ]
            });

            setTimeout(() => {
                msg.delete().catch(() => {});
            }, 3000);
        } catch {
            return reply(
                message,
                errorEmbed(
                    "I could not delete those messages."
                )
            );
        }

        return;
    }

    // ===================================================
    // RANK
    // ===================================================

    if (command === "rank") {
        if (!member) {
            const rank = getRank(
                message.guild,
                message.author.id
            );

            return reply(
                message,
                vcEmbed(
                    "Rank",
                    `${message.author} is **${RANK_DISPLAY[rank]}**.`
                )
            );
        }

        if (args.length === 0) {
            const rank = getRank(
                message.guild,
                member.id
            );

            return reply(
                message,
                vcEmbed(
                    "Rank",
                    `${member} is **${RANK_DISPLAY[rank]}**.`
                )
            );
        }

        if (!requireRank(message, "admin")) return;

        const newRank = normalizeRank(args[0]);

        if (!RANKS.includes(newRank)) {
            return reply(
                message,
                errorEmbed(
                    `Invalid rank.\n\nAvailable:\n${RANKS.map(
                        r => `\`${r}\``
                    ).join(", ")}`
                )
            );
        }

        if (
            !canManageUser(
                message.guild,
                message.author.id,
                member.id
            )
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot change the rank of someone equal to or above your rank."
                )
            );
        }

        if (
            RANK_LEVEL[newRank] >=
            getRankLevel(
                message.guild,
                message.author.id
            ) &&
            message.guild.ownerId !== message.author.id
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot give someone a rank equal to or higher than your own."
                )
            );
        }

        guildData.ranks[member.id] = newRank;

        saveDB();

        return reply(
            message,
            successEmbed(
                "Rank Updated",
                `${member} is now **${RANK_DISPLAY[newRank]}**.`
            )
        );
    }

    // ===================================================
    // REMOVE RANK
    // ===================================================

    if (command === "removerank") {
        if (!requireOwner(message)) return;

        if (!member) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-removerank @user`"
                )
            );
        }

        delete guildData.ranks[member.id];

        saveDB();

        return reply(
            message,
            successEmbed(
                "Rank Removed",
                `${member} has been returned to **Member**.`
            )
        );
    }

    // ===================================================
    // RANK LIST
    // ===================================================

    if (command === "ranklist") {
        const entries = Object.entries(
            guildData.ranks
        );

        if (entries.length === 0) {
            return reply(
                message,
                vcEmbed(
                    "Rank List",
                    "No custom VC+ ranks have been assigned."
                )
            );
        }

        let output = "";

        for (const [userId, rank] of entries) {
            output +=
                `<@${userId}> — **${RANK_DISPLAY[rank]}**\n`;
        }

        return reply(
            message,
            vcEmbed(
                "Rank List",
                output.slice(0, 4000)
            )
        );
    }

    // ===================================================
    // GODMODE
    // ===================================================

    if (command === "godmode") {
        if (!requireRank(message, "god")) return;

        const remove =
            args[0]?.toLowerCase() === "remove";

        if (remove) {
            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-godmode remove @user`"
                    )
                );
            }

            guildData.godmode =
                guildData.godmode.filter(
                    id => id !== target.id
                );

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Godmode Removed",
                    `${target} no longer has VC+ Godmode.`
                )
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-godmode @user`"
                )
            );
        }

        if (
            !canManageUser(
                message.guild,
                message.author.id,
                target.id
            )
        ) {
            return reply(
                message,
                errorEmbed(
                    "You cannot give Godmode to someone equal to or above your rank."
                )
            );
        }

        if (!guildData.godmode.includes(target.id)) {
            guildData.godmode.push(target.id);
        }

        saveDB();

        return reply(
            message,
            successEmbed(
                "Godmode Enabled",
                `${target} now has VC+ Godmode.`
            )
        );
    }

    // ===================================================
    // VOUCH
    // ===================================================

    if (command === "vouch") {
        if (!args.length) {
            return reply(
                message,
                errorEmbed(
                    "Usage: `-vouch role set @Role`\n`-vouch role`\n`-vouch give @user reason`\n`-vouch clear @user`\n`-vouch clear everyone`\n`-vouch list`"
                )
            );
        }

        const sub = args.shift()?.toLowerCase();

        // -----------------------------------------------
        // VOUCH ROLE
        // -----------------------------------------------

        if (sub === "role") {
            if (
                args[0]?.toLowerCase() === "set"
            ) {
                if (!requireRank(message, "admin")) return;

                const role =
                    message.mentions.roles.first();

                if (!role) {
                    return reply(
                        message,
                        errorEmbed(
                            "Usage: `-vouch role set @Role`"
                        )
                    );
                }

                guildData.vouchRole = role.id;

                saveDB();

                return reply(
                    message,
                    successEmbed(
                        "Vouch Role Set",
                        `Vouched users will now receive ${role}.`
                    )
                );
            }

            const role = guildData.vouchRole
                ? message.guild.roles.cache.get(
                    guildData.vouchRole
                )
                : null;

            return reply(
                message,
                vcEmbed(
                    "Vouch Role",
                    role
                        ? `Current vouch role: ${role}`
                        : "No vouch role has been configured."
                )
            );
        }

        // -----------------------------------------------
        // VOUCH GIVE
        // -----------------------------------------------

        if (sub === "give") {
            if (!requireRank(message, "staff")) return;

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vouch give @user reason`"
                    )
                );
            }

            const role = guildData.vouchRole
                ? message.guild.roles.cache.get(
                    guildData.vouchRole
                )
                : null;

            if (!role) {
                return reply(
                    message,
                    errorEmbed(
                        "No vouch role is configured. Use `-vouch role set @Role` first."
                    )
                );
            }

            const reason =
                args
                    .filter(
                        x =>
                            !x.startsWith("<@")
                    )
                    .join(" ") ||
                "No reason provided";

            if (!guildData.vouches[target.id]) {
                guildData.vouches[target.id] = [];
            }

            guildData.vouches[target.id].push({
                by: message.author.id,
                reason,
                timestamp: Date.now()
            });

            try {
                await target.roles.add(
                    role,
                    `VC+ vouch by ${message.author.tag}`
                );
            } catch {}

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Vouch Added",
                    `${target} received a vouch and ${role}.\n\n**Reason:** ${reason}`
                )
            );
        }

        // -----------------------------------------------
        // VOUCH CLEAR
        // -----------------------------------------------

        if (sub === "clear") {
            if (!requireRank(message, "admin")) return;

            const targetArg =
                args[0]?.toLowerCase();

            // EVERYONE
            if (targetArg === "everyone") {
                const users =
                    Object.keys(
                        guildData.vouches
                    );

                let cleared = 0;

                for (const userId of users) {
                    delete guildData.vouches[userId];

                    const target =
                        message.guild.members.cache.get(
                            userId
                        );

                    if (
                        target &&
                        guildData.vouchRole
                    ) {
                        const role =
                            message.guild.roles.cache.get(
                                guildData.vouchRole
                            );

                        if (
                            role &&
                            target.roles.cache.has(role.id)
                        ) {
                            try {
                                await target.roles.remove(
                                    role
                                );
                            } catch {}
                        }
                    }

                    cleared++;
                }

                saveDB();

                return reply(
                    message,
                    successEmbed(
                        "Vouches Cleared",
                        `Cleared vouches and removed the configured vouch role from **${cleared}** affected users.`
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vouch clear @user`"
                    )
                );
            }

            delete guildData.vouches[target.id];

            const role = guildData.vouchRole
                ? message.guild.roles.cache.get(
                    guildData.vouchRole
                )
                : null;

            if (
                role &&
                target.roles.cache.has(role.id)
            ) {
                try {
                    await target.roles.remove(
                        role
                    );
                } catch {}
            }

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Vouches Cleared",
                    `${target}'s vouches were cleared and the configured vouch role was removed.`
                )
            );
        }

        // -----------------------------------------------
        // VOUCH LIST
        // -----------------------------------------------

        if (sub === "list") {
            const entries =
                Object.entries(
                    guildData.vouches
                );

            if (!entries.length) {
                return reply(
                    message,
                    vcEmbed(
                        "Vouch List",
                        "No vouches are currently stored."
                    )
                );
            }

            let output = "";

            for (const [userId, vouches] of entries) {
                output +=
                    `<@${userId}> — **${vouches.length}** vouch(es)\n`;
            }

            return reply(
                message,
                vcEmbed(
                    "Vouch List",
                    output.slice(0, 4000)
                )
            );
        }

        return reply(
            message,
            errorEmbed(
                "Unknown vouch command."
            )
        );
    }

    // ===================================================
    // VOUCHES
    // ===================================================

    if (command === "vouches") {
        const target =
            message.mentions.members.first() ||
            message.member;

        const count =
            guildData.vouches[target.id]?.length || 0;

        return reply(
            message,
            vcEmbed(
                "Vouches",
                `${target} has **${count}** vouch(es).`
            )
        );
    }

    // ===================================================
    // FILTER
    // ===================================================

    if (command === "filter") {
        if (!requireRank(message, "admin")) return;

        const sub =
            args.shift()?.toLowerCase();

        if (sub === "add") {
            const word =
                args.join(" ").trim();

            if (!word) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-filter add word`"
                    )
                );
            }

            if (
                !guildData.filters.includes(
                    word.toLowerCase()
                )
            ) {
                guildData.filters.push(
                    word.toLowerCase()
                );
            }

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Filter Added",
                    `Added \`${word}\` to the automatic filter.`
                )
            );
        }

        if (sub === "remove") {
            const word =
                args.join(" ").trim();

            guildData.filters =
                guildData.filters.filter(
                    x =>
                        x.toLowerCase() !==
                        word.toLowerCase()
                );

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Filter Removed",
                    `Removed \`${word}\` from the automatic filter.`
                )
            );
        }

        return reply(
            message,
            vcEmbed(
                "Filter",
                guildData.filters.length
                    ? guildData.filters
                        .map(x => `\`${x}\``)
                        .join("\n")
                    : "No filters configured."
            )
        );
    }

    // ===================================================
    // VC SETUP
    // ===================================================

    if (command === "vc") {
        const sub =
            args.shift()?.toLowerCase();

        // -----------------------------------------------
        // SETUP
        // -----------------------------------------------

        if (sub === "setup") {
            if (!requireRank(message, "admin")) return;

            const existing =
                message.guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildVoice &&
                        channel.name ===
                            "➕ Create VC"
                );

            if (existing) {
                return reply(
                    message,
                    errorEmbed(
                        "VC+ Join-to-Create is already configured."
                    )
                );
            }

            const category =
                await message.guild.channels.create({
                    name: "VC+ VOICE",
                    type: ChannelType.GuildCategory
                });

            const createChannel =
                await message.guild.channels.create({
                    name: "➕ Create VC",
                    type: ChannelType.GuildVoice,
                    parent: category.id
                });

            guildData.jtcCategory =
                category.id;

            guildData.jtcChannel =
                createChannel.id;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Setup Complete",
                    `Join ${createChannel} to automatically create your own temporary VC.`
                )
            );
        }

        // -----------------------------------------------
        // GET CURRENT VC
        // -----------------------------------------------

        const voice =
            message.member.voice.channel;

        if (!voice) {
            return reply(
                message,
                errorEmbed(
                    "You must be inside your VC+ temporary voice channel."
                )
            );
        }

        const temp =
            guildData.temporaryVCs[voice.id];

        if (!temp) {
            return reply(
                message,
                errorEmbed(
                    "This is not a VC+ temporary voice channel."
                )
            );
        }

        // -----------------------------------------------
        // OWNER CHECK
        // -----------------------------------------------

        const isOwner =
            temp.owner ===
            message.author.id;

        const isGod =
            guildData.godmode.includes(
                message.author.id
            ) ||
            hasRank(
                message.guild,
                message.author.id,
                "god"
            );

        // -----------------------------------------------
        // KICK
        // -----------------------------------------------

        if (sub === "kick") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc kick @user`"
                    )
                );
            }

            if (
                target.voice.channelId !==
                voice.id
            ) {
                return reply(
                    message,
                    errorEmbed(
                        "That user is not in your VC."
                    )
                );
            }

            try {
                await target.voice.disconnect(
                    "VC+ VC kick"
                );

                return reply(
                    message,
                    successEmbed(
                        "VC Kick",
                        `${target} was removed from the VC.`
                    )
                );
            } catch {
                return reply(
                    message,
                    errorEmbed(
                        "I could not disconnect that user."
                    )
                );
            }
        }

        // -----------------------------------------------
        // DISCONNECT
        // -----------------------------------------------

        if (sub === "disconnect") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc disconnect @user`"
                    )
                );
            }

            try {
                await target.voice.disconnect(
                    "VC+ disconnect"
                );

                return reply(
                    message,
                    successEmbed(
                        "Disconnected",
                        `${target} was disconnected.`
                    )
                );
            } catch {
                return reply(
                    message,
                    errorEmbed(
                        "I could not disconnect that user."
                    )
                );
            }
        }

        // -----------------------------------------------
        // BAN
        // -----------------------------------------------

        if (sub === "ban") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc ban @user`"
                    )
                );
            }

            if (!temp.banned) {
                temp.banned = [];
            }

            if (!temp.banned.includes(target.id)) {
                temp.banned.push(target.id);
            }

            try {
                await target.voice.disconnect(
                    "VC+ VC ban"
                );
            } catch {}

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Ban",
                    `${target} can no longer join this temporary VC.`
                )
            );
        }

        // -----------------------------------------------
        // REJECT
        // -----------------------------------------------

        if (sub === "reject") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc reject @user`"
                    )
                );
            }

            if (!temp.rejected) {
                temp.rejected = [];
            }

            if (!temp.rejected.includes(target.id)) {
                temp.rejected.push(target.id);
            }

            try {
                await target.voice.disconnect(
                    "VC+ rejected"
                );
            } catch {}

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Reject",
                    `${target} has been rejected from this VC.`
                )
            );
        }

        // -----------------------------------------------
        // PERMIT
        // -----------------------------------------------

        if (sub === "permit") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc permit @user`"
                    )
                );
            }

            temp.banned =
                (temp.banned || []).filter(
                    id => id !== target.id
                );

            temp.rejected =
                (temp.rejected || []).filter(
                    id => id !== target.id
                );

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Permit",
                    `${target} is allowed to join your VC again.`
                )
            );
        }

        // -----------------------------------------------
        // LOCK
        // -----------------------------------------------

        if (sub === "lock") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            await voice.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    Connect: false
                }
            );

            temp.locked = true;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Locked",
                    "Your temporary VC is now locked."
                )
            );
        }

        // -----------------------------------------------
        // UNLOCK
        // -----------------------------------------------

        if (sub === "unlock") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            await voice.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    Connect: null
                }
            );

            temp.locked = false;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Unlocked",
                    "Your temporary VC is now unlocked."
                )
            );
        }

        // -----------------------------------------------
        // LIMIT
        // -----------------------------------------------

        if (sub === "limit") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const limit =
                Number(args[0]);

            if (
                !Number.isInteger(limit) ||
                limit < 0 ||
                limit > 99
            ) {
                return reply(
                    message,
                    errorEmbed(
                        "Use a number from 0 to 99."
                    )
                );
            }

            await voice.setUserLimit(limit);

            return reply(
                message,
                successEmbed(
                    "VC Limit",
                    `VC member limit set to **${limit === 0 ? "Unlimited" : limit}**.`
                )
            );
        }

        // -----------------------------------------------
        // RENAME
        // -----------------------------------------------

        if (sub === "rename") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            const name =
                args.join(" ");

            if (!name) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc rename New Name`"
                    )
                );
            }

            await voice.setName(name);

            return reply(
                message,
                successEmbed(
                    "VC Renamed",
                    `Your VC is now **${name}**.`
                )
            );
        }

        // -----------------------------------------------
        // TRANSFER
        // -----------------------------------------------

        if (sub === "transfer") {
            if (!isOwner) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the current VC owner can transfer ownership."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc transfer @user`"
                    )
                );
            }

            temp.owner = target.id;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "Ownership Transferred",
                    `${target} is now the owner of this temporary VC.`
                )
            );
        }

        // -----------------------------------------------
        // CLAIM
        // -----------------------------------------------

        if (sub === "claim") {
            if (voice.members.has(temp.owner)) {
                return reply(
                    message,
                    errorEmbed(
                        "The current VC owner is still in the channel."
                    )
                );
            }

            temp.owner =
                message.author.id;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Claimed",
                    `${message.author} now owns this VC.`
                )
            );
        }

        // -----------------------------------------------
        // FORCECLAIM
        // -----------------------------------------------

        if (sub === "forceclaim") {
            if (!isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "You need VC+ Godmode or God rank to force-claim a VC."
                    )
                );
            }

            temp.owner =
                message.author.id;

            saveDB();

            return reply(
                message,
                successEmbed(
                    "VC Force Claimed",
                    `${message.author} now owns this VC.`
                )
            );
        }

        // -----------------------------------------------
        // STFU
        // -----------------------------------------------

        if (sub === "stfu") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can use STFU."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc stfu @user`"
                    )
                );
            }

            if (!temp.stfu) {
                temp.stfu = [];
            }

            if (!temp.stfu.includes(target.id)) {
                temp.stfu.push(target.id);
            }

            try {
                await target.voice.setMute(
                    true,
                    "VC+ STFU"
                );
            } catch {}

            saveDB();

            return reply(
                message,
                successEmbed(
                    "STFU Enabled",
                    `${target} is now persistently muted in this VC.`
                )
            );
        }

        // -----------------------------------------------
        // UNSTFU
        // -----------------------------------------------

        if (sub === "unstfu") {
            if (!isOwner && !isGod) {
                return reply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can use UnSTFU."
                    )
                );
            }

            const target =
                message.mentions.members.first();

            if (!target) {
                return reply(
                    message,
                    errorEmbed(
                        "Usage: `-vc unstfu @user`"
                    )
                );
            }

            temp.stfu =
                (temp.stfu || []).filter(
                    id => id !== target.id
                );

            try {
                await target.voice.setMute(
                    false,
                    "VC+ UnSTFU"
                );
            } catch {}

            saveDB();

            return reply(
                message,
                successEmbed(
                    "STFU Removed",
                    `${target} can unmute normally again.`
                )
            );
        }

        return reply(
            message,
            errorEmbed(
                "Unknown VC command. Use `-help`."
            )
        );
    }

    // ===================================================
    // INTERFACE
    // ===================================================

    if (command === "interface") {
        if (!requireRank(message, "admin")) return;

        const voice =
            message.member.voice.channel;

        if (!voice) {
            return reply(
                message,
                errorEmbed(
                    "Join a voice channel first."
                )
            );
        }

        guildData.interfaceChannel =
            message.channel.id;

        saveDB();

        const embed = new EmbedBuilder()
            .setTitle("VC+  •  Voice Control")
            .setDescription(
                "Control your temporary VC using the buttons below."
            )
            .setColor(0x5865f2);

        const row1 =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vcplus_lock")
                    .setLabel("Lock")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vcplus_unlock")
                    .setLabel("Unlock")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId("vcplus_claim")
                    .setLabel("Claim")
                    .setStyle(ButtonStyle.Primary)
            );

        const row2 =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vcplus_limit")
                    .setLabel("Limit")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vcplus_rename")
                    .setLabel("Rename")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vcplus_disconnect")
                    .setLabel("Disconnect")
                    .setStyle(ButtonStyle.Danger)
            );

        return message.channel.send({
            embeds: [embed],
            components: [
                row1,
                row2
            ]
        });
    }
});

// =======================================================
// VOICE STATE SYSTEM
// =======================================================

client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const data = getGuildData(guild.id);

    // -----------------------------------------------
    // JOIN CREATE CHANNEL
    // -----------------------------------------------

    if (
        newState.channelId &&
        newState.channelId === data.jtcChannel
    ) {
        try {
            const category =
                guild.channels.cache.get(
                    data.jtcCategory
                );

            if (!category) return;

            const channel =
                await guild.channels.create({
                    name: `${newState.member.user.username}'s VC`,
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.Connect
                            ]
                        },
                        {
                            id: newState.member.id,
                            allow: [
                                PermissionsBitField.Flags.ViewChannel,
                                PermissionsBitField.Flags.Connect,
                                PermissionsBitField.Flags.Speak,
                                PermissionsBitField.Flags.Stream
                            ]
                        }
                    ]
                });

            data.temporaryVCs[channel.id] = {
                owner: newState.member.id,
                locked: false,
                banned: [],
                rejected: [],
                stfu: []
            };

            saveDB();

            await newState.setChannel(channel);

        } catch (err) {
            console.error(
                "JTC creation error:",
                err
            );
        }
    }

    // -----------------------------------------------
    // PERSISTENT STFU
    // -----------------------------------------------

    if (newState.channelId) {
        const temp =
            data.temporaryVCs[newState.channelId];

        if (
            temp &&
            temp.stfu?.includes(
                newState.member.id
            )
        ) {
            try {
                await newState.setMute(
                    true,
                    "VC+ persistent STFU"
                );
            } catch {}
        }

        if (
            temp &&
            (
                temp.banned?.includes(
                    newState.member.id
                ) ||
                temp.rejected?.includes(
                    newState.member.id
                )
            )
        ) {
            try {
                await newState.disconnect(
                    "VC+ access denied"
                );
            } catch {}
        }
    }

    // -----------------------------------------------
    // DELETE EMPTY TEMP VC
    // -----------------------------------------------

    if (
        oldState.channelId &&
        data.temporaryVCs[oldState.channelId]
    ) {
        const channel =
            guild.channels.cache.get(
                oldState.channelId
            );

        if (
            channel &&
            channel.members.size === 0
        ) {
            delete data.temporaryVCs[
                oldState.channelId
            ];

            saveDB();

            try {
                await channel.delete(
                    "VC+ temporary VC empty"
                );
            } catch {}
        }
    }
});

// =======================================================
// BUTTONS
// =======================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isButton()) return;

    // ===================================================
    // HELP PANEL
    // ===================================================

    if (
        interaction.customId.startsWith(
            "vcplus_help_"
        )
    ) {
        const currentPage =
            Number(
                interaction.message.embeds[0]
                    ?.footer?.text
                    ?.match(/Page (\d+)/)?.[1] || 1
            ) - 1;

        let page = currentPage;

        if (
            interaction.customId ===
            "vcplus_help_next"
        ) {
            page++;
        }

        if (
            interaction.customId ===
            "vcplus_help_back"
        ) {
            page--;
        }

        if (
            interaction.customId ===
            "vcplus_help_home"
        ) {
            page = 0;
        }

        page = Math.max(
            0,
            Math.min(
                HELP_PAGES.length - 1,
                page
            )
        );

        return interaction.update({
            embeds: [
                buildHelpEmbed(page)
            ],
            components: [
                buildHelpButtons(page)
            ]
        });
    }

    // ===================================================
    // VC BUTTONS
    // ===================================================

    const guild =
        interaction.guild;

    if (!guild) return;

    const data =
        getGuildData(guild.id);

    const voice =
        interaction.member.voice.channel;

    if (!voice) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "You must be inside your VC."
                )
            ],
            ephemeral: true
        });
    }

    const temp =
        data.temporaryVCs[voice.id];

    if (!temp) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "This is not a VC+ temporary VC."
                )
            ],
            ephemeral: true
        });
    }

    const owner =
        temp.owner ===
        interaction.user.id;

    const god =
        data.godmode.includes(
            interaction.user.id
        ) ||
        hasRank(
            guild,
            interaction.user.id,
            "god"
        );

    if (
        !owner &&
        !god
    ) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "Only the VC owner or VC+ Godmode can use these controls."
                )
            ],
            ephemeral: true
        });
    }

    // LOCK
    if (
        interaction.customId ===
        "vcplus_lock"
    ) {
        await voice.permissionOverwrites.edit(
            guild.roles.everyone,
            {
                Connect: false
            }
        );

        temp.locked = true;
        saveDB();

        return interaction.reply({
            embeds: [
                successEmbed(
                    "VC Locked",
                    "Your VC is now locked."
                )
            ],
            ephemeral: true
        });
    }

    // UNLOCK
    if (
        interaction.customId ===
        "vcplus_unlock"
    ) {
        await voice.permissionOverwrites.edit(
            guild.roles.everyone,
            {
                Connect: null
            }
        );

        temp.locked = false;
        saveDB();

        return interaction.reply({
            embeds: [
                successEmbed(
                    "VC Unlocked",
                    "Your VC is now unlocked."
                )
            ],
            ephemeral: true
        });
    }

    // CLAIM
    if (
        interaction.customId ===
        "vcplus_claim"
    ) {
        if (
            voice.members.has(
                temp.owner
            )
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "The current owner is still in the VC."
                    )
                ],
                ephemeral: true
            });
        }

        temp.owner =
            interaction.user.id;

        saveDB();

        return interaction.reply({
            embeds: [
                successEmbed(
                    "VC Claimed",
                    `${interaction.user} now owns the VC.`
                )
            ],
            ephemeral: true
        });
    }

    // LIMIT
    if (
        interaction.customId ===
        "vcplus_limit"
    ) {
        await interaction.reply({
            embeds: [
                vcEmbed(
                    "VC Limit",
                    "Use `-vc limit 5` to set the limit."
                )
            ],
            ephemeral: true
        });

        return;
    }

    // RENAME
    if (
        interaction.customId ===
        "vcplus_rename"
    ) {
        return interaction.reply({
            embeds: [
                vcEmbed(
                    "VC Rename",
                    "Use `-vc rename New Name` to rename your VC."
                )
            ],
            ephemeral: true
        });
    }

    // DISCONNECT
    if (
        interaction.customId ===
        "vcplus_disconnect"
    ) {
        return interaction.reply({
            embeds: [
                vcEmbed(
                    "Disconnect",
                    "Use `-vc disconnect @user` to disconnect a member."
                )
            ],
            ephemeral: true
        });
    }
});

// =======================================================
// FOREVER BAN CHECK
// =======================================================

client.on("guildMemberAdd", async member => {
    const data =
        getGuildData(member.guild.id);

    if (
        data.foreverBans.includes(
            member.id
        )
    ) {
        try {
            await member.ban({
                reason: "VC+ permanent ban list"
            });
        } catch {}
    }
});

// =======================================================
// ERROR PROTECTION
// =======================================================

process.on("unhandledRejection", error => {
    console.error(
        "Unhandled rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "Uncaught exception:",
        error
    );
});

// =======================================================
// LOGIN
// =======================================================

if (!process.env.TOKEN) {
    console.error(
        "Missing TOKEN in .env file."
    );

    process.exit(1);
}

client.login(
    process.env.TOKEN
);
