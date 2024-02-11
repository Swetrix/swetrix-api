import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { InjectBot } from 'nestjs-telegraf'
import { UserService } from 'src/user/user.service'
import { Markup, Telegraf } from 'telegraf'
import { Repository } from 'typeorm'
import { Message } from './entities/message.entity'
import { Context } from './interface/context.interface'

@Injectable()
export class TelegramService {
  constructor(
    @Optional() @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async getStartMessage(telgramId: number) {
    const user = await this.userService.getUserByTelegramId(telgramId)

    let text: string
    let extra: unknown = {}

    if (!user) {
      text =
        'Welcome to the Swetrix Bot!' +
        '\n\n' +
        'Your Telegram ID is: ' +
        `<code>${telgramId.toString()}</code>` +
        '\n\n' +
        'You can use this ID to link your Telegram account with your Swetrix account.' +
        '\n\n' +
        'To do this, go to your <a href="https://swetrix.com/settings">Swetrix account settings</a> and enter this ID in the Telegram field.' +
        '\n\n' +
        'After that, you can use the bot to manage your projects.'
      extra = {
        disable_web_page_preview: true,
        reply_markup: { remove_keyboard: true },
      }
    }

    if (user) {
      text = 'Welcome to the Swetrix Bot!'
      extra = {
        ...Markup.keyboard([['📂 Projects', '⚙️ Settings']])
          .oneTime()
          .resize(),
      }
    }

    return { text, extra }
  }

  async confirmLinkAccount(userId: string, chatId: number) {
    if (
      this.configService.get<string>('ENABLE_INTEGRATIONS') !== 'true' &&
      this.configService.get<string>('ENABLE_TELEGRAM_INTEGRATION') !== 'true'
    ) {
      return
    }

    await this.userService.updateUserTelegramId(userId, chatId, true)
  }

  async cancelLinkAccount(userId: string) {
    if (
      this.configService.get<string>('ENABLE_INTEGRATIONS') !== 'true' &&
      this.configService.get<string>('ENABLE_TELEGRAM_INTEGRATION') !== 'true'
    ) {
      return
    }

    await this.userService.updateUserTelegramId(userId, null)
  }

  async confirmUnlinkAccount(chatId: number) {
    if (
      this.configService.get<string>('ENABLE_INTEGRATIONS') !== 'true' &&
      this.configService.get<string>('ENABLE_TELEGRAM_INTEGRATION') !== 'true'
    ) {
      return
    }

    const user = await this.userService.getUserByTelegramId(chatId)
    await this.userService.updateUserTelegramId(user.id, null)
  }

  async addMessage(chatId: string, text: string, extra?: unknown) {
    await this.messageRepository.save({ chatId, text, extra })
  }

  async getMessages() {
    const messagesCount = 25
    return this.messageRepository.find({
      take: messagesCount,
      order: { createdAt: 'DESC' },
    })
  }

  async sendMessage(
    messageId: string,
    chatId: string,
    text: string,
    extra?: unknown,
  ) {
    if (
      this.configService.get<string>('ENABLE_INTEGRATIONS') !== 'true' &&
      this.configService.get<string>('ENABLE_TELEGRAM_INTEGRATION') !== 'true'
    ) {
      return
    }

    const chat = await this.bot.telegram.getChat(chatId)

    if (!chat) {
      await this.deleteMessage(messageId)
      return
    }

    await this.bot.telegram.sendMessage(chatId, text, extra)
    await this.deleteMessage(messageId)
  }

  async deleteMessage(messageId: string) {
    await this.messageRepository.delete(messageId)
  }
}
