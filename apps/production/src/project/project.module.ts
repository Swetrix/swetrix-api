import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { BullModule } from '@nestjs/bull'

import { ProjectService } from './project.service'
import { ProjectController } from './project.controller'
import { UserModule } from '../user/user.module'
import { ActionTokensModule } from '../action-tokens/action-tokens.module'
import { MailerModule } from '../mailer/mailer.module'
import { AppLoggerModule } from '../logger/logger.module'
import { Project, ProjectSubscriber, Funnel, ProjectShare } from './entity'
import { ProjectsViewsRepository } from './repositories/projects-views.repository'
import { ProjectViewEntity } from './entity/project-view.entity'
import { ProjectViewCustomEventEntity } from './entity/project-view-custom-event.entity'
import { MonitorConsumer } from './consumers/monitor.consumer'
import { MonitorGroupEntity } from './entity/monitor-group.entity'
import { MonitorEntity } from './entity/monitor.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectShare,
      ProjectSubscriber,
      Funnel,
      ProjectViewEntity,
      ProjectViewCustomEventEntity,
      MonitorGroupEntity,
      MonitorEntity,
    ]),
    forwardRef(() => UserModule),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get('AI_URL'),
      }),
    }),
    ClientsModule.register([
      {
        name: 'MONITOR_EUROPE_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.MONITOR_QUEUE_URL],
          queue: 'monitor_europe_queue',
          queueOptions: {
            durable: false,
          },
        },
      },
      {
        name: 'MONITOR_US_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.MONITOR_QUEUE_URL],
          queue: 'monitor_us_queue',
          queueOptions: {
            durable: false,
          },
        },
      },
      {
        name: 'MONITOR_ASIA_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.MONITOR_QUEUE_URL],
          queue: 'monitor_asia_queue',
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
    BullModule.registerQueue({
      name: 'monitor',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25,
      },
    }),
    AppLoggerModule,
    ActionTokensModule,
    MailerModule,
  ],
  providers: [ProjectService, ProjectsViewsRepository, MonitorConsumer],
  exports: [ProjectService, ProjectsViewsRepository],
  controllers: [ProjectController],
})
export class ProjectModule {}
