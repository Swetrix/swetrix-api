import {
  Controller,
  Query,
  Req,
  Body,
  Param,
  Get,
  Post,
  Put,
  Delete,
  HttpCode,
  BadRequestException,
  UseGuards,
  MethodNotAllowedException,
  ConflictException,
  Headers,
  Ip,
  Patch,
  NotFoundException,
} from '@nestjs/common'
import { Request } from 'express'
import { ApiTags, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as _map from 'lodash/map'
import * as _join from 'lodash/join'
import * as _isNull from 'lodash/isNull'
import * as _isEmpty from 'lodash/isEmpty'
import * as _includes from 'lodash/includes'
import * as _isString from 'lodash/isString'
import * as _omit from 'lodash/omit'
import * as _round from 'lodash/round'
import { v4 as uuidv4 } from 'uuid'

import { Markup } from 'telegraf'
import { Counter } from 'prom-client'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { JwtAccessTokenGuard } from '../auth/guards'

import { Public, Roles, CurrentUserId } from '../auth/decorators'
import { TelegramService } from '../integrations/telegram/telegram.service'
import { UserService } from './user.service'
import { ProjectService, deleteProjectRedis } from '../project/project.service'
import {
  User,
  UserType,
  MAX_EMAIL_REQUESTS,
  PlanCode,
  Theme,
} from './entities/user.entity'
import { Pagination } from '../common/pagination/pagination'
import {
  GDPR_EXPORT_TIMEFRAME,
  isDevelopment,
  PRODUCTION_ORIGIN,
} from '../common/constants'
import { clickhouse } from '../common/integrations/clickhouse'
import { RolesGuard } from '../auth/guards/roles.guard'
import { UpdateUserProfileDTO } from './dto/update-user.dto'
import { IChangePlanDTO } from './dto/change-plan.dto'
import { AdminUpdateUserProfileDTO } from './dto/admin-update-user.dto'
import { SetShowLiveVisitorsDTO } from './dto/set-show-live-visitors.dto'
import { ActionTokensService } from '../action-tokens/action-tokens.service'
import { MailerService } from '../mailer/mailer.service'
import { ActionTokenType } from '../action-tokens/action-token.entity'
import { AuthService } from '../auth/auth.service'
import { LetterTemplate } from '../mailer/letter'
import { AppLoggerService } from '../logger/logger.service'
import { UserProfileDTO } from './dto/user.dto'
import { DeleteSelfDTO } from './dto/delete-self.dto'
import {
  checkRateLimit,
  getGeoDetails,
  getIPFromHeaders,
  generateRefCode,
} from '../common/utils'
import { IUsageInfo, IMetaInfo } from './interfaces'
import { ReportFrequency } from '../project/enums'

dayjs.extend(utc)

const UNPAID_PLANS = [PlanCode.free, PlanCode.trial, PlanCode.none]

@ApiTags('User')
@Controller('user')
@UseGuards(JwtAccessTokenGuard, RolesGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly projectService: ProjectService,
    private readonly actionTokensService: ActionTokensService,
    private readonly mailerService: MailerService,
    private readonly logger: AppLoggerService,
    private readonly telegramService: TelegramService,
    @InjectMetric('export_user_data_count')
    private readonly exportUserDataCount: Counter<string>,
  ) {}

  @ApiBearerAuth()
  @Get('/me')
  @UseGuards(RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async me(@CurrentUserId() user_id: string): Promise<Partial<User>> {
    this.logger.log({ user_id }, 'GET /user/me')

    const sharedProjects = await this.projectService.findShare({
      where: {
        user: user_id,
      },
      relations: ['project'],
    })
    const user = this.userService.omitSensitiveData(
      await this.userService.findOne(user_id),
    )

    user.sharedProjects = sharedProjects

    return user
  }

  @ApiBearerAuth()
  @Get('/')
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  async get(
    @Query('take') take: number | undefined,
    @Query('skip') skip: number | undefined,
  ): Promise<Pagination<User> | User[]> {
    this.logger.log({ take, skip }, 'GET /user')
    return this.userService.paginate({ take, skip })
  }

  @ApiBearerAuth()
  @Put('/theme')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async setTheme(
    @CurrentUserId() userId: string,
    @Body('theme') theme: Theme,
  ): Promise<User> {
    return this.userService.update(userId, { theme })
  }

  @ApiBearerAuth()
  @Put('/live-visitors')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async setShowLiveVisitors(
    @CurrentUserId() userId: string,
    @Body() body: SetShowLiveVisitorsDTO,
  ): Promise<Partial<User>> {
    const { show } = body

    await this.userService.update(userId, { showLiveVisitorsInTitle: show })

    return {
      showLiveVisitorsInTitle: show,
    }
  }

  @ApiBearerAuth()
  @Get('/search')
  @ApiQuery({ name: 'query', required: false })
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  async searchUsers(
    @Query('query') query: string | undefined,
  ): Promise<User[]> {
    this.logger.log({ query }, 'GET /user/search')
    return this.userService.search(query)
  }

  @ApiBearerAuth()
  @Post('/')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  async create(@Body() userDTO: UserProfileDTO): Promise<User | null> {
    this.logger.log({ userDTO }, 'POST /user')
    this.userService.validatePassword(userDTO.password)
    userDTO.password = await this.authService.hashPassword(userDTO.password)

    try {
      const user = await this.userService.create({ ...userDTO, isActive: true })
      return user
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        if (e.sqlMessage.includes(userDTO.email)) {
          throw new BadRequestException('User with this email already exists')
        }
      }
    }

    return null
  }

  @ApiBearerAuth()
  @Post('/recieve-login-notifications')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async receiveLoginNotifications(
    @CurrentUserId() userId: string,
    @Body('receiveLoginNotifications') receiveLoginNotifications: boolean,
  ): Promise<User> {
    this.logger.log(
      { userId, receiveLoginNotifications },
      'POST /user/recieve-login-notifications',
    )

    return this.userService.update(userId, { receiveLoginNotifications })
  }

  @ApiBearerAuth()
  @Patch('/set-paypal-email')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async setPaypalEmail(
    @CurrentUserId() userId: string,
    @Body('paypalPaymentsEmail') paypalPaymentsEmail: string,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<User> {
    this.logger.log(
      { userId, paypalPaymentsEmail },
      'PATCH /user/set-paypal-email',
    )

    const ip = getIPFromHeaders(headers) || reqIP || ''

    await checkRateLimit(ip, 'set-paypal-email', 10, 3600)

    const user = await this.userService.findOne(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    await this.mailerService.sendEmail(
      user.email,
      LetterTemplate.PayPalEmailUpdate,
    )

    return this.userService.update(userId, {
      paypalPaymentsEmail: paypalPaymentsEmail || null,
    })
  }

  @ApiBearerAuth()
  @Post('/api-key')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async generateApiKey(
    @CurrentUserId() userId: string,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<{
    apiKey: string
  }> {
    this.logger.log({ userId }, 'POST /user/api-key')

    const ip = getIPFromHeaders(headers) || reqIP || ''

    await checkRateLimit(ip, 'generate-api-key', 5, 3600)

    const user = await this.userService.findOne(userId)

    if (!_isNull(user.apiKey)) {
      throw new ConflictException('You already have an API key')
    }

    const apiKey: string = uuidv4()

    await this.userService.update(userId, { apiKey })

    return { apiKey }
  }

  @ApiBearerAuth()
  @Delete('/api-key')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async deleteApiKey(@CurrentUserId() userId: string): Promise<void> {
    this.logger.log({ userId }, 'DELETE /user/api-key')

    const user = await this.userService.findOne(userId)

    if (_isNull(user.apiKey)) {
      throw new ConflictException("You don't have an API key")
    }

    await this.userService.update(userId, { apiKey: null })
  }

  @ApiBearerAuth()
  @Delete('/:id')
  @HttpCode(204)
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  async delete(
    @Param('id') id: string,
    @CurrentUserId() uid: string,
  ): Promise<any> {
    this.logger.log({ id, uid }, 'DELETE /user/:id')
    const user = await this.userService.findOne(id, {
      relations: ['projects'],
      select: ['id', 'planCode'],
    })

    if (_isEmpty(user)) {
      throw new BadRequestException(`User with id ${id} does not exist`)
    }

    if (!_includes(UNPAID_PLANS, user.planCode)) {
      throw new BadRequestException('cancelSubFirst')
    }

    try {
      if (!_isEmpty(user.projects)) {
        const pids = _join(
          _map(user.projects, el => `'${el.id}'`),
          ',',
        )

        const queries = [
          `ALTER table analytics DELETE WHERE pid IN (${pids})`,
          `ALTER table customEV DELETE WHERE pid IN (${pids})`,
          `ALTER table performance DELETE WHERE pid IN (${pids})`,
          `ALTER table errors DELETE WHERE pid IN (${pids})`,
          `ALTER table error_statuses DELETE WHERE pid IN (${pids})`,
          `ALTER table captcha DELETE WHERE pid IN (${pids})`,
        ]

        await this.projectService.deleteMultiple(pids)

        const promises = _map(queries, async query =>
          clickhouse.query({
            query,
          }),
        )
        await Promise.all(promises)
      }
      await this.actionTokensService.deleteMultiple(`userId="${id}"`)
      await this.userService.delete(id)

      return 'accountDeleted'
    } catch (e) {
      this.logger.error(e)
      throw new BadRequestException('accountDeleteError')
    }
  }

  @ApiBearerAuth()
  @Delete('/')
  @HttpCode(204)
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async deleteSelf(
    @CurrentUserId() id: string,
    @Body() deleteSelfDTO: DeleteSelfDTO,
  ): Promise<any> {
    this.logger.log({ id }, 'DELETE /user')

    const user = await this.userService.findOne(id, {
      relations: ['projects'],
      select: ['id', 'planCode'],
    })

    if (!_includes(UNPAID_PLANS, user.planCode)) {
      throw new BadRequestException('cancelSubFirst')
    }

    try {
      if (!_isEmpty(user.projects)) {
        const pids = _join(
          _map(user.projects, el => `'${el.id}'`),
          ',',
        )
        const queries = [
          `ALTER table analytics DELETE WHERE pid IN (${pids})`,
          `ALTER table customEV DELETE WHERE pid IN (${pids})`,
          `ALTER table performance DELETE WHERE pid IN (${pids})`,
          `ALTER table errors DELETE WHERE pid IN (${pids})`,
          `ALTER table error_statuses DELETE WHERE pid IN (${pids})`,
          `ALTER table captcha DELETE WHERE pid IN (${pids})`,
        ]
        await this.projectService.deleteMultiple(pids)
        const promises = _map(queries, async query =>
          clickhouse.query({
            query,
          }),
        )
        await Promise.all(promises)
      }
      await this.actionTokensService.deleteMultiple(`userId="${id}"`)
      await this.userService.delete(id)
    } catch (e) {
      this.logger.error(e)
      throw new BadRequestException('accountDeleteError')
    }

    try {
      if (deleteSelfDTO.feedback) {
        await this.userService.saveDeleteFeedback(deleteSelfDTO.feedback)
      }
    } catch (reason) {
      this.logger.error(
        '[ERROR] Failed to save account deletion feedback:',
        reason,
      )
      this.logger.error('DeleteSelfDTO: ', deleteSelfDTO)
    }

    return 'accountDeleted'
  }

  @ApiBearerAuth()
  @Delete('/share/:shareId')
  @HttpCode(204)
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  @ApiResponse({ status: 204, description: 'Empty body' })
  async deleteShare(
    @Param('shareId') shareId: string,
    @CurrentUserId() uid: string,
  ): Promise<any> {
    this.logger.log({ uid, shareId }, 'DELETE /user/share/:shareId')

    const share = await this.projectService.findOneShare(shareId, {
      relations: ['user', 'project'],
    })

    if (_isEmpty(share)) {
      throw new BadRequestException('The provided share ID is not valid')
    }

    if (share.user?.id !== uid) {
      throw new BadRequestException('You are not allowed to delete this share')
    }

    await this.projectService.deleteShare(shareId)
    await deleteProjectRedis(share.project.id)

    return 'shareDeleted'
  }

  @ApiBearerAuth()
  @Get('/share/:shareId')
  @HttpCode(204)
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  @ApiResponse({ status: 204, description: 'Empty body' })
  async acceptShare(
    @Param('shareId') shareId: string,
    @CurrentUserId() uid: string,
  ): Promise<any> {
    this.logger.log({ uid, shareId }, 'GET /user/share/:shareId')

    const share = await this.projectService.findOneShare(shareId, {
      relations: ['user', 'project'],
    })

    if (_isEmpty(share)) {
      throw new BadRequestException('The provided share ID is not valid')
    }

    if (share.user?.id !== uid) {
      throw new BadRequestException('You are not allowed to delete this share')
    }

    share.confirmed = true

    await this.projectService.updateShare(shareId, share)
    await deleteProjectRedis(share.project.id)

    return 'shareAccepted'
  }

  @ApiBearerAuth()
  @Post('/confirm_email')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async sendEmailConfirmation(
    @CurrentUserId() id: string,
    @Req() request: Request,
  ): Promise<boolean> {
    this.logger.log({ id }, 'POST /user/confirm_email')

    const user = await this.userService.findOneWhere({ id })

    if (
      !user ||
      !user.email ||
      user.isActive ||
      user.emailRequests >= MAX_EMAIL_REQUESTS
    )
      return false

    const token = await this.actionTokensService.createForUser(
      user,
      ActionTokenType.EMAIL_VERIFICATION,
      user.email,
    )
    const url = `${
      isDevelopment ? request.headers.origin : PRODUCTION_ORIGIN
    }/verify/${token.id}`

    await this.userService.update(id, { emailRequests: 1 + user.emailRequests })
    await this.mailerService.sendEmail(user.email, LetterTemplate.SignUp, {
      url,
    })
    return true
  }

  @ApiBearerAuth()
  @Put('/:id')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN)
  async update(
    @Body() userDTO: AdminUpdateUserProfileDTO,
    @Param('id') id: string,
  ): Promise<Partial<User>> {
    this.logger.log({ userDTO, id }, 'PUT /user/:id')

    if (userDTO.password) {
      this.userService.validatePassword(userDTO.password)
      userDTO.password = await this.authService.hashPassword(userDTO.password)
    }

    const user = await this.userService.findOneWhere({ id })

    try {
      if (!user) {
        await this.userService.create({ ...userDTO })
      }
      await this.userService.update(id, { ...user, ...userDTO })
      // omit sensitive data before returning using this.userService.omitSensitiveData function
      return this.userService.omitSensitiveData(
        await this.userService.findOne(id),
      )
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        if (e.sqlMessage.includes(userDTO.email)) {
          throw new BadRequestException('User with this email already exists')
        }
      }
      throw new BadRequestException(e.message)
    }
  }

  @ApiBearerAuth()
  @Delete('/tg/:id')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  @HttpCode(204)
  async deleteTelegramConnection(
    @Param('id') tgID: string,
    @CurrentUserId() id: string,
  ): Promise<any> {
    this.logger.log({ tgID, id }, 'DELETE /user/tg/:id')

    const user = await this.userService.findOneWhere({ id })

    if (tgID && user.telegramChatId === tgID) {
      await this.userService.update(id, {
        telegramChatId: null,
        isTelegramChatIdConfirmed: false,
      })
    }
  }

  @ApiBearerAuth()
  @Put('/')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async updateCurrentUser(
    @Body() userDTO: UpdateUserProfileDTO,
    @CurrentUserId() id: string,
    @Req() request: Request,
  ): Promise<Partial<User>> {
    this.logger.log({ userDTO, id }, 'PUT /user')
    const user = await this.userService.findOneWhere({ id })

    const shouldUpdatePassword =
      !_isEmpty(userDTO.password) && _isString(userDTO.password)

    if (shouldUpdatePassword) {
      // Validate new password
      this.userService.validatePassword(userDTO.password)

      // Hash new password
      userDTO.password = await this.authService.hashPassword(userDTO.password)
    }

    try {
      if (userDTO.email && user.email !== userDTO.email) {
        const userWithByEmail = await this.userService.findOneWhere({
          email: userDTO.email,
        })

        if (userWithByEmail) {
          throw new BadRequestException('User with this email already exists')
        }

        const token = await this.actionTokensService.createForUser(
          user,
          ActionTokenType.EMAIL_CHANGE,
          userDTO.email,
        )
        const url = `${
          isDevelopment ? request.headers.origin : PRODUCTION_ORIGIN
        }/change-email/${token.id}`
        await this.mailerService.sendEmail(
          user.email,
          LetterTemplate.MailAddressChangeConfirmation,
          { url },
        )
      }

      if (
        userDTO.telegramChatId &&
        user.telegramChatId !== userDTO.telegramChatId
      ) {
        const userWithByTelegramChatId = await this.userService.findOneWhere({
          telegramChatId: userDTO.telegramChatId,
        })

        if (userWithByTelegramChatId) {
          throw new BadRequestException(
            'User with this Telegram chat ID already exists',
          )
        }

        await this.userService.update(id, {
          isTelegramChatIdConfirmed: false,
        })

        this.telegramService.addMessage(
          userDTO.telegramChatId,
          'Please confirm your Telegram chat ID',
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '✅ Confirm',
                `link-account:confirm:${id}`,
              ),
              Markup.button.callback('❌ Cancel', `link-account:cancel:${id}`),
            ],
          ]),
        )
      }

      if (userDTO.timeFormat && user.timeFormat !== userDTO.timeFormat) {
        await this.userService.update(id, {
          timeFormat: userDTO.timeFormat,
        })
      }

      // delete internal properties from userDTO before updating it
      // todo: use _pick instead of _omit
      const userToUpdate = _omit(userDTO, [
        'id',
        'sharedProjects',
        'isActive',
        'evWarningSentOn',
        'exportedAt',
        'subID',
        'subUpdateURL',
        'subCancelURL',
        'projects',
        'actionTokens',
        'roles',
        'created',
        'updated',
        'planCode',
        'billingFrequency',
        'nextBillDate',
        'twoFactorRecoveryCode',
        'twoFactorAuthenticationSecret',
        'isTwoFactorAuthenticationEnabled',
        'isTelegramChatIdConfirmed',
        'trialEndDate',
        'cancellationEffectiveDate',
        'trialReminderSent',
        'googleId',
        'registeredWithGoogle',
        'githubId',
        'registeredWithGithub',
        'apiKey',
        'emailRequests',
        'refCode',
        'referrerID',
        'maxProjects',
        'planExceedContactedAt',
        'dashboardBlockReason',
        'isAccountBillingSuspended',
      ])
      await this.userService.update(id, userToUpdate)

      // If password should have been updated and there were no issues doing so, then...
      if (shouldUpdatePassword) {
        // Send 'Password changed' email notification
        await this.mailerService.sendEmail(
          userDTO.email,
          LetterTemplate.PasswordChanged,
        )

        // Log out all user sessions
        await this.authService.logoutAll(id)
      }

      const updatedUser = await this.userService.findOneWhere({ id })
      return this.userService.omitSensitiveData(updatedUser)
    } catch (e) {
      throw new BadRequestException(e.message)
    }
  }

  // @ApiBearerAuth()
  // @Get('payouts/list')
  // @ApiQuery({ name: 'take', required: false })
  // @ApiQuery({ name: 'skip', required: false })
  // @UseGuards(JwtAccessTokenGuard, RolesGuard)
  // @Roles(UserType.CUSTOMER, UserType.ADMIN)
  // async getPayoutsList(
  //   @CurrentUserId() id: string,
  //   @Query('take') take: number | undefined,
  //   @Query('skip') skip: number | undefined,
  // ): Promise<Pagination<Payout> | Payout[]> {
  //   this.logger.log({ id, take, skip }, 'GET /user/payouts/list')

  //   const user = await this.userService.findOneWhere({ id })

  //   if (!user) {
  //     throw new BadRequestException('User not found')
  //   }

  //   return this.userService.getPayoutsList(user)
  // }

  @ApiBearerAuth()
  @Get('referrals')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async getReferralsList(@CurrentUserId() id: string): Promise<any> {
    this.logger.log({ id }, 'GET /user/referrals')

    const user = await this.userService.findOneWhere({ id })

    if (!user) {
      throw new BadRequestException('User not found')
    }

    return this.userService.getReferralsList(user)
  }

  @ApiBearerAuth()
  @Get('payouts/info')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async getPayoutsInfo(@CurrentUserId() id: string): Promise<any> {
    this.logger.log({ id }, 'GET /user/payouts/info')

    const user = await this.userService.findOneWhere({ id })

    if (!user) {
      throw new BadRequestException('User not found')
    }

    return this.userService.getPayoutsInfo(user)
  }

  @ApiBearerAuth()
  @Post('generate-ref-code')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async generateRefCode(@CurrentUserId() id: string): Promise<any> {
    this.logger.log({ id }, 'POST /user/generate-ref-code')

    const user = await this.userService.findOneWhere({ id })

    if (!user) {
      throw new BadRequestException('User not found')
    }

    if (user.refCode) {
      throw new BadRequestException('Referral code already exists')
    }

    let refCode = generateRefCode()

    // eslint-disable-next-line no-await-in-loop
    while (!(await this.userService.isRefCodeUnique(refCode))) {
      refCode = generateRefCode()
    }

    await this.userService.update(id, { refCode })

    return {
      refCode,
    }
  }

  @ApiBearerAuth()
  @Get('/export')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async exportUserData(@CurrentUserId() user_id: string): Promise<User> {
    this.logger.log({ user_id }, 'GET /user/export')
    const user = await this.userService.findOneWhere({ id: user_id })
    const where = Object({ admin: user_id })
    const projects = await this.projectService.findWhere(where, ['alerts'])

    if (
      !_isNull(user.exportedAt) &&
      !dayjs().isAfter(
        dayjs.utc(user.exportedAt).add(GDPR_EXPORT_TIMEFRAME, 'day'),
        'day',
      )
    ) {
      throw new MethodNotAllowedException(
        `Please, try again later. You can request a GDPR Export only once per ${GDPR_EXPORT_TIMEFRAME} days.`,
      )
    }

    const data = {
      user: {
        ...user,
        created: dayjs(user.created).format('YYYY/MM/DD HH:mm:ss'),
        updated: dayjs(user.updated).format('YYYY/MM/DD HH:mm:ss'),
        cancellationEffectiveDate: _isNull(user.cancellationEffectiveDate)
          ? '-'
          : dayjs(user.cancellationEffectiveDate).format('YYYY/MM/DD HH:mm:ss'),
        planExceedContactedAt: _isNull(user.planExceedContactedAt)
          ? '-'
          : dayjs(user.planExceedContactedAt).format('YYYY/MM/DD HH:mm:ss'),
        exportedAt: _isNull(user.exportedAt)
          ? '-'
          : dayjs(user.exportedAt).format('YYYY/MM/DD HH:mm:ss'),
        evWarningSentOn: _isNull(user.evWarningSentOn)
          ? '-'
          : dayjs(user.evWarningSentOn).format('YYYY/MM/DD HH:mm:ss'),
        subID: user.subID || '-',
        subUpdateURL: user.subUpdateURL || '-',
        subCancelURL: user.subCancelURL || '-',
        telegramChatId: user.telegramChatId || '-',
        dashboardBlockReason: user.dashboardBlockReason || '-',
        refCode: user.refCode || '-',
        referrerID: user.referrerID || '-',
        paypalPaymentsEmail: user.paypalPaymentsEmail || '-',
        tierCurrency: user.tierCurrency || '-',
        nickname: user.nickname || '-',
      },
      projects: _map(projects, project => ({
        ...project,
        created: dayjs(project.created).format('YYYY/MM/DD HH:mm:ss'),
        origins: _join(project.origins, ', '),
        ipBlacklist: _join(project.ipBlacklist, ', '),
      })),
    }

    await this.mailerService.sendEmail(
      user.email,
      LetterTemplate.GDPRDataExport,
      data,
    )
    await this.userService.update(user.id, {
      exportedAt: dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
    })

    this.exportUserDataCount.inc()
    return user
  }

  @Get('metainfo')
  @Public()
  async getMetaInfo(
    @Headers() headers,
    @Ip() reqIP: string,
  ): Promise<IMetaInfo> {
    const ip = getIPFromHeaders(headers) || reqIP || ''
    const { country } = getGeoDetails(ip)

    return {
      country,
      ...this.userService.getCurrencyByCountry(country),
    }
  }

  @Get('usageinfo')
  async getUsageInfo(@CurrentUserId() uid: string): Promise<IUsageInfo> {
    const rawInfo = await this.projectService.getRedisUsageInfo(uid)

    const info: IUsageInfo = {
      ...rawInfo,
      trafficPerc: _round((rawInfo.traffic / rawInfo.total) * 100, 2),
      customEventsPerc: _round((rawInfo.customEvents / rawInfo.total) * 100, 2),
      captchaPerc: _round((rawInfo.captcha / rawInfo.total) * 100, 2),
      errorsPerc: _round((rawInfo.errors / rawInfo.total) * 100, 2),
    }

    return info
  }

  @ApiBearerAuth()
  @Post('change-plan')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async changePlan(
    @CurrentUserId() id: string,
    @Body() body: IChangePlanDTO,
  ): Promise<void> {
    this.logger.log({ body, id }, 'POST /change-plan')
    const { planId } = body

    await this.userService.updateSubscription(id, planId)
    await this.projectService.clearProjectsRedisCache(id)
  }

  @ApiBearerAuth()
  @Post('preview-plan')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.CUSTOMER, UserType.ADMIN)
  async previewPlan(
    @CurrentUserId() id: string,
    @Body() body: IChangePlanDTO,
  ): Promise<any> {
    this.logger.log({ body, id }, 'POST /preview-plan')
    const { planId } = body

    return this.userService.previewSubscription(id, planId)
  }

  // Used to unsubscribe from email reports
  @Get('/unsubscribe/:token')
  @Public()
  @ApiResponse({ status: 204 })
  async unsubscribeFromEmailReports(
    @Param('token') token: string,
  ): Promise<void> {
    this.logger.log({ token }, 'GET /project/unsubscribe/:token')

    let userId

    try {
      userId = this.userService.decryptUnsubscribeKey(token)
    } catch {
      throw new NotFoundException('Unsubscribe token is invalid')
    }

    const user = await this.userService.findOneWhere({
      id: userId,
    })

    if (!user) {
      throw new NotFoundException('Unsubscribe token is invalid')
    }

    await this.userService.update(userId, {
      reportFrequency: ReportFrequency.NEVER,
    })
  }
}
