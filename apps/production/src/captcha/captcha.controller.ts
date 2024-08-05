import {
  Controller,
  Post,
  Body,
  UseGuards,
  ForbiddenException,
  Headers,
  Ip,
  HttpCode,
} from '@nestjs/common'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'

import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Counter } from 'prom-client'
import { AppLoggerService } from '../logger/logger.service'
import { getIPFromHeaders } from '../common/utils'
import { CaptchaService, DUMMY_PIDS } from './captcha.service'
import { BotDetectionGuard } from '../common/guards/bot-detection.guard'
import { BotDetection } from '../common/decorators/bot-detection.decorator'
import { ManualDTO } from './dtos/manual.dto'
import { ValidateDTO } from './dtos/validate.dto'
import { GenerateDTO, DEFAULT_THEME } from './dtos/generate.dto'

dayjs.extend(utc)

@Controller({
  version: '1',
  path: 'captcha',
})
export class CaptchaController {
  constructor(
    private readonly captchaService: CaptchaService,
    private readonly logger: AppLoggerService,
    @InjectMetric('generated_captcha_count')
    private readonly generatedCaptchaCount: Counter<string>,
    @InjectMetric('verified_captcha_count')
    private readonly verifiedCaptchaCount: Counter<string>,
  ) {}

  @Post('/generate')
  @HttpCode(200)
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  async generateCaptcha(@Body() generateDTO: GenerateDTO): Promise<any> {
    this.logger.log({ generateDTO }, 'POST /captcha/generate')

    const { theme = DEFAULT_THEME, pid } = generateDTO

    await this.captchaService.validatePIDForCAPTCHA(pid)

    this.generatedCaptchaCount.inc()
    return this.captchaService.generateCaptcha(theme)
  }

  @Post('/verify')
  @HttpCode(200)
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  async verify(
    @Body() manualDTO: ManualDTO,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    this.logger.log({ manualDTO }, 'POST /captcha/verify-manual')

    const { 'user-agent': userAgent } = headers
    // todo: add origin checks

    const { code, hash, pid } = manualDTO

    await this.captchaService.validatePIDForCAPTCHA(pid)

    const timestamp = dayjs.utc().unix()

    // For dummy (test) PIDs
    if (pid === DUMMY_PIDS.ALWAYS_PASS) {
      const dummyToken = this.captchaService.generateDummyToken()
      return {
        success: true,
        token: dummyToken,
        timestamp,
        hash,
        pid,
      }
    }

    if (
      pid === DUMMY_PIDS.ALWAYS_FAIL ||
      !this.captchaService.verifyCaptcha(code, hash)
    ) {
      throw new ForbiddenException('Incorrect captcha')
    }

    const token = await this.captchaService.generateToken(pid, hash, timestamp)

    const ip = getIPFromHeaders(headers) || reqIP || ''

    await this.captchaService.logCaptchaPass(pid, userAgent, timestamp, ip)

    this.verifiedCaptchaCount.inc()
    return {
      success: true,
      token,
      timestamp,
      hash,
      pid,
    }
  }

  @Post('/validate')
  @HttpCode(200)
  async validateToken(@Body() validateDTO: ValidateDTO): Promise<any> {
    this.logger.log({ validateDTO }, 'POST /captcha/validate')

    const { token, secret } = validateDTO

    return {
      success: true,
      data: await this.captchaService.validateToken(token, secret),
    }
  }
}
