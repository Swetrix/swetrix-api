export abstract class WebhookAbcService {
  abstract sendWebhook(webhookUrl: string, message: unknown): Promise<void>
}
