import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { ProjectService } from './project.service'
import { ProjectController } from './project.controller'
import { UserModule } from '../user/user.module'
import { ActionTokensModule } from '../action-tokens/action-tokens.module'
import { MailerModule } from '../mailer/mailer.module'
import { AppLoggerModule } from '../logger/logger.module'
import { Project, ProjectSubscriber, Funnel, ProjectShare } from './entity'
import { ProjectsViewsRepository } from './repositories/projects-views.repository'
import { ProjectViewEntity } from './entity/project-view.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectShare,
      ProjectSubscriber,
      Funnel,
      ProjectViewEntity,
    ]),
    forwardRef(() => UserModule),
    AppLoggerModule,
    ActionTokensModule,
    MailerModule,
  ],
  providers: [ProjectService, ProjectsViewsRepository],
  exports: [ProjectService],
  controllers: [ProjectController],
})
export class ProjectModule {}
