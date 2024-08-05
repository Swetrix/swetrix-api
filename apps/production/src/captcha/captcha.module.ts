import { Module } from '@nestjs/common'

import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { AppLoggerModule } from '../logger/logger.module'
import { CaptchaController } from './captcha.controller'
import { CaptchaService } from './captcha.service'
import { ProjectModule } from '../project/project.module'

@Module({
  imports: [AppLoggerModule, ProjectModule],
  providers: [
    CaptchaService,
    makeCounterProvider({
      name: 'generated_captcha_count',
      help: 'The count of generated captchas',
    }),
    makeCounterProvider({
      name: 'verified_captcha_count',
      help: 'The count of verified captchas',
    }),
  ],
  exports: [CaptchaService],
  controllers: [CaptchaController],
})
export class CaptchaModule {}
