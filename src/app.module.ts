import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'

import { AuthModule } from './auth/auth.module'
import { UserModule } from './user/user.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { User } from './user/entities/user.entity'
import { Project } from './project/entity/project.entity'
import { ProjectModule } from './project/project.module'
import { MailerModule } from './mailer/mailer.module'
import { ActionTokensModule } from './action-tokens/action-tokens.module'
import { TwoFactorAuthModule } from './twoFactorAuth/twoFactorAuth.module'
import { ActionToken } from './action-tokens/action-token.entity'
import { ProjectShare } from './project/entity/project-share.entity'
import { TaskManagerModule } from './task-manager/task-manager.module'
import { WebhookModule } from './webhook/webhook.module'
import { PingModule } from './ping/ping.module'

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env' }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.MYSQL_HOST,
      port: 3306,
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      synchronize: process.env.NODE_ENV === 'development' ? true : false,
      entities: [User, ActionToken, Project, ProjectShare],
    }),
    ScheduleModule.forRoot(),
    TaskManagerModule,
    AuthModule,
    UserModule,
    MailerModule,
    ActionTokensModule,
    TwoFactorAuthModule,
    ProjectModule,
    AnalyticsModule,
    WebhookModule,
    PingModule,
  ],
})

export class AppModule {}
