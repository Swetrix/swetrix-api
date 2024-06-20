import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { NestjsFormDataModule } from 'nestjs-form-data'
import { MailerModule as NodeMailerModule } from '@nestjs-modules/mailer'

import { I18nModule } from 'nestjs-i18n'
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
import { IntegrationsModule } from './integrations/integrations.module'
import { HealthModule } from './health/health.module'
import { AppController } from './app.controller'

const modules = [
  ConfigModule.forRoot({
    cache: true,
    envFilePath: '.env',
    expandVariables: true,
    isGlobal: true,
  }),
  NodeMailerModule.forRoot({
    transport: {
      sendingRate: 14,
      // pool: true, // if true - set up pooled connections against a SMTP server
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: true, // if false - upgrade later with STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    },
    defaults: {
      from: `"Swetrix" <${process.env.FROM_EMAIL}>`, // outgoing email ID
    },
  }),
  TypeOrmModule.forRoot({
    type: 'mysql',
    host: process.env.MYSQL_HOST,
    port: 3306,
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    synchronize: false, // process.env.NODE_ENV !== 'production',
    entities: [`${__dirname}/**/*.entity{.ts,.js}`],
  }),
  I18nModule.forRootAsync(getI18nConfig()),
  ScheduleModule.forRoot(),
  NestjsFormDataModule.config({ isGlobal: true }),
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
  HealthModule,
]

@Module({
  imports: [
    ...modules,
    ...(process.env.ENABLE_INTEGRATIONS === 'true' ? [IntegrationsModule] : []),
    ...(process.env.IS_MASTER_NODE === 'true' ? [TaskManagerModule] : []),
  ],
  controllers: [AppController],
})
export class AppModule {}
