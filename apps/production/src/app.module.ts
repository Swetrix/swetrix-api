import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { NestjsFormDataModule } from 'nestjs-form-data'

import { I18nModule } from 'nestjs-i18n'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { UserModule } from './user/user.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { ProjectModule } from './project/project.module'
import { MailerModule } from './mailer/mailer.module'
import { ActionTokensModule } from './action-tokens/action-tokens.module'
import { TwoFactorAuthModule } from './twoFactorAuth/twoFactorAuth.module'
import { TaskManagerModule } from './task-manager/task-manager.module'
import { BlogModule } from './blog/blog.module'
import { WebhookModule } from './webhook/webhook.module'
import { PingModule } from './ping/ping.module'
import { MarketplaceModule } from './marketplace/marketplace.module'
import { AlertModule } from './alert/alert.module'
import { getI18nConfig } from './configs'
import { AuthModule } from './auth/auth.module'
import { CaptchaModule } from './captcha/captcha.module'
import { OgImageModule } from './og-image/og-image.module'
// import { isDevelopment } from './common/constants'
import { IntegrationsModule } from './integrations/integrations.module'
import { CLIENT_AI_SERVICE } from './constants'

const modules = [
  ConfigModule.forRoot({
    cache: true,
    envFilePath: '.env',
    expandVariables: true,
    isGlobal: true,
  }),
  TypeOrmModule.forRoot({
    type: 'mysql',
    host: process.env.MYSQL_HOST,
    port: 3306,
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    synchronize: false, // isDevelopment,
    entities: [`${__dirname}/**/*.entity{.ts,.js}`],
  }),
  ClientsModule.registerAsync([
    {
      name: CLIENT_AI_SERVICE,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        transport: Transport.RMQ,
        options: {
          urls: [
            {
              hostname:
                configService.get<string>('RMQ_HOSTNAME') ?? 'localhost',
              port: Number(configService.get<number>('RMQ_PORT')) ?? 5672,
              username: configService.get<string>('RMQ_USERNAME') ?? 'guest',
              password: configService.get<string>('RMQ_PASSWORD') ?? 'guest',
            },
          ],
          queue: configService.get<string>('AI_SERVICE_QUEUE') ?? 'ai_queue',
        },
      }),
    },
  ]),
  I18nModule.forRootAsync(getI18nConfig()),
  ScheduleModule.forRoot(),
  NestjsFormDataModule.config({ isGlobal: true }),
  TaskManagerModule,
  BlogModule,
  UserModule,
  MailerModule,
  ActionTokensModule,
  TwoFactorAuthModule,
  ProjectModule,
  AnalyticsModule,
  WebhookModule,
  PingModule,
  MarketplaceModule,
  AlertModule,
  AuthModule,
  CaptchaModule,
  OgImageModule,
]

@Module({
  imports: [
    ...modules,
    ...(process.env.ENABLE_INTEGRATIONS === 'true' ? [IntegrationsModule] : []),
  ],
})
export class AppModule {}
