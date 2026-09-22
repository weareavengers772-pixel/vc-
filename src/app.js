from pathlib import Path
import zipfile, json, textwrap

root = Path("/mnt/data/vcplus")
(root / "data").mkdir(parents=True, exist_ok=True)

package_json = {
    "name": "vc-plus",
    "version": "1.0.0",
    "type": "module",
    "main": "index.js",
    "scripts": {"start": "node index.js"},
    "dependencies": {"discord.js": "^14.24.2", "dotenv": "^17.2.2"}
}

env_example = "DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE\n"

index_js = r'''import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent
} from "discord.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREFIX = "-";
const BOT_NAME = "VC+";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.User]
});

const COLORS = {
  black: 0x111111,
  dark: 0x181818,
  success: 0x202020,
  warning: 0x202020,
  error: 0x202020
};

let db = { guilds: {} };

function blankGuild() {
  return {
    vcCategoryId: null,
    joinToCreateId: null,
    vouchRoleId: null,
    vouchRoleLimit: null,
    vouchGiveLimit: null,
    vouches: [],
    ranks: {},
    godmode: [],
    stfu: [],
    tempVCs: {},
    vcBans: {}
  };
}

function loadDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      saveDB();
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && typeof parsed === "object") db = parsed;
    if (!db.guilds || typeof db.guilds !== "object") db.guilds = {};
  } catch (e) {
    console.error("[VC+ DATABASE LOAD ERROR]", e);
    db = { guilds: {} };
  }
}

function saveDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("[VC+ DATABASE SAVE ERROR]", e);
  }
}

function guildData(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = blankGuild();
  const d = db.guilds[guildId];
  for (const [k, v] of Object.entries(blankGuild())) {
    if (d[k] === undefined) d[k] = Array.isArray(v) ? [] : v;
  }
  return d;
}

function makeBox(title, description = "", icon = "•") {
  return new EmbedBuilder()
    .setColor(COLORS.black)
    .setTitle(`${icon}  ${title}`)
    .setDescription(description)
    .setFooter({ text: "VC+" });
}

function ok(title, description) {
  return makeBox(title, description, "✓");
}

function warn(title, description) {
  return makeBox(title, description, "⚠");
}

function fail(title, description) {
  return makeBox(title, description, "⚠");
}

async function reply(message, embed, components = []) {
  try {
    return await message.reply({
      embeds: [embed],
      components,
      allowedMentions: { repliedUser: false }
    });
  } catch (e) {
    console.error("[VC+ REPLY ERROR]", e);
  }
}

function owner(message) {
  return message.guild?.ownerId === message.author.id;
}

function rankOf(guildId, userId) {
  return guildData(guildId).ranks[userId] || "Member";
}

function rankLevel(rank) {
  return {
    Member: 1,
    Trusted: 2,
    Moderator: 3,
    Admin: 4,
    God: 5,
    Founder: 6
  }[rank] || 1;
}

function isFounder(message) {
  return owner(message) || rankOf(message.guild.id, message.author.id) === "Founder";
}

function canModerate(message) {
  return owner(message) ||
    rankLevel(rankOf(message.guild.id, message.author.id)) >= 4 ||
    message.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function canManage(message) {
  return owner(message) ||
    rankLevel(rankOf(message.guild.id, message.author.id)) >= 3 ||
    message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    message.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function mentionUser(message) {
  return message.mentions.members.first() || null;
}

function mentionRole(message) {
  return message.mentions.roles.first() || null;
}

function tempVC(guild, channelId) {
  return guildData(guild.id).tempVCs[channelId] || null;
}

function ownedVC(guild, userId) {
  const d = guildData(guild.id);
  for (const [channelId, info] of Object.entries(d.tempVCs)) {
    if (info.ownerId === userId) return guild.channels.cache.get(channelId) || null;
  }
  return null;
}

function userOwnsCurrentVC(message) {
  const channel = message.member.voice.channel;
  if (!channel) return null;
  const info = tempVC(message.guild, channel.id);
  if (!info) return null;
  if (info.ownerId !== message.author.id) return null;
  return channel;
}

async function requireVC(message) {
  const channel = userOwnsCurrentVC(message);
  if (!channel) {
    await reply(message, fail("VC+", "You don't own this voice channel."));
    return null;
  }
  return channel;
}

function vcPanelEmbed(channel, page = 0) {
  const pages = [
    {
      title: "VoiceMaster Interface",
      text:
        `**${channel?.name || "Voice Channel"}**\n\n` +
        "Use the controls below to manage your voice channel with ease."
    },
    {
      title: "VoiceMaster Members",
      text:
        `**${channel?.members.size || 0} members**\n\n` +
        "Use the buttons to manage members in your voice channel."
    },
    {
      title: "VoiceMaster Access",
      text:
        "Manage who can enter or remain in your voice channel.\n\n" +
        "Permit and reject users with the controls below."
    },
    {
      title: "VoiceMaster Security",
      text:
        "Lock, hide, ban and manage your temporary voice channel."
    }
  ];
  return new EmbedBuilder()
    .setColor(COLORS.black)
    .setTitle(`VoiceMaster Interface  •  ${page + 1}/4`)
    .setDescription(`${pages[page].text}\n\n━━━━━━━━━━━━━━━━━━━━`)
    .setFooter({ text: "VC+" });
}

function vcPanelRows(page = 0) {
  if (page !== 0) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("vc_lock").setLabel("Lock").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("vc_unlock").setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("vc_hide").setLabel("Ghost").setEmoji("👁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("vc_unhide").setLabel("Unghost").setEmoji("👁").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("vc_prev").setLabel("Back").setEmoji("◀").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("vc_next").setLabel("Next").setEmoji("▶").setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vc_lock").setLabel("Lock").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_unlock").setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_hide").setLabel("Ghost").setEmoji("👁").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_unhide").setLabel("Unghost").setStyle(ButtonStyle.Secondary).setEmoji("👁")
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vc_kick").setLabel("Kick").setEmoji("✕").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_ban").setLabel("Ban").setEmoji("🚫").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_permit").setLabel("Permit").setEmoji("👤").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_claim").setLabel("Claim").setEmoji("👑").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_limit").setLabel("Limit").setEmoji("👥").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vc_prev").setLabel("Back").setEmoji("◀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vc_next").setLabel("Next").setEmoji("▶").setStyle(ButtonStyle.Secondary)
    )
  ];
}

const helpPages = [
  ["VOICE", [
    "-vc setup",
    "-vc lock",
    "-vc unlock",
    "-vc hide",
    "-vc unhide",
    "-vc kick @user",
    "-vc ban @user",
    "-vc unban @user",
    "-vc permit @user",
    "-vc reject @user",
    "-vc claim",
    "-vc limit <number>"
  ]],
  ["VOUCH", [
    "-vouch @user",
    "-vouch role set @role",
    "-vouch role reset",
    "-vouch role limit <number>",
    "-vouch limit set <number>",
    "-vouch limit",
    "-vouch list",
    "-vouch clear @user",
    "-vouch clearall"
  ]],
  ["RANKING", [
    "-rank @user <rank>",
    "-rank @user",
    "-rank remove @user",
    "Founder",
    "God",
    "Admin",
    "Moderator",
    "Trusted",
    "Member"
  ]],
  ["SECURITY", [
    "-timeout @user 10m",
    "-untimeout @user",
    "-ban @user",
    "-unban @user",
    "-unbanall",
    "-kick @user"
  ]],
  ["SPECIAL", [
    "-vc stfu @user",
    "-vc unstfu @user",
    "-godmode @user",
    "",
    "Founder only:",
    "stfu / unstfu / unbanall"
  ]]
];

function helpEmbed(page) {
  const [name, commands] = helpPages[page];
  return new EmbedBuilder()
    .setColor(COLORS.black)
    .setTitle(`VC+  •  ${page + 1}/5`)
    .setDescription(`**${name}**\n\n${commands.map(x => x ? `\`${x}\`` : "").join("\n")}`)
    .setFooter({ text: "VC+" });
}

function helpRows(page) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("help_prev").setLabel("Back").setEmoji("◀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("help_page").setLabel(`${page + 1}/5`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("help_next").setLabel("Next").setEmoji("▶").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function setupVC(message) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  const d = guildData(message.guild.id);

  try {
    let category = d.vcCategoryId ? message.guild.channels.cache.get(d.vcCategoryId) : null;
    if (!category) {
      category = await message.guild.channels.create({
        name: "VC+",
        type: ChannelType.GuildCategory
      });
      d.vcCategoryId = category.id;
    }

    let join = d.joinToCreateId ? message.guild.channels.cache.get(d.joinToCreateId) : null;
    if (!join) {
      join = await message.guild.channels.create({
        name: "🔊 Join to Create",
        type: ChannelType.GuildVoice,
        parent: category.id
      });
      d.joinToCreateId = join.id;
    }

    saveDB();
    return reply(message, ok("VC+ Setup", `VoiceMaster is ready.\n\n${join} is now the Join to Create channel.`));
  } catch (e) {
    console.error("[VC+ SETUP ERROR]", e);
    return reply(message, fail("VC+ Setup", "I could not finish setup. Check my Manage Channels permission."));
  }
}

async function createTempVC(oldState) {
  const guild = oldState.guild;
  const d = guildData(guild.id);
  if (!d.joinToCreateId || oldState.channelId !== d.joinToCreateId) return;

  try {
    const category = d.vcCategoryId ? guild.channels.cache.get(d.vcCategoryId) : null;
    const channel = await guild.channels.create({
      name: `${oldState.member.displayName}'s VC`,
      type: ChannelType.GuildVoice,
      parent: category?.id || null
    });

    d.tempVCs[channel.id] = {
      ownerId: oldState.member.id,
      locked: false,
      hidden: false,
      limit: 0,
      permitted: [],
      banned: []
    };
    saveDB();

    await oldState.setChannel(channel).catch(() => {});
  } catch (e) {
    console.error("[VC+ CREATE VC ERROR]", e);
  }
}

async function cleanupEmptyVC(channel) {
  const d = guildData(channel.guild.id);
  const info = d.tempVCs[channel.id];
  if (!info) return;

  if (channel.members.size === 0) {
    delete d.tempVCs[channel.id];
    delete d.vcBans[channel.id];
    saveDB();
    await channel.delete("VC+ temporary channel cleanup").catch(() => {});
  }
}

async function setVCState(message, action) {
  const channel = await requireVC(message);
  if (!channel) return;
  const d = guildData(message.guild.id);
  const info = d.tempVCs[channel.id];

  try {
    if (action === "lock" || action === "unlock") {
      info.locked = action === "lock";
      await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        Connect: !info.locked
      });
      saveDB();
      return reply(message, ok(action === "lock" ? "Voice Locked" : "Voice Unlocked",
        action === "lock" ? "Your voice channel is now locked." : "Your voice channel is now unlocked."));
    }

    if (action === "hide" || action === "unhide") {
      info.hidden = action === "hide";
      await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        ViewChannel: !info.hidden
      });
      saveDB();
      return reply(message, ok(action === "hide" ? "Voice Hidden" : "Voice Visible",
        action === "hide" ? "Your voice channel is now hidden." : "Your voice channel is now visible."));
    }
  } catch (e) {
    console.error("[VC+ STATE ERROR]", e);
    return reply(message, fail("VC+", "I couldn't change this voice channel."));
  }
}

async function vcMemberAction(message, action, target) {
  const channel = await requireVC(message);
  if (!channel) return;
  if (!target) return reply(message, fail("VC+", "Mention a valid user."));

  const d = guildData(message.guild.id);
  const info = d.tempVCs[channel.id];

  try {
    if (action === "kick") {
      if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ owner kick");
      return reply(message, ok("Member Kicked", `${target} was disconnected from your voice channel.`));
    }

    if (action === "ban") {
      if (!info.banned) info.banned = [];
      if (!info.banned.includes(target.id)) info.banned.push(target.id);
      if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ voice ban");
      await channel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
      saveDB();
      return reply(message, ok("Member Banned", `${target} is now banned from your voice channel.`));
    }

    if (action === "unban") {
      if (!info.banned) info.banned = [];
      info.banned = info.banned.filter(id => id !== target.id);
      await channel.permissionOverwrites.delete(target.id).catch(() => {});
      saveDB();
      return reply(message, ok("Member Unbanned", `${target} can enter your voice channel again.`));
    }

    if (action === "permit") {
      if (!info.permitted) info.permitted = [];
      if (!info.permitted.includes(target.id)) info.permitted.push(target.id);
      await channel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true });
      saveDB();
      return reply(message, ok("Member Permitted", `${target} can enter your voice channel.`));
    }

    if (action === "reject") {
      if (!info.permitted) info.permitted = [];
      info.permitted = info.permitted.filter(id => id !== target.id);
      await channel.permissionOverwrites.delete(target.id).catch(() => {});
      saveDB();
      return reply(message, ok("Member Rejected", `${target} no longer has a personal permit.`));
    }
  } catch (e) {
    console.error("[VC+ MEMBER ACTION ERROR]", e);
    return reply(message, fail("VC+", "I couldn't complete that voice action."));
  }
}

async function claimVC(message) {
  const channel = message.member.voice.channel;
  if (!channel) return reply(message, fail("VC+", "Join a temporary voice channel first."));
  const d = guildData(message.guild.id);
  const info = d.tempVCs[channel.id];
  if (!info) return reply(message, fail("VC+", "This isn't a VC+ temporary channel."));
  if (info.ownerId === message.author.id) return reply(message, warn("VC+", "You already own this voice channel."));

  const ownerMember = await message.guild.members.fetch(info.ownerId).catch(() => null);
  if (ownerMember?.voice.channelId === channel.id) {
    return reply(message, fail("VC+", "The current owner is still in this voice channel."));
  }

  info.ownerId = message.author.id;
  saveDB();
  return reply(message, ok("Voice Claimed", "You are now the owner of this voice channel."));
}

async function setLimit(message, amount) {
  const channel = await requireVC(message);
  if (!channel) return;
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 0 || n > 99) return reply(message, fail("VC+", "Use a number from 0 to 99."));
  await channel.setUserLimit(n);
  guildData(message.guild.id).tempVCs[channel.id].limit = n;
  saveDB();
  return reply(message, ok("User Limit", `Voice limit set to **${n === 0 ? "unlimited" : n}**.`));
}

async function vouchRoleSet(message, role) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  if (!role) return reply(message, fail("Vouch", "Mention a valid role."));
  const d = guildData(message.guild.id);
  d.vouchRoleId = role.id;
  saveDB();
  return reply(message, ok("Vouch Role", `${role} is now the official vouch role.`));
}

async function vouchRoleReset(message) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  const d = guildData(message.guild.id);
  d.vouchRoleId = null;
  saveDB();
  return reply(message, ok("Vouch Role", "The configured vouch role has been removed."));
}

async function vouchRoleLimit(message, value) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  const d = guildData(message.guild.id);
  if (String(value).toLowerCase() === "off") {
    d.vouchRoleLimit = null;
  } else {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return reply(message, fail("Vouch", "Enter a whole number above 0 or `off`."));
    d.vouchRoleLimit = n;
    while (d.vouches.length > n) {
      const removed = d.vouches.pop();
      const m = await message.guild.members.fetch(removed.userId).catch(() => null);
      const role = d.vouchRoleId ? message.guild.roles.cache.get(d.vouchRoleId) : null;
      if (m && role) await m.roles.remove(role).catch(() => {});
    }
  }
  saveDB();
  return reply(message, ok("Vouch Role Limit", `Maximum role holders: **${d.vouchRoleLimit ?? "unlimited"}**.`));
}

async function giveVouch(message, target) {
  const d = guildData(message.guild.id);
  const role = d.vouchRoleId ? message.guild.roles.cache.get(d.vouchRoleId) : null;
  if (!role) return reply(message, fail("Vouch", "No vouch role is configured."));
  if (!target) return reply(message, fail("Vouch", "Mention a valid user."));
  if (d.vouches.some(v => v.userId === target.id)) return reply(message, warn("Vouch", `${target} is already vouched.`));
  if (d.vouchRoleLimit !== null && d.vouches.length >= d.vouchRoleLimit) {
    return reply(message, fail("Vouch", `The vouch role limit of **${d.vouchRoleLimit}** has been reached.`));
  }
  if (d.vouchGiveLimit !== null) {
    const given = d.vouches.filter(v => v.byId === message.author.id).length;
    if (given >= d.vouchGiveLimit) return reply(message, fail("Vouch", `You have reached your vouch limit of **${d.vouchGiveLimit}**.`));
  }

  try {
    await target.roles.add(role, "VC+ vouch");
    d.vouches.push({ userId: target.id, byId: message.author.id, at: Date.now() });
    saveDB();
    return reply(message, ok("Vouch", `${target} was vouched.\n\nVouch role  •  Added`));
  } catch (e) {
    console.error("[VC+ VOUCH ERROR]", e);
    return reply(message, fail("Vouch", "I couldn't add the vouch role. Check my role position."));
  }
}

async function clearVouch(message, target) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  if (!target) return reply(message, fail("Vouch", "Mention a valid user."));
  const d = guildData(message.guild.id);
  d.vouches = d.vouches.filter(v => v.userId !== target.id);
  const role = d.vouchRoleId ? message.guild.roles.cache.get(d.vouchRoleId) : null;
  if (role) await target.roles.remove(role, "VC+ vouch cleared").catch(() => {});
  saveDB();
  return reply(message, ok("Vouch", `${target}'s vouch has been cleared.`));
}

async function clearAllVouches(message) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to use this command."));
  const d = guildData(message.guild.id);
  const role = d.vouchRoleId ? message.guild.roles.cache.get(d.vouchRoleId) : null;
  let count = 0;
  if (role) {
    for (const v of d.vouches) {
      const m = await message.guild.members.fetch(v.userId).catch(() => null);
      if (m) {
        await m.roles.remove(role, "VC+ clearall").catch(() => {});
        count++;
      }
    }
  }
  d.vouches = [];
  saveDB();
  return reply(message, ok("Vouch", `All recorded vouches were cleared.\n\nRemoved  •  ${count}`));
}

async function vouchList(message) {
  const d = guildData(message.guild.id);
  if (!d.vouches.length) return reply(message, makeBox("Vouch", "No recorded vouches."));
  const lines = [];
  for (const v of d.vouches.slice(0, 30)) {
    const m = message.guild.members.cache.get(v.userId);
    lines.push(`${m ? m.user : `<@${v.userId}>`}  •  <@${v.byId}>`);
  }
  return reply(message, makeBox("Vouch List", lines.join("\n")));
}

const VALID_RANKS = ["Founder", "God", "Admin", "Moderator", "Trusted", "Member"];

async function rankCommand(message, args) {
  if (args.length === 0) return reply(message, makeBox("Rank", `Your rank  •  **${rankOf(message.guild.id, message.author.id)}**`));
  const target = mentionUser(message);
  if (!target) return reply(message, fail("Rank", "Mention a valid user."));
  const d = guildData(message.guild.id);

  if (args.length === 1 || (args.length === 2 && args[0].startsWith("<@"))) {
    const r = rankOf(message.guild.id, target.id);
    const v = d.vouches.filter(x => x.userId === target.id).length;
    const g = d.godmode.includes(target.id) ? "On" : "Off";
    return reply(message, makeBox(target.user.username, `Rank       ${r}\nVouches   ${v}\nGodmode  ${g}`, "★"));
  }

  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to assign ranks."));
  const requested = args[1] ? args[1].replace(/[^a-zA-Z]/g, "") : "";
  const rank = VALID_RANKS.find(r => r.toLowerCase() === requested.toLowerCase());
  if (!rank) return reply(message, fail("Rank", `Valid ranks: ${VALID_RANKS.join(", ")}`));

  if (rank === "Founder" && !owner(message)) return reply(message, fail("Rank", "Only the server owner can assign Founder."));
  d.ranks[target.id] = rank;
  saveDB();
  return reply(message, makeBox("Rank", `${target}\n${rank}`, "★"));
}

async function rankRemove(message, target) {
  if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to remove ranks."));
  if (!target) return reply(message, fail("Rank", "Mention a valid user."));
  delete guildData(message.guild.id).ranks[target.id];
  saveDB();
  return reply(message, ok("Rank", `${target}'s custom rank was removed.`));
}

async function stfu(message, target, enabled) {
  if (!isFounder(message)) return reply(message, fail("Permission Denied", "You need Founder rank to use this command."));
  if (!target) return reply(message, fail("Voice", "Mention a valid user."));
  const d = guildData(message.guild.id);
  if (enabled) {
    if (!d.stfu.includes(target.id)) d.stfu.push(target.id);
    if (target.voice.channel) await target.voice.setMute(true, "VC+ Founder STFU").catch(() => {});
  } else {
    d.stfu = d.stfu.filter(id => id !== target.id);
    if (target.voice.channel) await target.voice.setMute(false, "VC+ Founder UNSTFU").catch(() => {});
  }
  saveDB();
  return reply(message, ok(enabled ? "Server Mute" : "Server Unmute",
    enabled ? `${target} has been server muted.\n\nUse -vc unstfu to release.` : `${target} is no longer forced server muted.`));
}

async function godmode(message, target) {
  if (!isFounder(message) && !canManage(message)) return reply(message, fail("Permission Denied", "You need management access to use Godmode."));
  if (!target) target = message.member;
  const d = guildData(message.guild.id);
  const idx = d.godmode.indexOf(target.id);
  if (idx === -1) {
    d.godmode.push(target.id);
    if (target.voice.channel?.members.get(target.id)?.voice.serverMute) {
      await target.voice.setMute(false, "VC+ Godmode").catch(() => {});
    }
  } else {
    d.godmode.splice(idx, 1);
  }
  saveDB();
  const enabled = d.godmode.includes(target.id);
  return reply(message, makeBox("Godmode", `${target}\nStatus    **${enabled ? "ENABLED" : "DISABLED"}**\n\nServer mute protection ${enabled ? "is active." : "is inactive."}`, "◈"));
}

async function parseDuration(input) {
  const m = String(input || "").match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit]);
}

async function moderation(message, command, target, extra) {
  if (!canModerate(message)) return reply(message, fail("Permission Denied", "You need moderation access to use this command."));
  if (!target) return reply(message, fail("Moderation", "Mention a valid user."));

  try {
    if (command === "timeout") {
      const ms = await parseDuration(extra);
      if (!ms) return reply(message, fail("Timeout", "Use a duration like `10m`, `1h`, or `1d`."));
      await target.timeout(ms, `VC+ timeout by ${message.author.tag}`);
      return reply(message, ok("Timeout", `${target} has been timed out for **${extra}**.`));
    }
    if (command === "untimeout") {
      await target.timeout(null, `VC+ untimeout by ${message.author.tag}`);
      return reply(message, ok("Timeout Removed", `${target} is no longer timed out.`));
    }
    if (command === "kick") {
      await target.kick(`VC+ kick by ${message.author.tag}`);
      return reply(message, ok("Kick", `${target.user} was kicked.`));
    }
    if (command === "ban") {
      await target.ban({ reason: `VC+ ban by ${message.author.tag}` });
      return reply(message, ok("Ban", `${target.user} was banned.`));
    }
  } catch (e) {
    console.error("[VC+ MOD ERROR]", e);
    return reply(message, fail("Moderation", "Discord rejected the action. Check role hierarchy and permissions."));
  }
}

async function unban(message, userId) {
  if (!canModerate(message)) return reply(message, fail("Permission Denied", "You need moderation access to use this command."));
  if (!userId) return reply(message, fail("Unban", "Provide a user ID."));
  try {
    await message.guild.bans.remove(userId, `VC+ unban by ${message.author.tag}`);
    return reply(message, ok("Unban", `<@${userId}> was unbanned.`));
  } catch {
    return reply(message, fail("Unban", "That user could not be unbanned. Use their Discord user ID."));
  }
}

async function unbanAll(message) {
  if (!isFounder(message)) return reply(message, fail("Permission Denied", "You need Founder rank to use this command."));
  try {
    const bans = await message.guild.bans.fetch();
    let count = 0;
    for (const [id] of bans) {
      await message.guild.bans.remove(id, "VC+ unbanall").catch(() => {});
      count++;
    }
    return reply(message, ok("Unban All", `${count} banned users were processed.`));
  } catch (e) {
    console.error("[VC+ UNBANALL ERROR]", e);
    return reply(message, fail("Unban All", "I couldn't process the server bans."));
  }
}

async function handleVC(message, args) {
  const sub = (args.shift() || "").toLowerCase();

  if (sub === "setup") return setupVC(message);

  if (sub === "stfu") return stfu(message, mentionUser(message), true);
  if (sub === "unstfu") return stfu(message, mentionUser(message), false);

  if (sub === "lock") return setVCState(message, "lock");
  if (sub === "unlock") return setVCState(message, "unlock");
  if (sub === "hide" || sub === "ghost") return setVCState(message, "hide");
  if (sub === "unhide" || sub === "unghost") return setVCState(message, "unhide");
  if (sub === "claim") return claimVC(message);
  if (sub === "limit") return setLimit(message, args[0]);

  if (["kick", "ban", "unban", "permit", "reject"].includes(sub)) {
    return vcMemberAction(message, sub, mentionUser(message));
  }

  return reply(message, fail("VC+", "Unknown VC command."));
}

async function handleVouch(message, args) {
  const first = (args[0] || "").toLowerCase();

  if (first === "role") {
    const action = (args[1] || "").toLowerCase();
    if (action === "set") return vouchRoleSet(message, mentionRole(message));
    if (action === "reset") return vouchRoleReset(message);
    if (action === "limit") return vouchRoleLimit(message, args[2]);
    return reply(message, fail("Vouch", "Use `-vouch role set`, `reset`, or `limit`."));
  }

  if (first === "limit") {
    const action = (args[1] || "").toLowerCase();
    const d = guildData(message.guild.id);

    if (!action) {
      return reply(message, makeBox("Vouch Limit",
        `Vouch limit  •  **${d.vouchGiveLimit ?? "unlimited"}**\nRole limit   •  **${d.vouchRoleLimit ?? "unlimited"}**`, "✦"));
    }

    if (action === "set") {
      if (!canManage(message)) return reply(message, fail("Permission Denied", "You need a management rank to change the vouch limit."));
      const n = Number(args[2]);
      if (!Number.isInteger(n) || n < 1) return reply(message, fail("Vouch", "Enter a whole number above 0."));
      d.vouchGiveLimit = n;
      saveDB();
      return reply(message, ok("Vouch Limit", `Each user may give **${n}** vouch${n === 1 ? "" : "es"}.`));
    }
  }

  if (first === "list") return vouchList(message);
  if (first === "clearall") return clearAllVouches(message);
  if (first === "clear") return clearVouch(message, mentionUser(message));
  return giveVouch(message, mentionUser(message));
}

async function handleCommand(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || "").toLowerCase();

  if (command === "help" || command === "commands") {
    return reply(message, helpEmbed(0), helpRows(0));
  }

  if (command === "vc") return handleVC(message, args);
  if (command === "vouch") return handleVouch(message, args);

  if (command === "rank") {
    if ((args[0] || "").toLowerCase() === "remove") return rankRemove(message, mentionUser(message));
    return rankCommand(message, args);
  }

  if (command === "godmode") return godmode(message, mentionUser(message) || message.member);

  if (["timeout", "untimeout", "kick", "ban"].includes(command)) {
    return moderation(message, command, mentionUser(message), args[1]);
  }

  if (command === "unban") return unban(message, args[0]);
  if (command === "unbanall") return unbanAll(message);
}

async function handleButtons(interaction) {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId.startsWith("help_")) {
      let page = Number(interaction.message.embeds[0]?.title?.match(/(\d+)\/5/)?.[1] || 1) - 1;
      if (interaction.customId === "help_next") page = (page + 1) % 5;
      if (interaction.customId === "help_prev") page = (page + 4) % 5;
      return interaction.update({
        embeds: [helpEmbed(page)],
        components: helpRows(page)
      });
    }

    if (interaction.customId.startsWith("vc_")) {
      const channel = interaction.member?.voice?.channel;
      const info = channel ? tempVC(interaction.guild, channel.id) : null;
      if (!channel || !info || info.ownerId !== interaction.user.id) {
        return interaction.reply({
          embeds: [fail("VC+", "You don't own this voice channel.")],
          ephemeral: true
        });
      }

      const map = {
        vc_lock: "lock",
        vc_unlock: "unlock",
        vc_hide: "hide",
        vc_unhide: "unhide"
      };

      if (map[interaction.customId]) {
        const action = map[interaction.customId];
        info.locked = action === "lock" ? true : action === "unlock" ? false : info.locked;
        info.hidden = action === "hide" ? true : action === "unhide" ? false : info.hidden;
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          Connect: info.locked ? false : true,
          ViewChannel: info.hidden ? false : true
        });
        saveDB();
        return interaction.update({
          embeds: [vcPanelEmbed(channel, 0)],
          components: vcPanelRows(0)
        });
      }

      if (interaction.customId === "vc_claim") {
        return interaction.reply({
          embeds: [warn("VC+", "You already own this voice channel.")],
          ephemeral: true
        });
      }

      if (interaction.customId === "vc_prev" || interaction.customId === "vc_next") {
        let page = Number(interaction.message.embeds[0]?.title?.match(/(\d+)\/4/)?.[1] || 1) - 1;
        page = interaction.customId === "vc_next" ? (page + 1) % 4 : (page + 3) % 4;
        return interaction.update({
          embeds: [vcPanelEmbed(channel, page)],
          components: vcPanelRows(page)
        });
      }

      return interaction.reply({
        embeds: [makeBox("VoiceMaster", "This button requires a target or value.\nUse the matching `-vc` command.")],
        ephemeral: true
      });
    }
  } catch (e) {
    console.error("[VC+ BUTTON ERROR]", e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [fail("VC+", "Something went wrong.")], ephemeral: true }).catch(() => {});
    }
  }
}

client.once("ready", async () => {
  console.log(`[VC+] Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "-help", type: 2 }],
    status: "online"
  });
});

client.on("messageCreate", async message => {
  try {
    await handleCommand(message);
  } catch (e) {
    console.error("[VC+ COMMAND ERROR]", e);
    await reply(message, fail("VC+", "An unexpected error occurred.")).catch(() => {});
  }
});

client.on("interactionCreate", handleButtons);

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const d = guildData(newState.guild.id);

    // Join-to-create
    if (newState.channelId === d.joinToCreateId && oldState.channelId !== d.joinToCreateId) {
      await createTempVC(newState);
    }

    // Cleanup
    if (oldState.channelId && oldState.channelId !== d.joinToCreateId) {
      const oldChannel = oldState.guild.channels.cache.get(oldState.channelId);
      if (oldChannel) await cleanupEmptyVC(oldChannel);
    }

    // STFU protection
    if (d.stfu.includes(newState.id) && newState.serverMute === false && newState.channelId) {
      const member = newState.member;
      if (member) await member.voice.setMute(true, "VC+ STFU protection").catch(() => {});
    }

    // Godmode protection
    if (d.godmode.includes(newState.id) && newState.serverMute === true && newState.channelId) {
      const member = newState.member;
      if (member) await member.voice.setMute(false, "VC+ Godmode").catch(() => {});
    }

    // Remove unauthorized manually-added vouch role
    if (oldState.member && newState.member) {
      const role = d.vouchRoleId ? newState.guild.roles.cache.get(d.vouchRoleId) : null;
      if (role) {
        const recorded = d.vouches.some(v => v.userId === newState.id);
        const had = oldState.member.roles.cache.has(role.id);
        const has = newState.member.roles.cache.has(role.id);
        if (!had && has && !recorded) {
          await newState.member.roles.remove(role, "VC+ unauthorized vouch role").catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("[VC+ VOICE STATE ERROR]", e);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const d = guildData(newMember.guild.id);
    const role = d.vouchRoleId ? newMember.guild.roles.cache.get(d.vouchRoleId) : null;
    if (!role) return;

    const had = oldMember.roles.cache.has(role.id);
    const has = newMember.roles.cache.has(role.id);
    const recorded = d.vouches.some(v => v.userId === newMember.id);

    if (!had && has && !recorded) {
      await newMember.roles.remove(role, "VC+ unauthorized vouch role").catch(() => {});
    }
  } catch (e) {
    console.error("[VC+ ROLE WATCH ERROR]", e);
  }
});

process.on("unhandledRejection", error => {
  console.error("[VC+ UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", error => {
  console.error("[VC+ UNCAUGHT EXCEPTION]", error);
});

loadDB();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[VC+ LOGIN ERROR] DISCORD_TOKEN is missing.");
  process.exit(1);
}

client.login(token).catch(error => {
  console.error("[VC+ LOGIN ERROR]", error);
});
'''

readme = r'''# VC+

Discord.js v14 VC + Vouch + Rank + Moderation bot.

## Setup

1. Install Node.js 18.17+ (20+ recommended).
2. Run:
   npm install
3. Copy `.env.example` to `.env`.
4. Put your bot token in `.env`.
5. Enable these Discord Developer Portal intents:
   - Message Content
   - Server Members
   - Server Members / Guild Members
   - Voice States
6. Run:
   npm start

## Commands

### Voice
- `-vc setup`
- `-vc lock`
- `-vc unlock`
- `-vc hide`
- `-vc unhide`
- `-vc permit @user`
- `-vc reject @user`
- `-vc kick @user`
- `-vc ban @user`
- `-vc unban @user`
- `-vc limit 5`
- `-vc claim`

### Founder Voice
- `-vc stfu @user`
- `-vc unstfu @user`

### Vouch
- `-vouch role set @role`
- `-vouch role reset`
- `-vouch role limit 5`
- `-vouch @user`
- `-vouch limit set 1`
- `-vouch limit`
- `-vouch list`
- `-vouch clear @user`
- `-vouch clearall`

The role-holder limit and the per-giver vouch limit are separate settings.

### Ranks
- `-rank @user founder`
- `-rank @user`
- `-rank remove @user`

Ranks:
Founder, God, Admin, Moderator, Trusted, Member

### Moderation
- `-timeout @user 10m`
- `-untimeout @user`
- `-ban @user`
- `-unban USER_ID`
- `-unbanall`
- `-kick @user`
- `-godmode @user`

Founder-only:
- `-vc stfu`
- `-vc unstfu`
- `-unbanall`

## Permissions

The bot needs at minimum:
Manage Channels, Move Members, Mute Members, Kick Members, Ban Members, Moderate Members, Manage Roles, View Audit Log.

Put the bot's role above the vouch role and any roles/users it needs to manage.
'''

(root / "package.json").write_text(json.dumps(package_json, indent=2), encoding="utf-8")
(root / ".env.example").write_text(env_example, encoding="utf-8")
(root / "index.js").write_text(index_js, encoding="utf-8")
(root / "README.md").write_text(readme, encoding="utf-8")
(root / "data" / "vcplus.json").write_text(json.dumps({"guilds": {}}, indent=2), encoding="utf-8")

zip_path = Path("/mnt/data/VCPlus.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob("*"):
        if p.is_file():
            z.write(p, p.relative_to(root.parent))

print(f"Created: {zip_path}")
