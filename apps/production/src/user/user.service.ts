import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import axios from 'axios'
import * as CryptoJS from 'crypto-js'
import * as dayjs from 'dayjs'
import * as _isEmpty from 'lodash/isEmpty'
import * as _size from 'lodash/size'
import * as _omit from 'lodash/omit'
import * as _isNull from 'lodash/isNull'
import * as _toNumber from 'lodash/toNumber'

import { Pagination, PaginationOptionsInterface } from '../common/pagination'
import { PayoutsService } from '../payouts/payouts.service'
import {
  User,
  ACCOUNT_PLANS,
  TRIAL_DURATION,
  BillingFrequency,
  PlanCode,
} from './entities/user.entity'
import { PayoutStatus } from '../payouts/entities/payouts.entity'
import { UserProfileDTO } from './dto/user.dto'
import { RefreshToken } from './entities/refresh-token.entity'
import { DeleteFeedback } from './entities/delete-feedback.entity'
import { UserGoogleDTO } from './dto/user-google.dto'
import { UserGithubDTO } from './dto/user-github.dto'
import { EMAIL_ACTION_ENCRYPTION_KEY } from '../common/constants'
import { UserWebhookEntity } from './entities/user.webhook.entity'

const EUR = {
  symbol: '€',
  code: 'EUR',
}

const USD = {
  symbol: '$',
  code: 'USD',
}

const GBP = {
  symbol: '£',
  code: 'GBP',
}

const getSymbolByCode = (code: string) => {
  switch (code) {
    case EUR.code:
      return EUR.symbol
    case USD.code:
      return USD.symbol
    case GBP.code:
      return GBP.symbol
    default:
      return null
  }
}

const CURRENCY_BY_COUNTRY = {
  AT: EUR, // Austria
  BE: EUR, // Belgium
  CY: EUR, // Cyprus
  DE: EUR, // Germany
  DK: EUR, // Denmark
  EE: EUR, // Estonia
  ES: EUR, // Spain
  FI: EUR, // Finland
  FR: EUR, // France
  GB: GBP, // United Kingdom
  GR: EUR, // Greece
  HR: EUR, // Croatia
  IE: EUR, // Ireland
  IT: EUR, // Italy
  LT: EUR, // Lithuania
  LU: EUR, // Luxembourg
  LV: EUR, // Latvia
  MT: EUR, // Malta
  NL: EUR, // Netherlands
  PT: EUR, // Portugal
  SI: EUR, // Slovenia
  SK: EUR, // Slovakia
  US: USD, // United States
}

const { PADDLE_VENDOR_ID, PADDLE_API_KEY } = process.env

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserWebhookEntity)
    private readonly usersWebhooksRepository: Repository<UserWebhookEntity>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(DeleteFeedback)
    private readonly deleteFeedbackRepository: Repository<DeleteFeedback>,
    private readonly payoutsService: PayoutsService,
  ) {}

  async create(
    userDTO: UserProfileDTO | User | UserGoogleDTO | UserGithubDTO,
  ): Promise<User> {
    return this.usersRepository.save(userDTO)
  }

  async paginate(
    options: PaginationOptionsInterface,
  ): Promise<Pagination<User>> {
    const [results, total] = await this.usersRepository.findAndCount({
      take: options.take || 10,
      skip: options.skip || 0,
    })

    return new Pagination<User>({
      results,
      total,
    })
  }

  async update(id: string, update: Record<string, unknown>): Promise<any> {
    return this.usersRepository.update({ id }, update)
  }

  async updateByEmail(
    email: string,
    update: Record<string, unknown>,
  ): Promise<any> {
    return this.usersRepository.update({ email }, update)
  }

  async updateBySubID(
    subID: string,
    update: Record<string, unknown>,
  ): Promise<any> {
    return this.usersRepository.update({ subID }, update)
  }

  async delete(id: string): Promise<any> {
    return this.usersRepository.delete(id)
  }

  async count(options?: any): Promise<number> {
    return this.usersRepository.count(options)
  }

  omitSensitiveData(user: Partial<User>): Partial<User> {
    const maxEventsCount = ACCOUNT_PLANS[user?.planCode]?.monthlyUsageLimit || 0

    const enhancedUser = {
      ...user,
      maxEventsCount,
    }

    return _omit(enhancedUser, [
      'password',
      'twoFactorRecoveryCode',
      'twoFactorAuthenticationSecret',
    ])
  }

  findOneWhere(
    where: Record<string, unknown>,
    relations?: string[],
    select?: any,
  ): Promise<User> {
    return this.usersRepository.findOne({ where, relations, select })
  }

  findOne(id: string, params: any = {}): Promise<User> {
    return this.usersRepository.findOne({
      where: { id },
      ...params,
    })
  }

  findOneWithRelations(id: string, relations: string[]): Promise<User> {
    return this.usersRepository.findOne(id, { relations })
  }

  findWhereWithRelations(
    where: Record<string, unknown>,
    relations: string[],
  ): Promise<User[]> {
    return this.usersRepository.find({
      where,
      relations,
    })
  }

  find(params: any): Promise<User[]> {
    return this.usersRepository.find(params)
  }

  findWhere(where: Record<string, unknown>): Promise<User[]> {
    return this.usersRepository.find({ where })
  }

  validatePassword(pass: string): void {
    const err = []
    if (_isEmpty(pass)) {
      err.push('Password cannot be empty')
    }

    if (_size(pass) > 50) {
      err.push('Maximum password length is 50 letters')
    }

    if (_size(pass) < 8) {
      err.push('at least 8 characters')
    }

    // if(!/[a-z]/.test(pass))
    //   err.push('should contain at least one lower case')
    // if(!/[A-Z]/.test(pass))
    //   err.push('should contain at least one upper case')
    // if(!(/[!@#$%^&*(),.?":{}|<>]/g.test(pass)))
    //   err.push('should contain at least one symbol')

    if (!_isEmpty(err)) {
      throw new BadRequestException(err)
    }
  }

  search(query: string): Promise<User[]> {
    return this.usersRepository
      .createQueryBuilder('user')
      .select()
      .where('email like :query', { query: `%${query}%` })
      .limit(5)
      .getMany()
  }

  public async findUser(email: string) {
    return this.usersRepository.findOne({ email })
  }

  public async createUser(
    user: Pick<User, 'email' | 'password' | 'referrerID'>,
  ) {
    return this.usersRepository.save({
      ...user,
      trialEndDate: dayjs
        .utc()
        .add(TRIAL_DURATION, 'day')
        .format('YYYY-MM-DD HH:mm:ss'),
    })
  }

  public async findUserById(id: string) {
    return this.usersRepository.findOne({ id })
  }

  public async updateUser(id: string, user: Partial<Omit<User, 'id'>>) {
    return this.usersRepository.update({ id }, user)
  }

  public async saveDeleteFeedback(feedback: string) {
    return this.deleteFeedbackRepository.save({
      feedback,
    })
  }

  public async findDeleteFeedback(id: string) {
    return this.deleteFeedbackRepository.findOne({ id })
  }

  public async deleteDeleteFeedback(id: string) {
    await this.deleteFeedbackRepository.delete({ id })
  }

  public async saveRefreshToken(userId: string, refreshToken: string) {
    return this.refreshTokenRepository.save({
      userId,
      refreshToken,
    })
  }

  public async findRefreshToken(userId: string, refreshToken: string) {
    return this.refreshTokenRepository.findOne({
      where: {
        userId,
        refreshToken,
      },
    })
  }

  public async deleteRefreshToken(userId: string, refreshToken: string) {
    await this.refreshTokenRepository.delete({
      userId,
      refreshToken,
    })
  }

  public async deleteAllRefreshTokens(userId: string) {
    await this.refreshTokenRepository.delete({
      userId,
    })
  }

  public async deleteRefreshTokensWhere(where: Record<string, unknown>) {
    await this.refreshTokenRepository.delete(where)
  }

  public async findUserByApiKey(apiKey: string) {
    return this.usersRepository.findOne({ where: { apiKey } })
  }

  async getUser(id: string) {
    return this.usersRepository.findOne({ id })
  }

  async getUserByEmail(email: string) {
    return this.usersRepository.findOne({ where: { email } })
  }

  async getUserByTelegramId(telegramId: number) {
    return this.usersRepository.findOne({
      where: { telegramChatId: telegramId },
    })
  }

  async updateUserTelegramId(
    userId: string,
    telegramId: number | null,
    isTelegramChatIdConfirmed = false,
  ) {
    await this.usersRepository.update(userId, {
      telegramChatId: _isNull(telegramId) ? null : String(telegramId),
      isTelegramChatIdConfirmed,
    })
  }

  getCurrencyByCountry(country: string) {
    return CURRENCY_BY_COUNTRY[country] || USD
  }

  getPlanById(planId: number) {
    if (!planId) {
      return null
    }

    const stringifiedPlanId = String(planId)

    const plan = Object.values(ACCOUNT_PLANS).find(
      tier =>
        // @ts-ignore
        tier.pid === stringifiedPlanId ||
        // @ts-ignore
        tier.ypid === stringifiedPlanId,
    )

    // @ts-ignore
    if (plan && plan.pid) {
      const planCode = plan.id
      const billingFrequency =
        // @ts-ignore
        Number(plan?.pid) === planId
          ? BillingFrequency.Monthly
          : BillingFrequency.Yearly

      return {
        planCode,
        billingFrequency,
      }
    }

    return null
  }

  async previewSubscription(id: string, planID: number) {
    const user = await this.findOneWhere({ id })
    const plan = this.getPlanById(planID)

    if (!plan) {
      throw new BadRequestException('Plan not found')
    }

    const { planCode, billingFrequency } = plan

    if (
      user.planCode === planCode &&
      user.billingFrequency === billingFrequency
    ) {
      throw new BadRequestException('You are already subscribed to this plan')
    }

    const url = 'https://vendors.paddle.com/api/2.0/subscription/preview_update'

    let preview: any = {}

    try {
      preview = await axios.post(url, {
        vendor_id: Number(PADDLE_VENDOR_ID),
        vendor_auth_code: PADDLE_API_KEY,
        subscription_id: Number(user.subID),
        plan_id: planID,
        prorate: true,
        bill_immediately: true,
        currency: user.tierCurrency,
        keep_modifiers: false,
      })
    } catch (error) {
      console.error(
        '[ERROR] (previewSubscription):',
        error?.response?.data?.error?.message || error,
      )
      throw new BadRequestException('Something went wrong')
    }

    const { data } = preview

    if (!data.success) {
      console.error('[ERROR] (previewSubscription) success -> false:', preview)
      throw new InternalServerErrorException('Something went wrong')
    }

    const symbol = getSymbolByCode(data.response.next_payment.currency)

    return {
      immediatePayment: {
        ...data.response.immediate_payment,
        symbol,
      },
      nextPayment: {
        ...data.response.next_payment,
        symbol,
      },
    }
  }

  async updateSubscription(id: string, planID: number) {
    const user = await this.findOneWhere({ id })
    const plan = this.getPlanById(planID)

    if (!plan) {
      throw new BadRequestException('Plan not found')
    }

    const { planCode, billingFrequency } = plan

    if (
      user.planCode === planCode &&
      user.billingFrequency === billingFrequency
    ) {
      throw new BadRequestException('You are already subscribed to this plan')
    }

    const url = 'https://vendors.paddle.com/api/2.0/subscription/users/update'

    let result: any = {}

    try {
      result = await axios.post(url, {
        vendor_id: Number(PADDLE_VENDOR_ID),
        vendor_auth_code: PADDLE_API_KEY,
        subscription_id: Number(user.subID),
        plan_id: planID,
        prorate: true,
        bill_immediately: true,
        currency: user.tierCurrency,
        keep_modifiers: false,
        passthrough: JSON.stringify({
          uid: id,
        }),
      })
    } catch (error) {
      console.error(
        '[ERROR] (updateSubscription):',
        error?.response?.data?.error?.message || error,
      )
      throw new BadRequestException('Something went wrong')
    }

    const { data } = result

    if (!data.success) {
      console.error('[ERROR] (updateSubscription) success -> false:', result)
      throw new InternalServerErrorException('Something went wrong')
    }

    const { response } = data

    const {
      subscription_id: subID,
      next_payment: { currency, date },
    } = response

    const updateParams = {
      planCode,
      subID,
      nextBillDate: date,
      billingFrequency,
      tierCurrency: currency,
    }

    await this.update(id, updateParams)
  }

  async getPayoutsList(user: User, take = 20, skip = 0) {
    return this.payoutsService.paginate(
      {
        take,
        skip,
      },
      {
        user: user.id,
      },
    )
  }

  createUnsubscribeKey(userId: string): string {
    return encodeURIComponent(
      CryptoJS.Rabbit.encrypt(userId, EMAIL_ACTION_ENCRYPTION_KEY).toString(),
    )
  }

  decryptUnsubscribeKey(token: string): string {
    const bytes = CryptoJS.Rabbit.decrypt(
      decodeURIComponent(token),
      EMAIL_ACTION_ENCRYPTION_KEY,
    )
    return bytes.toString(CryptoJS.enc.Utf8)
  }

  async getReferralsList(user: User): Promise<Partial<User>[]> {
    return this.usersRepository
      .createQueryBuilder('user')
      .select([
        'user.planCode',
        'user.created',
        'user.billingFrequency',
        'user.tierCurrency',
      ])
      .where('user.referrerID = :id', { id: user.id })
      .andWhere('user.planCode != :none', { none: PlanCode.none })
      .andWhere('user.planCode != :trial', { trial: PlanCode.trial })
      .andWhere('user.planCode != :free', { free: PlanCode.free })
      .orderBy('user.created', 'DESC')
      .getMany()
  }

  async getPayoutsInfo(user: User): Promise<any> {
    const { id } = user

    const trials = await this.count({
      where: {
        referrerID: id,
        planCode: In([PlanCode.trial, PlanCode.none]),
      },
    })

    const subscribers = _toNumber(
      (
        await this.usersRepository
          .createQueryBuilder('user')
          .select('COUNT(user.id)', 'count')
          .where('user.referrerID = :id', { id })
          .andWhere('user.planCode != :none', { none: PlanCode.none })
          .andWhere('user.planCode != :trial', { trial: PlanCode.trial })
          .getRawOne()
      )?.count,
    )

    let paid = await this.payoutsService.sumAmountByReferrerId(
      id,
      PayoutStatus.paid,
    )
    let nextPayout = await this.payoutsService.sumAmountByReferrerId(
      id,
      PayoutStatus.processing,
    )
    let pending = await this.payoutsService.sumAmountByReferrerId(
      id,
      PayoutStatus.pending,
    )

    paid = paid ?? 0
    nextPayout = nextPayout ?? 0
    pending = pending ?? 0

    return {
      trials,
      subscribers,
      paid,
      nextPayout,
      pending,
    }
  }

  async isRefCodeUnique(code: string): Promise<boolean> {
    const user = await this.findOneWhere({ refCode: code })

    return !user
  }

  async findUserWebhooks(userId: string) {
    return this.usersWebhooksRepository.find({ userId })
  }

  async findUserWebhookByUserIdAndUrl(userId: string, url: string) {
    return this.usersWebhooksRepository.findOne({
      where: { userId, url },
    })
  }

  async findUserWebhookByUserIdAndWebhookId(
    userId: string,
    webhookId: string,
  ): Promise<UserWebhookEntity> {
    return this.usersWebhooksRepository.findOne({
      where: { userId, id: webhookId },
    })
  }

  async createUserWebhook(
    webhook: Pick<UserWebhookEntity, 'userId' | 'name' | 'url'>,
  ) {
    return this.usersWebhooksRepository.save(webhook)
  }

  async updateUserWebhook(
    id: string,
    webhook: Partial<Pick<UserWebhookEntity, 'name' | 'url'>>,
  ) {
    return this.usersWebhooksRepository.update(id, webhook)
  }

  async deleteUserWebhook(id: string) {
    return this.usersWebhooksRepository.delete({ id })
  }

  async findUserV2(id: string, select?: (keyof User)[]) {
    return this.usersRepository.findOne({ select, where: { id } })
  }
}
