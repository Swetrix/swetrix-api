import { Module } from '@nestjs/common'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { AppLoggerModule } from '../logger/logger.module'
import { MailerService } from './mailer.service'

@Module({
  providers: [
    MailerService,
    makeCounterProvider({
      name: 'sent_email_count',
      help: 'The count of sent emails',
    }),
  ],
  exports: [MailerService],
  imports: [AppLoggerModule],
})
export class MailerModule {}
