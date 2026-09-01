// src/app.js

import {
    Client,
    GatewayIntentBits,
    Partials,
    Collection
} from 'discord.js';

import {
    db,
    initializeDatabase,
    pgDb
} from './utils/database.js';

import { logger } from './utils/logger.js';
import { BotConfig } from './config/bot.js';

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
        GatewayIntentBits.GuildMessageReactions
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
        Partials.Reaction
    ]
});

// ============================================================
// COMMAND COLLECTION
// ============================================================

client.commands = new Collection();

// Make database available through client
client.db = db;

// ============================================================
// ERROR PROTECTION
// ============================================================

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
});

process.on('warning', (warning) => {
    logger.warn('Node warning:', warning);
});

// Discord client errors
client.on('error', (error) => {
    logger.error('Discord client error:', error);
});

client.on('shardError', (error) => {
    logger.error('Discord shard error:', error);
});

// ============================================================
// READY
// ============================================================

client.once('ready', async () => {
    try {
        logger.info(`Logged in as ${client.user.tag}`);

        logger.info(
            `Connected to ${client.guilds.cache.size} server(s)`
        );

        // Database initialization
        try {
            await initializeDatabase();
            logger.info('Database initialized successfully.');
        } catch (error) {
            logger.error(
                'Database initialization failed:',
                error
            );
        }

        // Presence
        try {
            const status =
                BotConfig?.presence?.status ||
                'online';

            const activity =
                BotConfig?.presence?.activity ||
                null;

            client.user.setPresence({
                status,
                activities: activity
                    ? [{
                        name: activity,
                        type: 0
                    }]
                    : []
            });
        } catch (error) {
            logger.warn(
                'Could not set bot presence:',
                error
            );
        }

        logger.info('Bot is ready.');
    } catch (error) {
        logger.error(
            'Ready event error:',
            error
        );
    }
});

// ============================================================
// GUILD JOIN
// ============================================================

client.on('guildCreate', async (guild) => {
    try {
        logger.info(
            `Joined guild: ${guild.name} (${guild.id})`
        );
    } catch (error) {
        logger.error(
            'Guild create handler error:',
            error
        );
    }
});

// ============================================================
// GUILD LEAVE
// ============================================================

client.on('guildDelete', async (guild) => {
    try {
        logger.info(
            `Left guild: ${guild.name} (${guild.id})`
        );
    } catch (error) {
        logger.error(
            'Guild delete handler error:',
            error
        );
    }
});

// ============================================================
// MESSAGE PROTECTION
// ============================================================

client.on('messageCreate', async (message) => {
    try {
        if (!message || message.author?.bot) {
            return;
        }

        // Your command/event handlers can be loaded here.
        // Example:
        //
        // await handleMessage(message, client);

    } catch (error) {
        logger.error(
            'messageCreate error:',
            error
        );
    }
});

// ============================================================
// VOICE / JOIN TO CREATE
// ============================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const {
                handleJoinToCreate
            } = await import(
                './events/joinToCreate.js'
            );

            if (
                typeof handleJoinToCreate === 'function'
            ) {
                await handleJoinToCreate(
                    oldState,
                    newState,
                    client
                );
            }
        } catch (error) {
            logger.error(
                'voiceStateUpdate error:',
                error
            );
        }
    }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
    'interactionCreate',
    async (interaction) => {
        try {
            if (!interaction) {
                return;
            }

            if (interaction.isChatInputCommand()) {
                const command =
                    client.commands.get(
                        interaction.commandName
                    );

                if (!command) {
                    logger.warn(
                        `Unknown command: ${interaction.commandName}`
                    );

                    if (!interaction.replied) {
                        await interaction.reply({
                            content:
                                '❌ Command not found.',
                            ephemeral: true
                        }).catch(() => {});
                    }

                    return;
                }

                try {
                    await command.execute(
                        interaction,
                        client
                    );
                } catch (error) {
                    logger.error(
                        `Command error (${interaction.commandName}):`,
                        error
                    );

                    if (
                        interaction.replied ||
                        interaction.deferred
                    ) {
                        await interaction.editReply({
                            content:
                                '❌ Something went wrong while running that command.'
                        }).catch(() => {});
                    } else {
                        await interaction.reply({
                            content:
                                '❌ Something went wrong while running that command.',
                            ephemeral: true
                        }).catch(() => {});
                    }
                }

                return;
            }

            // Buttons
            if (interaction.isButton()) {
                try {
                    // Button handlers can go here.
                } catch (error) {
                    logger.error(
                        'Button interaction error:',
                        error
                    );
                }

                return;
            }

            // Select menus
            if (interaction.isStringSelectMenu()) {
                try {
                    // Select menu handlers can go here.
                } catch (error) {
                    logger.error(
                        'Select menu error:',
                        error
                    );
                }

                return;
            }

            // Modals
            if (interaction.isModalSubmit()) {
                try {
                    // Modal handlers can go here.
                } catch (error) {
                    logger.error(
                        'Modal interaction error:',
                        error
                    );
                }
            }

        } catch (error) {
            logger.error(
                'interactionCreate error:',
                error
            );
        }
    }
);

// ============================================================
// LOGIN
// ============================================================

async function startBot() {
    try {
        const token =
            process.env.DISCORD_TOKEN ||
            process.env.BOT_TOKEN ||
            BotConfig?.token;

        if (!token) {
            throw new Error(
                'Discord bot token is missing. Set DISCORD_TOKEN in your environment variables.'
            );
        }

        logger.info('Starting bot...');

        await client.login(token);

    } catch (error) {
        logger.error(
            'Failed to start Discord bot:',
            error
        );

        // Give the logger time to write before exiting.
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    try {
        logger.info(
            `${signal} received. Shutting down...`
        );

        try {
            if (
                pgDb &&
                typeof pgDb.close === 'function'
            ) {
                await pgDb.close();
            }
        } catch (error) {
            logger.error(
                'Database shutdown error:',
                error
            );
        }

        try {
            client.destroy();
        } catch (error) {
            logger.error(
                'Discord shutdown error:',
                error
            );
        }

        process.exit(0);

    } catch (error) {
        logger.error(
            'Shutdown error:',
            error
        );

        process.exit(1);
    }
}

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

// ============================================================
// START
// ============================================================

startBot();
