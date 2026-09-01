```js
import {
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";

export default {
  name: "vc",
  aliases: ["voice", "jtc"],
  description: "Voice channel setup commands",
  category: "JoinToCreate",

  async execute(message, args, client) {
    if (!message.guild) return;

    // -vc setup
    if (args[0]?.toLowerCase() === "setup") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply("❌ You need **Manage Channels** to use this.");
      }

      try {
        // Check if one already exists
        const existing = message.guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildVoice &&
            channel.name === "Join to Create"
        );

        if (existing) {
          return message.reply(
            `❌ Join to Create is already set up: ${existing}`
          );
        }

        // Create category
        let category = message.guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === "VOICE CHANNELS"
        );

        if (!category) {
          category = await message.guild.channels.create({
            name: "VOICE CHANNELS",
            type: ChannelType.GuildCategory,
          });
        }

        // Create Join to Create channel
        const trigger = await message.guild.channels.create({
          name: "Join to Create",
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: [
            {
              id: message.guild.roles.everyone.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
              ],
            },
          ],
        });

        return message.reply(
          `✅ **Join to Create setup complete!**\n\n` +
          `🔊 Join channel: ${trigger}\n` +
          `📁 Category: **${category.name}**\n\n` +
          `When someone joins **Join to Create**, your bot can create a temporary voice channel for them.`
        );
      } catch (error) {
        console.error("VC setup error:", error);

        return message.reply(
          "❌ I couldn't set up Join to Create. Make sure I have **Manage Channels** permission."
        );
      }
    }

    // -vc
    return message.reply(
      "🔊 **Voice Commands**\n\n" +
      "`-vc setup` — Set up Join to Create\n" +
      "`-vc help` — Show voice commands"
    );
  },
};
```
