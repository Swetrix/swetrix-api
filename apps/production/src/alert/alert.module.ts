import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { ProjectModule } from 'src/project/project.module'
import { AppLoggerModule } from 'src/logger/logger.module'
import { UserModule } from 'src/user/user.module'
import {
  makeGaugeProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus'
import { AlertService } from './alert.service'
import { Alert } from './entity/alert.entity'
import { AlertController } from './alert.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert]),
    PrometheusModule,
    ProjectModule,
    AppLoggerModule,
    UserModule,
  ],
  providers: [
    AlertService,
    makeGaugeProvider({
      name: 'alert_count',
      help: 'The count of alerts',
    }),
  ],
  exports: [AlertService],
  controllers: [AlertController],
})
export class AlertModule {}
