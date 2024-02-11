import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { IsNull, LessThan, In, Not, Between, MoreThan, Like } from 'typeorm'
import * as Paypal from '@paypal/payouts-sdk'
import * as bcrypt from 'bcrypt'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as _isEmpty from 'lodash/isEmpty'
import * as _isNull from 'lodash/isNull'
import * as _join from 'lodash/join'
import * as _size from 'lodash/size'
import * as _map from 'lodash/map'
import * as _now from 'lodash/now'
import * as _find from 'lodash/find'
import * as _toNumber from 'lodash/toNumber'
import * as _reduce from 'lodash/reduce'

import { AlertService } from '../alert/alert.service'
import { QueryCondition, QueryMetric, QueryTime } from '../alert/dto/alert.dto'
import { ExtensionsService } from '../marketplace/extensions/extensions.service'
import { Extension } from '../marketplace/extensions/entities/extension.entity'
import { ReportFrequency } from '../project/enums'
import { TelegramService } from '../integrations/telegram/telegram.service'
import { MailerService } from '../mailer/mailer.service'
import { UserService } from '../user/user.service'
import { ProjectService } from '../project/project.service'
import { ActionTokensService } from '../action-tokens/action-tokens.service'
import { ActionTokenType } from '../action-tokens/action-token.entity'
import { LetterTemplate } from '../mailer/letter'
import { AnalyticsService } from '../analytics/analytics.service'
import { PayoutsService } from '../payouts/payouts.service'
import { PayoutStatus } from '../payouts/entities/payouts.entity'
import {
  ACCOUNT_PLANS,
  PlanCode,
  BillingFrequency,
  TRIAL_DURATION,
} from '../user/entities/user.entity'
import {
  clickhouse,
  redis,
  REDIS_LOG_DATA_CACHE_KEY,
  REDIS_LOG_CUSTOM_CACHE_KEY,
  REDIS_SESSION_SALT_KEY,
  REDIS_USERS_COUNT_KEY,
  REDIS_PROJECTS_COUNT_KEY,
  REDIS_EVENTS_COUNT_KEY,
  REDIS_LOG_PERF_CACHE_KEY,
  PROJECT_INVITE_EXPIRE,
  REDIS_LOG_CAPTCHA_CACHE_KEY,
  JWT_REFRESH_TOKEN_LIFETIME,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  isDevelopment,
} from '../common/constants'
import { getRandomTip } from '../common/utils'
import { AppLoggerService } from '../logger/logger.service'

dayjs.extend(utc)

let paypalClient

if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) {
  const environment = new Paypal.core.SandboxEnvironment(
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
  )
  paypalClient = new Paypal.core.PayPalHttpClient(environment)
}

const getQueryTime = (time: QueryTime): number => {
  if (time === QueryTime.LAST_15_MINUTES) return 15 * 60
  if (time === QueryTime.LAST_30_MINUTES) return 30 * 60
  if (time === QueryTime.LAST_1_HOUR) return 60 * 60
  if (time === QueryTime.LAST_4_HOURS) return 4 * 60 * 60
  if (time === QueryTime.LAST_24_HOURS) return 24 * 60 * 60
  if (time === QueryTime.LAST_48_HOURS) return 48 * 60 * 60
  return 0
}

const getQueryTimeString = (time: QueryTime): string => {
  if (time === QueryTime.LAST_15_MINUTES) return '15 minutes'
  if (time === QueryTime.LAST_30_MINUTES) return '30 minutes'
  if (time === QueryTime.LAST_1_HOUR) return '1 hour'
  if (time === QueryTime.LAST_4_HOURS) return '4 hours'
  if (time === QueryTime.LAST_24_HOURS) return '24 hours'
  if (time === QueryTime.LAST_48_HOURS) return '48 hours'
  return '0'
}

const getQueryCondition = (condition: QueryCondition): string => {
  if (condition === QueryCondition.LESS_THAN) return '<'
  if (condition === QueryCondition.LESS_EQUAL_THAN) return '<='
  if (condition === QueryCondition.GREATER_THAN) return '>'
  if (condition === QueryCondition.GREATER_EQUAL_THAN) return '>='
  return ''
}

@Injectable()
export class TaskManagerService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly userService: UserService,
    private readonly analyticsService: AnalyticsService,
    private readonly projectService: ProjectService,
    private readonly actionTokensService: ActionTokensService,
    private readonly alertService: AlertService,
    private readonly extensionsService: ExtensionsService,
    private readonly logger: AppLoggerService,
    private readonly telegramService: TelegramService,
    private readonly payoutsService: PayoutsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async saveLogData(): Promise<void> {
    const data = await redis.lrange(REDIS_LOG_DATA_CACHE_KEY, 0, -1)
    const customData = await redis.lrange(REDIS_LOG_CUSTOM_CACHE_KEY, 0, -1)
    const perfData = await redis.lrange(REDIS_LOG_PERF_CACHE_KEY, 0, -1)
    const captchaData = await redis.lrange(REDIS_LOG_CAPTCHA_CACHE_KEY, 0, -1)

    if (!_isEmpty(data)) {
      await redis.del(REDIS_LOG_DATA_CACHE_KEY)
      const query = `INSERT INTO analytics (*) VALUES ${_join(data, ',')}`
      try {
        await clickhouse.query(query).toPromise()
      } catch (e) {
        console.error(`[CRON WORKER] Error whilst saving log data: ${e}`)
      }
    }

    if (!_isEmpty(captchaData)) {
      await redis.del(REDIS_LOG_CAPTCHA_CACHE_KEY)
      const query = `INSERT INTO captcha (*) VALUES ${_join(captchaData, ',')}`
      try {
        await clickhouse.query(query).toPromise()
      } catch (e) {
        console.error(
          `[CRON WORKER] Error whilst saving CAPTCHA log data: ${e}`,
        )
      }
    }

    if (!_isEmpty(customData)) {
      await redis.del(REDIS_LOG_CUSTOM_CACHE_KEY)
      const query = `INSERT INTO customEV (*) VALUES ${_join(customData, ',')}`

      try {
        await clickhouse.query(query).toPromise()
      } catch (e) {
        console.error(
          `[CRON WORKER] Error whilst saving custom events data: ${e}`,
        )
      }
    }

    if (!_isEmpty(perfData)) {
      await redis.del(REDIS_LOG_PERF_CACHE_KEY)

      const query = `INSERT INTO performance (*) VALUES ${_join(perfData, ',')}`

      try {
        await clickhouse.query(query).toPromise()
      } catch (e) {
        console.error(
          `[CRON WORKER] Error whilst saving performance data: ${e}`,
        )
      }
    }
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  async checkLeftEvents(): Promise<void> {
    const thisMonth = dayjs.utc().format('YYYY-MM-01')
    const users = await this.userService.find({
      where: [
        {
          evWarningSentOn: IsNull(),
          isActive: true,
          planCode: Not(PlanCode.none),
        },
        {
          evWarningSentOn: LessThan(thisMonth),
          isActive: true,
          planCode: Not(PlanCode.none),
        },
      ],
      relations: ['projects'],
      select: [
        'id',
        'email',
        'planCode',
        'planLimitNotificationPercentage',
        'isTelegramChatIdConfirmed',
        'telegramChatId',
      ],
    })

    const promises = _map(users, async user => {
      const {
        id,
        email,
        planCode,
        projects,
        planLimitNotificationPercentage,
        isTelegramChatIdConfirmed,
        telegramChatId,
      } = user

      if (_isEmpty(projects) || _isNull(projects)) {
        return
      }

      const maxEventsCount = ACCOUNT_PLANS[planCode].monthlyUsageLimit || 0
      const totalMonthlyEvents = await this.projectService.getRedisCount(id)

      const usedEV = (totalMonthlyEvents * 100) / maxEventsCount

      if (usedEV >= planLimitNotificationPercentage) {
        await this.mailerService.sendEmail(
          email,
          LetterTemplate.TierWarning,
          {
            amount: planLimitNotificationPercentage,
            url: 'https://swetrix.com/billing',
          },
          'broadcast',
        )
        if (isTelegramChatIdConfirmed && telegramChatId) {
          await this.telegramService.addMessage(
            telegramChatId,
            `You've reached ${planLimitNotificationPercentage}% of your monthly event limit.\nThat's a lot of traffic, congratulations!\nThat means that in case you use 100% of the available events until the end of the month, all the subsequent traffic will not be saved.\nTo avoid this we recommend that you upgrade your tier on the [Billing](https://swetrix.com/billing) page.`,
            {
              parse_mode: 'Markdown',
            },
          )
        }
        await this.userService.update(id, {
          evWarningSentOn: dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
        })
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](checkLeftEvents) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async deleteOldShareInvitations(): Promise<void> {
    const minDate = dayjs
      .utc()
      .subtract(PROJECT_INVITE_EXPIRE, 'h')
      .format('YYYY-MM-DD HH:mm:ss')
    await this.actionTokensService.deleteMultiple(
      `action="${ActionTokenType.PROJECT_SHARE}" AND created<"${minDate}"`,
    )
    await this.projectService.deleteMultipleShare(
      `confirmed=0 AND created<"${minDate}"`,
    )
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateSessionSalt(): Promise<void> {
    const salt = await bcrypt.genSalt(10)
    await redis.set(REDIS_SESSION_SALT_KEY, salt, 'EX', 87000)
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanUpSessions(): Promise<void> {
    const delSidQuery = `ALTER TABLE analytics UPDATE sid = NULL WHERE created < '${dayjs
      .utc()
      .subtract(20, 'm')
      .format('YYYY-MM-DD HH:mm:ss')}'`

    await clickhouse.query(delSidQuery).toPromise()
  }

  // EVERY SUNDAY AT 2:30 AM
  @Cron('30 02 * * 0')
  async weeklyReportsHandler(): Promise<void> {
    const users = await this.userService.find({
      where: {
        reportFrequency: ReportFrequency.WEEKLY,
      },
      relations: ['projects'],
      select: ['email'],
    })
    const now = dayjs.utc().format('DD.MM.YYYY')
    const weekAgo = dayjs.utc().subtract(1, 'w').format('DD.MM.YYYY')
    const date = `${weekAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(users, async user => {
      const { email, projects } = user

      if (_isEmpty(projects) || _isNull(projects)) {
        return
      }

      const ids = _map(projects, p => p.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '7d'),
      )

      const result = {
        type: 'w', // week
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](weeklyReportsHandler) Error occured: ${reason}`,
      )
    })
  }

  // ON THE FIRST DAY OF EVERY MONTH AT 2 AM
  @Cron('0 02 1 * *')
  async monthlyReportsHandler(): Promise<void> {
    const users = await this.userService.find({
      where: {
        reportFrequency: ReportFrequency.MONTHLY,
      },
      relations: ['projects'],
      select: ['email'],
    })
    const now = dayjs.utc().format('DD.MM.YYYY')
    const weekAgo = dayjs.utc().subtract(1, 'M').format('DD.MM.YYYY')
    const date = `${weekAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(users, async user => {
      const { email, projects } = user

      if (_isEmpty(projects) || _isNull(projects)) {
        return
      }

      const ids = _map(projects, p => p.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '4w'),
      )

      const result = {
        type: 'M', // month
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](monthlyReportsHandler) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_QUARTER)
  async quarterlyReportsHandler(): Promise<void> {
    const users = await this.userService.find({
      where: {
        reportFrequency: ReportFrequency.QUARTERLY,
      },
      relations: ['projects'],
      select: ['email'],
    })
    const now = dayjs.utc().format('DD.MM.YYYY')
    const quarterAgo = dayjs.utc().subtract(3, 'M').format('DD.MM.YYYY')
    const date = `${quarterAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(users, async user => {
      const { email, projects } = user

      if (_isEmpty(projects) || _isNull(projects)) {
        return
      }

      const ids = _map(projects, p => p.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '3M'),
      )

      const result = {
        type: 'Q', // quarterly
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](quarterlyReportsHandler) Error occured: ${reason}`,
      )
    })
  }

  // EMAIL REPORTS, BUT FOR MULTIPLE PROJECT SUBSCRIBERS

  @Cron(CronExpression.EVERY_QUARTER)
  async handleQuarterlyReports(): Promise<void> {
    const subscribers = await this.projectService.getSubscribersForReports(
      ReportFrequency.QUARTERLY,
    )
    const now = dayjs.utc().format('DD.MM.YYYY')
    const quarterAgo = dayjs.utc().subtract(3, 'M').format('DD.MM.YYYY')
    const date = `${quarterAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(subscribers, async subscriber => {
      const { id, email } = subscriber
      const projects = await this.projectService.getSubscriberProjects(id)

      const ids = projects.map(project => project.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '3M'),
      )

      const result = {
        type: 'Q', // quarter
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleQuarterlyReports) Error occured: ${reason}`,
      )
    })
  }

  // ON THE FIRST DAY OF EVERY MONTH AT 3 AM
  @Cron('0 03 1 * *')
  async handleMonthlyReports(): Promise<void> {
    const subscribers = await this.projectService.getSubscribersForReports(
      ReportFrequency.MONTHLY,
    )
    const now = dayjs.utc().format('DD.MM.YYYY')
    const weekAgo = dayjs.utc().subtract(1, 'M').format('DD.MM.YYYY')
    const date = `${weekAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(subscribers, async subscriber => {
      const { id, email } = subscriber
      const projects = await this.projectService.getSubscriberProjects(id)

      const ids = projects.map(project => project.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '4w'),
      )

      const result = {
        type: 'M', // month
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleMonthlyReports) Error occured: ${reason}`,
      )
    })
  }

  // EVERY SUNDAY AT 3 AM
  @Cron('0 03 * * 0')
  async handleWeeklyReports(): Promise<void> {
    const subscribers = await this.projectService.getSubscribersForReports(
      ReportFrequency.WEEKLY,
    )
    const now = dayjs.utc().format('DD.MM.YYYY')
    const weekAgo = dayjs.utc().subtract(1, 'w').format('DD.MM.YYYY')
    const date = `${weekAgo} - ${now}`
    const tip = getRandomTip()

    const promises = _map(subscribers, async subscriber => {
      const { id, email } = subscriber
      const projects = await this.projectService.getSubscriberProjects(id)

      const ids = projects.map(project => project.id)
      const data = this.analyticsService.convertSummaryToObsoleteFormat(
        await this.analyticsService.getAnalyticsSummary(ids, '7d'),
      )

      const result = {
        type: 'w', // week
        date,
        projects: _map(ids, (pid, index) => ({
          data: data[pid],
          name: projects[index].name,
        })),
        tip,
      }

      await this.mailerService.sendEmail(
        email,
        LetterTemplate.ProjectReport,
        result,
        'broadcast',
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleWeeklyReports) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async getGeneralStats(): Promise<object> {
    const trafficQuery = 'SELECT count(*) FROM analytics'
    const customEVQuery = 'SELECT count(*) FROM customEV'
    const performanceQuery = 'SELECT count(*) FROM performance'
    const captchaQuery = 'SELECT count(*) FROM captcha'

    const users = await this.userService.count()
    const projects = await this.projectService.count()
    const events =
      (await clickhouse.query(trafficQuery).toPromise())[0]['count()'] +
      (await clickhouse.query(customEVQuery).toPromise())[0]['count()'] +
      (await clickhouse.query(performanceQuery).toPromise())[0]['count()'] +
      (await clickhouse.query(captchaQuery).toPromise())[0]['count()']

    await redis.set(REDIS_USERS_COUNT_KEY, users, 'EX', 630)
    await redis.set(REDIS_PROJECTS_COUNT_KEY, projects, 'EX', 630)
    await redis.set(REDIS_EVENTS_COUNT_KEY, events, 'EX', 630)

    return {
      users,
      projects,
      events,
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processSessionDuration(): Promise<void> {
    const keys = await redis.keys('sd:*')
    const toSave = []
    const now = _now()

    const promises = _map(keys, async key => {
      const [start, last] = (await redis.get(key)).split(':')
      const duration = now - Number(last)

      // storing to the DB if last interaction was more than 1 minute ago
      if (duration > 60000) {
        toSave.push([key, Number(last) - Number(start)])
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](processSessionDuration) Error occured: ${reason}`,
      )
    })

    if (_size(toSave) > 0) {
      await redis.del(..._map(toSave, ([key]) => key))

      const setSdurQuery = `ALTER TABLE analytics UPDATE sdur = sdur + CASE ${_map(
        toSave,
        ([key, duration]) =>
          `WHEN sid = '${key.split(':')[1]}' THEN ${duration / 1000}`, // converting to seconds
      ).join(' ')} END WHERE sid IN (${_map(
        toSave,
        ([key]) => `'${key.split(':')[1]}'`,
      ).join(',')})`

      await clickhouse.query(setSdurQuery).toPromise()
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkIsTelegramChatIdConfirmed(): Promise<void> {
    const users = await this.userService.find({
      where: {
        isTelegramChatIdConfirmed: false,
      },
      select: ['id', 'telegramChatId'],
    })

    const promises = _map(users, async user => {
      const { id } = user

      await this.userService.update(id, {
        telegramChatId: null,
      })
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](checkIsTelegramChatIdConfirmed) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async cleanUpUnpaidSubUsers(): Promise<void> {
    const users = await this.userService.find({
      where: {
        cancellationEffectiveDate: Not(IsNull()),
      },
    })

    const promises = _map(users, async user => {
      const cancellationEffectiveDate = new Date(user.cancellationEffectiveDate)
      const now = new Date()

      if (now > cancellationEffectiveDate) {
        await this.userService.update(user.id, {
          cancellationEffectiveDate: null,
          planCode: PlanCode.none,
          nextBillDate: null,
          billingFrequency: BillingFrequency.Monthly,
        })
        await this.projectService.clearProjectsRedisCache(user.id)
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](cleanUpUnpaidSubUsers) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  async trialReminder(): Promise<void> {
    const users = await this.userService.find({
      where: {
        planCode: PlanCode.trial,
        trialEndDate: Between(
          // between today & tomorrow
          new Date(),
          new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
        ),
        trialReminderSent: false,
      },
    })

    const promises = _map(users, async user => {
      const { id, email } = user

      await this.userService.update(id, {
        trialReminderSent: true,
      })
      await this.mailerService.sendEmail(
        email,
        LetterTemplate.TrialEndsTomorrow,
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(`[CRON WORKER](trialReminder) Error occured: ${reason}`)
    })
  }

  // A temporary fix for a bug that was causing trialEndDate to be null
  @Cron(CronExpression.EVERY_10_MINUTES)
  async fixAFuckingTrialEndDateNullBug(): Promise<void> {
    const users = await this.userService.find({
      where: {
        planCode: PlanCode.trial,
        trialEndDate: IsNull(),
      },
    })

    const promises = _map(users, async user => {
      const { id, created } = user

      await this.userService.update(id, {
        trialEndDate: new Date(
          new Date(created).getTime() + TRIAL_DURATION * 24 * 60 * 60 * 1000,
        ),
      })
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](fixAFuckingTrialEndDateNullBug) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async trialEnd(): Promise<void> {
    const users = await this.userService.find({
      where: [
        {
          planCode: PlanCode.trial,
          trialEndDate: LessThan(new Date()),
        },
        {
          planCode: PlanCode.trial,
          trialEndDate: IsNull(),
        },
      ],
    })

    const promises = _map(users, async user => {
      const { id, email } = user

      await this.userService.update(id, {
        planCode: PlanCode.none,
        // trialEndDate: null,
      })
      await this.mailerService.sendEmail(email, LetterTemplate.TrialExpired)
      await this.projectService.clearProjectsRedisCache(id)
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(`[CRON WORKER](trialEnd) Error occured: ${reason}`)
    })
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  // @Cron(CronExpression.EVERY_5_SECONDS)
  async checkOnlineUsersAlerts(): Promise<void> {
    const projects = await this.projectService.findWhere(
      {
        admin: {
          isTelegramChatIdConfirmed: true,
          planCode: Not(PlanCode.none),
        },
      },
      ['admin'],
    )

    const alerts = await this.alertService.findWhere(
      {
        project: In(_map(projects, 'id')),
        active: true,
        queryMetric: QueryMetric.ONLINE_USERS,
      },
      ['project'],
    )

    const promises = _map(alerts, async alert => {
      const project = _find(projects, { id: alert.project.id })

      if (alert.lastTriggered !== null) {
        const lastTriggered = new Date(alert.lastTriggered)
        const now = new Date()

        if (now.getTime() - lastTriggered.getTime() < 24 * 60 * 60 * 1000) {
          return
        }
      }

      const online = await this.analyticsService.getOnlineUserCount(project.id)

      if (online >= alert.queryValue) {
        // @ts-ignore
        await this.alertService.update(alert.id, {
          lastTriggered: new Date(),
        })
        if (project.admin && project.admin.isTelegramChatIdConfirmed) {
          this.telegramService.addMessage(
            project.admin.telegramChatId,
            `🔔 Alert *${alert.name}* got triggered!\nYour project *${project.name}* has *${online}* online users right now!`,
            {
              parse_mode: 'Markdown',
            },
          )
        }
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](checkOnlineUsersAlerts) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  // @Cron(CronExpression.EVERY_5_SECONDS)
  async checkMetricAlerts(): Promise<void> {
    const projects = await this.projectService.findWhere(
      {
        admin: {
          isTelegramChatIdConfirmed: true,
          planCode: Not(PlanCode.none),
        },
      },
      ['admin'],
    )

    const alerts = await this.alertService.findWhere(
      {
        project: In(_map(projects, 'id')),
        active: true,
        queryMetric: Not(QueryMetric.ONLINE_USERS),
      },
      ['project'],
    )

    const promises = _map(alerts, async alert => {
      const project = _find(projects, { id: alert.project.id })

      if (alert.lastTriggered !== null) {
        const lastTriggered = new Date(alert.lastTriggered)
        const now = new Date()

        if (now.getTime() - lastTriggered.getTime() < 24 * 60 * 60 * 1000) {
          return
        }
      }

      const isUnique = Number(
        alert.queryMetric === QueryMetric.UNIQUE_PAGE_VIEWS,
      )
      const time = getQueryTime(alert.queryTime)
      const createdCondition = getQueryCondition(alert.queryCondition)
      const query =
        alert.queryMetric === QueryMetric.CUSTOM_EVENTS
          ? `SELECT count() FROM customEV WHERE pid='${project.id}' AND ev={ev:String} AND created ${createdCondition} now() - ${time}`
          : `SELECT count() FROM analytics WHERE pid='${project.id}' AND unique = '${isUnique}' AND created ${createdCondition} now() - ${time}`

      const params = {
        ev: alert.queryCustomEvent,
      }
      const queryResult = await clickhouse.query(query, { params }).toPromise()

      const count = Number(queryResult[0]['count()'])

      if (count >= alert.queryValue) {
        // @ts-ignore
        await this.alertService.update(alert.id, {
          lastTriggered: new Date(),
        })

        const queryMetric =
          alert.queryMetric === QueryMetric.CUSTOM_EVENTS
            ? 'custom events'
            : alert.queryMetric === QueryMetric.UNIQUE_PAGE_VIEWS
              ? 'unique page views'
              : 'page views'
        const text = `🔔 Alert *${alert.name}* got triggered!\nYour project *${
          project.name
        }* has had *${count}*${
          alert.queryMetric === QueryMetric.CUSTOM_EVENTS
            ? ` "${alert.queryCustomEvent}"`
            : ''
        } ${queryMetric} in the last ${getQueryTimeString(alert.queryTime)}!`

        if (project.admin && project.admin.isTelegramChatIdConfirmed) {
          this.telegramService.addMessage(project.admin.telegramChatId, text, {
            parse_mode: 'Markdown',
          })
        }
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](checkMetricAlerts) Error occured: ${reason}`,
      )
    })
  }

  @Cron('0 * * * *')
  async handleNewExtensions() {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const newExtensions = await this.extensionsService.find({
      where: {
        createdAt: MoreThan(twoWeeksAgo),
      },
    })

    const newExtensionsPromise = _map(newExtensions, async extension => {
      if (!extension.tags.includes('New')) {
        extension.tags.push('New')
        await this.extensionsService.save(extension)
      }
    })

    await Promise.allSettled(newExtensionsPromise).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleNewExtensions) Error occured: ${reason}`,
      )
    })

    const oldExtensions = await this.extensionsService.find({
      where: {
        createdAt: LessThan(twoWeeksAgo),
        tags: Like('%New%'),
      },
    })

    const oldExtensionsPromise = _map(oldExtensions, async extension => {
      extension.tags = extension.tags.filter(tag => tag !== 'New')
      await this.extensionsService.save(extension)
    })

    await Promise.allSettled(oldExtensionsPromise).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleNewExtensions) Error occured: ${reason}`,
      )
    })
  }

  @Cron('0 * * * *')
  async handleTrendingExtensions() {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const extensions = await this.extensionsService.find({
      where: {
        createdAt: MoreThan(twoWeeksAgo),
      },
    })

    const promises = _map(extensions, async extension => {
      const currentInstalls =
        await this.extensionsService.getExtensionInstallCount(extension.id)
      const twoWeeksBeforeInstalls =
        await this.extensionsService.getExtensionInstallCount(
          extension.id,
          twoWeeksAgo,
        )

      if (
        currentInstalls > twoWeeksBeforeInstalls * 2 &&
        currentInstalls > 0.9 * (await this.getAverageInstalls(extensions))
      ) {
        if (!extension.tags.includes('Trending')) {
          extension.tags.push('Trending')
          await this.extensionsService.save(extension)
        }
      } else if (extension.tags.includes('Trending')) {
        extension.tags = extension.tags.filter(tag => tag !== 'Trending')
        await this.extensionsService.save(extension)
      }
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](handleTrendingExtensions) Error occured: ${reason}`,
      )
    })
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dropClickhouseLogs(): Promise<void> {
    const queries = [
      'DROP TABLE IF EXISTS system.asynchronous_metric_log',
      'DROP TABLE IF EXISTS system.metric_log',
      'DROP TABLE IF EXISTS system.query_log',
      'DROP TABLE IF EXISTS system.trace_log',
      'DROP TABLE IF EXISTS system.part_log',
    ]

    const promises = _map(queries, async query => {
      await clickhouse.query(query).toPromise()
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](dropClickhouseLogs) Error occured: ${reason}`,
      )
    })
  }

  private async getAverageInstalls(
    extensions: Extension[],
    twoWeeksAgo?: Date,
  ) {
    let totalInstalls = 0

    const promises = _map(extensions, async extension => {
      totalInstalls += await this.extensionsService.getExtensionInstallCount(
        extension.id,
        twoWeeksAgo,
      )
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        `[CRON WORKER](getAverageInstalls) Error occured: ${reason}`,
      )
      return 0
    })

    return totalInstalls / extensions.length
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async sendTelegramMessages() {
    try {
      const messages = await this.telegramService.getMessages()

      messages.forEach(async message => {
        try {
          await this.telegramService.sendMessage(
            message.id,
            message.chatId,
            message.text,
            message.extra,
          )
        } catch (e) {
          this.logger.error(
            `[CRON WORKER](sendTelegramMessages) Error occured while sending message: ${e}`,
          )
          await this.telegramService.deleteMessage(message.id)
        }
      })
    } catch (error) {
      this.logger.error(
        `[CRON WORKER](sendTelegramMessages) Error occured: ${error}`,
      )
    }
  }

  // Disable reports for inactive users
  // Some people stop using Swetrix but keep the account (and don't disable the email reports in settings), so why keep spamming them?
  // EVERY SUNDAY AT 2:00 AM (right before we send weekly reports)
  @Cron('0 02 * * 0')
  async disableReportsForInactiveUsers(): Promise<void> {
    const users = await this.userService.find({
      where: {
        reportFrequency: Not(ReportFrequency.NEVER),
      },
      relations: ['projects'],
      select: ['id'],
    })
    const now = dayjs.utc().format('YYYY-MM-DD')
    // a bit more than 2 months ago
    const nineWeeksAgo = dayjs.utc().subtract(9, 'w').format('YYYY-MM-DD')

    const promises = _map(users, async user => {
      const { id, projects } = user

      if (_isEmpty(projects) || _isNull(projects)) {
        return
      }

      const pidsStringified = _map(projects, p => `'${p.id}'`).join(',')
      // No need to check for performance activity because it's not tracked without tracking analytics
      const queryAnalytics = `SELECT count() FROM analytics WHERE pid IN (${pidsStringified}) AND created BETWEEN '${nineWeeksAgo}' AND '${now}'`
      const queryCaptcha = `SELECT count() FROM captcha WHERE pid IN (${pidsStringified}) AND created BETWEEN '${nineWeeksAgo}' AND '${now}'`
      const queryCustomEvents = `SELECT count() FROM customEV WHERE pid IN (${pidsStringified}) AND created BETWEEN '${nineWeeksAgo}' AND '${now}'`

      const hasAnalyticsActivity =
        Number(
          (await clickhouse.query(queryAnalytics).toPromise())[0]['count()'],
        ) > 0

      if (hasAnalyticsActivity) {
        return
      }

      const hasCaptchaActivity =
        Number(
          (await clickhouse.query(queryCaptcha).toPromise())[0]['count()'],
        ) > 0

      if (hasCaptchaActivity) {
        return
      }

      const hasCustomEventsActivity =
        Number(
          (await clickhouse.query(queryCustomEvents).toPromise())[0]['count()'],
        ) > 0

      if (hasCustomEventsActivity) {
        return
      }

      await this.userService.update(id, {
        reportFrequency: ReportFrequency.NEVER,
      })
    })

    await Promise.allSettled(promises).catch(reason => {
      this.logger.error(
        '[CRON WORKER](disableReportsForInactiveUsers) Error occured:',
        reason,
      )
    })
  }

  // Delete old refresh tokens
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async deleteOldRefreshTokens(): Promise<void> {
    const minDate = dayjs
      .utc()
      .subtract(JWT_REFRESH_TOKEN_LIFETIME, 's')
      .format('YYYY-MM-DD HH:mm:ss')

    const where: Record<string, unknown> = {
      created: LessThan(minDate),
    }

    await this.userService.deleteRefreshTokensWhere(where)
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_NOON)
  async payReferrers(): Promise<void> {
    if (isDevelopment || !paypalClient) {
      return
    }

    const payoutsToProcess = await this.payoutsService.find({
      where: {
        status: PayoutStatus.processing,
      },
      relations: ['user'],
    })

    if (_isEmpty(payoutsToProcess)) {
      return
    }

    // A map of emails to pay and their amounts
    const payouts = {}

    for (let i = 0; i < _size(payoutsToProcess); ++i) {
      const key = payoutsToProcess[i].user.paypalPaymentsEmail

      if (!key) {
        continue
      }

      if (!payouts[key]) {
        payouts[key] = {
          amount: 0,
          payoutsIds: [],
        }
      }

      payouts[key].amount += _toNumber(payoutsToProcess[i].amount)
      payouts[key].payoutsIds.push(payoutsToProcess[i].id)
    }

    const requestBody = {
      sender_batch_header: {
        recipient_type: 'EMAIL',
        email_message: 'Swetrix referral program payout.',
        note: 'Swetrix referral program payout.',
      },
      items: _reduce(
        payouts,
        (acc, value, key) => {
          acc.push({
            recipient_type: 'EMAIL',
            amount: {
              value: value.amount.toFixed(2),
              currency: 'USD',
            },
            receiver: key,
            note: `Your Swetrix $${value.amount.toFixed(2)} payout.`,
          })

          return acc
        },
        [],
      ),
    }

    // Send the request to PayPal
    const request = new Paypal.payouts.PayoutsPostRequest()
    request.requestBody(requestBody)

    const response = await paypalClient.execute(request)

    if (response.statusCode !== 201) {
      console.error(
        `[CRON](payReferrers) An error occured while executing a request to pay referrers: ${JSON.stringify(
          response,
          null,
          2,
        )}`,
      )
      console.error(`Payouts: ${JSON.stringify(payouts, null, 2)}`)

      // Update the payouts in the DB
      await this.payoutsService.update(
        {
          where: {
            id: In(_map(payoutsToProcess, 'id')),
          },
        },
        {
          status: PayoutStatus.suspended,
        },
      )
      return
    }

    // Update the payouts in the DB
    await this.payoutsService.update(
      {
        where: {
          id: In(_map(payoutsToProcess, 'id')),
        },
      },
      {
        status: PayoutStatus.paid,
        transactionId: response.result?.batch_header?.payout_batch_id,
      },
    )
  }
}
