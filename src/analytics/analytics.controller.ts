import * as _isEmpty from 'lodash/isEmpty'
import * as _isArray from 'lodash/isArray'
import * as _toNumber from 'lodash/toNumber'
import * as _size from 'lodash/size'
import * as _last from 'lodash/last'
import * as _map from 'lodash/map'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as timezone from 'dayjs/plugin/timezone'
import { v4 as uuidv4 } from 'uuid'
import { hash } from 'blake3'
import ct from 'countries-and-timezones'
import {
  Controller, Body, Query, UseGuards, Get, Post, Headers, BadRequestException, InternalServerErrorException,
  UnprocessableEntityException, PreconditionFailedException, Ip, ForbiddenException, Response,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import * as UAParser from 'ua-parser-js'
import * as isbot from 'isbot'

import {
  AnalyticsService, getSessionKey, isValidTimezone, isValidDate, checkIfTBAllowed,
} from './analytics.service'
import { TaskManagerService } from '../task-manager/task-manager.service'
import { CurrentUserId } from '../common/decorators/current-user-id.decorator'
import { DEFAULT_TIMEZONE } from '../user/entities/user.entity'
import { RolesGuard } from 'src/common/guards/roles.guard'
import { PageviewsDTO } from './dto/pageviews.dto'
import { EventsDTO } from './dto/events.dto'
import { AnalyticsGET_DTO } from './dto/getData.dto'
import { AppLoggerService } from '../logger/logger.service'
import { SelfhostedGuard } from '../common/guards/selfhosted.guard'
import {
  REDIS_LOG_DATA_CACHE_KEY, redis, REDIS_LOG_CUSTOM_CACHE_KEY,
  HEARTBEAT_SID_LIFE_TIME, REDIS_USERS_COUNT_KEY, REDIS_PROJECTS_COUNT_KEY, REDIS_PAGEVIEWS_COUNT_KEY, REDIS_SESSION_SALT_KEY,
} from '../common/constants'

dayjs.extend(utc)
dayjs.extend(timezone)

const getSessionKeyCustom = (ip: string, ua: string, pid: string, ev: string, salt: string = '') => `cses_${hash(`${ua}${ip}${pid}${ev}${salt}`).toString('hex')}`

const analyticsDTO = (pid: string, pg: string, dv: string, br: string, os: string, lc: string, ref: string, so: string, me: string, ca: string, lt: number | string, cc: string, unique: number): Array<string | number> => {
  return [uuidv4(), pid, pg, dv, br, os, lc, ref, so, me, ca, lt, cc, unique, dayjs.utc().format('YYYY-MM-DD HH:mm:ss')]
}

const customLogDTO = (pid: string, ev: string): string => {
  const dto = {
    id: uuidv4(),
    pid,
    ev,
    created: dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
  }

  return JSON.stringify(dto)
}

const getElValue = (el) => {
  if (el === undefined || el === null || el === 'NULL') return 'NULL'
  return `'${el}'`
}

const getPIDsArray = (pids, pid) => {
  const pidsEmpty = _isEmpty(pids)
  const pidEmpty = _isEmpty(pid)
  if (pidsEmpty && pidEmpty) throw new BadRequestException('An array of Project ID\'s (pids) or a Project ID (pid) has to be provided')
  else if (!pidsEmpty && !pidEmpty) throw new BadRequestException('Please provide either an array of Project ID\'s (pids) or a Project ID (pid), but not both')
  else if (!pidEmpty) {
    pids = JSON.stringify([pid])
  }

  try {
    pids = JSON.parse(pids)
  } catch (e) {
    throw new UnprocessableEntityException('Cannot process the provided array of Project ID\'s')
  }

  if (!_isArray(pids)) {
    throw new UnprocessableEntityException('An array of Project ID\'s has to be provided as a \'pids\' param')
  }

  return pids
}

// needed for serving 1x1 px GIF
const TRANSPARENT_GIF_BUFFER = Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64')

@ApiTags('Analytics')
@UseGuards(RolesGuard)
@Controller('log')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly logger: AppLoggerService,
    private readonly taskManagerService: TaskManagerService,
  ) { }

  @Get('/')
  async getData(@Query() data: AnalyticsGET_DTO, @CurrentUserId() uid: string): Promise<any> {
    const { pid, period, timeBucket, from, to, filters, timezone = DEFAULT_TIMEZONE } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    this.analyticsService.validateTimebucket(timeBucket)
    const [filtersQuery, filtersParams] = this.analyticsService.getFiltersQuery(filters)
    await this.analyticsService.checkProjectAccess(pid, uid)

    let groupFrom = from, groupTo = to

    const queryCustoms = 'SELECT ev, count() FROM customEV WHERE pid = {pid:FixedString(12)} AND created BETWEEN {groupFrom:String} AND {groupTo:String} GROUP BY ev'
    const subQuery = `FROM analytics WHERE pid = {pid:FixedString(12)} ${filtersQuery} AND created BETWEEN {groupFrom:String} AND {groupTo:String}`

    const paramsData = {
      params: {
        pid,
        groupFrom: null,
        groupTo: null,
        ...filtersParams,
      },
    }

    if (!_isEmpty(from) && !_isEmpty(to)) {
      if (!isValidDate(from)) {
        throw new PreconditionFailedException('The timeframe \'from\' parameter is invalid')
      }

      if (!isValidDate(to)) {
        throw new PreconditionFailedException('The timeframe \'to\' parameter is invalid')
      }

      if (dayjs.utc(from).isAfter(dayjs.utc(to), 'second')) {
        throw new PreconditionFailedException('The timeframe \'from\' parameter cannot be greater than \'to\'')
      }

      checkIfTBAllowed(timeBucket, from, to)

      groupFrom = dayjs.tz(from, timezone).utc().format('YYYY-MM-DD HH:mm:ss')

      if (from === to) {
        groupTo = dayjs.tz(to, timezone).add(1, 'day').format('YYYY-MM-DD HH:mm:ss')
      } else {
        groupTo = dayjs.tz(to, timezone).format('YYYY-MM-DD HH:mm:ss')
      }
    } else if (!_isEmpty(period)) {
      if (period === 'today') {
        if (timezone !== DEFAULT_TIMEZONE && isValidTimezone(timezone)) {
          groupFrom = dayjs().tz(timezone).startOf('d').utc().format('YYYY-MM-DD HH:mm:ss')
          groupTo = dayjs().tz(timezone).utc().format('YYYY-MM-DD HH:mm:ss')
        } else {
          groupFrom = dayjs.utc().startOf('d').format('YYYY-MM-DD')
          groupTo = dayjs.utc().format('YYYY-MM-DD HH:mm:ss')
        }
      } else if (period === 'yesterday') {
        if (timezone !== DEFAULT_TIMEZONE && isValidTimezone(timezone)) {
          groupFrom = dayjs().tz(timezone).startOf('d').subtract(1, 'day').utc().format('YYYY-MM-DD HH:mm:ss')
          groupTo = dayjs().tz(timezone).startOf('d').utc().format('YYYY-MM-DD HH:mm:ss')
        } else {
          groupFrom = dayjs.utc().startOf('d').subtract(1, 'day').format('YYYY-MM-DD')
          groupTo = dayjs.utc().startOf('d').format('YYYY-MM-DD HH:mm:ss')
        }
      } else {
        groupFrom = dayjs.utc().subtract(parseInt(period), _last(period)).format('YYYY-MM-DD')
        groupTo = dayjs.utc().format('YYYY-MM-DD 23:59:59')

        checkIfTBAllowed(timeBucket, groupFrom, groupTo)
      }
    } else {
      throw new BadRequestException('The timeframe (either from/to pair or period) has to be provided')
    }

    paramsData.params = {
      ...paramsData.params,
      groupFrom, groupTo,
    }

    const result = await this.analyticsService.groupByTimeBucket(timeBucket, groupFrom, groupTo, subQuery, filtersQuery, paramsData, timezone)

    const customs = await this.analyticsService.processCustomEV(queryCustoms, paramsData)

    return {
      ...result,
      customs,
      appliedFilters: filters,
    }
  }

  @Get('/birdseye')
  // returns overall short statistics per project
  async getOverallStats(@Query() data, @CurrentUserId() uid: string): Promise<any> {
    const { pids, pid } = data
    const pidsArray = getPIDsArray(pids, pid)

    for (let i = 0; i < _size(pidsArray); ++i) {
      this.analyticsService.validatePID(pidsArray[i])
      await this.analyticsService.checkProjectAccess(pidsArray[i], uid)
    }

    return this.analyticsService.getSummary(pidsArray, 'w')
  }

  @UseGuards(SelfhostedGuard)
  @Get('/generalStats')
  async getGeneralStats(): Promise<object> {
    const exists = await redis.exists(REDIS_USERS_COUNT_KEY, REDIS_PROJECTS_COUNT_KEY, REDIS_PAGEVIEWS_COUNT_KEY)

    if (exists) {
      const users = _toNumber(await redis.get(REDIS_USERS_COUNT_KEY))
      const projects = _toNumber(await redis.get(REDIS_PROJECTS_COUNT_KEY))
      const pageviews = _toNumber(await redis.get(REDIS_PAGEVIEWS_COUNT_KEY))

      return {
        users, projects, pageviews,
      }
    }

    return await this.taskManagerService.getGeneralStats()
  }

  @Get('/hb')
  async getHeartBeatStats(@Query() data, @CurrentUserId() uid: string): Promise<object> {
    const { pids, pid } = data
    const pidsArray = getPIDsArray(pids, pid)
    const pidsSize = _size(pidsArray)

    for (let i = 0; i < pidsSize; ++i) {
      this.analyticsService.validatePID(pidsArray[i])
      await this.analyticsService.checkProjectAccess(pidsArray[i], uid)
    }

    const result = {}

    for (let i = 0; i < pidsSize; ++i) {
      const currentPID = pidsArray[i]
      // @ts-ignore
      const keysAmout = await redis.countKeysByPattern(`hb:${currentPID}:*`)
      result[currentPID] = keysAmout
    }

    return result
  }

  // Log custom event
  @Post('/custom')
  async logCustom(@Body() eventsDTO: EventsDTO, @Headers() headers, @Ip() reqIP): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers

    // todo: create a decorator for bot traffic detection
    if (isbot(userAgent)) {
      throw new ForbiddenException('Bot traffic is ignored')
    }

    const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for'] || reqIP || ''

    await this.analyticsService.validate(eventsDTO, origin, 'custom', ip)

    if (eventsDTO.unique) {
      const salt = await redis.get(REDIS_SESSION_SALT_KEY)
      const sessionHash = getSessionKeyCustom(ip, userAgent, eventsDTO.pid, eventsDTO.ev, salt)
      const unique = await this.analyticsService.isUnique(sessionHash)

      if (!unique) {
        throw new ForbiddenException('The unique option provided, while the custom event have already been created for this session')
      }
    }

    const dto = customLogDTO(eventsDTO.pid, eventsDTO.ev)

    try {
      await redis.rpush(REDIS_LOG_CUSTOM_CACHE_KEY, dto)
      return
    } catch (e) {
      this.logger.error(e)
      throw new InternalServerErrorException('Error occured while saving the custom event')
    }
  }

  @Post('/hb')
  async heartbeat(@Body() logDTO: PageviewsDTO, @Headers() headers, @Ip() reqIP): Promise<any> {
    const { 'user-agent': userAgent } = headers
    const { pid } = logDTO
    const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for'] || reqIP || ''

    const sessionID = await this.analyticsService.validateHB(logDTO, userAgent, ip)
    await redis.set(`hb:${pid}:${sessionID}`, 1, 'EX', HEARTBEAT_SID_LIFE_TIME)
    return
  }

  // Log pageview event
  @Post('/')
  async log(@Body() logDTO: PageviewsDTO, @Headers() headers, @Ip() reqIP): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers

    // todo: create a decorator for bot traffic detection
    if (isbot(userAgent)) {
      throw new ForbiddenException('Bot traffic is ignored')
    }

    const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for'] || reqIP || ''

    await this.analyticsService.validate(logDTO, origin, 'log', ip)

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)
    const sessionHash = getSessionKey(ip, userAgent, logDTO.pid, salt)
    const unique = await this.analyticsService.isUnique(sessionHash)
    let dto: Array<string | number>

    if (unique) {
      const ua = UAParser(userAgent)
      const dv = ua.device.type || 'desktop'
      const br = ua.browser.name
      const os = ua.os.name
      // trying to get country from timezome, otherwise using CloudFlare's IP based country code as a fallback
      const cc = ct.getCountryForTimezone(logDTO.tz)?.id || (headers['cf-ipcountry'] === 'XX' ? 'NULL' : headers['cf-ipcountry'])
      dto = analyticsDTO(logDTO.pid, logDTO.pg, dv, br, os, logDTO.lc, logDTO.ref, logDTO.so, logDTO.me, logDTO.ca, 'NULL' /* logDTO.lt */, cc, 1)
    } else if (!logDTO.unique) {
      dto = analyticsDTO(logDTO.pid, logDTO.pg, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 0)
    } else {
      throw new BadRequestException('Event was not saved because it was not unique while unique only param is provided')
    }

    // todo: fix: may be vulnerable to sql injection attack
    const values = `(${dto.map(getElValue).join(',')})`
    try {
      await redis.rpush(REDIS_LOG_DATA_CACHE_KEY, values)
      return
    } catch (e) {
      this.logger.error(e)
      throw new InternalServerErrorException('Error occured while saving the log data')
    }
  }

  // Fallback for logging pageviews for users with JavaScript disabled
  // Returns 1x1 transparent gif
  @Get('/noscript')
  async noscript(@Query() data, @Headers() headers, @Ip() reqIP, @Response() res): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers
    const { pid } = data

    // todo: create a decorator for bot traffic detection
    if (isbot(userAgent)) {
      res.writeHead(200, { 'Content-Type': 'image/gif' })
      return res.end(TRANSPARENT_GIF_BUFFER, 'binary')
    }

    const logDTO: PageviewsDTO = {
      pid,
    }

    await this.analyticsService.validate(logDTO, origin)

    const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for'] || reqIP || ''

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)
    const sessionHash = getSessionKey(ip, userAgent, logDTO.pid, salt)
    const unique = await this.analyticsService.isUnique(sessionHash)

    let dto: Array<string | number>

    if (unique) {
      const ua = UAParser(userAgent)
      const dv = ua.device.type || 'desktop'
      const br = ua.browser.name
      const os = ua.os.name
      // using CloudFlare's IP based country code
      const cc = headers['cf-ipcountry'] === 'XX' ? 'NULL' : headers['cf-ipcountry']
      dto = analyticsDTO(logDTO.pid, 'NULL', dv, br, os, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', cc, 1)
    } else {
      dto = analyticsDTO(logDTO.pid, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 0)
    }

    // todo: fix: may be vulnerable to sql injection attack
    const values = `(${dto.map(getElValue).join(',')})`
    try {
      await redis.rpush(REDIS_LOG_DATA_CACHE_KEY, values)
    } catch (e) {
      this.logger.error(e)
    }

    res.writeHead(200, { 'Content-Type': 'image/gif' })
    return res.end(TRANSPARENT_GIF_BUFFER, 'binary')
  }
}
