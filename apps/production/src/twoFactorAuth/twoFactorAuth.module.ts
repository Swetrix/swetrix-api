import { Module } from '@nestjs/common'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { TwoFactorAuthService } from './twoFactorAuth.service'
import { UserModule } from '../user/user.module'
import { AuthModule } from '../auth/auth.module'
import { TwoFactorAuthController } from './twoFactorAuth.controller'
import { AppLoggerModule } from '../logger/logger.module'
import { MailerModule } from '../mailer/mailer.module'

@Module({
  imports: [UserModule, AppLoggerModule, AuthModule, MailerModule],
  controllers: [TwoFactorAuthController],
  providers: [
    TwoFactorAuthService,
    makeCounterProvider({
      name: 'authorization_2fa_count',
      help: 'The count of 2FA authorizations',
    }),
  ],
  exports: [TwoFactorAuthService],
})
export class TwoFactorAuthModule {}
