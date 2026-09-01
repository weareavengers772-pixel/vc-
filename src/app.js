import {
    Client,
    GatewayIntentBits,
    Partials,
    Collection
} from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    db,
    initializeDatabase,
    pgDb
} from './utils/database.js';

import { logger } from './utils/logger.js';
import { BotConfig } from './config/bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

client.commands = new Collection();
client.db = db;

/* =========================
   ERROR HANDLING
========================= */

process.on('unhandledRejection', error => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    logger.error('Uncaught exception:', error);
});

client.on('error', error => {
    logger.error('Discord client error:', error);
});

client.on('shardError', error => {
    logger.error('Discord shard error:', error);
});

/* =========================
   LOAD COMMANDS
========================= */

async function loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');

    if (!fs.existsSync(commandsPath)) {
        logger.warn('Commands folder does not exist:', commandsPath);
        return;
    }

    const files = fs
        .readdirSync(commandsPath)
        .filter(file => file.endsWith('.js'));

    for (const file of files) {
        try {
            const filePath = path.join(commandsPath, file);
            const command = await import(pathToFileURL(filePath).href);

            const cmd = command.default || command;

            if (!cmd?.data?.name || typeof cmd.execute !== 'function') {
                logger.warn(`Skipping invalid command: ${file}`);
                continue;
            }

            client.commands.set(cmd.data.name, cmd);

            logger.info(`Loaded command: ${cmd.data.name}`);
        } catch (error) {
            logger.error(`Failed to load command ${file}:`, error);
        }
    }

    logger.info(`Loaded ${client.commands.size} command(s).`);
}

/* =========================
   READY
========================= */

client.once('ready', async () => {
    try {
        logger.info(`Logged in as ${client.user.tag}`);
        logger.info(
            `Connected to ${client.guilds.cache.size} server(s)`
        );

        try {
            await initializeDatabase();
            logger.info('Database initialized.');
        } catch (error) {
            logger.error('Database initialization failed:', error);
        }

        try {
            const status =
                BotConfig?.presence?.status || 'online';

            const activity =
                BotConfig?.presence?.activity || null;

            client.user.setPresence({
                status,
                activities: activity
                    ? [
                        {
                            name: activity,
                            type: 0
                        }
                    ]
                    : []
            });
        } catch (error) {
            logger.warn('Presence error:', error);
        }

        logger.info('Bot is ready.');
    } catch (error) {
        logger.error('Ready event error:', error);
    }
});

/* =========================
   GUILD EVENTS
========================= */

client.on('guildCreate', guild => {
    logger.info(
        `Joined guild: ${guild.name} (${guild.id})`
    );
});

client.on('guildDelete', guild => {
    logger.info(
        `Left guild: ${guild.name} (${guild.id})`
    );
});

/* =========================
   VOICE / JTC
========================= */

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const { handleJoinToCreate } =
            await import('./events/joinToCreate.js');

        if (typeof handleJoinToCreate === 'function') {
            await handleJoinToCreate(
                oldState,
                newState,
                client
            );
        }
    } catch (error) {
        logger.error('Voice state error:', error);
    }
});

/* =========================
   INTERACTIONS
========================= */

client.on('interactionCreate', async interaction => {
    try {
        /* COMMANDS */
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(
                interaction.commandName
            );

            if (!command) {
                logger.warn(
                    `Command not found: ${interaction.commandName}`
                );

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Command not found.',
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
                    `Command error: ${interaction.commandName}`,
                    error
                );

                const response = {
                    content:
                        '❌ Something went wrong while running this command.',
                    ephemeral: true
                };

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {
                    await interaction.editReply(
                        response
                    ).catch(() => {});
                } else {
                    await interaction.reply(
                        response
                    ).catch(() => {});
                }
            }

            return;
        }

        /* BUTTONS */
        if (interaction.isButton()) {
            logger.info(
                `Button pressed: ${interaction.customId}`
            );

            return;
        }

        /* SELECT MENUS */
        if (interaction.isStringSelectMenu()) {
            logger.info(
                `Select menu used: ${interaction.customId}`
            );

            return;
        }

        /* MODALS */
        if (interaction.isModalSubmit()) {
            logger.info(
                `Modal submitted: ${interaction.customId}`
            );

            return;
        }

    } catch (error) {
        logger.error(
            'Interaction error:',
            error
        );
    }
});

/* =========================
   LOGIN
========================= */

async function startBot() {
    try {
        await loadCommands();

        const token =
            process.env.DISCORD_TOKEN ||
            process.env.BOT_TOKEN ||
            BotConfig?.token;

        if (!token) {
            throw new Error(
                'Missing Discord bot token. Set DISCORD_TOKEN or BOT_TOKEN.'
            );
        }

        logger.info('Starting bot...');

        await client.login(token);

    } catch (error) {
        logger.error(
            'Failed to start bot:',
            error
        );

        setTimeout(() => {
            process.exit(1);
        }, 1000);
    }
}

/* =========================
   SHUTDOWN
========================= */

async function shutdown(signal) {
    try {
        logger.info(`${signal} received. Shutting down...`);

        if (
            pgDb &&
            typeof pgDb.close === 'function'
        ) {
            await pgDb.close().catch(error => {
                logger.error(
                    'Database shutdown error:',
                    error
                );
            });
        }

        client.destroy();

        process.exit(0);

    } catch (error) {
        logger.error(
            'Shutdown error:',
            error
        );

        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* =========================
   START
========================= */

startBot();
