import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TwitterApi } from 'twitter-api-v2'
import { JwtService } from '@nestjs/jwt'
import axios from 'axios'
import { genSalt, hash, compare } from 'bcrypt'
import { getCountry } from 'countries-and-timezones'
import { Auth } from 'googleapis'
import { createHash } from 'crypto'
import * as dayjs from 'dayjs'
import { InjectBot } from 'nestjs-telegraf'
import { Telegraf } from 'telegraf'
import { UAParser } from 'ua-parser-js'
import * as _pick from 'lodash/pick'
import * as _split from 'lodash/split'
import * as _isEmpty from 'lodash/isEmpty'
import * as _find from 'lodash/find'
import { v4 as uuidv4 } from 'uuid'

import {
  ActionToken,
  ActionTokenType,
} from 'src/action-tokens/action-token.entity'
import { ActionTokensService } from 'src/action-tokens/action-tokens.service'
import { LetterTemplate } from 'src/mailer/letter'
import { MailerService } from 'src/mailer/mailer.service'
import {
  MAX_EMAIL_REQUESTS,
  User,
  TRIAL_DURATION,
} from 'src/user/entities/user.entity'
import { TelegrafContext } from 'src/user/user.controller'
import { UserService } from 'src/user/user.service'
import { ProjectService } from 'src/project/project.service'
import {
  REDIS_SSO_UUID,
  redis,
  PRODUCTION_ORIGIN,
  isDevelopment,
} from 'src/common/constants'
import { SSOProviders } from './dtos/sso-generate.dto'
import { UserGoogleDTO } from '../user/dto/user-google.dto'
import { UserGithubDTO } from '../user/dto/user-github.dto'

const REDIS_SSO_SESSION_TIMEOUT = 60 * 5 // 5 minutes
const getSSORedisKey = (uuid: string) => `${REDIS_SSO_UUID}:${uuid}`
const generateSSOState = (provider: SSOProviders) => `${provider}:${uuidv4()}`
const getSSOSessionProvider = (state: string): SSOProviders =>
  _split(state, ':')[0] as SSOProviders

const OAUTH_REDIRECT_URL = isDevelopment
  ? 'http://localhost:3000/socialised'
  : `${PRODUCTION_ORIGIN}/socialised`

const TWITTER_OAUTH_REDIRECT_URL = isDevelopment
  ? 'http://127.0.0.1:3000/socialised'
  : `${PRODUCTION_ORIGIN}/socialised`

const {
  GITHUB_OAUTH2_CLIENT_ID, GITHUB_OAUTH2_CLIENT_SECRET,
  TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET,
} = process.env

const twitterClient = new TwitterApi({ clientId: TWITTER_CLIENT_ID, clientSecret: TWITTER_CLIENT_SECRET })

@Injectable()
export class AuthService {
  oauth2Client: Auth.OAuth2Client
  githubOAuthClientID: string
  githubOAuthClientSecret: string

  constructor(
    @InjectBot() private readonly telegramBot: Telegraf<TelegrafContext>,
    private readonly userService: UserService,
    private readonly actionTokensService: ActionTokensService,
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
    private readonly jwtService: JwtService,
    private readonly projectService: ProjectService,
  ) {
    this.oauth2Client = new Auth.OAuth2Client(
      this.configService.get('GOOGLE_OAUTH2_CLIENT_ID'),
      this.configService.get('GOOGLE_OAUTH2_CLIENT_SECRET'),
    )
  }

  private async createSha1Hash(password: string): Promise<string> {
    return new Promise(resolve => {
      const sha1sum = createHash('sha1')
        .update(password)
        .digest('hex')
        .toUpperCase()
      resolve(sha1sum)
    })
  }

  private getFirstFiveChars(passwordHash: string): string {
    return passwordHash.slice(0, 5)
  }

  private async sendRequestToApi(passwordHash: string) {
    const url = `https://api.pwnedpasswords.com/range/${passwordHash}`
    const response = await axios.get(url)

    if (response.status !== 200) {
      throw new InternalServerErrorException()
    }

    return response.data
  }

  public async checkIfLeaked(password: string): Promise<boolean> {
    const sha1Hash = await this.createSha1Hash(password)
    const firstFiveChars = this.getFirstFiveChars(sha1Hash)
    const response = await this.sendRequestToApi(firstFiveChars)

    return response.includes(firstFiveChars)
  }

  public async hashPassword(password: string): Promise<string> {
    const salt = await genSalt(10)
    return hash(password, salt)
  }

  public async sendVerificationEmail(userId: string, email: string) {
    const actionToken = await this.actionTokensService.createActionToken(
      userId,
      ActionTokenType.EMAIL_VERIFICATION,
    )

    const user = await this.userService.findUserById(userId)

    if (user && user.emailRequests < MAX_EMAIL_REQUESTS) {
      await this.userService.updateUser(userId, {
        emailRequests: user.emailRequests + 1,
      })
    }

    const verificationLink = `${this.configService.get('CLIENT_URL')}/verify/${
      actionToken.id
    }`

    await this.mailerService.sendEmail(email, LetterTemplate.SignUp, {
      url: verificationLink,
    })
  }

  public async createUnverifiedUser(
    email: string,
    password: string,
  ): Promise<User> {
    const hashedPassword = await this.hashPassword(password)

    const user = await this.userService.createUser({
      email,
      password: hashedPassword, // Using the password field is incorrect.
    })

    await this.sendVerificationEmail(user.id, user.email)

    return user
  }

  public async generateJwtAccessToken(
    userId: string,
    isSecondFactorAuthenticated = false,
  ) {
    return this.jwtService.signAsync(
      {
        sub: userId,
        isSecondFactorAuthenticated,
      },
      {
        algorithm: 'HS256',
        expiresIn: 60 * 30,
        secret: this.configService.get('JWT_ACCESS_TOKEN_SECRET'),
      },
    )
  }

  public async validateUser(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.userService.findUser(email)

    if (user && (await this.comparePassword(password, user.password))) {
      return user
    }

    return null
  }

  public async getSharedProjectsForUser(user: User): Promise<User> {
    const sharedProjects = await this.projectService.findShare({
      where: {
        user: user.id,
      },
      relations: ['project'],
    })

    user.sharedProjects = sharedProjects

    return user
  }

  private async comparePassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return compare(password, hashedPassword)
  }

  public async sendTelegramNotification(
    userId: string,
    headers: unknown,
    ip: string,
  ) {
    const user = await this.userService.findUserById(userId)

    if (!user.telegramChatId) {
      return
    }

    const chat = await this.checkTelegramChatId(user.telegramChatId)

    if (!chat) {
      return
    }

    const headersInfo = await this.getHeadersInfo(headers)
    const loginDate = dayjs().utc().format('YYYY-MM-DD HH:mm:ss')
    const message =
      '🚨 *Someone has logged into your account!*\n\n' +
      `*Browser:* ${headersInfo.browser}\n` +
      `*Device:* ${headersInfo.device}\n` +
      `*OS:* ${headersInfo.os}\n` +
      `*Country:* ${headersInfo.country}\n` +
      `*IP:* ${ip}\n` +
      `*Date:* ${loginDate} (UTC)\n\n` +
      'If it was not you, please change your password immediately.'
    await this.telegramBot.telegram.sendMessage(user.telegramChatId, message, {
      parse_mode: 'Markdown',
    })
  }

  private async getHeadersInfo(headers: unknown) {
    const ua = UAParser(headers['user-agent'])
    const browser = ua.browser.name || 'Unknown'
    const device = ua.device.type || 'Desktop'
    const os = ua.os.name || 'Unknown'
    let country = 'Unknown'
    const cfCountry = headers['cf-ipcountry']

    if (cfCountry === 'T1') {
      country = 'Unknown (Tor)'
    }

    if (cfCountry) {
      country = getCountry(cfCountry)?.name
    }

    return {
      browser,
      device,
      os,
      country,
    }
  }

  public async checkTelegramChatId(chatId: string): Promise<boolean> {
    const chat = (await this.telegramBot.telegram.getChat(chatId)).id
    return Boolean(chat)
  }

  public async checkVerificationToken(
    token: string,
  ): Promise<ActionToken | null> {
    const actionToken = await this.actionTokensService.findActionToken(token)

    if (
      actionToken &&
      actionToken.action === ActionTokenType.EMAIL_VERIFICATION
    ) {
      return actionToken
    }

    return null
  }

  public async verifyEmail(actionToken: ActionToken): Promise<void> {
    await this.userService.updateUser(actionToken.user.id, {
      isActive: true,
    })
    await this.actionTokensService.deleteActionToken(actionToken.id)
  }

  public async sendResetPasswordEmail(userId: string, email: string) {
    const actionToken = await this.actionTokensService.createActionToken(
      userId,
      ActionTokenType.PASSWORD_RESET,
    )

    const verificationLink = `${this.configService.get(
      'CLIENT_URL',
    )}/password-reset/${actionToken.id}`

    await this.mailerService.sendEmail(
      email,
      LetterTemplate.ConfirmPasswordChange,
      {
        url: verificationLink,
      },
    )
  }

  public async checkResetPasswordToken(
    token: string,
  ): Promise<ActionToken | null> {
    const actionToken = await this.actionTokensService.findActionToken(token)

    if (actionToken && actionToken.action === ActionTokenType.PASSWORD_RESET) {
      return actionToken
    }

    return null
  }

  public async resetPassword(
    actionToken: ActionToken,
    password: string,
  ): Promise<void> {
    const hashedPassword = await this.hashPassword(password)

    await this.userService.updateUser(actionToken.user.id, {
      password: hashedPassword,
    })
    await this.actionTokensService.deleteActionToken(actionToken.id)
  }

  public async changePassword(userId: string, password: string): Promise<void> {
    const hashedPassword = await this.hashPassword(password)
    await this.userService.updateUser(userId, {
      password: hashedPassword,
    })
  }

  public async checkIfMaxEmailRequestsReached(
    userId: string,
  ): Promise<boolean> {
    const user = await this.userService.findUserById(userId)

    if (user && user.emailRequests >= MAX_EMAIL_REQUESTS) {
      return true
    }

    return false
  }

  public async checkIfEmailTaken(email: string): Promise<boolean> {
    const user = await this.userService.findUser(email)
    return Boolean(user)
  }

  public async changeEmail(
    userId: string,
    email: string,
    newEmail: string,
  ): Promise<void> {
    const actionToken = await this.actionTokensService.createActionToken(
      userId,
      ActionTokenType.EMAIL_CHANGE,
      newEmail,
    )

    const verificationLink = `${this.configService.get(
      'CLIENT_URL',
    )}/change-email/${actionToken.id}`

    await this.mailerService.sendEmail(
      email,
      LetterTemplate.MailAddressChangeConfirmation,
      {
        url: verificationLink,
      },
    )
  }

  public async checkChangeEmailToken(
    token: string,
  ): Promise<ActionToken | null> {
    const actionToken = await this.actionTokensService.findActionToken(token)

    if (actionToken && actionToken.action === ActionTokenType.EMAIL_CHANGE) {
      return actionToken
    }

    return null
  }

  public async confirmChangeEmail(actionToken: ActionToken): Promise<void> {
    await this.userService.updateUser(actionToken.user.id, {
      email: actionToken.newValue,
    })
    await this.actionTokensService.deleteActionToken(actionToken.id)
    await this.mailerService.sendEmail(
      actionToken.newValue,
      LetterTemplate.MailAddressHadChanged,
    )
  }

  private async generateJwtRefreshToken(
    userId: string,
    isSecondFactorAuthenticated = false,
  ) {
    const refreshToken = await this.jwtService.signAsync(
      {
        sub: userId,
        isSecondFactorAuthenticated,
      },
      {
        algorithm: 'HS256',
        expiresIn: 60 * 60 * 24 * 30,
        secret: this.configService.get('JWT_REFRESH_TOKEN_SECRET'),
      },
    )

    await this.userService.saveRefreshToken(userId, refreshToken)

    return refreshToken
  }

  public async checkRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<boolean> {
    const token = await this.userService.findRefreshToken(userId, refreshToken)
    return Boolean(token)
  }

  public async generateJwtTokens(
    userId: string,
    isSecondFactorAuthenticated = false,
  ) {
    const accessToken = await this.generateJwtAccessToken(
      userId,
      isSecondFactorAuthenticated,
    )
    const refreshToken = await this.generateJwtRefreshToken(
      userId,
      isSecondFactorAuthenticated,
    )

    return { accessToken, refreshToken }
  }

  async logout(userId: string, refreshToken: string) {
    await this.userService.deleteRefreshToken(userId, refreshToken)
  }

  async validateApiKey(apiKey: string): Promise<User | null> {
    return this.userService.findUserByApiKey(apiKey)
  }

  /*
    --------------------------------
    Google SSO section
    --------------------------------
  */
  async handleExistingUserGoogle(user: User, headers: unknown, ip: string) {
    if (!user.googleId) {
      throw new BadRequestException()
    }

    await this.sendTelegramNotification(user.id, headers, ip)

    const jwtTokens = await this.generateJwtTokens(
      user.id,
      !user.isTwoFactorAuthenticationEnabled,
    )

    if (user.isTwoFactorAuthenticationEnabled) {
      user = _pick(user, ['isTwoFactorAuthenticationEnabled', 'email'])
    } else {
      user = await this.getSharedProjectsForUser(user)
    }

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async registerUserGoogle(sub: string, email: string) {
    const query: UserGoogleDTO = {
      googleId: sub,
      trialEndDate: dayjs
        .utc()
        .add(TRIAL_DURATION, 'day')
        .format('YYYY-MM-DD HH:mm:ss'),
      registeredWithGoogle: true,
      isActive: true,
      emailRequests: 0,
    }

    const userWithSameEmail = await this.userService.findOneWhere({
      email,
    })

    if (!userWithSameEmail) {
      query.email = email
    }

    const user = await this.userService.create(query)

    const jwtTokens = await this.generateJwtTokens(user.id, true)

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async processHash(ssoHash: string) {
    if (!ssoHash) {
      throw new BadRequestException('Missing hash parameter')
    }

    const ssoRedisKey = getSSORedisKey(ssoHash)
    const exists = await redis.exists(ssoRedisKey)

    if (!exists) {
      throw new BadRequestException(
        'No authentication session opened for this hash',
      )
    }

    const data = await redis.get(ssoRedisKey)

    if (!data) {
      throw new ConflictException(
        'Authentication session is opened but no data found',
      )
    }

    let payload

    try {
      payload = JSON.parse(data)
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> authenticateGoogle -> JSON.parse]: ${reason} - ${data}`,
      )
      throw new InternalServerErrorException(
        'Session related data is corrupted',
      )
    }

    await redis.del(ssoRedisKey)

    return payload
  }

  async authenticateSSO(
    ssoHash: string,
    headers: unknown,
    ip: string,
    provider: SSOProviders,
  ) {
    if (provider === SSOProviders.GOOGLE) {
      return this.authenticateGoogle(ssoHash, headers, ip)
    }

    if (provider === SSOProviders.GITHUB) {
      return this.authenticateGithub(ssoHash, headers, ip)
    }

    if (provider === SSOProviders.TWITTER) {
      console.log('authenticateTwitter')
      // return this.authenticateTwitter(ssoHash, headers, ip)
    }

    throw new BadRequestException('Unknown SSO provider supplied')
  }

  async authenticateGoogle(ssoHash: string, headers: unknown, ip: string) {
    const { sub, email } = await this.processHash(ssoHash)

    try {
      const user = await this.userService.findOneWhere({
        googleId: sub,
      })

      if (!user) {
        return await this.registerUserGoogle(sub, email)
      }

      return await this.handleExistingUserGoogle(user, headers, ip)
    } catch (error) {
      console.error(`[ERROR][AuthService -> authenticateGoogle]: ${error}`)
      throw new InternalServerErrorException(
        'Something went wrong while authenticating user with Google',
      )
    }
  }

  async generateGoogleURL() {
    // Generating SSO session identifier and authorisation URL
    const uuid = generateSSOState(SSOProviders.GOOGLE)
    const authUrl = await this.oauth2Client.generateAuthUrl({
      state: uuid,
      redirect_uri: OAUTH_REDIRECT_URL,
      scope: 'email',
      response_type: 'token',
    })

    // Storing the session identifier in redis
    await redis.set(getSSORedisKey(uuid), '', 'EX', REDIS_SSO_SESSION_TIMEOUT)

    return {
      uuid,
      auth_url: authUrl,
      expires_in: REDIS_SSO_SESSION_TIMEOUT * 1000, // milliseconds
    }
  }

  async processSSOToken(token: string, ssoHash: string) {
    const provider = getSSOSessionProvider(ssoHash)

    if (provider === SSOProviders.GOOGLE) {
      return this.processGoogleToken(token, ssoHash)
    }

    if (provider === SSOProviders.GITHUB) {
      return this.processGithubCode(token, ssoHash)
    }

    throw new BadRequestException('Unknown SSO provider supplied')
  }

  async processGoogleToken(token: string, ssoHash: string) {
    let tokenInfo

    try {
      tokenInfo = await this.oauth2Client.getTokenInfo(token)
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> processGoogleCode -> oauth2Client.getTokenInfo]: ${reason}`,
      )
      throw new BadRequestException('Invalid Google token supplied')
    }

    const { sub, email } = tokenInfo

    const dataToStore = JSON.stringify({ sub, email })

    // Storing the session identifier in redis
    await redis.set(
      getSSORedisKey(ssoHash),
      dataToStore,
      'EX',
      REDIS_SSO_SESSION_TIMEOUT,
    )
  }

  async linkSSOAccount(
    userId: string,
    ssoHash: string,
    provider: SSOProviders,
  ) {
    if (provider === SSOProviders.GOOGLE) {
      return this.linkGoogleAccount(userId, ssoHash)
    }

    if (provider === SSOProviders.GITHUB) {
      return this.linkGithubAccount(userId, ssoHash)
    }

    if (provider === SSOProviders.TWITTER) {
      return this.linkTwitterAccount(userId, ssoHash)
    }

    throw new BadRequestException('Unknown SSO provider supplied')
  }

  async linkGoogleAccount(userId: string, ssoHash: string) {
    const { sub } = await this.processHash(ssoHash)

    if (!sub) {
      throw new BadRequestException(
        'Google ID is missing in the authentication session',
      )
    }

    const subUser = await this.userService.findOneWhere({
      googleId: sub,
    })

    if (subUser) {
      throw new BadRequestException(
        'This Google account is already linked to another user',
      )
    }

    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    await this.userService.updateUser(userId, {
      googleId: sub,
    })
  }

  async unlinkSSOAccount(userId: string, provider: SSOProviders) {
    if (provider === SSOProviders.GOOGLE) {
      return this.unlinkGoogleAccount(userId)
    }

    if (provider === SSOProviders.GITHUB) {
      return this.unlinkGithubAccount(userId)
    }

    if (provider === SSOProviders.TWITTER) {
      return this.unlinkTwitterAccount(userId)
    }

    throw new BadRequestException('Unknown SSO provider supplied')
  }

  async unlinkGoogleAccount(userId: string) {
    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    if (user.registeredWithGoogle) {
      throw new BadRequestException(
        'You cannot unlink your Google account if you registered with it',
      )
    }

    await this.userService.updateUser(userId, {
      googleId: null,
    })
  }

  /*
    --------------------------------
    Github SSO section
    --------------------------------
  */
  async generateGithubURL() {
    // Generating SSO session identifier and authorisation URL
    const uuid = generateSSOState(SSOProviders.GITHUB)
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_OAUTH2_CLIENT_ID}&state=${uuid}&redirect_uri=${OAUTH_REDIRECT_URL}&scope=user:email`

    // Storing the session identifier in redis
    await redis.set(getSSORedisKey(uuid), '', 'EX', REDIS_SSO_SESSION_TIMEOUT)

    return {
      uuid,
      auth_url: authUrl,
      expires_in: REDIS_SSO_SESSION_TIMEOUT * 1000, // milliseconds
    }
  }

  async processGithubCode(code: string, ssoHash: string) {
    let token
    let tokenInfo

    try {
      const response = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: GITHUB_OAUTH2_CLIENT_ID,
          client_secret: GITHUB_OAUTH2_CLIENT_SECRET,
          code,
        },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      )

      token = response.data.access_token
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> processGithubCode -> axios.post]: ${reason}`,
      )
      throw new BadRequestException('Invalid Github code supplied')
    }

    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
        },
      })

      tokenInfo = response.data
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> processGithubCode -> axios.get]: ${reason}`,
      )
      throw new BadRequestException('Invalid Github token')
    }

    const { id } = tokenInfo
    let { email } = tokenInfo

    if (!email) {
      try {
        const response = await axios.get('https://api.github.com/user/emails', {
          headers: {
            Authorization: `token ${token}`,
          },
        })

        const emails = response.data

        if (_isEmpty(emails)) {
          console.error(
            '[ERROR][AuthService -> processGithubCode]: No email address found',
          )
          throw new BadRequestException('No email address found')
        }

        email = _find(emails, e => e.primary).email
      } catch (reason) {
        console.error(
          `[ERROR][AuthService -> processGithubCode -> axios.get (emails)]: ${reason}`,
        )
        throw new BadRequestException('Invalid Github token')
      }
    }

    const dataToStore = JSON.stringify({ id, email })

    // Storing the session identifier in redis
    await redis.set(
      getSSORedisKey(ssoHash),
      dataToStore,
      'EX',
      REDIS_SSO_SESSION_TIMEOUT,
    )
  }

  async registerUserGithub(id: number, email: string) {
    const query: UserGithubDTO = {
      githubId: id,
      trialEndDate: dayjs
        .utc()
        .add(TRIAL_DURATION, 'day')
        .format('YYYY-MM-DD HH:mm:ss'),
      registeredWithGithub: true,
      isActive: true,
      emailRequests: 0,
    }

    const userWithSameEmail = await this.userService.findOneWhere({
      email,
    })

    if (!userWithSameEmail) {
      query.email = email
    }

    const user = await this.userService.create(query)

    const jwtTokens = await this.generateJwtTokens(user.id, true)

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async handleExistingUserGithub(user: User, headers: unknown, ip: string) {
    if (!user.githubId) {
      throw new BadRequestException()
    }

    await this.sendTelegramNotification(user.id, headers, ip)

    const jwtTokens = await this.generateJwtTokens(
      user.id,
      !user.isTwoFactorAuthenticationEnabled,
    )

    if (user.isTwoFactorAuthenticationEnabled) {
      user = _pick(user, ['isTwoFactorAuthenticationEnabled', 'email'])
    } else {
      user = await this.getSharedProjectsForUser(user)
    }

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async unlinkGithubAccount(userId: string) {
    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    if (user.registeredWithGithub) {
      throw new BadRequestException(
        'You cannot unlink your Google account if you registered with it',
      )
    }

    await this.userService.updateUser(userId, {
      githubId: null,
    })
  }

  async linkGithubAccount(userId: string, ssoHash: string) {
    const { id } = await this.processHash(ssoHash)

    if (!id) {
      throw new BadRequestException(
        'Github ID is missing in the authentication session',
      )
    }

    const subUser = await this.userService.findOneWhere({
      githubId: id,
    })

    if (subUser) {
      throw new BadRequestException(
        'This Github account is already linked to another user',
      )
    }

    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    await this.userService.updateUser(userId, {
      githubId: id,
    })
  }

  async authenticateGithub(ssoHash: string, headers: unknown, ip: string) {
    const { id, email } = await this.processHash(ssoHash)

    try {
      const user = await this.userService.findOneWhere({
        githubId: id,
      })

      if (!user) {
        return await this.registerUserGithub(id, email)
      }

      return await this.handleExistingUserGithub(user, headers, ip)
    } catch (error) {
      console.error(`[ERROR][AuthService -> authenticateGithub]: ${error}`)
      throw new InternalServerErrorException(
        'Something went wrong while authenticating user with Github',
      )
    }
  }

  /*
    --------------------------------
    Twitter SSO section
    --------------------------------
  */
  async generateTwitterURL() {
    // Generating SSO session identifier and authorisation URL
    const uuid = generateSSOState(SSOProviders.TWITTER)

    const { url, codeVerifier } = await twitterClient.generateOAuth2AuthLink(TWITTER_OAUTH_REDIRECT_URL, {
      state: uuid,
      scope: 'email', // openid
    })

    console.log(url, codeVerifier)

    // Storing the session identifier in redis
    // await redis.set(getSSORedisKey(uuid), '', 'EX', REDIS_SSO_SESSION_TIMEOUT)

    return {
      uuid,
      auth_url: url,
      expires_in: REDIS_SSO_SESSION_TIMEOUT * 1000, // milliseconds
    }
  }

  async processTwitterCode(code: string, ssoHash: string) {
    ///////////////////
    let token
    let tokenInfo

    try {
      const response = await axios.post(
        'https://api.twitter.com/oauth/access_token',
        {
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: OAUTH_REDIRECT_URL,
        },
        {
          headers: {
            // Authorization: twitterAuthorisation,
            Accept: 'application/json',
          },
        },
      )

      token = response.data.access_token
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> processTwitterCode -> axios.post]: ${reason}`,
      )
      throw new BadRequestException('Invalid Twitter code supplied')
    }

    console.log(token)

    const authHeader = `Bearer ${token}`

    try {
      const response = await axios.get('https://api.twitter.com/1.1/account/verify_credentials.json', {
        headers: {
          Authorization: authHeader,
        },
      })

      tokenInfo = response.data
    } catch (reason) {
      console.error(
        `[ERROR][AuthService -> processTwitterCode -> axios.get]: ${reason}`,
      )
      throw new BadRequestException('Invalid Twitter token')
    }

    console.log(tokenInfo)

    const { id } = tokenInfo
    let { email } = tokenInfo

    // if (!email) {
    //   try {
    //     const response = await axios.get('https://api.github.com/user/emails', {
    //       headers: {
    //         Authorization: `token ${token}`,
    //       },
    //     })

    //     const emails = response.data

    //     if (_isEmpty(emails)) {
    //       console.error(
    //         '[ERROR][AuthService -> processGithubCode]: No email address found',
    //       )
    //       throw new BadRequestException('No email address found')
    //     }

    //     email = _find(emails, e => e.primary).email
    //   } catch (reason) {
    //     console.error(
    //       `[ERROR][AuthService -> processGithubCode -> axios.get (emails)]: ${reason}`,
    //     )
    //     throw new BadRequestException('Invalid Github token')
    //   }
    // }

    // const dataToStore = JSON.stringify({ id, email })

    // // Storing the session identifier in redis
    // await redis.set(
    //   getSSORedisKey(ssoHash),
    //   dataToStore,
    //   'EX',
    //   REDIS_SSO_SESSION_TIMEOUT,
    // )
  }

  async registerUserTwitter(id: number, email: string) {
    ///////////////////
    const query: UserGithubDTO = {
      githubId: id,
      trialEndDate: dayjs
        .utc()
        .add(TRIAL_DURATION, 'day')
        .format('YYYY-MM-DD HH:mm:ss'),
      registeredWithGithub: true,
      isActive: true,
      emailRequests: 0,
    }

    const userWithSameEmail = await this.userService.findOneWhere({
      email,
    })

    if (!userWithSameEmail) {
      query.email = email
    }

    const user = await this.userService.create(query)

    const jwtTokens = await this.generateJwtTokens(user.id, true)

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async handleExistingUserTwitter(user: User, headers: unknown, ip: string) {
    ///////////////////
    if (!user.githubId) {
      throw new BadRequestException()
    }

    await this.sendTelegramNotification(user.id, headers, ip)

    const jwtTokens = await this.generateJwtTokens(
      user.id,
      !user.isTwoFactorAuthenticationEnabled,
    )

    if (user.isTwoFactorAuthenticationEnabled) {
      user = _pick(user, ['isTwoFactorAuthenticationEnabled', 'email'])
    } else {
      user = await this.getSharedProjectsForUser(user)
    }

    return {
      ...jwtTokens,
      user: this.userService.omitSensitiveData(user),
    }
  }

  async unlinkTwitterAccount(userId: string) {
    ///////////////////
    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    if (user.registeredWithGithub) {
      throw new BadRequestException(
        'You cannot unlink your Google account if you registered with it',
      )
    }

    await this.userService.updateUser(userId, {
      githubId: null,
    })
  }

  async linkTwitterAccount(userId: string, ssoHash: string) {
    ///////////////////
    const { id } = await this.processHash(ssoHash)

    if (!id) {
      throw new BadRequestException(
        'Github ID is missing in the authentication session',
      )
    }

    const subUser = await this.userService.findOneWhere({
      githubId: id,
    })

    if (subUser) {
      throw new BadRequestException(
        'This Github account is already linked to another user',
      )
    }

    const user = await this.userService.findUserById(userId)

    if (!user) {
      throw new BadRequestException('User not found')
    }

    await this.userService.updateUser(userId, {
      githubId: id,
    })
  }

  async authenticateTwitter(ssoHash: string, headers: unknown, ip: string) {
    ///////////////////
    const { id, email } = await this.processHash(ssoHash)

    try {
      const user = await this.userService.findOneWhere({
        githubId: id,
      })

      if (!user) {
        return await this.registerUserGithub(id, email)
      }

      return await this.handleExistingUserGithub(user, headers, ip)
    } catch (error) {
      console.error(`[ERROR][AuthService -> authenticateTwitter]: ${error}`)
      throw new InternalServerErrorException(
        'Something went wrong while authenticating user with Github',
      )
    }
  }
}
