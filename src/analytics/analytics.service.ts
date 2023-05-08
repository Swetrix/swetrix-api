import * as _isEmpty from 'lodash/isEmpty'
import * as _split from 'lodash/split'
import * as _size from 'lodash/size'
import * as _includes from 'lodash/includes'
import * as _map from 'lodash/map'
import * as _toUpper from 'lodash/toUpper'
import * as _join from 'lodash/join'
import * as _last from 'lodash/last'
import * as _some from 'lodash/some'
import * as _find from 'lodash/find'
import * as _now from 'lodash/now'
import * as _values from 'lodash/values'
import * as _round from 'lodash/round'
import * as _filter from 'lodash/filter'
import * as _clone from 'lodash/clone'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as dayjsTimezone from 'dayjs/plugin/timezone'
import * as ipRangeCheck from 'ip-range-check'
import validator from 'validator'
import { hash } from 'blake3'
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
  UnprocessableEntityException,
  PreconditionFailedException,
} from '@nestjs/common'

import {
  ACCOUNT_PLANS,
  DEFAULT_TIMEZONE,
  PlanCode,
} from '../user/entities/user.entity'
import {
  redis,
  isValidPID,
  UNIQUE_SESSION_LIFE_TIME,
  clickhouse,
  isSelfhosted,
  REDIS_SESSION_SALT_KEY,
} from '../common/constants'
import {
  calculateRelativePercentage,
  millisecondsToSeconds,
} from '../common/utils'
import { PageviewsDTO } from './dto/pageviews.dto'
import { EventsDTO } from './dto/events.dto'
import { ProjectService } from '../project/project.service'
import { Project } from '../project/entity/project.entity'
import { TimeBucketType } from './dto/getData.dto'
import {
  PerformanceCHResponse,
  CustomsCHResponse,
  CustomsCHAggregatedResponse,
  TrafficCEFilterCHResponse,
  TrafficCHResponse,
  IGetGroupFromTo,
  GetFiltersQuery,
  IUserFlowNode,
  IUserFlowLink,
  IUserFlow,
  IBuildUserFlow,
  IExtractChartData,
  DateRelativeToUTC,
  TimeBucketToDateFormat,
} from './interfaces'

dayjs.extend(utc)
dayjs.extend(dayjsTimezone)

export const getSessionKey = (ip: string, ua: string, pid: string, salt = '') =>
  `ses_${hash(`${ua}${ip}${pid}${salt}`).toString('hex')}`

export const getHeartbeatKey = (pid: string, sessionID: string) =>
  `hb:${pid}:${sessionID}`

export const getSessionDurationKey = (sessionHash: string, pid: string) =>
  `sd:${sessionHash}:${pid}`

export const cols = [
  'cc',
  'pg',
  'lc',
  'br',
  'os',
  'dv',
  'ref',
  'so',
  'me',
  'ca',
]

export const captchaColumns = ['cc', 'br', 'os', 'dv']

export const perfColumns = ['cc', 'pg', 'dv', 'br']

const validPeriods = [
  'today',
  'yesterday',
  '1d',
  '7d',
  '4w',
  '3M',
  '12M',
  '24M',
]

const validTimebuckets = [
  TimeBucketType.HOUR,
  TimeBucketType.DAY,
  TimeBucketType.WEEK,
  TimeBucketType.MONTH,
]

// mapping of allowed timebuckets per difference between days
// (e.g. if difference is lower than (lt) (including) -> then the specified timebuckets are allowed to be applied)
const timeBucketToDays = [
  { lt: 7, tb: [TimeBucketType.HOUR, TimeBucketType.DAY] }, // 7 days
  { lt: 28, tb: [TimeBucketType.DAY, TimeBucketType.WEEK] }, // 4 weeks
  { lt: 366, tb: [TimeBucketType.WEEK, TimeBucketType.MONTH] }, // 12 months
  { lt: 732, tb: [TimeBucketType.MONTH] }, // 24 months
]

// Smaller than 64 characters, must start with an English letter and contain only letters (a-z A-Z), numbers (0-9), underscores (_) and dots (.)
// eslint-disable-next-line no-useless-escape
const customEVvalidate = /^[a-zA-Z](?:[\w\.]){0,62}$/

const timeBucketConversion = {
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
}

const isValidTimezone = (timezone: string): boolean => {
  if (_isEmpty(timezone)) {
    return false
  }

  try {
    dayjs.tz('2013-11-18 11:55', timezone)
    return true
  } catch {
    return false
  }
}

export const isValidDate = (date: string, format = 'YYYY-MM-DD'): boolean => {
  if (_isEmpty(date)) {
    return false
  }

  return dayjs(date, format).format(format) === date
}

const checkIfTBAllowed = (
  timeBucket: TimeBucketType,
  from: string,
  to: string,
): void => {
  const diff = dayjs(to).diff(dayjs(from), 'days')

  const tbMap = _find(timeBucketToDays, ({ lt }) => diff <= lt)

  if (_isEmpty(tbMap)) {
    throw new PreconditionFailedException(
      "The difference between 'from' and 'to' is greater than allowed",
    )
  }

  const { tb } = tbMap

  if (!_includes(tb, timeBucket)) {
    throw new PreconditionFailedException(
      "The specified 'timeBucket' parameter cannot be applied to the date range",
    )
  }
}

const generateParamsQuery = (
  col: string,
  subQuery: string,
  customEVFilterApplied: boolean,
  isPageInclusiveFilterSet: boolean,
  isCaptcha?: boolean,
  isPerformance?: boolean,
): string => {
  if (isPerformance) {
    return `SELECT ${col}, avg(pageLoad) ${subQuery} AND ${col} IS NOT NULL GROUP BY ${col}`
  }

  if (isCaptcha) {
    return `SELECT ${col}, count(*) ${subQuery} AND ${col} IS NOT NULL GROUP BY ${col}`
  }

  if (customEVFilterApplied) {
    return `SELECT ${col}, count(*) ${subQuery} AND ${col} IS NOT NULL GROUP BY ${col}`
  }

  if (col === 'pg' || isPageInclusiveFilterSet) {
    return `SELECT ${col}, count(*) ${subQuery} AND ${col} IS NOT NULL GROUP BY ${col}`
  }

  return `SELECT ${col}, count(*) ${subQuery} AND ${col} IS NOT NULL AND unique='1' GROUP BY ${col}`
}

export enum DataType {
  ANALYTICS = 'analytics',
  PERFORMANCE = 'performance',
  CAPTCHA = 'captcha',
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly projectService: ProjectService) {}

  async checkProjectAccess(pid: string, uid: string | null): Promise<void> {
    if (!isSelfhosted) {
      const project = await this.projectService.getRedisProject(pid)
      this.projectService.allowedToView(project, uid)
    }
  }

  checkOrigin(project: Project, origin: string): void {
    // For some reasons the project.origins sometimes may look like [''], let's filter it out
    // TODO: Properly validate the origins on project update
    const origins = _filter(project.origins, Boolean)

    if (!_isEmpty(origins) && !_isEmpty(origin)) {
      if (origin === 'null') {
        if (!_includes(origins, 'null')) {
          throw new BadRequestException(
            "'null' origin is not added to your project's whitelist. To send requests from this origin either add it to your origins policy or leave it empty.",
          )
        }
      } else {
        const { hostname } = new URL(origin)
        if (!_includes(origins, hostname)) {
          throw new BadRequestException(
            "This origin is prohibited by the project's origins policy",
          )
        }
      }
    }
  }

  checkIpBlacklist(project: Project, ip: string): void {
    // For some reasons the project.ipBlacklist sometimes may look like [''], let's filter it out
    // TODO: Properly validate the ipBlacklist on project update
    const ipBlacklist = _filter(project.ipBlacklist, Boolean)

    if (!_isEmpty(ipBlacklist) && ipRangeCheck(ip, ipBlacklist)) {
      throw new BadRequestException(
        'Incoming analytics is disabled for this IP address',
      )
    }
  }

  validatePID(pid: string): void {
    if (_isEmpty(pid)) {
      throw new BadRequestException('The Project ID (pid) has to be provided')
    }

    if (!isValidPID(pid)) {
      throw new BadRequestException(
        'The provided Project ID (pid) is incorrect',
      )
    }
  }

  async validate(
    logDTO: PageviewsDTO | EventsDTO,
    origin: string,
    type: 'custom' | 'log' = 'log',
    ip?: string,
  ): Promise<string | null> {
    if (_isEmpty(logDTO)) {
      throw new BadRequestException('The request cannot be empty')
    }

    const { pid } = logDTO
    this.validatePID(pid)

    if (type === 'custom') {
      const { ev } = <EventsDTO>logDTO

      if (_isEmpty(ev)) {
        throw new BadRequestException('Empty custom events are not allowed')
      }

      if (!customEVvalidate.test(ev)) {
        throw new BadRequestException(
          'An incorrect event name (ev) is provided',
        )
      }
    }

    // 'tz' does not need validation as it's based on getCountryForTimezone detection
    const { lc } = logDTO

    // validate locale ('lc' param)
    if (!_isEmpty(lc)) {
      if (validator.isLocale(lc)) {
        // uppercase the locale after '-' char, so for example both 'en-gb' and 'en-GB' in result will be 'en-GB'
        const lcParted = _split(lc, '-')

        if (_size(lcParted) > 1) {
          lcParted[1] = _toUpper(lcParted[1])
        }

        logDTO.lc = _join(lcParted, '-')
      } else {
        logDTO.lc = 'NULL'
      }
    }

    const project = await this.projectService.getRedisProject(pid)

    this.checkIpBlacklist(project, ip)

    if (!project.active) {
      throw new BadRequestException(
        'Incoming analytics is disabled for this project',
      )
    }

    if (!isSelfhosted) {
      if (project.admin.planCode === PlanCode.none) {
        throw new ForbiddenException(
          'You cannot send analytics to this project due to no active subscription. Please upgrade your account plan to continue sending analytics.',
        )
      }

      const count = await this.projectService.getRedisCount(project.admin.id)
      const maxCount =
        ACCOUNT_PLANS[project.admin.planCode].monthlyUsageLimit || 0

      if (count >= maxCount) {
        throw new ForbiddenException(
          'You have exceeded the available monthly request limit for your account. Please upgrade your account plan if you need more requests.',
        )
      }
    }

    this.checkOrigin(project, origin)

    return null
  }

  getDataTypeColumns(dataType: DataType): string[] {
    if (dataType === DataType.ANALYTICS) {
      return cols
    }

    if (dataType === DataType.PERFORMANCE) {
      return perfColumns
    }

    return captchaColumns
  }

  getGroupFromTo(
    from: string,
    to: string,
    timeBucket: TimeBucketType | null,
    period: string,
    timezone: string,
  ): IGetGroupFromTo {
    let groupFrom
    let groupTo

    if (!_isEmpty(from) && !_isEmpty(to)) {
      if (!isValidDate(from)) {
        throw new PreconditionFailedException(
          "The timeframe 'from' parameter is invalid",
        )
      }

      if (!isValidDate(to)) {
        throw new PreconditionFailedException(
          "The timeframe 'to' parameter is invalid",
        )
      }

      if (dayjs.utc(from).isAfter(dayjs.utc(to), 'second')) {
        throw new PreconditionFailedException(
          "The timeframe 'from' parameter cannot be greater than 'to'",
        )
      }

      if (!_isEmpty(timeBucket)) {
        checkIfTBAllowed(timeBucket, from, to)
      }

      groupFrom = dayjs.tz(from, timezone).utc().format('YYYY-MM-DD HH:mm:ss')

      if (from === to) {
        groupTo = dayjs
          .tz(to, timezone)
          .add(1, 'day')
          .format('YYYY-MM-DD HH:mm:ss')
      } else {
        groupTo = dayjs.tz(to, timezone).format('YYYY-MM-DD HH:mm:ss')
      }
    } else if (!_isEmpty(period)) {
      if (period === 'today') {
        if (timezone !== DEFAULT_TIMEZONE && isValidTimezone(timezone)) {
          groupFrom = dayjs()
            .tz(timezone)
            .startOf('d')
            .utc()
            .format('YYYY-MM-DD HH:mm:ss')
          groupTo = dayjs().tz(timezone).utc().format('YYYY-MM-DD HH:mm:ss')
        } else {
          groupFrom = dayjs.utc().startOf('d').format('YYYY-MM-DD')
          groupTo = dayjs.utc().format('YYYY-MM-DD HH:mm:ss')
        }
      } else if (period === 'yesterday') {
        if (timezone !== DEFAULT_TIMEZONE && isValidTimezone(timezone)) {
          groupFrom = dayjs()
            .tz(timezone)
            .startOf('d')
            .subtract(1, 'day')
            .utc()
            .format('YYYY-MM-DD HH:mm:ss')
          groupTo = dayjs()
            .tz(timezone)
            .startOf('d')
            .utc()
            .format('YYYY-MM-DD HH:mm:ss')
        } else {
          groupFrom = dayjs
            .utc()
            .startOf('d')
            .subtract(1, 'day')
            .format('YYYY-MM-DD')
          groupTo = dayjs.utc().startOf('d').format('YYYY-MM-DD HH:mm:ss')
        }
      } else {
        groupFrom = dayjs
          .utc()
          .subtract(parseInt(period, 10), _last(period))
          .format('YYYY-MM-DD')
        groupTo = dayjs.utc().format('YYYY-MM-DD 23:59:59')

        if (!_isEmpty(timeBucket)) {
          checkIfTBAllowed(timeBucket, groupFrom, groupTo)
        }
      }
    } else {
      throw new BadRequestException(
        'The timeframe (either from/to pair or period) has to be provided',
      )
    }

    return {
      groupFrom,
      groupTo,
    }
  }

  removeCyclicDependencies(links: IUserFlowLink[]): IUserFlowLink[] {
    const visited = new Set<string>()

    return links.filter(link => {
      const key = `${link.source}_${link.target}`
      if (visited.has(key)) {
        return false
      }
      visited.add(key)
      return true
    })
  }

  buildUserFlow(links: IUserFlowLink[]): IBuildUserFlow {
    const nodes: IUserFlowNode[] = Array.from(
      new Set(
        links
          .map((link: IUserFlowLink) => link.source)
          .concat(links.map((link: IUserFlowLink) => link.target)),
      ),
    ).map((node: any) => ({ id: node }))

    return { nodes, links }
  }

  async getUserFlow(params: unknown): Promise<IUserFlow> {
    const query = `
      SELECT
        pg AS source,
        prev AS target,
        count() AS value
      FROM analytics
      WHERE
        pid = {pid:FixedString(12)}
        AND created BETWEEN {groupFrom:String} AND {groupTo:String}
        AND pg != prev
      GROUP BY
        pg,
        prev
    `

    const results = <IUserFlowLink[]>(
      await clickhouse.query(query, { params }).toPromise()
    )

    if (_isEmpty(results)) {
      const empty = { nodes: [], links: [] }
      return {
        ascending: empty,
        descending: empty,
      }
    }

    const ascendingLinks: IUserFlowLink[] = []
    const descendingLinks: IUserFlowLink[] = []

    this.removeCyclicDependencies(results).forEach((row: any) => {
      const link: IUserFlowLink = {
        source: row.source,
        target: row.target,
        value: row.value,
      }
      if (link.source < link.target) {
        ascendingLinks.push(link)
      } else {
        descendingLinks.push(link)
      }
    })

    return {
      ascending: this.buildUserFlow(ascendingLinks),
      descending: this.buildUserFlow(descendingLinks),
    }
  }

  async getSessionHash(
    pid: string,
    userAgent: string,
    ip: string,
  ): Promise<string> {
    this.validatePID(pid)

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)

    return getSessionKey(ip, userAgent, pid, salt)
  }

  async isSessionDurationOpen(sdKey: string): Promise<Array<string | boolean>> {
    const sd = await redis.get(sdKey)
    return [sd, Boolean(sd)]
  }

  // Processes interaction for session duration
  async processInteractionSD(sessionHash: string, pid: string): Promise<void> {
    const sdKey = getSessionDurationKey(sessionHash, pid)
    const [sd, isOpened] = await this.isSessionDurationOpen(sdKey)
    const now = _now()

    // the value is START_UNIX_TIMESTAMP:LAST_INTERACTION_UNIX_TIMESTAMP
    if (isOpened) {
      const [start] = _split(sd, ':')
      await redis.set(sdKey, `${start}:${now}`, 'EX', UNIQUE_SESSION_LIFE_TIME)
    } else {
      await redis.set(sdKey, `${now}:${now}`, 'EX', UNIQUE_SESSION_LIFE_TIME)
    }
  }

  validatePeriod(period: string): void {
    if (!_includes(validPeriods, period)) {
      throw new UnprocessableEntityException('The provided period is incorrect')
    }
  }

  // returns SQL filters query in a format like 'AND col=value AND ...'
  getFiltersQuery(filters: string, dataType: DataType): GetFiltersQuery {
    let parsed = []
    let query = ''
    let params = {}

    if (_isEmpty(filters)) {
      return [query, params, parsed]
    }

    try {
      parsed = JSON.parse(filters)
    } catch (e) {
      console.error(`Cannot parse the filters array: ${filters}`)
      return [query, params, parsed]
    }

    if (_isEmpty(parsed)) {
      return [query, params, parsed]
    }

    const columns = this.getDataTypeColumns(dataType)

    for (let i = 0; i < _size(parsed); ++i) {
      const { column, filter, isExclusive } = parsed[i]

      if (column === 'ev') {
        params = {
          ...params,
          [column]: filter,
          [`${column}_exclusive`]: isExclusive,
        }

        continue
      }

      if (!_includes(columns, column)) {
        throw new UnprocessableEntityException(
          `The provided filter (${column}) is not supported`,
        )
      }
      // working only on 1 filter per 1 column
      const colFilter = `cf_${column}`

      params = {
        ...params,
        [colFilter]: filter,
      }
      query += ` ${
        isExclusive ? 'AND NOT' : 'AND'
      } ${column}={${colFilter}:String}`
    }

    return [query, params, parsed]
  }

  validateTimebucket(tb: TimeBucketType): void {
    if (!_includes(validTimebuckets, tb)) {
      throw new UnprocessableEntityException(
        'The provided timebucket is incorrect',
      )
    }
  }

  async isUnique(sessionHash: string) {
    const session = await redis.get(sessionHash)
    await redis.set(sessionHash, 1, 'EX', UNIQUE_SESSION_LIFE_TIME)
    return !session
  }

  async getSummary(
    pids: string[],
    period: 'w' | 'M' = 'w',
    amountToSubtract = 1,
  ) {
    return this.getSummaryStats(pids, 'analytics', period, amountToSubtract)
  }

  async getCaptchaSummary(pids: string[], period: 'w' | 'M' = 'w') {
    return this.getSummaryStats(pids, 'captcha', period)
  }

  async getSummaryStats(
    pids: string[],
    tableName: 'analytics' | 'captcha',
    period: 'w' | 'M' = 'w',
    amountToSubtract = 1,
  ) {
    const result = {}

    const promises = pids.map(async pid => {
      if (!isValidPID(pid)) {
        throw new BadRequestException(
          `The provided Project ID (${pid}) is incorrect`,
        )
      }

      const now = dayjs.utc().format('YYYY-MM-DD HH:mm:ss')
      const periodRaw = dayjs.utc().subtract(amountToSubtract, period)
      const periodFormatted = periodRaw.format('YYYY-MM-DD HH:mm:ss')
      const periodSubtracted = periodRaw
        .subtract(amountToSubtract, period)
        .format('YYYY-MM-DD HH:mm:ss')

      const queryThisWeek = `SELECT ${
        tableName === 'analytics' ? 'unique,' : ''
      } count() FROM ${tableName} WHERE pid = {pid:FixedString(12)} AND created BETWEEN {periodFormatted:String} AND {now:String}${
        tableName === 'analytics' ? ' GROUP BY unique' : ''
      }`
      const queryLastWeek = `SELECT ${
        tableName === 'analytics' ? 'unique,' : ''
      } count() FROM ${tableName} WHERE pid = {pid:FixedString(12)} AND created BETWEEN {periodSubtracted:String} AND {periodFormatted:String}${
        tableName === 'analytics' ? ' GROUP BY unique' : ''
      }`

      const paramsData = {
        params: {
          pid,
          periodFormatted,
          periodSubtracted,
          now,
        },
      }

      try {
        const thisWeekResult = await clickhouse
          .query(queryThisWeek, paramsData)
          .toPromise()
        const lastWeekResult = await clickhouse
          .query(queryLastWeek, paramsData)
          .toPromise()

        if (tableName === 'analytics') {
          const thisWeekUnique =
            _find(thisWeekResult, ({ unique }) => unique)?.['count()'] || 0
          const thisWeekPV =
            (_find(thisWeekResult, ({ unique }) => !unique)?.['count()'] || 0) +
            thisWeekUnique
          const lastWeekUnique =
            _find(lastWeekResult, ({ unique }) => unique)?.['count()'] || 0
          const lastWeekPV =
            (_find(lastWeekResult, ({ unique }) => !unique)?.['count()'] || 0) +
            lastWeekUnique

          result[pid] = {
            thisWeek: thisWeekPV,
            lastWeek: lastWeekPV,
            thisWeekUnique,
            lastWeekUnique,
            percChange: calculateRelativePercentage(lastWeekPV, thisWeekPV),
            percChangeUnique: calculateRelativePercentage(
              lastWeekUnique,
              thisWeekUnique,
            ),
          }
        } else {
          const thisWeek = thisWeekResult?.['count()'] || 0
          const lastWeek = lastWeekResult?.['count()'] || 0

          result[pid] = {
            thisWeek,
            lastWeek,
            percChange: calculateRelativePercentage(lastWeek, thisWeek),
          }
        }
      } catch {
        throw new InternalServerErrorException(
          "Can't process the provided PID. Please, try again later.",
        )
      }
    })

    await Promise.all(promises)

    return result
  }

  async generateParams(
    parsedFilters: Array<{ [key: string]: string }>,
    subQuery: string,
    customEVFilterApplied: boolean,
    paramsData: any,
    isCaptcha: boolean,
    isPerformance: boolean,
  ): Promise<any> {
    const params = {}

    // We need this to display all the pageview related data (e.g. country, browser) when user applies an inclusive filter on the Page column
    const isPageInclusiveFilterSet =
      isCaptcha || isPerformance
        ? false
        : !_isEmpty(
            _find(
              parsedFilters,
              filter => filter.column === 'pg' && !filter.isExclusive,
            ),
          )

    let columns = cols

    if (isCaptcha) {
      columns = captchaColumns
    }

    if (isPerformance) {
      columns = perfColumns
    }

    const paramsPromises = _map(columns, async col => {
      const query = generateParamsQuery(
        col,
        subQuery,
        customEVFilterApplied,
        isPageInclusiveFilterSet,
        isCaptcha,
        isPerformance,
      )
      const res = await clickhouse.query(query, paramsData).toPromise()

      params[col] = {}

      const size = _size(res)
      for (let j = 0; j < size; ++j) {
        const key = res[j][col]

        if (isPerformance) {
          params[col][key] = _round(
            millisecondsToSeconds(res[j]['avg(pageLoad)']),
            2,
          )
          continue
        }

        params[col][key] = res[j]['count()']
      }
    })

    await Promise.all(paramsPromises)

    return params
  }

  async calculateAverageSessionDuration(
    subQuery: string,
    paramsData: any,
  ): Promise<number> {
    const avgSdurQuery = `SELECT avg(sdur) ${subQuery} AND sdur IS NOT NULL AND unique='1'`
    const avgSdurObject = await clickhouse
      .query(avgSdurQuery, paramsData)
      .toPromise()

    return _round(avgSdurObject[0]['avg(sdur)'])
  }

  generateXAxis(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
  ): string[] {
    let groupDateIterator
    const now = dayjs.utc().endOf(timeBucket)
    const djsTo = dayjs.utc(to).endOf(timeBucket)
    const iterateTo = djsTo > now ? now : djsTo
    let format

    switch (timeBucket) {
      case TimeBucketType.HOUR:
        groupDateIterator = dayjs.utc(from).startOf('hour')
        format = 'YYYY-MM-DD HH:mm:ss'
        break

      case TimeBucketType.DAY:
        groupDateIterator = dayjs.utc(from).startOf('day')
        format = 'YYYY-MM-DD'
        break

      case TimeBucketType.WEEK:
        groupDateIterator = dayjs.utc(from).startOf('week')
        format = 'YYYY-MM-DD'
        break

      case TimeBucketType.MONTH:
        groupDateIterator = dayjs.utc(from).startOf('month')
        format = 'YYYY-MM'
        break

      default:
        throw new BadRequestException(
          `The provided time bucket (${timeBucket}) is incorrect`,
        )
    }

    const x = []

    while (groupDateIterator < iterateTo) {
      const nextIteration = groupDateIterator.add(1, timeBucket)
      x.push(groupDateIterator.format(format))
      groupDateIterator = nextIteration
    }

    return x
  }

  checkTimebucket(timeBucket: TimeBucketType): void {
    const isValid = _includes(
      [
        TimeBucketType.HOUR,
        TimeBucketType.DAY,
        TimeBucketType.WEEK,
        TimeBucketType.MONTH,
      ],
      timeBucket,
    )

    if (!isValid) {
      throw new BadRequestException(
        `The provided time bucket (${timeBucket}) is incorrect`,
      )
    }
  }

  generateDateString(row: { [key: string]: number }): string {
    const { year, month, day, hour } = row

    let dateString = `${year}-${month < 10 ? `0${month}` : month}`

    if (typeof day === 'number') {
      if (day < 10) {
        dateString += `-0${day}`
      } else {
        dateString += `-${day}`
      }
    }

    if (typeof hour === 'number') {
      if (hour < 10) {
        dateString += ` 0${hour}:00:00`
      } else {
        dateString += ` ${hour}:00:00`
      }
    }

    return dateString
  }

  extractChartData(result, x: string[]): IExtractChartData {
    const visits = Array(x.length).fill(0)
    const uniques = Array(x.length).fill(0)
    const sdur = Array(x.length).fill(0)

    for (let row = 0; row < _size(result); ++row) {
      const dateString = this.generateDateString(result[row])
      const index = x.indexOf(dateString)

      if (index !== -1) {
        visits[index] = result[row].pageviews
        uniques[index] = result[row].uniques
        sdur[index] = _round(result[row].sdur)
      }
    }

    return {
      visits,
      uniques,
      sdur,
    }
  }

  extractCustomEventsChartData(queryResult, x: string[]): any {
    const result = {}

    for (let row = 0; row < _size(queryResult); ++row) {
      const { ev = '_unknown_event' } = queryResult[row]

      const dateString = this.generateDateString(queryResult[row])

      const index = x.indexOf(dateString)

      if (index !== -1) {
        if (!result[ev]) {
          result[ev] = Array(x.length).fill(0)
        }

        result[ev][index] = queryResult[row].count
      }
    }

    return result
  }

  dateRelativeToUTC(date: dayjs.Dayjs, timezone: string): DateRelativeToUTC {
    const now = dayjs.utc().tz(timezone)
    const localDate = date.tz(timezone)

    if (localDate.isSame(now, 'day')) {
      return DateRelativeToUTC.TODAY
    }

    if (localDate.isBefore(now, 'day')) {
      return DateRelativeToUTC.YESTERDAY
    }

    return DateRelativeToUTC.TOMORROW
  }

  getSafeTimezone(timezone: string): string {
    if (timezone === DEFAULT_TIMEZONE || !isValidTimezone(timezone)) {
      return DEFAULT_TIMEZONE
    }

    return timezone
  }

  updateXAxisTimezone(
    x: string[],
    timezone: string,
    timeBucket: TimeBucketType,
  ): string[] {
    if (timezone === DEFAULT_TIMEZONE || !isValidTimezone(timezone)) {
      return x
    }

    return _map(x, el => {
      const date = dayjs.utc(el)
      const convertedDate = date.tz(timezone)

      if (timeBucket === TimeBucketType.HOUR) {
        return convertedDate.format(TimeBucketToDateFormat.hour)
      }

      const relative = this.dateRelativeToUTC(date, timezone)

      if (relative === DateRelativeToUTC.TODAY) {
        return convertedDate.format(TimeBucketToDateFormat[timeBucket])
      }

      if (relative === DateRelativeToUTC.YESTERDAY) {
        return convertedDate
          .add(1, 'day')
          .format(TimeBucketToDateFormat[timeBucket])
      }

      return convertedDate
        .subtract(1, 'day')
        .format(TimeBucketToDateFormat[timeBucket])
    })
  }

  getGroupSubquery(timeBucket: TimeBucketType): [string, string] {
    if (timeBucket === TimeBucketType.HOUR) {
      return [
        `toYear(tz_created) as year,
        toMonth(tz_created) as month,
        toDayOfMonth(tz_created) as day,
        toHour(tz_created) as hour`,
        'year, month, day, hour',
      ]
    }

    if (timeBucket === TimeBucketType.MONTH) {
      return [
        `toYear(tz_created) as year,
        toMonth(tz_created) as month`,
        'year, month',
      ]
    }

    return [
      `toYear(tz_created) as year,
      toMonth(tz_created) as month,
      toDayOfMonth(tz_created) as day`,
      'year, month, day',
    ]
  }

  generateAnalyticsAggregationQuery(
    timezone: string,
    timeBucket: TimeBucketType,
    filtersQuery: string,
  ): string {
    const safeTimezone = this.getSafeTimezone(timezone)

    const timeBucketFunc = timeBucketConversion[timeBucket]
    const [selector, groupBy] = this.getGroupSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    return `
      SELECT
        ${selector},
        avg(sdur) as sdur,
        count() as pageviews,
        sumIf(1, unique = 1) as uniques
      FROM (
        SELECT *,
          ${timeBucketFunc}(toTimeZone(created, '${safeTimezone}')) as tz_created
        FROM analytics
        WHERE pid = {pid:FixedString(12)} AND created BETWEEN ${tzFromDate} AND ${tzToDate} ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  getGroupXAxisSubquery(timeBucket: TimeBucketType): [string, string, string] {
    if (timeBucket === TimeBucketType.HOUR) {
      return [
        `toYear(date_range.date) as year,
        toMonth(date_range.date) as month,
        toDayOfMonth(date_range.date) as day,
        toHour(date_range.date) as hour`,
        'year, month, day, hour',
        'toStartOfHour(addHours',
      ]
    }

    if (timeBucket === TimeBucketType.MONTH) {
      return [
        `toYear(date_range.date) as year,
        toMonth(date_range.date) as month`,
        'year, month',
        'toStartOfMonth(addMonths',
      ]
    }

    return [
      `toYear(date_range.date) as year,
      toMonth(date_range.date) as month,
      toDayOfMonth(date_range.date) as day`,
      'year, month, day',
      'toStartOfDay(addDays',
    ]
  }

  generateDateRangeQuery(
    timezone: string,
    timeBucket: TimeBucketType,
  ): string {
    const safeTimezone = this.getSafeTimezone(timezone)

    const [selector, groupBy, aggregator] = this.getGroupXAxisSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    // return `
    //   WITH date_range AS (
    //     SELECT toStartOfDay(addDays(${tzFromDate}, number)) AS date
    //     FROM system.numbers
    //     WHERE toStartOfDay(addDays(${tzFromDate}, number)) <= ${tzToDate}
    //       AND toStartOfDay(addDays(${tzFromDate}, number)) >= ${tzFromDate}
    //     LIMIT 15
    //   )
    //   SELECT
    //     toYear(date_range.date) as year,
    //     toMonth(date_range.date) as month,
    //     toDayOfMonth(date_range.date) as day
    //   FROM date_range
    //   ORDER BY year, month, day
    //   `

    // LIMIT 200 because the largest timebucket is 168 (24 hours * 7 days), adding a buffer just in case
    return `
      WITH date_range AS (
        SELECT ${aggregator}(${tzFromDate}, number)) AS date
        FROM system.numbers
        WHERE ${aggregator}(${tzFromDate}, number)) <= ${tzToDate}
        LIMIT 200
      )
      SELECT
        ${selector}
      FROM date_range
      ORDER BY ${groupBy}
      `
  }

  generateCustomEventsAggregationQuery(
    timezone: string,
    timeBucket: TimeBucketType,
    filtersQuery: string,
    paramsData: any,
  ): string {
    const safeTimezone = this.getSafeTimezone(timezone)

    const timeBucketFunc = timeBucketConversion[timeBucket]
    const [selector, groupBy] = this.getGroupSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    return `
      SELECT
        ${selector},
        count() as count
      FROM (
        SELECT *,
          ${timeBucketFunc}(toTimeZone(created, '${safeTimezone}')) as tz_created
        FROM customEV
        WHERE ${
          paramsData.params.ev_exclusive ? 'NOT' : ''
        } ev = {ev:String} AND pid = {pid:FixedString(12)} AND created BETWEEN ${tzFromDate} AND ${tzToDate} ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  generatePerformanceAggregationQuery(
    timezone: string,
    timeBucket: TimeBucketType,
    filtersQuery: string,
  ): string {
    const safeTimezone = this.getSafeTimezone(timezone)

    const timeBucketFunc = timeBucketConversion[timeBucket]
    const [selector, groupBy] = this.getGroupSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    return `
      SELECT
        ${selector},
        avg(dns) as dns,
        avg(tls) as tls,
        avg(conn) as conn,
        avg(response) as response,
        avg(render) as render,
        avg(domLoad) as domLoad,
        avg(ttfb) as ttfb
      FROM (
        SELECT *,
          ${timeBucketFunc}(toTimeZone(created, '${safeTimezone}')) as tz_created
        FROM performance
        WHERE pid = {pid:FixedString(12)} AND created BETWEEN ${tzFromDate} AND ${tzToDate} ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  generateCaptchaAggregationQuery(
    timezone: string,
    timeBucket: TimeBucketType,
    filtersQuery: string,
  ): string {
    const safeTimezone = this.getSafeTimezone(timezone)

    const timeBucketFunc = timeBucketConversion[timeBucket]
    const [selector, groupBy] = this.getGroupSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    return `
      SELECT
        ${selector},
        count() as count
      FROM (
        SELECT *,
          ${timeBucketFunc}(toTimeZone(created, '${safeTimezone}')) as tz_created
        FROM captcha
        WHERE pid = {pid:FixedString(12)} AND created BETWEEN ${tzFromDate} AND ${tzToDate} ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  async groupByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    subQuery: string,
    filtersQuery: string,
    paramsData: any,
    timezone: string,
    customEVFilterApplied: boolean,
    parsedFilters: Array<{ [key: string]: string }>,
  ): Promise<object | void> {
    let params: unknown = {}
    let chart: unknown = {}
    let avgSdur = 0

    const promises = [
      // Getting params
      (async () => {
        params = await this.groupParamsByTimeBucket(
          subQuery,
          paramsData,
          customEVFilterApplied,
          parsedFilters,
        )

        if (!_some(_values(params), val => !_isEmpty(val))) {
          throw new BadRequestException(
            'The are no parameters for the specified time frames',
          )
        }
      })(),

      // Getting chart & average session duration data
      (async () => {
        const groupedData = await this.groupChartByTimeBucket(
          timeBucket,
          from,
          to,
          subQuery,
          filtersQuery,
          paramsData,
          timezone,
          customEVFilterApplied,
        )

        // @ts-ignore
        chart = groupedData.chart

        // @ts-ignore
        avgSdur = groupedData.avgSdur
      })(),
    ]

    await Promise.all(promises)

    return {
      params,
      chart,
      avgSdur,
    }
  }

  async groupParamsByTimeBucket(
    subQuery: string,
    paramsData: any,
    customEVFilterApplied: boolean,
    parsedFilters: Array<{ [key: string]: string }>,
  ): Promise<object | void> {
    return this.generateParams(
      parsedFilters,
      subQuery,
      customEVFilterApplied,
      paramsData,
      false,
      false,
    )
  }

  async groupChartByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    subQuery: string,
    filtersQuery: string,
    paramsData: any,
    timezone: string,
    customEVFilterApplied: boolean,
  ): Promise<object | void> {
    const avgSdur = customEVFilterApplied
      ? 0
      : await this.calculateAverageSessionDuration(subQuery, paramsData)

    const x = this.generateXAxis(timeBucket, from, to)

    if (customEVFilterApplied) {
      const query = this.generateCustomEventsAggregationQuery(
        timezone,
        timeBucket,
        filtersQuery,
        paramsData,
      )

      const result = <Array<TrafficCEFilterCHResponse>>(
        await clickhouse.query(query, paramsData).toPromise()
      )

      const uniques =
        this.extractCustomEventsChartData(result, x)?._unknown_event || []

      const sdur = Array(_size(x)).fill(0)

      // x = this.updateXAxisTimezone(x, timezone, timeBucket)

      return Promise.resolve({
        chart: {
          x,
          visits: uniques,
          uniques,
          sdur,
        },
        avgSdur,
      })
    }
    const query = this.generateAnalyticsAggregationQuery(
      timezone,
      timeBucket,
      filtersQuery,
    )

    const queryDates = this.generateDateRangeQuery(timezone, timeBucket)

    const result = <Array<TrafficCHResponse>>(
      await clickhouse.query(query, paramsData).toPromise()
    )

    const dates = <Array<{ date: string }>>(
      await clickhouse.query(queryDates, paramsData).toPromise()
    )

    console.log('DATES:', paramsData, dates)

    console.log(result)

    const { visits, uniques, sdur } = this.extractChartData(result, x)

    // x = this.updateXAxisTimezone(x, timezone, timeBucket)

    return Promise.resolve({
      chart: {
        x,
        visits,
        uniques,
        sdur,
      },
      avgSdur,
    })
  }

  extractCaptchaChartData(result, x: string[]): any {
    const count = Array(x.length).fill(0)

    for (let row = 0; row < _size(result); ++row) {
      const dateString = this.generateDateString(result[row])

      const index = x.indexOf(dateString)

      if (index !== -1) {
        count[index] = result[row].count
      }
    }

    return {
      count,
    }
  }

  async groupCaptchaByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    subQuery: string,
    filtersQuery: string,
    paramsData: object,
    timezone: string,
  ): Promise<object | void> {
    let params: unknown = {}
    let chart: unknown = {}

    const promises = [
      // Getting params
      (async () => {
        params = await this.generateParams(
          null,
          subQuery,
          false,
          paramsData,
          true,
          false,
        )

        if (!_some(_values(params), val => !_isEmpty(val))) {
          throw new BadRequestException(
            'The are no parameters for the specified time frames',
          )
        }
      })(),

      // Getting CAPTCHA chart data
      (async () => {
        const x = this.generateXAxis(timeBucket, from, to)

        const query = this.generateCaptchaAggregationQuery(
          timezone,
          timeBucket,
          filtersQuery,
        )

        const result = <Array<TrafficCEFilterCHResponse>>(
          await clickhouse.query(query, paramsData).toPromise()
        )
        const { count } = this.extractCaptchaChartData(result, x)

        chart = {
          x,
          results: count,
        }
      })(),
    ]

    await Promise.all(promises)

    return Promise.resolve({
      params,
      chart,
    })
  }

  extractPerformanceChartData(result, x: string[]): any {
    const dns = Array(x.length).fill(0)
    const tls = Array(x.length).fill(0)
    const conn = Array(x.length).fill(0)
    const response = Array(x.length).fill(0)
    const render = Array(x.length).fill(0)
    const domLoad = Array(x.length).fill(0)
    const ttfb = Array(x.length).fill(0)

    for (let row = 0; row < _size(result); ++row) {
      const dateString = this.generateDateString(result[row])

      const index = x.indexOf(dateString)

      if (index !== -1) {
        dns[index] = _round(millisecondsToSeconds(result[row].dns), 2)
        tls[index] = _round(millisecondsToSeconds(result[row].tls), 2)
        conn[index] = _round(millisecondsToSeconds(result[row].conn), 2)
        response[index] = _round(millisecondsToSeconds(result[row].response), 2)
        render[index] = _round(millisecondsToSeconds(result[row].render), 2)
        domLoad[index] = _round(millisecondsToSeconds(result[row].domLoad), 2)
        ttfb[index] = _round(millisecondsToSeconds(result[row].ttfb), 2)
      }
    }

    return {
      dns,
      tls,
      conn,
      response,
      render,
      domLoad,
      ttfb,
    }
  }

  async groupPerfByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    subQuery: string,
    filtersQuery: string,
    paramsData: object,
    timezone: string,
  ): Promise<object | void> {
    let params: unknown = {}
    let chart: unknown = {}

    const promises = [
      // Getting params
      (async () => {
        params = await this.generateParams(
          null,
          subQuery,
          false,
          paramsData,
          false,
          true,
        )

        if (!_some(_values(params), val => !_isEmpty(val))) {
          throw new BadRequestException(
            'The are no parameters for the specified time frames',
          )
        }
      })(),

      // Getting chart data
      (async () => {
        const x = this.generateXAxis(timeBucket, from, to)

        const query = this.generatePerformanceAggregationQuery(
          timezone,
          timeBucket,
          filtersQuery,
        )

        const result = <Array<PerformanceCHResponse>>(
          await clickhouse.query(query, paramsData).toPromise()
        )

        // x = this.updateXAxisTimezone(x, timezone, timeBucket)

        chart = {
          x,
          ...this.extractPerformanceChartData(result, x),
        }
      })(),
    ]

    await Promise.all(promises)

    return Promise.resolve({
      params,
      chart,
    })
  }

  async processCustomEV(query: string, params: object): Promise<object> {
    const result = {}

    const rawCustoms = <Array<CustomsCHResponse>>(
      await clickhouse.query(query, params).toPromise()
    )
    const size = _size(rawCustoms)

    for (let i = 0; i < size; ++i) {
      const { ev, 'count()': c } = rawCustoms[i]
      result[ev] = c
    }

    return result
  }

  async getOnlineUserCount(pid: string): Promise<number> {
    // @ts-ignore
    return redis.countKeysByPattern(`hb:${pid}:*`)
  }

  async groupCustomEVByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    filtersQuery: string,
    paramsData: object,
    timezone: string,
  ): Promise<object | void> {
    const safeTimezone = this.getSafeTimezone(timezone)
    const x = this.generateXAxis(timeBucket, from, to)

    const timeBucketFunc = timeBucketConversion[timeBucket]
    const [selector, groupBy] = this.getGroupSubquery(timeBucket)
    const tzFromDate = `toTimeZone(parseDateTimeBestEffort({groupFrom:String}), '${safeTimezone}')`
    const tzToDate = `toTimeZone(parseDateTimeBestEffort({groupTo:String}), '${safeTimezone}')`

    const query = `
      SELECT
        ${selector},
        ev,
        count() as count
      FROM (
        SELECT *,
          ${timeBucketFunc}(toTimeZone(created, '${safeTimezone}')) as tz_created
        FROM customEV
        WHERE pid = {pid:FixedString(12)} AND created BETWEEN ${tzFromDate} AND ${tzToDate} ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}, ev
      ORDER BY ${groupBy};
      `

    const result = <Array<CustomsCHAggregatedResponse>>(
      await clickhouse.query(query, paramsData).toPromise()
    )

    const events = this.extractCustomEventsChartData(result, x)

    // x = this.updateXAxisTimezone(x, timezone, timeBucket)

    return Promise.resolve({
      chart: {
        x,
        events,
      },
    })
  }

  async getOnlineCountByProjectId(projectId: string) {
    // @ts-ignore
    return redis.countKeysByPattern(`hb:${projectId}:*`)
  }

  async getStatsByProjectId(projectId: string) {
    return this.getSummaryStats([projectId], 'analytics', 'w', 1)
  }
}
