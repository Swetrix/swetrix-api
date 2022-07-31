import { Injectable } from '@nestjs/common'
import * as postmark from 'postmark'
import handlebars from 'handlebars'
import { LetterTemplate } from './letter'
import fs = require('fs')
import path = require('path')
import { AppLoggerService } from 'src/logger/logger.service'
import { SEND_WARNING_AT_PERC } from 'src/common/constants'

const TEMPLATES_PATH = path.join(__dirname, '..', 'common', 'templates')
const metaInfoJson = {
  [LetterTemplate.SignUp]: {
    subject: {
      en: () => 'Please verify your account registration',
    },
  },
  [LetterTemplate.ConfirmPasswordChange]: {
    subject: {
      en: () => 'Please confirm the password change',
    },
  },
  [LetterTemplate.MailAddressChangeConfirmation]: {
    subject: {
      en: () => 'Please confirm the new e-mail address',
    },
  },
  [LetterTemplate.MailAddressHadChanged]: {
    subject: {
      en: () => 'A new e-mail-address has been saved',
    },
  },
  [LetterTemplate.PasswordChangeRequest]: {
    subject: {
      en: () => 'Changing your password',
    },
  },
  [LetterTemplate.PasswordChanged]: {
    subject: {
      en: () => 'Your password was successfully changed',
    },
  },
  [LetterTemplate.GDPRDataExport]: {
    subject: {
      en: () => 'Swetrix Account data export',
    },
  },
  [LetterTemplate.ProjectReport]: {
    subject: {
      en: (p: Params) => `${p.type === 'w' ? 'Weekly' : 'Monthly'} Report: ${p.date}`,
    },
  },
  [LetterTemplate.TierWarning]: {
    subject: {
      en: () => `You have used more than ${SEND_WARNING_AT_PERC}% of the available events per your tier for this month.`,
    },
  },
  [LetterTemplate.ProjectInvitation]: {
    subject: {
      en: () => 'You have been invited to join the project.',
    },
  },
  [LetterTemplate.TwoFAOn]: {
    subject: {
      en: () => '2FA has been enabled on your Swetrix account',
    },
  },
  [LetterTemplate.TwoFAOff]: {
    subject: {
      en: () => '2FA has been disabled on your Swetrix account',
    },
  },
}

interface Params {
  [name: string]: any
}

handlebars.registerHelper('ifEquals', function (arg1, arg2, options) {
  return (arg1 == arg2) ? options.fn(this) : options.inverse(this)
})

handlebars.registerHelper('greater', function (v1, v2, options) {
  if (v1 > v2) {
    return options.fn(this)
  }
  return options.inverse(this)
})

const mailClient = new postmark.ServerClient(process.env.SMTP_PASSWORD)

@Injectable()
export class MailerService {
  constructor(
    private readonly logger: AppLoggerService,
  ) { }

  async sendEmail(email: string, templateName: LetterTemplate, params: Params = null, messageStream: 'broadcast' | 'outbound' = 'outbound'): Promise<void> {
    try {
      const templatePath = `${TEMPLATES_PATH}/en/${templateName}.html`
      const letter = fs.readFileSync(templatePath, { encoding: 'utf-8' })
      const subject = metaInfoJson[templateName].subject.en(params)
      const template = handlebars.compile(letter)
      const htmlToSend = template(params)

      const message = {
        From: process.env.FROM_EMAIL,
        To: email,
        Subject: subject,
        HtmlBody: htmlToSend,
        MessageStream: messageStream,
      }

      if (process.env.SMTP_MOCK) {
        this.logger.log({
          ...message,
          params,
        }, 'sendEmail', true)
      } else {
        await mailClient.sendEmail(message)
      }
    } catch (error) {
      console.error(`[ERROR][MAILER] ${error}`)
    }
  }
}
