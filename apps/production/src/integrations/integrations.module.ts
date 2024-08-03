import { Module } from '@nestjs/common'
import { TelegramModule } from './telegram/telegram.module'
import { DiscordModule } from './discord/discord.module'
import { SlackModule } from './slack/slack.module'

@Module({
  imports: [
    ...(process.env.ENABLE_TELEGRAM_INTEGRATION === 'true'
      ? [TelegramModule]
      : []),
    DiscordModule,
    SlackModule,
  ],
})
export class IntegrationsModule {}
