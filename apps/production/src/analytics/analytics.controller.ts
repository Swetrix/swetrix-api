import * as _isEmpty from 'lodash/isEmpty'
import * as _isArray from 'lodash/isArray'
import * as _toNumber from 'lodash/toNumber'
import * as _pick from 'lodash/pick'
import * as _includes from 'lodash/includes'
import * as _keys from 'lodash/keys'
import * as _values from 'lodash/values'
import * as _map from 'lodash/map'
import * as _uniqBy from 'lodash/uniqBy'
import * as _round from 'lodash/round'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as dayjsTimezone from 'dayjs/plugin/timezone'
import { hash } from 'blake3'
import {
  Controller,
  Body,
  Query,
  UseGuards,
  Get,
  Post,
  Patch,
  Headers,
  BadRequestException,
  InternalServerErrorException,
  UnprocessableEntityException,
  Ip,
  ForbiddenException,
  Response,
  Header,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import * as UAParser from 'ua-parser-js'
import * as isbot from 'isbot'

import { OptionalJwtAccessTokenGuard } from '../auth/guards'
import { Auth, Public } from '../auth/decorators'
import {
  AnalyticsService,
  getSessionKey,
  getHeartbeatKey,
  DataType,
  validPeriods,
  getLowestPossibleTimeBucket,
} from './analytics.service'
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator'
import { DEFAULT_TIMEZONE } from '../user/entities/user.entity'
import { RolesGuard } from '../auth/guards/roles.guard'
import { PageviewsDTO } from './dto/pageviews.dto'
import { EventsDTO } from './dto/events.dto'
import { AnalyticsGET_DTO, ChartRenderMode } from './dto/getData.dto'
import { GetCustomEventMetadata } from './dto/get-custom-event-meta.dto'
import { GetPagePropertyMetaDTO } from './dto/get-page-property-meta.dto'
import { GetUserFlowDTO } from './dto/getUserFlow.dto'
import { GetFunnelsDTO } from './dto/getFunnels.dto'
import { AppLoggerService } from '../logger/logger.service'
import {
  REDIS_LOG_DATA_CACHE_KEY,
  REDIS_LOG_PERF_CACHE_KEY,
  redis,
  REDIS_LOG_CUSTOM_CACHE_KEY,
  HEARTBEAT_SID_LIFE_TIME,
  REDIS_USERS_COUNT_KEY,
  REDIS_PROJECTS_COUNT_KEY,
  REDIS_EVENTS_COUNT_KEY,
  REDIS_SESSION_SALT_KEY,
  clickhouse,
  REDIS_LOG_ERROR_CACHE_KEY,
} from '../common/constants'
import {
  checkRateLimit,
  getGeoDetails,
  getIPFromHeaders,
} from '../common/utils'
import { BotDetection } from '../common/decorators/bot-detection.decorator'
import { BotDetectionGuard } from '../common/guards/bot-detection.guard'
import { GetCustomEventsDto } from './dto/get-custom-events.dto'
import { GetFiltersDto } from './dto/get-filters.dto'
import {
  IFunnel,
  IGetFunnel,
  IPageProperty,
  IUserFlow,
  PerfMeasure,
} from './interfaces'
import { GetSessionsDto } from './dto/get-sessions.dto'
import { GetSessionDto } from './dto/get-session.dto'
import { ErrorDTO } from './dto/error.dto'
import { GetErrorsDto } from './dto/get-errors.dto'
import { GetErrorDTO } from './dto/get-error.dto'
import { PatchStatusDTO } from './dto/patch-status.dto'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mysql = require('mysql2')

dayjs.extend(utc)
dayjs.extend(dayjsTimezone)

export const DEFAULT_MEASURE = 'median'

const getSessionKeyCustom = (
  ip: string,
  ua: string,
  pid: string,
  ev: string,
  salt = '',
) => `cses_${hash(`${ua}${ip}${pid}${ev}${salt}`).toString('hex')}`

const analyticsDTO = (
  psid: string,
  sid: string,
  pid: string,
  pg: string,
  prev: string,
  dv: string,
  br: string,
  os: string,
  lc: string,
  ref: string,
  so: string,
  me: string,
  ca: string,
  cc: string,
  rg: string,
  ct: string,
  lt: number | string,
  keys: string[],
  values: string[],
  sdur: number | string,
  unique: number,
): Array<string | number | string[]> => {
  return [
    psid,
    sid,
    pid,
    pg,
    prev,
    dv,
    br,
    os,
    lc,
    ref,
    so,
    me,
    ca,
    cc,
    rg,
    ct,
    lt,
    keys,
    values,
    sdur,
    unique,
    dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
  ]
}

const performanceDTO = (
  pid: string,
  pg: string,
  dv: string,
  br: string,
  cc: string,
  rg: string,
  ct: string,
  dns: number,
  tls: number,
  conn: number,
  response: number,
  render: number,
  domLoad: number,
  pageLoad: number,
  ttfb: number,
): Array<string | number> => {
  return [
    pid,
    pg,
    dv,
    br,
    cc,
    rg,
    ct,
    _round(dns),
    _round(tls),
    _round(conn),
    _round(response),
    _round(render),
    _round(domLoad),
    _round(pageLoad),
    _round(ttfb),
    dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
  ]
}

const customLogDTO = (
  psid: string,
  pid: string,
  ev: string,
  pg: string,
  dv: string,
  br: string,
  os: string,
  lc: string,
  ref: string,
  so: string,
  me: string,
  ca: string,
  cc: string,
  rg: string,
  ct: string,
  lt: number | string,
  keys: string[],
  values: string[],
): Array<string | number | string[]> => {
  return [
    psid,
    pid,
    ev,
    pg,
    dv,
    br,
    os,
    lc,
    ref,
    so,
    me,
    ca,
    cc,
    rg,
    ct,
    lt,
    keys,
    values,
    dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
  ]
}

const errorLogDTO = (
  eid: string,
  pid: string,
  pg: string,
  dv: string,
  br: string,
  os: string,
  lc: string,
  cc: string,
  rg: string,
  ct: string,
  name: string,
  message: string,
  lineno: number,
  colno: number,
  filename: string,
): Array<string | number | string[]> => {
  return [
    eid,
    pid,
    pg,
    dv,
    br,
    os,
    lc,
    cc,
    rg,
    ct,
    name,
    message,
    lineno,
    colno,
    filename,
    dayjs.utc().format('YYYY-MM-DD HH:mm:ss'),
  ]
}

export const getElValue = el => {
  if (_isArray(el)) {
    return `[${_map(el, getElValue).join(',')}]`
  }

  if (el === undefined || el === null || el === 'NULL') return 'NULL'
  return mysql.escape(el)
}

// Performance object validator: none of the values cannot be bigger than 1000 * 60 * 5 (5 minutes) and are >= 0
const MAX_PERFORMANCE_VALUE = 1000 * 60 * 5
const isPerformanceValid = (perf: any) => {
  return (
    perf.dns <= MAX_PERFORMANCE_VALUE &&
    perf.tls <= MAX_PERFORMANCE_VALUE &&
    perf.conn <= MAX_PERFORMANCE_VALUE &&
    perf.response <= MAX_PERFORMANCE_VALUE &&
    perf.render <= MAX_PERFORMANCE_VALUE &&
    perf.dom_load <= MAX_PERFORMANCE_VALUE &&
    perf.page_load <= MAX_PERFORMANCE_VALUE &&
    perf.ttfb <= MAX_PERFORMANCE_VALUE &&
    perf.dns >= 0 &&
    perf.tls >= 0 &&
    perf.conn >= 0 &&
    perf.response >= 0 &&
    perf.render >= 0 &&
    perf.dom_load >= 0 &&
    perf.page_load >= 0 &&
    perf.ttfb >= 0
  )
}

const getPIDsArray = (pids, pid) => {
  const pidsEmpty = _isEmpty(pids)
  const pidEmpty = _isEmpty(pid)
  if (pidsEmpty && pidEmpty)
    throw new BadRequestException(
      "An array of Project ID's (pids) or a Project ID (pid) has to be provided",
    )
  else if (!pidsEmpty && !pidEmpty)
    throw new BadRequestException(
      "Please provide either an array of Project ID's (pids) or a Project ID (pid), but not both",
    )
  else if (!pidEmpty) {
    pids = JSON.stringify([pid])
  }

  try {
    pids = JSON.parse(pids)
  } catch (e) {
    throw new UnprocessableEntityException(
      "Cannot process the provided array of Project ID's",
    )
  }

  if (!_isArray(pids)) {
    throw new UnprocessableEntityException(
      "An array of Project ID's has to be provided as a 'pids' param",
    )
  }

  return pids
}

const getEIDsArray = (eids, eid) => {
  const eidsEmpty = _isEmpty(eids)
  const eidEmpty = _isEmpty(eid)
  if (eidsEmpty && eidEmpty) {
    throw new BadRequestException(
      "An array of Error ID's (eids) or a Error ID (eid) has to be provided",
    )
  }
  if (!eidsEmpty && !eidEmpty) {
    throw new BadRequestException(
      "Please provide either an array of Error ID's (eids) or a Error ID (eid), but not both",
    )
  }

  if (!eidsEmpty) {
    return eids
  }

  return [eid]
}

// needed for serving 1x1 px GIF
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=',
  'base64',
)

@ApiTags('Analytics')
@UseGuards(OptionalJwtAccessTokenGuard, RolesGuard)
@Controller(['log', 'v1/log'])
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly logger: AppLoggerService,
  ) {}

  @Get()
  @Auth([], true, true)
  async getData(
    @Query() data: AnalyticsGET_DTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
    isCaptcha = false,
  ): Promise<any> {
    const {
      pid,
      period,
      timeBucket,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      mode = ChartRenderMode.PERIODICAL,
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    let newTimebucket = timeBucket
    let allowedTumebucketForPeriodAll

    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      diff = res.diff
      // eslint-disable-next-line prefer-destructuring
      newTimebucket = _includes(res.timeBucket, timeBucket)
        ? timeBucket
        : res.timeBucket[0]
      allowedTumebucketForPeriodAll = res.timeBucket
    }

    this.analyticsService.validateTimebucket(newTimebucket)
    const [filtersQuery, filtersParams, appliedFilters, customEVFilterApplied] =
      this.analyticsService.getFiltersQuery(
        filters,
        isCaptcha ? DataType.CAPTCHA : DataType.ANALYTICS,
      )

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo, groupFromUTC, groupToUTC } =
      this.analyticsService.getGroupFromTo(
        from,
        to,
        newTimebucket,
        period,
        safeTimezone,
        diff,
      )

    let subQuery = `FROM ${
      isCaptcha ? 'captcha' : 'analytics'
    } WHERE pid = {pid:FixedString(12)} ${filtersQuery} AND created BETWEEN {groupFrom:String} AND {groupTo:String}`

    if (customEVFilterApplied && !isCaptcha) {
      subQuery = `FROM customEV WHERE pid = {pid:FixedString(12)} ${filtersQuery} AND created BETWEEN {groupFrom:String} AND {groupTo:String}`
    }

    const paramsData = {
      params: {
        pid,
        groupFrom: groupFromUTC,
        groupTo: groupToUTC,
        ...filtersParams,
      },
    }

    let result: object | void

    if (isCaptcha) {
      result = await this.analyticsService.groupCaptchaByTimeBucket(
        newTimebucket,
        groupFrom,
        groupTo,
        subQuery,
        filtersQuery,
        paramsData,
        safeTimezone,
        mode,
      )
    } else {
      result = await this.analyticsService.groupByTimeBucket(
        newTimebucket,
        groupFrom,
        groupTo,
        subQuery,
        filtersQuery,
        paramsData,
        safeTimezone,
        customEVFilterApplied,
        appliedFilters,
        mode,
      )
    }

    if (isCaptcha) {
      return {
        ...result,
        appliedFilters,
        timeBucket: allowedTumebucketForPeriodAll,
      }
    }

    const customs = await this.analyticsService.getCustomEvents(
      filtersQuery,
      paramsData,
    )

    let properties: IPageProperty = {}

    if (!customEVFilterApplied) {
      properties = await this.analyticsService.getPageProperties(
        filtersQuery,
        paramsData,
      )
    }

    return {
      ...result,
      customs,
      properties,
      appliedFilters,
      timeBucket: allowedTumebucketForPeriodAll,
    }
  }

  @Get('funnel')
  @Auth([], true, true)
  async getFunnel(
    @Query() data: GetFunnelsDTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<IGetFunnel> {
    const {
      pid,
      period,
      from,
      to,
      timezone = DEFAULT_TIMEZONE,
      pages,
      funnelId,
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const pagesArr = await this.analyticsService.getPagesArray(
      pages,
      funnelId,
      pid,
    )

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      null,
      period,
      safeTimezone,
    )

    const params = {
      pid,
      groupFrom,
      groupTo,
    }

    let funnel: IFunnel[] = []
    let totalPageviews: number = 0

    const promises = [
      (async () => {
        funnel = await this.analyticsService.getFunnel(pagesArr, params)
      })(),
      (async () => {
        totalPageviews = await this.analyticsService.getTotalPageviews(
          pid,
          groupFrom,
          groupTo,
        )
      })(),
    ]

    await Promise.all(promises)

    return {
      funnel,
      totalPageviews,
    }
  }

  @Get('meta')
  @Auth([], true, true)
  async getCustomEventMetadata(
    @Query() data: GetCustomEventMetadata,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<ReturnType<typeof this.analyticsService.getCustomEventMetadata>> {
    const { pid, period } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    return this.analyticsService.getCustomEventMetadata(data)
  }

  @Get('property')
  @Auth([], true, true)
  async getPagePropertyMetadata(
    @Query() data: GetPagePropertyMetaDTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<ReturnType<typeof this.analyticsService.getPagePropertyMeta>> {
    const { pid, period } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    return this.analyticsService.getPagePropertyMeta(data)
  }

  @Get('filters')
  @Auth([], true, true)
  async getFilters(
    @Query() data: GetFiltersDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const { pid, type } = data
    this.analyticsService.validatePID(pid)

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    return this.analyticsService.getFilters(pid, type)
  }

  @Get('errors-filters')
  @Auth([], true, true)
  async getErrorsFilters(
    @Query() data: GetFiltersDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const { pid, type } = data
    this.analyticsService.validatePID(pid)

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    return this.analyticsService.getErrorsFilters(pid, type)
  }

  @Get('chart')
  @Auth([], true, true)
  async getChartData(
    @Query() data: AnalyticsGET_DTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      period,
      timeBucket,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      mode = ChartRenderMode.PERIODICAL,
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    this.analyticsService.validateTimebucket(timeBucket)
    const [filtersQuery, filtersParams, appliedFilters, customEVFilterApplied] =
      this.analyticsService.getFiltersQuery(filters, DataType.ANALYTICS)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      timeBucket,
      period,
      safeTimezone,
    )
    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const paramsData = {
      params: {
        pid,
        groupFrom,
        groupTo,
        ...filtersParams,
      },
    }

    const result = await this.analyticsService.groupChartByTimeBucket(
      timeBucket,
      groupFrom,
      groupTo,
      filtersQuery,
      paramsData,
      safeTimezone,
      customEVFilterApplied,
      mode,
    )

    return {
      ...result,
      appliedFilters,
    }
  }

  @Get('performance')
  @Auth([], true, true)
  async getPerfData(
    @Query() data: AnalyticsGET_DTO & { measure: PerfMeasure },
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      period,
      timeBucket,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      measure = DEFAULT_MEASURE,
    } = data
    this.analyticsService.validatePID(pid)

    this.analyticsService.checkIfPerfMeasureIsValid(measure)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    let newTimeBucket = timeBucket
    let allowedTumebucketForPeriodAll
    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      diff = res.diff
      // eslint-disable-next-line prefer-destructuring
      newTimeBucket = _includes(res.timeBucket, timeBucket)
        ? timeBucket
        : res.timeBucket[0]
      allowedTumebucketForPeriodAll = res.timeBucket
    }

    this.analyticsService.validateTimebucket(newTimeBucket)
    const [filtersQuery, filtersParams, appliedFilters] =
      this.analyticsService.getFiltersQuery(filters, DataType.PERFORMANCE)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      newTimeBucket,
      period,
      safeTimezone,
      diff,
    )

    const subQuery = `FROM performance WHERE pid = {pid:FixedString(12)} ${filtersQuery} AND created BETWEEN {groupFrom:String} AND {groupTo:String}`

    const paramsData = {
      params: {
        pid,
        groupFrom,
        groupTo,
        ...filtersParams,
      },
    }

    const result = await this.analyticsService.groupPerfByTimeBucket(
      newTimeBucket,
      groupFrom,
      groupTo,
      subQuery,
      filtersQuery,
      paramsData,
      safeTimezone,
      measure,
    )

    return {
      ...result,
      appliedFilters,
      timeBucket: allowedTumebucketForPeriodAll,
    }
  }

  @Get('performance/chart')
  @Auth([], true, true)
  async getPerfChartData(
    @Query() data: AnalyticsGET_DTO & { measure: PerfMeasure },
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      period,
      timeBucket,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      measure = DEFAULT_MEASURE,
    } = data
    this.analyticsService.validatePID(pid)

    this.analyticsService.checkIfPerfMeasureIsValid(measure)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    this.analyticsService.validateTimebucket(timeBucket)
    const [filtersQuery, filtersParams, appliedFilters] =
      this.analyticsService.getFiltersQuery(filters, DataType.PERFORMANCE)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      timeBucket,
      period,
      safeTimezone,
    )
    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const paramsData = {
      params: {
        pid,
        groupFrom,
        groupTo,
        ...filtersParams,
      },
    }

    const chart = await this.analyticsService.getPerfChartData(
      timeBucket,
      from,
      to,
      filtersQuery,
      paramsData,
      safeTimezone,
      measure,
    )

    return {
      chart,
      appliedFilters,
    }
  }

  @Get('captcha')
  @Auth([], true, true)
  async getCaptchaData(
    @Query() data: AnalyticsGET_DTO,
    @CurrentUserId() uid: string,
  ): Promise<any> {
    return this.getData(data, uid, {}, true)
  }

  @Get('user-flow')
  @Auth([], true, true)
  async getUserFlow(
    @Query() data: GetUserFlowDTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<IUserFlow | { appliedFilters: any[] }> {
    const { pid, period, from, to, timezone = DEFAULT_TIMEZONE, filters } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      diff = res.diff
    }

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      null,
      period,
      safeTimezone,
      diff,
    )

    const [filtersQuery, filtersParams, appliedFilters] =
      this.analyticsService.getFiltersQuery(filters, DataType.ANALYTICS)

    const params = {
      pid,
      groupFrom,
      groupTo,
      ...filtersParams,
    }

    const flow = await this.analyticsService.getUserFlow(params, filtersQuery)

    return {
      ...flow,
      appliedFilters,
    }
  }

  @Get('birdseye')
  @Auth([], true, true)
  // returns overall short statistics per project
  async getOverallStats(
    @Query() data,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pids,
      pid,
      period,
      from,
      to,
      timezone = DEFAULT_TIMEZONE,
      filters,
    } = data
    const pidsArray = getPIDsArray(pids, pid)

    const validationPromises = _map(pidsArray, async currentPID => {
      this.analyticsService.validatePID(currentPID)
      await this.analyticsService.checkProjectAccess(
        currentPID,
        uid,
        headers['x-password'],
      )

      await this.analyticsService.checkBillingAccess(currentPID)
    })

    await Promise.all(validationPromises)

    return this.analyticsService.getAnalyticsSummary(
      pidsArray,
      period,
      from,
      to,
      timezone,
      filters,
    )
  }

  @Get('captcha/birdseye')
  @Auth([], true, true)
  // returns overall short statistics per CAPTCHA project
  async getCaptchaOverallStats(
    @Query() data,
    @CurrentUserId() uid: string,
  ): Promise<any> {
    const {
      pids,
      pid,
      period,
      from,
      to,
      timezone = DEFAULT_TIMEZONE,
      filters,
    } = data
    const pidsArray = getPIDsArray(pids, pid)

    const validationPromises = _map(pidsArray, async currentPID => {
      this.analyticsService.validatePID(currentPID)
      await this.analyticsService.checkProjectAccess(currentPID, uid)

      await this.analyticsService.checkBillingAccess(currentPID)
    })

    await Promise.all(validationPromises)

    return this.analyticsService.getCaptchaSummary(
      pidsArray,
      period,
      from,
      to,
      timezone,
      filters,
    )
  }

  @Get('performance/birdseye')
  @Auth([], true, true)
  async getPerformanceOverallStats(
    @Query() data,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pids,
      pid,
      period,
      from,
      to,
      timezone = DEFAULT_TIMEZONE,
      filters,
    } = data
    let { measure = DEFAULT_MEASURE } = data
    const pidsArray = getPIDsArray(pids, pid)

    this.analyticsService.checkIfPerfMeasureIsValid(measure)

    if (measure === 'quantiles') {
      measure = DEFAULT_MEASURE
    }

    const validationPromises = _map(pidsArray, async currentPID => {
      this.analyticsService.validatePID(currentPID)
      await this.analyticsService.checkProjectAccess(
        currentPID,
        uid,
        headers['x-password'],
      )

      await this.analyticsService.checkBillingAccess(currentPID)
    })

    await Promise.all(validationPromises)

    return this.analyticsService.getPerformanceSummary(
      pidsArray,
      period,
      from,
      to,
      timezone,
      filters,
      measure,
    )
  }

  @Public()
  @Get('generalStats')
  async getGeneralStats(): Promise<object> {
    const exists = await redis.exists(
      REDIS_USERS_COUNT_KEY,
      REDIS_PROJECTS_COUNT_KEY,
      REDIS_EVENTS_COUNT_KEY,
    )

    if (exists) {
      const users = _toNumber(await redis.get(REDIS_USERS_COUNT_KEY))
      const projects = _toNumber(await redis.get(REDIS_PROJECTS_COUNT_KEY))
      const events = _toNumber(await redis.get(REDIS_EVENTS_COUNT_KEY))

      return {
        users,
        projects,
        events,
      }
    }

    return this.analyticsService.getGeneralStats()
  }

  @Get('hb')
  async getHeartBeatStats(
    @Query() data,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<object> {
    const { pids, pid } = data
    const pidsArray = getPIDsArray(pids, pid)

    const validationPromises = _map(pidsArray, async currentPID => {
      this.analyticsService.validatePID(currentPID)
      await this.analyticsService.checkProjectAccess(
        currentPID,
        uid,
        headers['x-password'],
      )

      await this.analyticsService.checkBillingAccess(currentPID)
    })

    await Promise.all(validationPromises)

    const result = {}

    const keyCountPromises = _map(pidsArray, async currentPID => {
      result[currentPID] =
        await this.analyticsService.getOnlineUserCount(currentPID)
    })

    await Promise.all(keyCountPromises).catch(reason => {
      this.logger.error(`[GET /analytics/hb] ${reason}`)
      throw new InternalServerErrorException(
        'An error occured while calculating heartbeat statistics',
      )
    })

    return result
  }

  @Get('liveVisitors')
  @Auth([], true, true)
  async getLiveVisitors(
    @Query() data,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<object> {
    const { pid } = data

    this.analyticsService.validatePID(pid)
    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const keys = await redis.keys(`sd:*:${pid}`)

    if (_isEmpty(keys)) {
      return []
    }

    const sids = _map(keys, key => key.split(':')[1])

    const query = `SELECT sid, dv, br, os, cc FROM analytics WHERE sid IN (${sids
      .map(el => `'${el}'`)
      .join(',')})`
    const result = await clickhouse.query(query).toPromise()
    const processed = _map(_uniqBy(result, 'sid'), el =>
      _pick(el, ['dv', 'br', 'os', 'cc']),
    )

    return processed
  }

  // Log error event
  @Post('error')
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  @Public()
  async logError(
    @Body() errorDTO: ErrorDTO,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers

    const ip = getIPFromHeaders(headers, true) || reqIP || ''

    await this.analyticsService.validate(errorDTO, origin, 'error', ip)

    const {
      city = 'NULL',
      region = 'NULL',
      country = 'NULL',
    } = getGeoDetails(ip, errorDTO.tz)

    const ua = UAParser(userAgent)
    const dv = ua.device.type || 'desktop'
    const br = ua.browser.name
    const os = ua.os.name

    const { name, message, lineno, colno, filename } = errorDTO

    const dto = errorLogDTO(
      this.analyticsService.getErrorID(errorDTO),
      errorDTO.pid,
      errorDTO.pg,
      dv,
      br,
      os,
      errorDTO.lc,
      country,
      region,
      city,
      name,
      message,
      lineno,
      colno,
      filename,
    )

    try {
      const values = `(${dto.map(getElValue).join(',')})`
      await redis.rpush(REDIS_LOG_ERROR_CACHE_KEY, values)
    } catch (e) {
      this.logger.error(e)
      throw new InternalServerErrorException(
        'Error occured while saving the custom event',
      )
    }
  }

  // Update error(s) status
  @Patch('error-status')
  @Auth([], true, true)
  async patchStatus(
    @Body() statusDTO: PatchStatusDTO,
    @CurrentUserId() uid: string,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    const { pid, eid, eids: unprocessedEids, status } = statusDTO
    const ip = getIPFromHeaders(headers) || reqIP || ''

    await checkRateLimit(ip, 'error-status', 100, 1800)

    this.analyticsService.validatePID(pid)
    await this.analyticsService.checkManageAccess(pid, uid)
    await this.analyticsService.checkBillingAccess(pid)

    const eids = getEIDsArray(unprocessedEids, eid)

    await this.analyticsService.validateEIDs(eids, pid)

    return this.analyticsService.updateEIDStatus(eids, status, pid)
  }

  // Log custom event
  @Post('custom')
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  @Public()
  async logCustom(
    @Body() eventsDTO: EventsDTO,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers

    const ip = getIPFromHeaders(headers, true) || reqIP || ''

    this.analyticsService.validateCustomEVMeta(eventsDTO.meta)
    await this.analyticsService.validate(eventsDTO, origin, 'custom', ip)

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)

    if (eventsDTO.unique) {
      const sessionHash = getSessionKeyCustom(
        ip,
        userAgent,
        eventsDTO.pid,
        eventsDTO.ev,
        salt,
      )
      const [unique] = await this.analyticsService.isUnique(sessionHash)

      if (!unique) {
        throw new ForbiddenException(
          'The unique option provided, while the custom event have already been created for this session',
        )
      }
    }

    const {
      city = 'NULL',
      region = 'NULL',
      country = 'NULL',
      localTime: localTimeUnprepared,
    } = getGeoDetails(ip, eventsDTO.tz)

    const ua = UAParser(userAgent)
    const dv = ua.device.type || 'desktop'
    const br = ua.browser.name
    const os = ua.os.name

    const localTime =
      localTimeUnprepared === null ? 'NULL' : localTimeUnprepared

    const sessionHash = getSessionKey(ip, userAgent, eventsDTO.pid, salt)
    const [, psid] = await this.analyticsService.isUnique(sessionHash)

    const dto = customLogDTO(
      psid,
      eventsDTO.pid,
      eventsDTO.ev,
      eventsDTO.pg,
      dv,
      br,
      os,
      eventsDTO.lc,
      eventsDTO.ref,
      eventsDTO.so,
      eventsDTO.me,
      eventsDTO.ca,
      country,
      region,
      city,
      localTime,
      _keys(eventsDTO.meta),
      _values(eventsDTO.meta),
    )

    try {
      const values = `(${dto.map(getElValue).join(',')})`
      await redis.rpush(REDIS_LOG_CUSTOM_CACHE_KEY, values)
    } catch (e) {
      this.logger.error(e)
      throw new InternalServerErrorException(
        'Error occured while saving the custom event',
      )
    }
  }

  @Post('hb')
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  @Auth([], true, true)
  async heartbeat(
    @Body() logDTO: PageviewsDTO,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    const { 'user-agent': userAgent } = headers
    const { pid } = logDTO
    const ip = getIPFromHeaders(headers, true) || reqIP || ''

    const sessionID = await this.analyticsService.getSessionHash(
      pid,
      userAgent,
      ip,
    )

    await redis.set(
      getHeartbeatKey(pid, sessionID),
      1,
      'EX',
      HEARTBEAT_SID_LIFE_TIME,
    )
    await this.analyticsService.processInteractionSD(sessionID, pid)
  }

  // Log pageview event
  @Post()
  @UseGuards(BotDetectionGuard)
  @BotDetection()
  @Public()
  async log(
    @Body() logDTO: PageviewsDTO,
    @Headers() headers,
    @Ip() reqIP,
  ): Promise<any> {
    const { 'user-agent': userAgent, origin } = headers

    const ip = getIPFromHeaders(headers, true) || reqIP || ''

    await this.analyticsService.validate(logDTO, origin, 'log', ip)

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)
    const sessionHash = getSessionKey(ip, userAgent, logDTO.pid, salt)
    const [unique, psid] = await this.analyticsService.isUnique(sessionHash)

    await this.analyticsService.processInteractionSD(sessionHash, logDTO.pid)

    if (!unique && logDTO.unique) {
      throw new ForbiddenException(
        'The event was not saved because it was not unique while unique only param is provided',
      )
    }

    const {
      city = 'NULL',
      region = 'NULL',
      country = 'NULL',
      localTime: localTimeUnprepared,
    } = getGeoDetails(ip, logDTO.tz)
    const ua = UAParser(userAgent)
    const dv = ua.device.type || 'desktop'
    const br = ua.browser.name
    const os = ua.os.name

    const localTime =
      localTimeUnprepared === null ? 'NULL' : localTimeUnprepared

    const dto = analyticsDTO(
      psid,
      sessionHash,
      logDTO.pid,
      logDTO.pg,
      logDTO.prev,
      dv,
      br,
      os,
      logDTO.lc,
      logDTO.ref,
      logDTO.so,
      logDTO.me,
      logDTO.ca,
      country,
      region,
      city,
      localTime,
      _keys(logDTO.meta),
      _values(logDTO.meta),
      0,
      Number(unique),
    )

    let perfDTO: Array<string | number> = []

    if (!_isEmpty(logDTO.perf) && isPerformanceValid(logDTO.perf)) {
      const {
        dns,
        tls,
        conn,
        response,
        render,
        dom_load: domLoad,
        page_load: pageLoad,
        ttfb,
      } = logDTO.perf

      perfDTO = performanceDTO(
        logDTO.pid,
        logDTO.pg,
        dv,
        br,
        country,
        region,
        city,
        dns,
        tls,
        conn,
        response,
        render,
        domLoad,
        pageLoad,
        ttfb,
      )
    }

    const values = `(${dto.map(getElValue).join(',')})`

    try {
      await redis.rpush(REDIS_LOG_DATA_CACHE_KEY, values)

      if (!_isEmpty(perfDTO)) {
        const perfValues = `(${perfDTO.map(getElValue).join(',')})`
        await redis.rpush(REDIS_LOG_PERF_CACHE_KEY, perfValues)
      }
    } catch (e) {
      this.logger.error(e)
      throw new InternalServerErrorException(
        'Error occured while saving the log data',
      )
    }
  }

  // Fallback for logging pageviews for users with JavaScript disabled
  // Returns 1x1 transparent gif
  @Get('noscript')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Public()
  async noscript(
    @Query() data,
    @Headers() headers,
    @Ip() reqIP,
    @Response() res,
  ): Promise<any> {
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

    const ip = getIPFromHeaders(headers) || reqIP || ''
    const salt = await redis.get(REDIS_SESSION_SALT_KEY)
    const sessionHash = getSessionKey(ip, userAgent, logDTO.pid, salt)
    const [unique, psid] = await this.analyticsService.isUnique(sessionHash)

    await this.analyticsService.processInteractionSD(sessionHash, logDTO.pid)

    const {
      city = 'NULL',
      region = 'NULL',
      country = 'NULL',
      localTime: localTimeUnprepared,
    } = getGeoDetails(ip)
    const ua = UAParser(userAgent)
    const dv = ua.device.type || 'desktop'
    const br = ua.browser.name
    const os = ua.os.name

    const localTime =
      localTimeUnprepared === null ? 'NULL' : localTimeUnprepared

    const dto = analyticsDTO(
      psid,
      sessionHash,
      logDTO.pid,
      'NULL',
      'NULL',
      dv,
      br,
      os,
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      country,
      region,
      city,
      localTime,
      [],
      [],
      0,
      Number(unique),
    )

    const values = `(${dto.map(getElValue).join(',')})`
    try {
      await redis.rpush(REDIS_LOG_DATA_CACHE_KEY, values)
    } catch (e) {
      this.logger.error(e)
    }

    res.writeHead(200, { 'Content-Type': 'image/gif' })
    return res.end(TRANSPARENT_GIF_BUFFER, 'binary')
  }

  @Get('sessions')
  @Auth([], true, true)
  async getSessions(
    @Query() data: GetSessionsDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const { pid, period, from, to, filters, timezone = DEFAULT_TIMEZONE } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const take = this.analyticsService.getSafeNumber(data.take, 30)
    const skip = this.analyticsService.getSafeNumber(data.skip, 0)

    if (take > 150) {
      throw new BadRequestException(
        'The maximum number of sessions to return is 150',
      )
    }

    let timeBucket
    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      // eslint-disable-next-line prefer-destructuring
      timeBucket = res.timeBucket[0]
      diff = res.diff
    } else {
      timeBucket = getLowestPossibleTimeBucket(period, from, to)
    }

    this.analyticsService.validateTimebucket(timeBucket)
    const [filtersQuery, filtersParams, appliedFilters, customEVFilterApplied] =
      this.analyticsService.getFiltersQuery(filters, DataType.ANALYTICS)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFromUTC, groupToUTC } = this.analyticsService.getGroupFromTo(
      from,
      to,
      timeBucket,
      period,
      safeTimezone,
      diff,
    )

    const paramsData = {
      params: {
        pid,
        groupFrom: groupFromUTC,
        groupTo: groupToUTC,
        ...filtersParams,
      },
    }

    const sessions = await this.analyticsService.getSessionsList(
      filtersQuery,
      paramsData,
      safeTimezone,
      take,
      skip,
      customEVFilterApplied,
    )

    return {
      sessions,
      appliedFilters,
      take,
      skip,
    }
  }

  @Get('errors')
  @Auth([], true, true)
  async getErrors(
    @Query() data: GetErrorsDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      period,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      options,
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const take = this.analyticsService.getSafeNumber(data.take, 30)
    const skip = this.analyticsService.getSafeNumber(data.skip, 0)

    if (take > 150) {
      throw new BadRequestException(
        'The maximum number of errors to return is 150',
      )
    }

    let timeBucket
    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      // eslint-disable-next-line prefer-destructuring
      timeBucket = res.timeBucket[0]
      diff = res.diff
    } else {
      timeBucket = getLowestPossibleTimeBucket(period, from, to)
    }

    this.analyticsService.validateTimebucket(timeBucket)
    const [filtersQuery, filtersParams, appliedFilters] =
      this.analyticsService.getFiltersQuery(filters, DataType.ANALYTICS)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFromUTC, groupToUTC } = this.analyticsService.getGroupFromTo(
      from,
      to,
      timeBucket,
      period,
      safeTimezone,
      diff,
    )

    const paramsData = {
      params: {
        pid,
        groupFrom: groupFromUTC,
        groupTo: groupToUTC,
        ...filtersParams,
      },
    }

    const errors = await this.analyticsService.getErrorsList(
      options,
      filtersQuery,
      paramsData,
      safeTimezone,
      take,
      skip,
    )

    return {
      errors,
      appliedFilters,
      take,
      skip,
    }
  }

  @Get('get-error')
  @Auth([], true, true)
  async getError(
    @Query() data: GetErrorDTO,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      timezone = DEFAULT_TIMEZONE,
      eid,
      period,
      from,
      to,
      //
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    let timeBucket
    let diff

    if (period === 'all') {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      // eslint-disable-next-line prefer-destructuring
      timeBucket = res.timeBucket[0]
      diff = res.diff
    } else {
      timeBucket = getLowestPossibleTimeBucket(period, from, to)
    }

    this.analyticsService.validateTimebucket(timeBucket)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFromUTC, groupToUTC } = this.analyticsService.getGroupFromTo(
      from,
      to,
      timeBucket,
      period,
      safeTimezone,
      diff,
    )

    const result = await this.analyticsService.getErrorDetails(
      pid,
      eid,
      safeTimezone,
      groupFromUTC,
      groupToUTC,
      timeBucket,
    )

    return result
  }

  @Get('session')
  @Auth([], true, true)
  async getSession(
    @Query() data: GetSessionDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      psid,
      timezone = DEFAULT_TIMEZONE,
      //
    } = data
    this.analyticsService.validatePID(pid)

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)

    const result = await this.analyticsService.getSessionDetails(
      pid,
      psid,
      safeTimezone,
    )

    return result
  }

  @Get('custom-events')
  @Auth([], true, true)
  async getCustomEvents(
    @Query() data: GetCustomEventsDto,
    @CurrentUserId() uid: string,
    @Headers() headers: { 'x-password'?: string },
  ): Promise<any> {
    const {
      pid,
      period,
      timeBucket,
      from,
      to,
      filters,
      timezone = DEFAULT_TIMEZONE,
      customEvents,
    } = data
    this.analyticsService.validatePID(pid)

    if (!_isEmpty(period)) {
      this.analyticsService.validatePeriod(period)
    }

    await this.analyticsService.checkProjectAccess(
      pid,
      uid,
      headers['x-password'],
    )

    await this.analyticsService.checkBillingAccess(pid)

    let newTimeBucket = timeBucket
    let diff
    let timeBucketForAllTime

    if (period === validPeriods[validPeriods.length - 1]) {
      const res = await this.analyticsService.getTimeBucketForAllTime(
        pid,
        period,
        timezone,
      )

      // eslint-disable-next-line prefer-destructuring
      newTimeBucket = _includes(res.timeBucket, timeBucket)
        ? timeBucket
        : res.timeBucket[0]
      diff = res.diff
      timeBucketForAllTime = res.timeBucket
    }

    this.analyticsService.validateTimebucket(newTimeBucket)
    const [filtersQuery, filtersParams, appliedFilters] =
      this.analyticsService.getFiltersQuery(filters, DataType.ANALYTICS)

    const safeTimezone = this.analyticsService.getSafeTimezone(timezone)
    const { groupFrom, groupTo } = this.analyticsService.getGroupFromTo(
      from,
      to,
      newTimeBucket,
      period,
      safeTimezone,
      diff,
    )

    const paramsData = {
      params: {
        pid,
        groupFrom,
        groupTo,
        ...filtersParams,
      },
    }

    const result: any = await this.analyticsService.groupCustomEVByTimeBucket(
      newTimeBucket,
      groupFrom,
      groupTo,
      filtersQuery,
      paramsData,
      safeTimezone,
    )

    let customEventss = customEvents

    if (filters) {
      try {
        customEventss = JSON.parse(customEvents)
        // eslint-disable-next-line no-empty
      } catch {}
    }

    if (customEventss.length > 0) {
      for (const key in result.chart.events) {
        if (!customEventss.includes(key)) {
          delete result.chart.events[key]
        }
      }
    } else {
      result.chart = {}
    }

    return {
      ...result,
      appliedFilters,
      timeBucket: timeBucketForAllTime,
    }
  }
}
