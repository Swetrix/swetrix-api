import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { Injectable, Logger } from '@nestjs/common'
import { WebhookAbcService } from '../webhook-abc/webhook-abc.service'

@Injectable()
export class DiscordService extends WebhookAbcService {
  private readonly logger = new Logger(DiscordService.name)

  constructor(private readonly httpService: HttpService) {
    super()
  }

  async sendWebhook(webhookUrl: string, message: unknown): Promise<void> {
    try {
      const payload = { content: message }
      await firstValueFrom(this.httpService.post(webhookUrl, payload))
    } catch (error) {
      this.logger.error(`Error sending Discord webhook: ${error}`)
    }
  }
}
