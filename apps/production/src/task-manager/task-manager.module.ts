import { HttpModule } from '@nestjs/axios'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AlertModule } from '../alert/alert.module'
import { ExtensionsModule } from '../marketplace/extensions/extensions.module'
import { TelegramService } from '../integrations/telegram/telegram.service'
import { TaskManagerService } from './task-manager.service'
import { MailerModule } from '../mailer/mailer.module'
import { UserModule } from '../user/user.module'
import { ProjectModule } from '../project/project.module'
import { AnalyticsModule } from '../analytics/analytics.module'
import { PayoutsModule } from '../payouts/payouts.module'
import { ActionTokensModule } from '../action-tokens/action-tokens.module'
import { AppLoggerModule } from '../logger/logger.module'
import { Message } from '../integrations/telegram/entities/message.entity'
import { DiscordModule } from '../integrations/discord/discord.module'
import { SlackModule } from '../integrations/slack/slack.module'

@Module({
  imports: [
    ProjectModule,
    MailerModule,
    UserModule,
    ActionTokensModule,
    AlertModule,
    forwardRef(() => AnalyticsModule),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get('AI_URL'),
      }),
    }),
    ExtensionsModule,
    AppLoggerModule,
    TypeOrmModule.forFeature([Message]),
    PayoutsModule,
    DiscordModule,
    SlackModule,
    HttpModule,
  ],
  providers: [TaskManagerService, TelegramService],
  exports: [TaskManagerService],
})
export class TaskManagerModule {}
