import {
    ChannelType,
    PermissionFlagsBits
} from 'discord.js';

import {
    getJoinToCreateConfig,
    updateJoinToCreateConfig
} from '../utils/database.js';

import { logger } from '../utils/logger.js';

export async function handleJoinToCreate(oldState, newState, client) {
    try {
        // User didn't actually change voice channels
        if (oldState.channelId === newState.channelId) return;

        const guild = newState.guild;

        if (!guild) return;

        const member = newState.member;

        if (!member) return;

        const config = await getJoinToCreateConfig(client, guild.id);

        if (!config) return;

        if (config.enabled === false) return;

        const triggerChannels = Array.isArray(config.triggerChannels)
            ? config.triggerChannels
            : [];

        // User didn't join a trigger channel
        if (!newState.channelId || !triggerChannels.includes(newState.channelId)) {
            await cleanupEmptyChannel(oldState, config, client);
            return;
        }

        const triggerChannel = newState.channel;

        if (!triggerChannel) return;

        // Prevent duplicate channels
        const temporaryChannels = config.temporaryChannels || {};

        if (temporaryChannels[member.id]) {
            const existing = guild.channels.cache.get(
                temporaryChannels[member.id]
            );

            if (existing) {
                await member.voice.setChannel(existing).catch(() => {});
                return;
            }

            delete temporaryChannels[member.id];

            await updateJoinToCreateConfig(client, guild.id, {
                temporaryChannels
            });
        }

        const channelOptions =
            config.channelOptions?.[triggerChannel.id] || {};

        const nameTemplate =
            channelOptions.nameTemplate ||
            config.channelNameTemplate ||
            '{username}\'s Room';

        const userLimit =
            channelOptions.userLimit ??
            config.userLimit ??
            0;

        const bitrate =
            channelOptions.bitrate ??
            config.bitrate ??
            64000;

        const categoryId =
            channelOptions.categoryId ||
            config.categoryId ||
            triggerChannel.parentId;

        const channelName = formatChannelName(
            nameTemplate,
            member,
            guild
        );

        const permissionOverwrites = [
            {
                id: guild.roles.everyone.id,
                deny: [
                    PermissionFlagsBits.Connect
                ]
            },
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.Stream
                ]
            }
        ];

        const tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,

            parent: categoryId || null,

            userLimit: Math.max(
                0,
                Math.min(99, Number(userLimit) || 0)
            ),

            bitrate: Math.max(
                8000,
                Math.min(384000, Number(bitrate) || 64000)
            ),

            permissionOverwrites
        });

        // Save temporary channel
        temporaryChannels[member.id] = tempChannel.id;

        await updateJoinToCreateConfig(client, guild.id, {
            temporaryChannels
        });

        // Move member
        try {
            await member.voice.setChannel(tempChannel);
        } catch (error) {
            logger.error(
                `Failed to move ${member.user.tag} to JTC channel:`,
                error
            );

            await tempChannel.delete().catch(() => {});

            delete temporaryChannels[member.id];

            await updateJoinToCreateConfig(client, guild.id, {
                temporaryChannels
            });

            return;
        }

        logger.info(
            `Created JTC channel ${tempChannel.name} for ${member.user.tag}`
        );

    } catch (error) {
        logger.error(
            'Join-to-Create error:',
            error
        );
    }
}

async function cleanupEmptyChannel(oldState, config, client) {
    try {
        if (!oldState?.channelId) return;

        const channel = oldState.channel;

        if (!channel) return;

        if (channel.type !== ChannelType.GuildVoice) return;

        const temporaryChannels = config.temporaryChannels || {};

        const entry = Object.entries(temporaryChannels)
            .find(([, channelId]) => channelId === channel.id);

        if (!entry) return;

        // Still has people inside
        if (channel.members.size > 0) return;

        const [ownerId] = entry;

        delete temporaryChannels[ownerId];

        await updateJoinToCreateConfig(client, oldState.guild.id, {
            temporaryChannels
        });

        await channel.delete(
            'Join-to-Create channel became empty'
        ).catch(() => {});

        logger.info(
            `Deleted empty JTC channel ${channel.id}`
        );

    } catch (error) {
        logger.error(
            'JTC cleanup error:',
            error
        );
    }
}

function formatChannelName(template, member, guild) {
    return template
        .replaceAll(
            '{username}',
            member.user.username
        )
        .replaceAll(
            '{display_name}',
            member.displayName
        )
        .replaceAll(
            '{user_tag}',
            member.user.tag
        )
        .replaceAll(
            '{guild_name}',
            guild.name
        )
        .slice(0, 100);
}
