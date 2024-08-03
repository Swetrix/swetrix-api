import { Injectable, Logger } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import { HttpService } from '@nestjs/axios'
import { WebhookAbcService } from '../webhook-abc/webhook-abc.service'

@Injectable()
export class SlackService extends WebhookAbcService {
  private readonly logger = new Logger(SlackService.name)

  constructor(private readonly httpService: HttpService) {
    super()
  }

  async sendWebhook(webhookUrl: string, message: unknown): Promise<void> {
    try {
      const payload = { text: message }
      await firstValueFrom(this.httpService.post(webhookUrl, payload))
    } catch (error) {
      this.logger.error(`Error sending Slack webhook: ${error}`)
    }
  }
}
