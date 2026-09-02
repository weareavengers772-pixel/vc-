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
    ChannelType
} from "discord.js";

// ============================================================
// VC+
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

// ============================================================
// DATABASE
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DATABASE = {
    guilds: {}
};

let database = DEFAULT_DATABASE;

try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf8");

        if (raw.trim()) {
            database = JSON.parse(raw);
        }
    }
} catch (error) {
    console.error("[VC+] Database load error:", error);
    database = DEFAULT_DATABASE;
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2)
        );
    } catch (error) {
        console.error("[VC+] Database save error:", error);
    }
}

function getGuildData(guildId) {
    if (!database.guilds[guildId]) {
        database.guilds[guildId] = {
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

        saveDatabase();
    }

    return database.guilds[guildId];
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
        Partials.GuildMember
    ]
});

// ============================================================
// RANK SYSTEM
// ============================================================

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
    if (!rank) return null;

    return rank
        .toLowerCase()
        .trim()
        .replaceAll("_", "-")
        .replace(/\s+/g, "-")
        .replace("coowner", "co-owner");
}

function getRank(guild, userId) {
    if (!guild) return "member";

    if (guild.ownerId === userId) {
        return "founder";
    }

    const data = getGuildData(guild.id);

    return data.ranks[userId] || "member";
}

function getRankLevel(guild, userId) {
    return RANK_LEVEL[getRank(guild, userId)] || 10;
}

function hasRank(guild, userId, minimumRank) {
    return (
        getRankLevel(guild, userId) >=
        (RANK_LEVEL[minimumRank] || 10)
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

// ============================================================
// EMBEDS
// ============================================================

function baseEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`${BOT_NAME}  •  ${title}`)
        .setDescription(description || "")
        .setColor(0x5865f2)
        .setFooter({
            text: BOT_NAME
        })
        .setTimestamp();
}

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`${BOT_NAME}  •  ${title}`)
        .setDescription(description || "")
        .setColor(0x57f287)
        .setFooter({
            text: BOT_NAME
        })
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setTitle(`${BOT_NAME}  •  Error`)
        .setDescription(description || "An error occurred.")
        .setColor(0xed4245)
        .setFooter({
            text: BOT_NAME
        })
        .setTimestamp();
}

async function safeReply(message, embed) {
    try {
        if (!message?.channel) return null;

        return await message.reply({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "[VC+] Message reply error:",
            error.message
        );

        return null;
    }
}

async function safeInteractionReply(interaction, data) {
    try {
        if (
            interaction.replied ||
            interaction.deferred
        ) {
            return await interaction.followUp(data);
        }

        return await interaction.reply(data);
    } catch (error) {
        console.error(
            "[VC+] Interaction reply error:",
            error.message
        );

        return null;
    }
}

// ============================================================
// PERMISSIONS
// ============================================================

function requireRank(message, rank) {
    if (!hasRank(
        message.guild,
        message.author.id,
        rank
    )) {
        safeReply(
            message,
            errorEmbed(
                `You need ${RANK_DISPLAY[rank]} or higher to use this command.`
            )
        );

        return false;
    }

    return true;
}

function requireServerOwner(message) {
    if (
        !message.guild ||
        message.guild.ownerId !== message.author.id
    ) {
        safeReply(
            message,
            errorEmbed(
                "Only the Server Owner can use this command."
            )
        );

        return false;
    }

    return true;
}

// ============================================================
// HELP PAGES
// ============================================================

const HELP_PAGES = [
    {
        title: "Home",
        description:
            "Welcome to VC+.\n\n" +
            "Use the buttons below to browse the VC+ command system.",
        fields: [
            {
                name: "Categories",
                value:
                    "Moderation\n" +
                    "Ranks\n" +
                    "Godmode\n" +
                    "Vouches\n" +
                    "Filter\n" +
                    "Voice"
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
            "Godmode gives a user additional VC+ management permissions."
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
            "VC+ checks normal messages against the configured filter."
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

function createHelpEmbed(page) {
    const data = HELP_PAGES[page];

    const embed = baseEmbed(
        data.title,
        data.description
    );

    if (data.fields) {
        embed.addFields(data.fields);
    }

    return embed.setFooter({
        text:
            `${BOT_NAME} Help  •  Page ${page + 1}/${HELP_PAGES.length}`
    });
}

function createHelpButtons(page) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("vcplus_help_back")
            .setLabel("Back")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),

        new ButtonBuilder()
            .setCustomId("vcplus_help_home")
            .setLabel("Home")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("vcplus_help_next")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                page >= HELP_PAGES.length - 1
            )
    );
}

// ============================================================
// READY
// ============================================================

client.once("ready", () => {
    console.log("--------------------------------");
    console.log(`${BOT_NAME} is online.`);
    console.log(`Logged in as ${client.user.tag}`);
    console.log("--------------------------------");

    try {
        client.user.setPresence({
            activities: [
                {
                    name: `${PREFIX}help`
                }
            ],
            status: "online"
        });
    } catch (error) {
        console.error(
            "[VC+] Presence error:",
            error.message
        );
    }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on("messageCreate", async message => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;

        const guildData =
            getGuildData(message.guild.id);

        const content =
            message.content?.trim() || "";

        // ====================================================
        // AUTOMATIC FILTER
        // ====================================================

        if (
            !content.startsWith(PREFIX) &&
            guildData.filters.length
        ) {
            const lower =
                content.toLowerCase();

            const found =
                guildData.filters.find(
                    word =>
                        lower.includes(
                            word.toLowerCase()
                        )
                );

            if (
                found &&
                !hasRank(
                    message.guild,
                    message.author.id,
                    "moderator"
                )
            ) {
                try {
                    await message.delete();
                } catch (error) {
                    console.error(
                        "[VC+] Filter delete error:",
                        error.message
                    );
                }

                return;
            }
        }

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

        const mentionedMember =
            message.mentions.members.first();

        // ====================================================
        // PING
        // ====================================================

        if (command === "ping") {
            return safeReply(
                message,
                baseEmbed(
                    "Ping",
                    `Pong.\nLatency: ${client.ws.ping}ms`
                )
            );
        }

        // ====================================================
        // HELP
        // ====================================================

        if (command === "help") {
            try {
                return await message.reply({
                    embeds: [
                        createHelpEmbed(0)
                    ],
                    components: [
                        createHelpButtons(0)
                    ]
                });
            } catch (error) {
                console.error(
                    "[VC+] Help error:",
                    error.message
                );
            }

            return;
        }

        // ====================================================
        // BAN
        // ====================================================

        if (command === "ban") {
            if (!requireRank(message, "moderator")) return;

            if (!mentionedMember) {
                return safeReply(
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
                    mentionedMember.id
                )
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot manage a user with an equal or higher VC+ rank."
                    )
                );
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            try {
                await mentionedMember.ban({
                    reason
                });

                return safeReply(
                    message,
                    successEmbed(
                        "User Banned",
                        `${mentionedMember} was banned.\n\nReason: ${reason}`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Ban error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not ban that user. Check my permissions and role position."
                    )
                );
            }
        }

        // ====================================================
        // UNBAN
        // ====================================================

        if (command === "unban") {
            if (!requireRank(message, "moderator")) return;

            const userId = args[0];

            if (!userId) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-unban USER_ID`"
                    )
                );
            }

            try {
                await message.guild.members.unban(
                    userId
                );

                return safeReply(
                    message,
                    successEmbed(
                        "User Unbanned",
                        `User ${userId} has been unbanned.`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Unban error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "That user is not banned or the ID is invalid."
                    )
                );
            }
        }

        // ====================================================
        // UNBAN ALL
        // ====================================================

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
                    } catch (error) {
                        console.error(
                            "[VC+] Individual unban error:",
                            error.message
                        );
                    }
                }

                return safeReply(
                    message,
                    successEmbed(
                        "Unban All",
                        `Removed ${count} ban(s).`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Unbanall error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not access the server ban list."
                    )
                );
            }
        }

        // ====================================================
        // KICK
        // ====================================================

        if (command === "kick") {
            if (!requireRank(message, "moderator")) return;

            if (!mentionedMember) {
                return safeReply(
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
                    mentionedMember.id
                )
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot manage a user with an equal or higher VC+ rank."
                    )
                );
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            try {
                await mentionedMember.kick(reason);

                return safeReply(
                    message,
                    successEmbed(
                        "User Kicked",
                        `${mentionedMember.user.tag} was kicked.\n\nReason: ${reason}`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Kick error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not kick that user."
                    )
                );
            }
        }

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (command === "timeout") {
            if (!requireRank(message, "moderator")) return;

            if (!mentionedMember) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-timeout @user [minutes] [reason]`"
                    )
                );
            }

            const minutes =
                Number(args.shift());

            if (
                !Number.isFinite(minutes) ||
                minutes <= 0
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Enter a valid number of minutes."
                    )
                );
            }

            if (
                !canManageUser(
                    message.guild,
                    message.author.id,
                    mentionedMember.id
                )
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot timeout a user with an equal or higher VC+ rank."
                    )
                );
            }

            const reason =
                args.join(" ") ||
                "No reason provided";

            try {
                await mentionedMember.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                return safeReply(
                    message,
                    successEmbed(
                        "Timeout",
                        `${mentionedMember} was timed out for ${minutes} minute(s).\n\nReason: ${reason}`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Timeout error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not timeout that user."
                    )
                );
            }
        }

        // ====================================================
        // UNTIMEOUT
        // ====================================================

        if (command === "untimeout") {
            if (!requireRank(message, "moderator")) return;

            if (!mentionedMember) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-untimeout @user`"
                    )
                );
            }

            try {
                await mentionedMember.timeout(
                    null
                );

                return safeReply(
                    message,
                    successEmbed(
                        "Timeout Removed",
                        `${mentionedMember} is no longer timed out.`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Untimeout error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not remove the timeout."
                    )
                );
            }
        }

        // ====================================================
        // FOREVERBAN
        // ====================================================

        if (command === "foreverban") {
            if (!requireRank(message, "admin")) return;

            if (!mentionedMember) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-foreverban @user [reason]`"
                    )
                );
            }

            const reason =
                args.join(" ") ||
                "VC+ permanent ban";

            if (
                !guildData.foreverBans.includes(
                    mentionedMember.id
                )
            ) {
                guildData.foreverBans.push(
                    mentionedMember.id
                );
            }

            saveDatabase();

            try {
                await mentionedMember.ban({
                    reason
                });
            } catch (error) {
                console.error(
                    "[VC+] Foreverban error:",
                    error.message
                );
            }

            return safeReply(
                message,
                successEmbed(
                    "Forever Ban",
                    `${mentionedMember.user.tag} was added to the VC+ permanent ban list.`
                )
            );
        }

        // ====================================================
        // UNFOREVERBAN
        // ====================================================

        if (command === "unforeverban") {
            if (!requireRank(message, "admin")) return;

            const userId = args[0];

            if (!userId) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-unforeverban USER_ID`"
                    )
                );
            }

            guildData.foreverBans =
                guildData.foreverBans.filter(
                    id => id !== userId
                );

            saveDatabase();

            return safeReply(
                message,
                successEmbed(
                    "Forever Ban Removed",
                    `${userId} was removed from the VC+ permanent ban list.`
                )
            );
        }

        // ====================================================
        // PURGE / CLEAR
        // ====================================================

        if (
            command === "purge" ||
            command === "clear"
        ) {
            if (!requireRank(message, "moderator")) return;

            const amount =
                Number(args[0]);

            if (
                !Number.isInteger(amount) ||
                amount < 1 ||
                amount > 100
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Amount must be between 1 and 100."
                    )
                );
            }

            try {
                const deleted =
                    await message.channel.bulkDelete(
                        amount,
                        true
                    );

                const confirmation =
                    await message.channel.send({
                        embeds: [
                            successEmbed(
                                "Messages Cleared",
                                `Deleted ${deleted.size} message(s).`
                            )
                        ]
                    });

                setTimeout(() => {
                    confirmation
                        ?.delete()
                        .catch(() => {});
                }, 3000);

            } catch (error) {
                console.error(
                    "[VC+] Purge error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not delete those messages."
                    )
                );
            }

            return;
        }

        // ====================================================
        // RANK
        // ====================================================

        if (command === "rank") {
            if (!mentionedMember) {
                const rank =
                    getRank(
                        message.guild,
                        message.author.id
                    );

                return safeReply(
                    message,
                    baseEmbed(
                        "Rank",
                        `${message.author} is ${RANK_DISPLAY[rank]}.`
                    )
                );
            }

            if (!args[0]) {
                const rank =
                    getRank(
                        message.guild,
                        mentionedMember.id
                    );

                return safeReply(
                    message,
                    baseEmbed(
                        "Rank",
                        `${mentionedMember} is ${RANK_DISPLAY[rank]}.`
                    )
                );
            }

            if (!requireRank(message, "admin")) return;

            const newRank =
                normalizeRank(args[0]);

            if (!RANKS.includes(newRank)) {
                return safeReply(
                    message,
                    errorEmbed(
                        `Invalid rank.\n\nAvailable ranks:\n${RANKS.join(", ")}`
                    )
                );
            }

            if (
                !canManageUser(
                    message.guild,
                    message.author.id,
                    mentionedMember.id
                )
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot change the rank of someone equal to or above your rank."
                    )
                );
            }

            if (
                message.guild.ownerId !==
                    message.author.id &&
                RANK_LEVEL[newRank] >=
                    getRankLevel(
                        message.guild,
                        message.author.id
                    )
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot give someone a rank equal to or higher than your own."
                    )
                );
            }

            guildData.ranks[
                mentionedMember.id
            ] = newRank;

            saveDatabase();

            return safeReply(
                message,
                successEmbed(
                    "Rank Updated",
                    `${mentionedMember} is now ${RANK_DISPLAY[newRank]}.`
                )
            );
        }

        // ====================================================
        // REMOVE RANK
        // ====================================================

        if (command === "removerank") {
            if (!requireServerOwner(message)) return;

            if (!mentionedMember) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Usage: `-removerank @user`"
                    )
                );
            }

            delete guildData.ranks[
                mentionedMember.id
            ];

            saveDatabase();

            return safeReply(
                message,
                successEmbed(
                    "Rank Removed",
                    `${mentionedMember} has been returned to Member.`
                )
            );
        }

        // ====================================================
        // RANK LIST
        // ====================================================

        if (command === "ranklist") {
            const entries =
                Object.entries(
                    guildData.ranks
                );

            if (!entries.length) {
                return safeReply(
                    message,
                    baseEmbed(
                        "Rank List",
                        "No custom VC+ ranks are currently assigned."
                    )
                );
            }

            const lines = [];

            for (
                const [userId, rank]
                of entries
            ) {
                lines.push(
                    `<@${userId}> — ${RANK_DISPLAY[rank]}`
                );
            }

            return safeReply(
                message,
                baseEmbed(
                    "Rank List",
                    lines.join("\n").slice(0, 4000)
                )
            );
        }

        // ====================================================
        // GODMODE
        // ====================================================

        if (command === "godmode") {
            if (!requireRank(message, "god")) return;

            const remove =
                args[0]?.toLowerCase() ===
                "remove";

            const target =
                message.mentions.members.first();

            if (!target) {
                return safeReply(
                    message,
                    errorEmbed(
                        remove
                            ? "Usage: `-godmode remove @user`"
                            : "Usage: `-godmode @user`"
                    )
                );
            }

            if (remove) {
                guildData.godmode =
                    guildData.godmode.filter(
                        id => id !== target.id
                    );

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Godmode Removed",
                        `${target} no longer has VC+ Godmode.`
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
                return safeReply(
                    message,
                    errorEmbed(
                        "You cannot give Godmode to someone equal to or above your rank."
                    )
                );
            }

            if (
                !guildData.godmode.includes(
                    target.id
                )
            ) {
                guildData.godmode.push(
                    target.id
                );
            }

            saveDatabase();

            return safeReply(
                message,
                successEmbed(
                    "Godmode Enabled",
                    `${target} now has VC+ Godmode.`
                )
            );
        }

        // ====================================================
        // VOUCH
        // ====================================================

        if (command === "vouch") {
            const sub =
                args.shift()?.toLowerCase();

            // ------------------------------------------------
            // ROLE
            // ------------------------------------------------

            if (sub === "role") {
                const action =
                    args.shift()?.toLowerCase();

                if (action === "set") {
                    if (
                        !requireRank(
                            message,
                            "admin"
                        )
                    ) return;

                    const role =
                        message.mentions.roles.first();

                    if (!role) {
                        return safeReply(
                            message,
                            errorEmbed(
                                "Usage: `-vouch role set @Role`"
                            )
                        );
                    }

                    guildData.vouchRole =
                        role.id;

                    saveDatabase();

                    return safeReply(
                        message,
                        successEmbed(
                            "Vouch Role Set",
                            `The configured vouch role is now ${role}.`
                        )
                    );
                }

                const role =
                    guildData.vouchRole
                        ? message.guild.roles.cache.get(
                            guildData.vouchRole
                        )
                        : null;

                return safeReply(
                    message,
                    baseEmbed(
                        "Vouch Role",
                        role
                            ? `Current role: ${role}`
                            : "No vouch role is configured."
                    )
                );
            }

            // ------------------------------------------------
            // GIVE
            // ------------------------------------------------

            if (sub === "give") {
                if (
                    !requireRank(
                        message,
                        "staff"
                    )
                ) return;

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vouch give @user reason`"
                        )
                    );
                }

                const role =
                    guildData.vouchRole
                        ? message.guild.roles.cache.get(
                            guildData.vouchRole
                        )
                        : null;

                if (!role) {
                    return safeReply(
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
                                !x.includes(
                                    ">"
                                )
                        )
                        .join(" ")
                        .trim() ||
                    "No reason provided";

                if (!guildData.vouches[target.id]) {
                    guildData.vouches[
                        target.id
                    ] = [];
                }

                guildData.vouches[
                    target.id
                ].push({
                    by: message.author.id,
                    reason,
                    timestamp: Date.now()
                });

                try {
                    if (
                        !target.roles.cache.has(
                            role.id
                        )
                    ) {
                        await target.roles.add(
                            role,
                            "VC+ vouch"
                        );
                    }
                } catch (error) {
                    console.error(
                        "[VC+] Vouch role error:",
                        error.message
                    );
                }

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Vouch Added",
                        `${target} received a vouch.\n\nRole: ${role}\nReason: ${reason}`
                    )
                );
            }

            // ------------------------------------------------
            // CLEAR
            // ------------------------------------------------

            if (sub === "clear") {
                if (
                    !requireRank(
                        message,
                        "admin"
                    )
                ) return;

                const targetArg =
                    args[0]?.toLowerCase();

                const role =
                    guildData.vouchRole
                        ? message.guild.roles.cache.get(
                            guildData.vouchRole
                        )
                        : null;

                // EVERYONE
                if (
                    targetArg ===
                    "everyone"
                ) {
                    const affectedUsers =
                        new Set(
                            Object.keys(
                                guildData.vouches
                            )
                        );

                    if (role) {
                        for (
                            const guildMember
                            of message.guild.members.cache.values()
                        ) {
                            if (
                                guildMember.roles.cache.has(
                                    role.id
                                )
                            ) {
                                affectedUsers.add(
                                    guildMember.id
                                );
                            }
                        }
                    }

                    let cleared = 0;

                    for (
                        const userId
                        of affectedUsers
                    ) {
                        delete guildData.vouches[
                            userId
                        ];

                        const guildMember =
                            message.guild.members.cache.get(
                                userId
                            );

                        if (
                            role &&
                            guildMember?.roles.cache.has(
                                role.id
                            )
                        ) {
                            try {
                                await guildMember.roles.remove(
                                    role,
                                    "VC+ vouches cleared"
                                );
                            } catch (error) {
                                console.error(
                                    "[VC+] Vouch role removal error:",
                                    error.message
                                );
                            }
                        }

                        cleared++;
                    }

                    saveDatabase();

                    return safeReply(
                        message,
                        successEmbed(
                            "Vouches Cleared",
                            `Cleared vouches and removed the configured vouch role from ${cleared} affected user(s).`
                        )
                    );
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vouch clear @user` or `-vouch clear everyone`"
                        )
                    );
                }

                delete guildData.vouches[
                    target.id
                ];

                if (
                    role &&
                    target.roles.cache.has(
                        role.id
                    )
                ) {
                    try {
                        await target.roles.remove(
                            role,
                            "VC+ vouches cleared"
                        );
                    } catch (error) {
                        console.error(
                            "[VC+] Vouch removal error:",
                            error.message
                        );
                    }
                }

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Vouches Cleared",
                        `${target}'s vouches were cleared and the configured vouch role was removed.`
                    )
                );
            }

            // ------------------------------------------------
            // LIST
            // ------------------------------------------------

            if (sub === "list") {
                const entries =
                    Object.entries(
                        guildData.vouches
                    );

                if (!entries.length) {
                    return safeReply(
                        message,
                        baseEmbed(
                            "Vouch List",
                            "There are no stored vouches."
                        )
                    );
                }

                const lines = entries.map(
                    ([userId, vouches]) =>
                        `<@${userId}> — ${vouches.length} vouch(es)`
                );

                return safeReply(
                    message,
                    baseEmbed(
                        "Vouch List",
                        lines.join("\n").slice(
                            0,
                            4000
                        )
                    )
                );
            }

            return safeReply(
                message,
                errorEmbed(
                    "Unknown vouch command."
                )
            );
        }

        // ====================================================
        // VOUCHES
        // ====================================================

        if (command === "vouches") {
            const target =
                message.mentions.members.first() ||
                message.member;

            const count =
                guildData.vouches[
                    target.id
                ]?.length || 0;

            return safeReply(
                message,
                baseEmbed(
                    "Vouches",
                    `${target} has ${count} vouch(es).`
                )
            );
        }

        // ====================================================
        // FILTER
        // ====================================================

        if (command === "filter") {
            if (!requireRank(message, "admin")) return;

            const sub =
                args.shift()?.toLowerCase();

            if (sub === "add") {
                const word =
                    args.join(" ").trim();

                if (!word) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-filter add word`"
                        )
                    );
                }

                const normalized =
                    word.toLowerCase();

                if (
                    !guildData.filters.includes(
                        normalized
                    )
                ) {
                    guildData.filters.push(
                        normalized
                    );
                }

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Filter Added",
                        `Added \`${word}\` to the filter.`
                    )
                );
            }

            if (sub === "remove") {
                const word =
                    args.join(" ").trim();

                guildData.filters =
                    guildData.filters.filter(
                        item =>
                            item.toLowerCase() !==
                            word.toLowerCase()
                    );

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Filter Removed",
                        `Removed \`${word}\` from the filter.`
                    )
                );
            }

            return safeReply(
                message,
                baseEmbed(
                    "Filter",
                    guildData.filters.length
                        ? guildData.filters
                            .map(
                                word =>
                                    `\`${word}\``
                            )
                            .join("\n")
                        : "No filter words are configured."
                )
            );
        }

        // ====================================================
        // VC COMMANDS
        // ====================================================

        if (command === "vc") {
            const sub =
                args.shift()?.toLowerCase();

            // ------------------------------------------------
            // SETUP
            // ------------------------------------------------

            if (sub === "setup") {
                if (
                    !requireRank(
                        message,
                        "admin"
                    )
                ) return;

                const existing =
                    message.guild.channels.cache.find(
                        channel =>
                            channel.type ===
                                ChannelType.GuildVoice &&
                            channel.name ===
                                "Create VC"
                    );

                if (existing) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "VC+ Join-to-Create is already configured."
                        )
                    );
                }

                try {
                    const category =
                        await message.guild.channels.create({
                            name: "VC+ Voice",
                            type: ChannelType.GuildCategory
                        });

                    const createChannel =
                        await message.guild.channels.create({
                            name: "Create VC",
                            type: ChannelType.GuildVoice,
                            parent: category.id
                        });

                    guildData.jtcCategory =
                        category.id;

                    guildData.jtcChannel =
                        createChannel.id;

                    saveDatabase();

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Setup Complete",
                            `Join ${createChannel} to create your temporary VC.`
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] VC setup error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not create the VC+ setup. Check my Manage Channels permission."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // CURRENT VC
            // ------------------------------------------------

            const voice =
                message.member?.voice?.channel;

            if (!voice) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You must be inside your VC+ temporary voice channel."
                    )
                );
            }

            const temp =
                guildData.temporaryVCs[
                    voice.id
                ];

            if (!temp) {
                return safeReply(
                    message,
                    errorEmbed(
                        "This is not a VC+ temporary voice channel."
                    )
                );
            }

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

            if (
                !isOwner &&
                !isGod
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can manage this VC."
                    )
                );
            }

            // ------------------------------------------------
            // KICK
            // ------------------------------------------------

            if (sub === "kick") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc kick @user`"
                        )
                    );
                }

                try {
                    await target.voice.disconnect(
                        "VC+ VC kick"
                    );

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Kick",
                            `${target} was removed from the VC.`
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] VC kick error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not disconnect that member."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // DISCONNECT
            // ------------------------------------------------

            if (sub === "disconnect") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
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

                    return safeReply(
                        message,
                        successEmbed(
                            "Disconnected",
                            `${target} was disconnected from the VC.`
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Disconnect error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not disconnect that member."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // BAN
            // ------------------------------------------------

            if (sub === "ban") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc ban @user`"
                        )
                    );
                }

                if (!temp.banned) {
                    temp.banned = [];
                }

                if (
                    !temp.banned.includes(
                        target.id
                    )
                ) {
                    temp.banned.push(
                        target.id
                    );
                }

                try {
                    if (
                        target.voice.channelId ===
                        voice.id
                    ) {
                        await target.voice.disconnect(
                            "VC+ VC ban"
                        );
                    }
                } catch {}

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "VC Ban",
                        `${target} is banned from this temporary VC.`
                    )
                );
            }

            // ------------------------------------------------
            // REJECT
            // ------------------------------------------------

            if (sub === "reject") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc reject @user`"
                        )
                    );
                }

                if (!temp.rejected) {
                    temp.rejected = [];
                }

                if (
                    !temp.rejected.includes(
                        target.id
                    )
                ) {
                    temp.rejected.push(
                        target.id
                    );
                }

                try {
                    if (
                        target.voice.channelId ===
                        voice.id
                    ) {
                        await target.voice.disconnect(
                            "VC+ rejected"
                        );
                    }
                } catch {}

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "VC Reject",
                        `${target} has been rejected from this temporary VC.`
                    )
                );
            }

            // ------------------------------------------------
            // PERMIT
            // ------------------------------------------------

            if (sub === "permit") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc permit @user`"
                        )
                    );
                }

                temp.banned =
                    (temp.banned || [])
                        .filter(
                            id =>
                                id !== target.id
                        );

                temp.rejected =
                    (temp.rejected || [])
                        .filter(
                            id =>
                                id !== target.id
                        );

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "VC Permit",
                        `${target} can join this temporary VC again.`
                    )
                );
            }

            // ------------------------------------------------
            // LOCK
            // ------------------------------------------------

            if (sub === "lock") {
                try {
                    await voice.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    temp.locked = true;

                    saveDatabase();

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Locked",
                            "Your temporary VC is now locked."
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Lock error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not lock this VC."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // UNLOCK
            // ------------------------------------------------

            if (sub === "unlock") {
                try {
                    await voice.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    temp.locked = false;

                    saveDatabase();

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Unlocked",
                            "Your temporary VC is now unlocked."
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Unlock error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not unlock this VC."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // LIMIT
            // ------------------------------------------------

            if (sub === "limit") {
                const limit =
                    Number(args[0]);

                if (
                    !Number.isInteger(limit) ||
                    limit < 0 ||
                    limit > 99
                ) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "The limit must be between 0 and 99."
                        )
                    );
                }

                try {
                    await voice.setUserLimit(
                        limit
                    );

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Limit",
                            `The VC limit is now ${limit === 0 ? "unlimited" : limit}.`
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Limit error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not change the VC limit."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // RENAME
            // ------------------------------------------------

            if (sub === "rename") {
                const name =
                    args.join(" ").trim();

                if (!name) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc rename New Name`"
                        )
                    );
                }

                try {
                    await voice.setName(
                        name.slice(0, 100)
                    );

                    return safeReply(
                        message,
                        successEmbed(
                            "VC Renamed",
                            `The VC is now named ${name.slice(0, 100)}.`
                        )
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Rename error:",
                        error.message
                    );

                    return safeReply(
                        message,
                        errorEmbed(
                            "I could not rename the VC."
                        )
                    );
                }
            }

            // ------------------------------------------------
            // TRANSFER
            // ------------------------------------------------

            if (sub === "transfer") {
                if (!isOwner) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Only the current VC owner can transfer ownership."
                        )
                    );
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc transfer @user`"
                        )
                    );
                }

                temp.owner =
                    target.id;

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "Ownership Transferred",
                        `${target} is now the owner of this VC.`
                    )
                );
            }

            // ------------------------------------------------
            // CLAIM
            // ------------------------------------------------

            if (sub === "claim") {
                if (
                    voice.members.has(
                        temp.owner
                    )
                ) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "The current VC owner is still in the channel."
                        )
                    );
                }

                temp.owner =
                    message.author.id;

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "VC Claimed",
                        `${message.author} now owns this VC.`
                    )
                );
            }

            // ------------------------------------------------
            // FORCECLAIM
            // ------------------------------------------------

            if (sub === "forceclaim") {
                if (!isGod) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "You need God rank or VC+ Godmode to force-claim a VC."
                        )
                    );
                }

                temp.owner =
                    message.author.id;

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "VC Force Claimed",
                        `${message.author} now owns this VC.`
                    )
                );
            }

            // ------------------------------------------------
            // STFU
            // ------------------------------------------------

            if (sub === "stfu") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc stfu @user`"
                        )
                    );
                }

                if (!temp.stfu) {
                    temp.stfu = [];
                }

                if (
                    !temp.stfu.includes(
                        target.id
                    )
                ) {
                    temp.stfu.push(
                        target.id
                    );
                }

                try {
                    if (
                        target.voice.channelId ===
                        voice.id
                    ) {
                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        );
                    }
                } catch (error) {
                    console.error(
                        "[VC+] STFU error:",
                        error.message
                    );
                }

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "STFU Enabled",
                        `${target} is now persistently muted in this VC.`
                    )
                );
            }

            // ------------------------------------------------
            // UNSTFU
            // ------------------------------------------------

            if (sub === "unstfu") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return safeReply(
                        message,
                        errorEmbed(
                            "Usage: `-vc unstfu @user`"
                        )
                    );
                }

                temp.stfu =
                    (temp.stfu || [])
                        .filter(
                            id =>
                                id !== target.id
                        );

                try {
                    if (
                        target.voice.channelId ===
                        voice.id
                    ) {
                        await target.voice.setMute(
                            false,
                            "VC+ UnSTFU"
                        );
                    }
                } catch (error) {
                    console.error(
                        "[VC+] UnSTFU error:",
                        error.message
                    );
                }

                saveDatabase();

                return safeReply(
                    message,
                    successEmbed(
                        "STFU Removed",
                        `${target} can unmute normally again.`
                    )
                );
            }

            return safeReply(
                message,
                errorEmbed(
                    "Unknown VC command. Use `-help`."
                )
            );
        }

        // ====================================================
        // INTERFACE
        // ====================================================

        if (command === "interface") {
            const voice =
                message.member?.voice?.channel;

            if (!voice) {
                return safeReply(
                    message,
                    errorEmbed(
                        "You must be inside your VC+ temporary VC first."
                    )
                );
            }

            const temp =
                guildData.temporaryVCs[
                    voice.id
                ];

            if (!temp) {
                return safeReply(
                    message,
                    errorEmbed(
                        "This is not a VC+ temporary voice channel."
                    )
                );
            }

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

            if (
                !isOwner &&
                !isGod
            ) {
                return safeReply(
                    message,
                    errorEmbed(
                        "Only the VC owner or VC+ Godmode can use the interface."
                    )
                );
            }

            guildData.interfaceChannel =
                message.channel.id;

            saveDatabase();

            const interfaceEmbed =
                new EmbedBuilder()
                    .setTitle(
                        "VC+  •  Voice Control"
                    )
                    .setDescription(
                        [
                            `Channel: ${voice}`,
                            `Owner: <@${temp.owner}>`,
                            `Members: ${voice.members.size}`,
                            `Status: ${temp.locked ? "Locked" : "Unlocked"}`,
                            "",
                            "Use the buttons below to control your temporary VC."
                        ].join("\n")
                    )
                    .setColor(0x5865f2)
                    .setFooter({
                        text:
                            "VC+ Voice Control"
                    })
                    .setTimestamp();

            const row1 =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_lock"
                            )
                            .setLabel("Lock")
                            .setStyle(
                                ButtonStyle.Secondary
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_unlock"
                            )
                            .setLabel("Unlock")
                            .setStyle(
                                ButtonStyle.Success
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_claim"
                            )
                            .setLabel("Claim")
                            .setStyle(
                                ButtonStyle.Primary
                            )
                    );

            const row2 =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_limit"
                            )
                            .setLabel("Limit")
                            .setStyle(
                                ButtonStyle.Secondary
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_rename"
                            )
                            .setLabel("Rename")
                            .setStyle(
                                ButtonStyle.Secondary
                            ),

                        new ButtonBuilder()
                            .setCustomId(
                                "vcplus_interface_refresh"
                            )
                            .setLabel("Refresh")
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            try {
                await message.channel.send({
                    embeds: [
                        interfaceEmbed
                    ],
                    components: [
                        row1,
                        row2
                    ]
                });

                return safeReply(
                    message,
                    successEmbed(
                        "Interface Created",
                        `The VC+ interface was placed in ${message.channel}.`
                    )
                );
            } catch (error) {
                console.error(
                    "[VC+] Interface error:",
                    error.message
                );

                return safeReply(
                    message,
                    errorEmbed(
                        "I could not send the interface in this channel. Check Send Messages and Embed Links permissions."
                    )
                );
            }
        }

    } catch (error) {
        console.error(
            "[VC+] Message handler error:",
            error
        );

        await safeReply(
            message,
            errorEmbed(
                "VC+ encountered an error while processing that command."
            )
        );
    }
});

// ============================================================
// VOICE STATE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild;

            if (!guild) return;

            const data =
                getGuildData(guild.id);

            // =================================================
            // JOIN TO CREATE
            // =================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    data.jtcChannel
            ) {
                const category =
                    guild.channels.cache.get(
                        data.jtcCategory
                    );

                if (!category) return;

                try {
                    const channel =
                        await guild.channels.create({
                            name:
                                `${newState.member.user.username}'s VC`,
                            type:
                                ChannelType.GuildVoice,
                            parent:
                                category.id
                        });

                    data.temporaryVCs[
                        channel.id
                    ] = {
                        owner:
                            newState.member.id,
                        locked: false,
                        banned: [],
                        rejected: [],
                        stfu: []
                    };

                    saveDatabase();

                    try {
                        await newState.setChannel(
                            channel
                        );
                    } catch (error) {
                        console.error(
                            "[VC+] Move to created VC error:",
                            error.message
                        );
                    }
                } catch (error) {
                    console.error(
                        "[VC+] JTC creation error:",
                        error.message
                    );
                }
            }

            // =================================================
            // ACCESS CHECK
            // =================================================

            if (newState.channelId) {
                const temp =
                    data.temporaryVCs[
                        newState.channelId
                    ];

                if (!temp) return;

                if (
                    temp.banned?.includes(
                        newState.member.id
                    ) ||
                    temp.rejected?.includes(
                        newState.member.id
                    )
                ) {
                    try {
                        await newState.disconnect(
                            "VC+ access denied"
                        );
                    } catch {}
                    return;
                }

                // Persistent STFU
                if (
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
            }

            // =================================================
            // DELETE EMPTY VC
            // =================================================

            if (
                oldState.channelId &&
                data.temporaryVCs[
                    oldState.channelId
                ]
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    oldChannel.members.size === 0
                ) {
                    delete data.temporaryVCs[
                        oldState.channelId
                    ];

                    saveDatabase();

                    try {
                        await oldChannel.delete(
                            "VC+ temporary VC empty"
                        );
                    } catch (error) {
                        console.error(
                            "[VC+] Temporary VC delete error:",
                            error.message
                        );
                    }
                }
            }

        } catch (error) {
            console.error(
                "[VC+] Voice state error:",
                error
            );
        }
    }
);

// ============================================================
// BUTTON INTERACTIONS
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (!interaction.isButton()) {
                return;
            }

            // =================================================
            // HELP PANEL
            // =================================================

            if (
                interaction.customId.startsWith(
                    "vcplus_help_"
                )
            ) {
                let page = 0;

                const footer =
                    interaction
                        .message
                        .embeds[0]
                        ?.footer
                        ?.text || "";

                const match =
                    footer.match(
                        /Page (\d+)/
                    );

                if (match) {
                    page =
                        Number(match[1]) - 1;
                }

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

                try {
                    await interaction.update({
                        embeds: [
                            createHelpEmbed(
                                page
                            )
                        ],
                        components: [
                            createHelpButtons(
                                page
                            )
                        ]
                    });
                } catch (error) {
                    console.error(
                        "[VC+] Help interaction error:",
                        error.message
                    );
                }

                return;
            }

            // =================================================
            // VC INTERFACE
            // =================================================

            const interfaceButtons = [
                "vcplus_interface_lock",
                "vcplus_interface_unlock",
                "vcplus_interface_claim",
                "vcplus_interface_limit",
                "vcplus_interface_rename",
                "vcplus_interface_refresh"
            ];

            if (
                !interfaceButtons.includes(
                    interaction.customId
                )
            ) {
                return;
            }

            const guild =
                interaction.guild;

            if (!guild) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                "This can only be used inside a server."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            const data =
                getGuildData(guild.id);

            const voice =
                interaction.member
                    ?.voice
                    ?.channel;

            if (!voice) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                "You must be inside your VC+ temporary VC."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            const temp =
                data.temporaryVCs[
                    voice.id
                ];

            if (!temp) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                "This is no longer a VC+ temporary VC."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            const isOwner =
                temp.owner ===
                interaction.user.id;

            const isGod =
                data.godmode.includes(
                    interaction.user.id
                ) ||
                hasRank(
                    guild,
                    interaction.user.id,
                    "god"
                );

            if (
                !isOwner &&
                !isGod
            ) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            errorEmbed(
                                "Only the VC owner or VC+ Godmode can use this interface."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            // =================================================
            // LOCK
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_lock"
            ) {
                try {
                    await voice.permissionOverwrites.edit(
                        guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    temp.locked = true;

                    saveDatabase();

                    return safeInteractionReply(
                        interaction,
                        {
                            embeds: [
                                successEmbed(
                                    "VC Locked",
                                    "The temporary VC is now locked."
                                )
                            ],
                            ephemeral: true
                        }
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Interface lock error:",
                        error.message
                    );

                    return safeInteractionReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    "I could not lock this VC."
                                )
                            ],
                            ephemeral: true
                        }
                    );
                }
            }

            // =================================================
            // UNLOCK
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_unlock"
            ) {
                try {
                    await voice.permissionOverwrites.edit(
                        guild.roles.everyone,
                        {
                            Connect: null
                        }
                    );

                    temp.locked = false;

                    saveDatabase();

                    return safeInteractionReply(
                        interaction,
                        {
                            embeds: [
                                successEmbed(
                                    "VC Unlocked",
                                    "The temporary VC is now unlocked."
                                )
                            ],
                            ephemeral: true
                        }
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Interface unlock error:",
                        error.message
                    );

                    return safeInteractionReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    "I could not unlock this VC."
                                )
                            ],
                            ephemeral: true
                        }
                    );
                }
            }

            // =================================================
            // CLAIM
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_claim"
            ) {
                if (
                    voice.members.has(
                        temp.owner
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        {
                            embeds: [
                                errorEmbed(
                                    "The current owner is still inside the VC."
                                )
                            ],
                            ephemeral: true
                        }
                    );
                }

                temp.owner =
                    interaction.user.id;

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            successEmbed(
                                "VC Claimed",
                                `${interaction.user} now owns this VC.`
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            // =================================================
            // LIMIT
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_limit"
            ) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            baseEmbed(
                                "VC Limit",
                                "Use `-vc limit 5` to set the maximum number of members."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            // =================================================
            // RENAME
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_rename"
            ) {
                return safeInteractionReply(
                    interaction,
                    {
                        embeds: [
                            baseEmbed(
                                "VC Rename",
                                "Use `-vc rename New Name` to rename the temporary VC."
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            // =================================================
            // REFRESH
            // =================================================

            if (
                interaction.customId ===
                "vcplus_interface_refresh"
            ) {
                const updatedEmbed =
                    new EmbedBuilder()
                        .setTitle(
                            "VC+  •  Voice Control"
                        )
                        .setDescription(
                            [
                                `Channel: ${voice}`,
                                `Owner: <@${temp.owner}>`,
                                `Members: ${voice.members.size}`,
                                `Status: ${temp.locked ? "Locked" : "Unlocked"}`,
                                "",
                                "Use the buttons below to control your temporary VC."
                            ].join("\n")
                        )
                        .setColor(0x5865f2)
                        .setFooter({
                            text:
                                "VC+ Voice Control"
                        })
                        .setTimestamp();

                try {
                    await interaction.update({
                        embeds: [
                            updatedEmbed
                        ]
                    });
                } catch (error) {
                    console.error(
                        "[VC+] Interface refresh error:",
                        error.message
                    );
                }

                return;
            }

        } catch (error) {
            console.error(
                "[VC+] Interaction handler error:",
                error
            );

            await safeInteractionReply(
                interaction,
                {
                    embeds: [
                        errorEmbed(
                            "VC+ encountered an error while processing that button."
                        )
                    ],
                    ephemeral: true
                }
            );
        }
    }
);

// ============================================================
// FOREVER BAN CHECK
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                !data.foreverBans.includes(
                    member.id
                )
            ) {
                return;
            }

            try {
                await member.ban({
                    reason:
                        "VC+ permanent ban list"
                });
            } catch (error) {
                console.error(
                    "[VC+] Forever ban enforcement error:",
                    error.message
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Guild member add error:",
                error
            );
        }
    }
);

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
    }
);

// ============================================================
// LOGIN
// ============================================================

if (!process.env.TOKEN) {
    console.error(
        "[VC+] TOKEN is missing from .env"
    );

    process.exit(1);
}

client.login(
    process.env.TOKEN
)
    .then(() => {
        console.log(
            "[VC+] Login successful."
        );
    })
    .catch(error => {
        console.error(
            "[VC+] Login failed:",
            error.message
        );

        process.exit(1);
    });
