import fs = require('fs')
import path = require('path')
import { MailerService as NodeMailerService } from '@nestjs-modules/mailer'
import { Injectable } from '@nestjs/common'
import handlebars from 'handlebars'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Counter } from 'prom-client'
import { LetterTemplate } from './letter'
import { AppLoggerService } from '../logger/logger.service'
import { SEND_WARNING_AT_PERC } from '../common/constants'

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
      en: (p: Params) =>
        `${p.type === 'w' ? 'Weekly' : 'Monthly'} Report: ${p.date}`,
    },
  },
  [LetterTemplate.TierWarning]: {
    subject: {
      en: () =>
        `You have used more than ${SEND_WARNING_AT_PERC}% of the available events per your tier for this month`,
    },
  },
  [LetterTemplate.SubscriptionCancelled]: {
    subject: {
      en: () => 'Your feedback on Swetrix',
    },
  },
  [LetterTemplate.ProjectInvitation]: {
    subject: {
      en: () => 'You have been invited to join the project',
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
  [LetterTemplate.TrialExpired]: {
    subject: {
      en: () => 'Your free Swetrix trial has ended',
    },
  },
  [LetterTemplate.TrialEndsTomorrow]: {
    subject: {
      en: () => 'Your free Swetrix trial ends tomorrow',
    },
  },
  [LetterTemplate.ProjectSubscriberInvitation]: {
    subject: {
      en: () => 'You have been invited to join the project',
    },
  },
  [LetterTemplate.ProjectTransfer]: {
    subject: {
      en: (p: Params) =>
        `A Swetrix user offers to transfer ${p.name} project to your account`,
    },
  },
  [LetterTemplate.PayPalEmailUpdate]: {
    subject: {
      en: () => 'Your PayPal email has been updated',
    },
  },
  [LetterTemplate.UsageOverLimit]: {
    subject: {
      en: () =>
        '[ACTION REQUIRED] You have exceeded your Swetrix subscription plan',
    },
  },
  [LetterTemplate.DashboardLockedExceedingLimits]: {
    subject: {
      en: () => '[ACTION REQUIRED] Your Swetrix dashboard has been locked',
    },
  },
  [LetterTemplate.DashboardLockedPaymentFailure]: {
    subject: {
      en: () =>
        '[ACTION REQUIRED] Your Swetrix dashboard has been locked due to a payment issue',
    },
  },
}

interface Params {
  [name: string]: any
}

handlebars.registerHelper('ifEquals', function ifEquals(arg1, arg2, options) {
  // eslint-disable-next-line eqeqeq
  return arg1 == arg2 ? options.fn(this) : options.inverse(this)
})

handlebars.registerHelper(
  'ifNotEquals',
  function ifNotEquals(arg1, arg2, options) {
    // eslint-disable-next-line eqeqeq
    return arg1 != arg2 ? options.fn(this) : options.inverse(this)
  },
)

handlebars.registerHelper('greater', function greater(v1, v2, options) {
  if (v1 > v2) {
    return options.fn(this)
  }
  return options.inverse(this)
})

@Injectable()
export class MailerService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly nodeMailerService: NodeMailerService,
    @InjectMetric('sent_email_count')
    private readonly sentEmailsCount: Counter<string>,
  ) {}

  async sendEmail(
    email: string,
    templateName: LetterTemplate,
    params: Params = null,
  ): Promise<void> {
    try {
      const templatePath = `${TEMPLATES_PATH}/en/${templateName}.html`
      const letter = fs.readFileSync(templatePath, { encoding: 'utf-8' })
      const subject = metaInfoJson[templateName].subject.en(params)
      const template = handlebars.compile(letter)
      const html = template(params)

      const message = {
        from: process.env.FROM_EMAIL,
        to: email,
        subject,
        html,
      }

      if (process.env.SMTP_MOCK) {
        this.logger.log(
          {
            ...message,
            params,
          },
          'sendEmail',
          true,
        )
      } else {
        await this.nodeMailerService.sendMail(message)
        this.sentEmailsCount.inc()
      }
    } catch (reason) {
      this.logger.error(reason, 'sendEmail', true)
    }
  }
}
