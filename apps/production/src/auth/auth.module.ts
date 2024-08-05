import { forwardRef, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { TypeOrmModule } from '@nestjs/typeorm'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { ActionTokensModule } from '../action-tokens/action-tokens.module'
import { MailerModule } from '../mailer/mailer.module'
import { UserModule } from '../user/user.module'
import { ProjectModule } from '../project/project.module'
import { TelegramService } from '../integrations/telegram/telegram.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import {
  ApiKeyStrategy,
  JwtAccessTokenStrategy,
  JwtRefreshTokenStrategy,
} from './strategies'
import { Message } from '../integrations/telegram/entities/message.entity'

@Module({
  imports: [
    JwtModule.register({}),
    PassportModule,
    forwardRef(() => UserModule),
    ActionTokensModule,
    MailerModule,
    ActionTokensModule,
    ProjectModule,
    TypeOrmModule.forFeature([Message]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessTokenStrategy,
    JwtRefreshTokenStrategy,
    ApiKeyStrategy,
    TelegramService,
    makeCounterProvider({
      name: 'user_count',
      help: 'The count of registered users',
    }),
    makeCounterProvider({
      name: 'authorization_count',
      help: 'The count of authorizations',
    }),
  ],
  exports: [AuthService],
})
export class AuthModule {}
