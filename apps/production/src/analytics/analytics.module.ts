import { Module, forwardRef } from '@nestjs/common'

import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'
import { UserModule } from '../user/user.module'
import { AppLoggerModule } from '../logger/logger.module'
import { ProjectModule } from '../project/project.module'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'

@Module({
  imports: [forwardRef(() => UserModule), AppLoggerModule, ProjectModule],
  providers: [AnalyticsService,

    makeCounterProvider({
      name: 'log_analytics_count',
      help: 'The count of requests sent to /log endpoint',
    }),
    makeCounterProvider({
      name: 'log_error_count',
      help: 'The count of requests sent to /error endpoint',
    }),
    makeCounterProvider({
      name: 'log_custom_count',
      help: 'The count of requests sent to /custom endpoint',
    })
  ],
  exports: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
