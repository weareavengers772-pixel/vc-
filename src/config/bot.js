import {
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from "discord.js";

const setups = new Map();
const userChannels = new Map();

export default {
  name: "vc",
  description: "Voice channel commands",

  async execute(message, args, client) {
    if (!message.guild) return;

    const subcommand = args[0]?.toLowerCase();

    if (subcommand === "setup") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply("❌ You need **Manage Server** permission.");
      }

      // Prevent duplicate setups
      if (setups.has(message.guild.id)) {
        const setup = setups.get(message.guild.id);

        const existing = message.guild.channels.cache.get(setup.triggerId);

        if (existing) {
          return message.reply(
            `❌ VC system is already set up.\n\nJoin ${existing} to create your own VC.`
          );
        }

        setups.delete(message.guild.id);
      }

      try {
        // Create category
        const category = await message.guild.channels.create({
          name: "VOICE CHANNELS",
          type: ChannelType.GuildCategory,
        });

        // Create trigger channel
        const trigger = await message.guild.channels.create({
          name: "➕・Create VC",
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 1,
        });

        setups.set(message.guild.id, {
          categoryId: category.id,
          triggerId: trigger.id,
        });

        const embed = new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("✅ Voice System Setup")
          .setDescription(
            `Your VC system has been set up automatically.\n\n` +
            `**Join:** ${trigger}\n` +
            `**Category:** ${category.name}\n\n` +
            `When someone joins the channel, their own VC will automatically be created.`
          )
          .setFooter({
            text: "Titan Bot",
          });

        return message.reply({
          embeds: [embed],
        });
      } catch (error) {
        console.error("VC setup error:", error);

        return message.reply(
          "❌ I couldn't create the VC system. Make sure I have **Manage Channels** permission."
        );
      }
    }

    if (subcommand === "help") {
      return message.reply(
        "**VC Commands**\n\n" +
        "`-vc setup` — Automatically set up the VC system\n" +
        "`-vc help` — Show VC commands"
      );
    }

    return message.reply(
      "❌ Unknown VC command. Use `-vc help`."
    );
  },

  // =========================
  // VOICE EVENT HANDLER
  // =========================

  async handleVoiceState(oldState, newState) {
    const guild = newState.guild;

    if (!guild) return;

    const setup = setups.get(guild.id);

    if (!setup) return;

    // =========================
    // USER JOINS CREATE CHANNEL
    // =========================

    if (
      newState.channelId === setup.triggerId &&
      oldState.channelId !== setup.triggerId
    ) {
      try {
        const member = newState.member;

        if (!member) return;

        const category = guild.channels.cache.get(setup.categoryId);

        if (!category) return;

        const channel = await guild.channels.create({
          name: `🔊・${member.user.username}'s VC`,
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 0,

          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
              ],
            },

            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.ManageChannels,
              ],
            },
          ],
        });

        userChannels.set(member.id, channel.id);

        await member.voice.setChannel(channel).catch(() => {});

      } catch (error) {
        console.error("VC creation error:", error);
      }
    }

    // =========================
    // DELETE EMPTY VC
    // =========================

    if (oldState.channelId) {
      const createdChannelId = oldState.channelId;

      const createdChannel = guild.channels.cache.get(createdChannelId);

      if (!createdChannel) return;

      // Never delete the trigger
      if (createdChannelId === setup.triggerId) return;

      // Only delete channels created by this system
      const isCreatedChannel = [...userChannels.values()].includes(
        createdChannelId
      );

      if (!isCreatedChannel) return;

      if (createdChannel.members.size === 0) {
        try {
          await createdChannel.delete("Empty temporary VC");

          for (const [userId, channelId] of userChannels.entries()) {
            if (channelId === createdChannelId) {
              userChannels.delete(userId);
            }
          }
        } catch (error) {
          console.error("VC deletion error:", error);
        }
      }
    }
  },
};
