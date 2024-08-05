import { Module, forwardRef } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { TelegramService } from '../integrations/telegram/telegram.service'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { User } from './entities/user.entity'
import { ActionTokensModule } from '../action-tokens/action-tokens.module'
import { MailerModule } from '../mailer/mailer.module'
import { AuthModule } from '../auth/auth.module'
import { PayoutsModule } from '../payouts/payouts.module'
import { AppLoggerModule } from '../logger/logger.module'
import { ProjectModule } from '../project/project.module'
import { RefreshToken } from './entities/refresh-token.entity'
import { DeleteFeedback } from './entities/delete-feedback.entity'
import { Message } from '../integrations/telegram/entities/message.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, DeleteFeedback, Message]),
    ActionTokensModule,
    MailerModule,
    forwardRef(() => AuthModule),
    AppLoggerModule,
    ProjectModule,
    PayoutsModule,
  ],
  providers: [
    UserService,
    TelegramService,
    makeCounterProvider({
      name: 'export_user_data_count',
      help: 'The count of exports of data from user',
    }),
  ],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
