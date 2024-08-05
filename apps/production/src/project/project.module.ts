import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule, ConfigService } from '@nestjs/config'

import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus'
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectShare,
      ProjectSubscriber,
      Funnel,
      ProjectViewEntity,
      ProjectViewCustomEventEntity,
    ]),
    forwardRef(() => UserModule),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get('AI_URL'),
      }),
    }),
    AppLoggerModule,
    ActionTokensModule,
    MailerModule,
  ],
  providers: [
    ProjectService,
    ProjectsViewsRepository,
    makeCounterProvider({
      name: 'generated_og_images',
      help: 'The count of generated og images',
    }),
    makeGaugeProvider({
      name: 'project_count',
      help: 'The count of projects',
    }),
    makeGaugeProvider({
      name: 'funnel_count',
      help: 'The count of funnels',
    }),
    makeGaugeProvider({
      name: 'project_share_count',
      help: 'The count of shared projects',
    }),
    makeGaugeProvider({
      name: 'project_view_count',
      help: 'The count of projects views',
    }),
    makeGaugeProvider({
      name: 'project_view_count',
      help: 'The count of projects views',
    }),
  ],
  exports: [ProjectService, ProjectsViewsRepository],
  controllers: [ProjectController],
})
export class ProjectModule {}
