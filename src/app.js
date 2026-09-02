// ============================================================
// VC+ — CRASH-SAFE BOOTSTRAP
// ============================================================

import {
    Client,
    GatewayIntentBits,
    Partials
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("[VC+] DISCORD_TOKEN is missing.");
    process.exit(1);
}

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
// GLOBAL ERROR PROTECTION
// ============================================================

process.on("unhandledRejection", error => {
    console.error("[VC+] Unhandled Promise Rejection:", error);
});

process.on("uncaughtException", error => {
    console.error("[VC+] Uncaught Exception:", error);

    // Do NOT immediately kill the process.
    // Logging the error lets the bot continue when possible.
});

process.on("warning", warning => {
    console.warn("[VC+] Node Warning:", warning);
});

process.on("SIGINT", async () => {
    console.log("[VC+] Shutdown requested.");

    try {
        client.destroy();
    } catch (error) {
        console.error("[VC+] Shutdown error:", error);
    }

    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("[VC+] SIGTERM received.");

    try {
        client.destroy();
    } catch (error) {
        console.error("[VC+] Shutdown error:", error);
    }

    process.exit(0);
});

// ============================================================
// DISCORD CLIENT ERROR PROTECTION
// ============================================================

client.on("error", error => {
    console.error("[VC+] Discord client error:", error);
});

client.on("warn", warning => {
    console.warn("[VC+] Discord warning:", warning);
});

client.on("shardError", error => {
    console.error("[VC+] Shard error:", error);
});

client.on("shardReconnecting", shardId => {
    console.log(`[VC+] Shard ${shardId} reconnecting...`);
});

client.on("shardResume", (shardId, replayedEvents) => {
    console.log(
        `[VC+] Shard ${shardId} resumed. Replayed ${replayedEvents} events.`
    );
});

client.on("shardDisconnect", (event, shardId) => {
    console.warn(
        `[VC+] Shard ${shardId} disconnected.`,
        event
    );
});

// ============================================================
// SAFE EXECUTOR
// ============================================================

async function safeExecute(fn, label = "operation") {
    try {
        return await fn();
    } catch (error) {
        console.error(`[VC+] ${label} failed:`, error);
        return null;
    }
}

// ============================================================
// SAFE MESSAGE REPLY
// ============================================================

async function safeReply(message, payload) {
    try {
        if (!message) return null;

        return await message.reply(payload);
    } catch (error) {
        console.error("[VC+] Failed to reply:", error);
        return null;
    }
}

// ============================================================
// SAFE INTERACTION REPLY
// ============================================================

async function safeInteractionReply(interaction, payload) {
    try {
        if (!interaction) return;

        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp(payload);
        }

        return await interaction.reply(payload);
    } catch (error) {
        console.error(
            "[VC+] Failed to respond to interaction:",
            error
        );
    }
}

// ============================================================
// SAFE DELETE
// ============================================================

async function safeDelete(message) {
    try {
        if (!message) return false;

        if (!message.deletable) {
            return false;
        }

        await message.delete();
        return true;
    } catch (error) {
        console.warn(
            "[VC+] Could not delete message:",
            error.message
        );

        return false;
    }
}

// ============================================================
// SAFE CHANNEL DELETE
// ============================================================

async function safeChannelDelete(channel, reason) {
    try {
        if (!channel) return false;

        await channel.delete(reason);
        return true;
    } catch (error) {
        console.warn(
            "[VC+] Could not delete channel:",
            error.message
        );

        return false;
    }
}

// ============================================================
// SAFE MEMBER ACTION
// ============================================================

async function safeMemberAction(action, member, label) {
    try {
        if (!member) return false;

        if (!member.manageable) {
            console.warn(
                `[VC+] Cannot manage member for ${label}.`
            );

            return false;
        }

        await action(member);

        return true;
    } catch (error) {
        console.warn(
            `[VC+] ${label} failed:`,
            error.message
        );

        return false;
    }
}

// ============================================================
// SAFE VOICE ACTION
// ============================================================

async function safeVoiceAction(action, member, label) {
    try {
        if (!member) return false;

        if (!member.voice) {
            return false;
        }

        await action(member.voice);

        return true;
    } catch (error) {
        console.warn(
            `[VC+] Voice action "${label}" failed:`,
            error.message
        );

        return false;
    }
}

// ============================================================
// COMMAND COOLDOWN
// ============================================================

const cooldowns = new Map();

const COMMAND_COOLDOWN = 750;

function isOnCooldown(userId, command) {
    const key = `${userId}:${command}`;
    const now = Date.now();

    const lastUsed = cooldowns.get(key);

    if (
        lastUsed &&
        now - lastUsed < COMMAND_COOLDOWN
    ) {
        return true;
    }

    cooldowns.set(key, now);

    return false;
}

// Clean old cooldowns periodically.
setInterval(() => {
    const now = Date.now();

    for (const [key, timestamp] of cooldowns) {
        if (now - timestamp > 60000) {
            cooldowns.delete(key);
        }
    }
}, 60000).unref();

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on("messageCreate", async message => {
    try {
        // Never process bots.
        if (!message) return;
        if (message.author?.bot) return;

        // Only guild messages.
        if (!message.guild) return;

        const PREFIX = "-";

        if (!message.content?.startsWith(PREFIX)) {
            return;
        }

        const input = message.content
            .slice(PREFIX.length)
            .trim();

        if (!input) return;

        const parts = input.split(/\s+/);

        const command = parts
            .shift()
            ?.toLowerCase();

        if (!command) return;

        // Prevent accidental command spam.
        if (
            isOnCooldown(
                message.author.id,
                command
            )
        ) {
            return;
        }

        // ====================================================
        // COMMAND ROUTER
        // ====================================================

        switch (command) {

            case "help":
                await safeExecute(
                    () => handleHelp(message, parts),
                    "help command"
                );
                break;

            case "ping":
                await safeExecute(
                    () => handlePing(message),
                    "ping command"
                );
                break;

            case "ban":
                await safeExecute(
                    () => handleBan(message, parts),
                    "ban command"
                );
                break;

            case "unban":
                await safeExecute(
                    () => handleUnban(message, parts),
                    "unban command"
                );
                break;

            case "unbanall":
                await safeExecute(
                    () => handleUnbanAll(message),
                    "unbanall command"
                );
                break;

            case "kick":
                await safeExecute(
                    () => handleKick(message, parts),
                    "kick command"
                );
                break;

            case "timeout":
                await safeExecute(
                    () => handleTimeout(message, parts),
                    "timeout command"
                );
                break;

            case "untimeout":
                await safeExecute(
                    () => handleUntimeout(message),
                    "untimeout command"
                );
                break;

            case "purge":
            case "clear":
                await safeExecute(
                    () => handlePurge(message, parts),
                    "purge command"
                );
                break;

            case "rank":
                await safeExecute(
                    () => handleRank(message, parts),
                    "rank command"
                );
                break;

            case "ranklist":
                await safeExecute(
                    () => handleRankList(message),
                    "ranklist command"
                );
                break;

            case "godmode":
                await safeExecute(
                    () => handleGodmode(message, parts),
                    "godmode command"
                );
                break;

            case "vouch":
            case "vouches":
                await safeExecute(
                    () => handleVouch(message, parts),
                    "vouch command"
                );
                break;

            case "filter":
                await safeExecute(
                    () => handleFilter(message, parts),
                    "filter command"
                );
                break;

            case "vc":
                await safeExecute(
                    () => handleVC(message, parts),
                    "vc command"
                );
                break;

            case "interface":
                await safeExecute(
                    () => handleInterface(message),
                    "interface command"
                );
                break;

            default:
                await safeReply(message, {
                    embeds: [
                        {
                            title: "VC+  •  Error",
                            description:
                                `Unknown command: \`${PREFIX}${command}\`\n\nUse \`${PREFIX}help\` to see all commands.`,
                            color: 0x111111
                        }
                    ]
                });
        }

    } catch (error) {
        console.error(
            "[VC+] Message handler crashed:",
            error
        );

        await safeReply(message, {
            embeds: [
                {
                    title: "VC+  •  Error",
                    description:
                        "Something went wrong while processing that command.",
                    color: 0x111111
                }
            ]
        });
    }
});

// ============================================================
// BUTTON HANDLER
// ============================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) {
            return;
        }

        if (
            !interaction.customId.startsWith(
                "vc_help_"
            )
        ) {
            return;
        }

        await safeExecute(
            async () => {
                // Put your help-page button logic here.
                await handleHelpButtons(interaction);
            },
            "help button"
        );

    } catch (error) {
        console.error(
            "[VC+] Interaction handler crashed:",
            error
        );

        await safeInteractionReply(
            interaction,
            {
                embeds: [
                    {
                        title: "VC+  •  Error",
                        description:
                            "This interaction could not be completed.",
                        color: 0x111111
                    }
                ],
                ephemeral: true
            }
        );
    }
});

// ============================================================
// VOICE STATE HANDLER
// ============================================================

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        if (!newState?.guild) return;

        await safeExecute(
            async () => {
                await handleVoiceState(
                    oldState,
                    newState
                );
            },
            "voice state update"
        );

    } catch (error) {
        console.error(
            "[VC+] Voice handler crashed:",
            error
        );
    }
});

// ============================================================
// MEMBER JOIN HANDLER
// ============================================================

client.on("guildMemberAdd", async member => {
    try {
        if (!member?.guild) return;

        await safeExecute(
            async () => {
                await handleMemberJoin(member);
            },
            "member join"
        );

    } catch (error) {
        console.error(
            "[VC+] Member join handler crashed:",
            error
        );
    }
});

// ============================================================
// READY
// ============================================================

client.once("ready", () => {
    console.log(
        `[VC+] Logged in as ${client.user.tag}`
    );

    try {
        client.user.setPresence({
            activities: [
                {
                    name: "-help",
                    type: 0
                }
            ],
            status: "online"
        });
    } catch (error) {
        console.error(
            "[VC+] Presence error:",
            error
        );
    }
});

// ============================================================
// RECONNECT WATCHDOG
// ============================================================

let lastReady = Date.now();

client.on("ready", () => {
    lastReady = Date.now();
});

setInterval(() => {
    try {
        if (!client.isReady()) {
            console.warn(
                "[VC+] Client is not ready. Discord.js will handle reconnection."
            );
            return;
        }

        const seconds =
            Math.floor(
                (Date.now() - lastReady) / 1000
            );

        if (seconds > 3600) {
            console.log(
                "[VC+] Bot has remained connected for over an hour."
            );
        }

    } catch (error) {
        console.error(
            "[VC+] Watchdog error:",
            error
        );
    }
}, 60000).unref();

// ============================================================
// LOGIN
// ============================================================

async function startBot() {
    try {
        console.log("[VC+] Starting...");

        await client.login(TOKEN);

    } catch (error) {
        console.error(
            "[VC+] Login failed:",
            error
        );

        // Login failure should not cause an endless crash loop.
        process.exitCode = 1;
    }
}

startBot();

// ============================================================
// PLACEHOLDER HANDLERS
// ============================================================
//
// Keep your existing VC+ command implementations inside these
// functions. The router above makes sure one broken command does
// not take down the entire bot.
//

async function handleHelp(message, args) {
    // Existing -help code
}

async function handlePing(message) {
    await safeReply(message, {
        embeds: [
            {
                title: "VC+  •  Ping",
                description:
                    `Latency: **${client.ws.ping}ms**`,
                color: 0x111111
            }
        ]
    });
}

async function handleBan(message, args) {
    // Existing -ban code
}

async function handleUnban(message, args) {
    // Existing -unban code
}

async function handleUnbanAll(message) {
    // Existing -unbanall code
}

async function handleKick(message, args) {
    // Existing -kick code
}

async function handleTimeout(message, args) {
    // Existing -timeout code
}

async function handleUntimeout(message) {
    // Existing -untimeout code
}

async function handlePurge(message, args) {
    // Existing -purge / -clear code
}

async function handleRank(message, args) {
    // Existing rank system
}

async function handleRankList(message) {
    // Existing ranklist
}

async function handleGodmode(message, args) {
    // Existing godmode
}

async function handleVouch(message, args) {
    // Existing vouch system
}

async function handleFilter(message, args) {
    // Existing filter system
}

async function handleVC(message, args) {
    // Existing VC system
}

async function handleInterface(message) {
    // Existing interface system
}

async function handleHelpButtons(interaction) {
    // Existing paginated help buttons
}

async function handleVoiceState(oldState, newState) {
    // Existing Join-To-Create system
}

async function handleMemberJoin(member) {
    // Existing forever-ban enforcement
}
