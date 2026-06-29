import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
  type TextChannel,
  type CategoryChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";

const TICKET_CATEGORY_NAME = "🎫 التذاكر";
const SUPPORT_ROLE_NAME = "Support";
const GREEN_COLOR = 0x00e676 as const;

export function startBot() {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    logger.error("DISCORD_TOKEN is not set — bot will not start");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });

  client.once("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Discord bot is online");
    await registerCommands(token, client.user!.id);
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction);
      }
    } catch (err) {
      logger.error({ err }, "Error handling interaction");
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}

async function registerCommands(token: string, clientId: string) {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup-tickets")
      .setDescription("إرسال لوحة نظام التذاكر في هذه القناة")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("إغلاق التذكرة الحالية")
      .toJSON(),
  ];

  const rest = new REST().setToken(token);

  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info("Slash commands registered globally");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "setup-tickets") {
    await sendTicketPanel(interaction);
  } else if (interaction.commandName === "close") {
    await closeTicket(interaction);
  }
}

async function sendTicketPanel(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(GREEN_COLOR)
    .setTitle("🎫 نظام التذاكر")
    .setDescription(
      "مرحباً بك في نظام الدعم الفني\nلفتح تذكرة جديدة اضغط على الزر ادناه وسيقوم فريقنا بمساعدتك في اقرب وقت ممكن"
    )
    .addFields({ name: "الأقسام المتاحة", value: "• الدعم الفني" })
    .setFooter({ text: "The South Roleplay • نظام التذاكر" });

  const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("فتح تذكرة | Open Ticket")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎫")
  );

  const channel = interaction.channel as TextChannel | null;
  await channel?.send({ embeds: [embed], components: [button] });
  await interaction.editReply({ content: "✅ تم إرسال لوحة التذاكر بنجاح!" });
}

async function handleButton(interaction: ButtonInteraction) {
  if (interaction.customId === "open_ticket") {
    const modal = new ModalBuilder()
      .setCustomId("ticket_modal")
      .setTitle("فتح تذكرة دعم");

    const inquiryInput = new TextInputBuilder()
      .setCustomId("inquiry")
      .setLabel("ما هو استفسارك؟")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("اشرح مشكلتك بالتفصيل...")
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(inquiryInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  } else if (interaction.customId === "close_ticket") {
    await interaction.reply({ content: "⏳ جاري إغلاق التذكرة...", ephemeral: true });
    setTimeout(async () => {
      await interaction.channel?.delete().catch(() => {});
    }, 3000);
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== "ticket_modal") return;

  await interaction.deferReply({ ephemeral: true });

  const inquiry = interaction.fields.getTextInputValue("inquiry");
  const guild = interaction.guild;
  const user = interaction.user;

  if (!guild) {
    await interaction.editReply({ content: "❌ خطأ: لا يمكن إنشاء التذكرة خارج السيرفر." });
    return;
  }

  let category = guild.channels.cache.find(
    (c) => c.name === TICKET_CATEGORY_NAME && c.type === ChannelType.GuildCategory
  ) as CategoryChannel | undefined;

  if (!category) {
    category = (await guild.channels.create({
      name: TICKET_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    })) as CategoryChannel;
  }

  const existingTicket = guild.channels.cache.find(
    (c) => c.name === `ticket-${user.username}` && c.parentId === category!.id
  );

  if (existingTicket) {
    await interaction.editReply({ content: `❌ لديك تذكرة مفتوحة بالفعل: <#${existingTicket.id}>` });
    return;
  }

  const ticketChannel = (await guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  })) as TextChannel;

  const supportRole = guild.roles.cache.find((r) => r.name === SUPPORT_ROLE_NAME);
  if (supportRole) {
    await ticketChannel.permissionOverwrites.create(supportRole, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
  }

  const ticketEmbed = new EmbedBuilder()
    .setColor(GREEN_COLOR)
    .setTitle("🎫 تذكرة دعم جديدة")
    .setDescription(
      `مرحباً ${user}, شكراً لتواصلك مع فريق الدعم.\nسيقوم أحد أعضاء الفريق بمساعدتك في اقرب وقت ممكن.\n\nالرجاء الانتظار وعدم إغلاق القناة.`
    )
    .addFields(
      { name: "👤 صاحب التذكرة", value: `${user}`, inline: true },
      { name: "📋 القسم", value: "الدعم الفني", inline: true },
      { name: "❓ الاستفسار", value: inquiry }
    )
    .setFooter({ text: "The South Roleplay • نظام التذاكر" })
    .setTimestamp();

  const closeButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("إغلاق التذكرة | Close Ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒")
  );

  await ticketChannel.send({
    content: `${user} ${supportRole ? supportRole : ""}`,
    embeds: [ticketEmbed],
    components: [closeButton],
  });

  await interaction.editReply({ content: `✅ تم فتح تذكرتك بنجاح! <#${ticketChannel.id}>` });
}

async function closeTicket(interaction: ChatInputCommandInteraction) {
  const channel = interaction.channel as TextChannel;

  if (!channel.name.startsWith("ticket-")) {
    await interaction.reply({ content: "❌ هذا الأمر يعمل فقط داخل قنوات التذاكر.", ephemeral: true });
    return;
  }

  await interaction.reply({ content: "⏳ جاري إغلاق التذكرة..." });
  setTimeout(async () => {
    await channel.delete().catch(() => {});
  }, 3000);
}
