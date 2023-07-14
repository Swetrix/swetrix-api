import * as _isEmpty from 'lodash/isEmpty'
import * as _split from 'lodash/split'
import * as _size from 'lodash/size'
import * as _includes from 'lodash/includes'
import * as _map from 'lodash/map'
import * as _toUpper from 'lodash/toUpper'
import * as _join from 'lodash/join'
import * as _isArray from 'lodash/isArray'
import * as _reduce from 'lodash/reduce'
import * as _keys from 'lodash/keys'
import * as _last from 'lodash/last'
import * as _some from 'lodash/some'
import * as _find from 'lodash/find'
import * as _now from 'lodash/now'
import * as _values from 'lodash/values'
import * as _round from 'lodash/round'
import * as _filter from 'lodash/filter'
import timezones from 'countries-and-timezones'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as dayjsTimezone from 'dayjs/plugin/timezone'
import * as isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
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
  REDIS_SESSION_SALT_KEY,
  TRAFFIC_COLUMNS,
  CAPTCHA_COLUMNS,
  PERFORMANCE_COLUMNS,
} from '../common/constants'
import {
  calculateRelativePercentage,
  millisecondsToSeconds,
  lookup,
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
  IFunnel,
  IBuildUserFlow,
  IExtractChartData,
  IGenerateXAxis,
} from './interfaces'

dayjs.extend(utc)
dayjs.extend(dayjsTimezone)
dayjs.extend(isSameOrBefore)

export const getSessionKey = (ip: string, ua: string, pid: string, salt = '') =>
  `ses_${hash(`${ua}${ip}${pid}${salt}`).toString('hex')}`

export const getHeartbeatKey = (pid: string, sessionID: string) =>
  `hb:${pid}:${sessionID}`

const getSessionDurationKey = (sessionHash: string, pid: string) =>
  `sd:${sessionHash}:${pid}`

const GMT_0_TIMEZONES = [
  'Atlantic/Azores',
  'Etc/GMT',
  // 'Africa/Casablanca',
]

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
  TimeBucketType.MONTH,
]

// mapping of allowed timebuckets per difference between days
// (e.g. if difference is lower than (lt) (including) -> then the specified timebuckets are allowed to be applied)
const timeBucketToDays = [
  {
    lt: 7,
    tb: [TimeBucketType.HOUR, TimeBucketType.DAY, TimeBucketType.MONTH],
  }, // 7 days
  {
    lt: 28,
    tb: [TimeBucketType.DAY, TimeBucketType.MONTH],
  }, // 4 weeks
  { lt: 366, tb: [TimeBucketType.MONTH] }, // 12 months
  { lt: 732, tb: [TimeBucketType.MONTH] }, // 24 months
]

// Smaller than 64 characters, must start with an English letter and contain only letters (a-z A-Z), numbers (0-9), underscores (_) and dots (.)
// eslint-disable-next-line no-useless-escape
const customEVvalidate = /^[a-zA-Z](?:[\w\.]){0,62}$/

const timeBucketConversion = {
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
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
  let columns = [`${col} as name`]

  // For regions and cities we'll return an array of objects, that will also include the country code
  // We need the conutry code to display the flag next to the region/city name
  if (col === 'rg' || col === 'ct') {
    columns = [...columns, 'cc']
  }

  const columnsQuery = columns.join(', ')

  if (isPerformance) {
    return `SELECT ${columnsQuery}, round(divide(avg(pageLoad), 1000), 2) as count ${subQuery} AND ${col} IS NOT NULL GROUP BY ${columnsQuery}`
  }

  if (isCaptcha) {
    return `SELECT ${columnsQuery}, count(*) as count ${subQuery} AND ${col} IS NOT NULL GROUP BY ${col}`
  }

  if (customEVFilterApplied) {
    return `SELECT ${columnsQuery}, count(*) as count ${subQuery} AND ${col} IS NOT NULL GROUP BY ${columnsQuery}`
  }

  if (col === 'pg' || isPageInclusiveFilterSet) {
    return `SELECT ${columnsQuery}, count(*) as count ${subQuery} AND ${col} IS NOT NULL GROUP BY ${columnsQuery}`
  }

  return `SELECT ${columnsQuery}, count(*) as count ${subQuery} AND ${col} IS NOT NULL AND unique='1' GROUP BY ${columnsQuery}`
}

export enum DataType {
  ANALYTICS = 'analytics',
  PERFORMANCE = 'performance',
  CAPTCHA = 'captcha',
}

const isValidOrigin = (origins: string[], origin: string) => {
  for (let i = 0; i < _size(origins); ++i) {
    const allowedOrigin = origins[i]

    // Check if the allowedOrigin is an exact match
    if (allowedOrigin === origin) {
      return true
    }

    // Check if the allowedOrigin contains a wildcard
    if (_includes(allowedOrigin, '*')) {
      // Escape the wildcard character for use in a regular expression
      const wildcardRegex = new RegExp(allowedOrigin.replace(/\*/g, '.*'))

      // Check if the origin matches the wildcard pattern
      if (wildcardRegex.test(origin)) {
        return true
      }
    }
  }

  return false
}

interface IPGeoDetails {
  country?: string
  region?: string
  city?: string
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly projectService: ProjectService) {}

  async checkProjectAccess(
    pid: string,
    uid: string | null,
    password?: string,
  ): Promise<void> {
    const project = await this.projectService.getRedisProject(pid)
    this.projectService.allowedToView(project, uid, password)
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
        if (!isValidOrigin(origins, hostname)) {
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

    this.checkOrigin(project, origin)

    return null
  }

  getDataTypeColumns(dataType: DataType): string[] {
    if (dataType === DataType.ANALYTICS) {
      return TRAFFIC_COLUMNS
    }

    if (dataType === DataType.PERFORMANCE) {
      return PERFORMANCE_COLUMNS
    }

    return CAPTCHA_COLUMNS
  }

  getGroupFromTo(
    from: string,
    to: string,
    timeBucket: TimeBucketType | null,
    period: string,
    safeTimezone: string,
  ): IGetGroupFromTo {
    let groupFrom: dayjs.Dayjs
    let groupTo: dayjs.Dayjs
    let groupFromUTC: string
    let groupToUTC: string
    const formatFrom = 'YYYY-MM-DD HH:mm:ss'
    const formatTo = 'YYYY-MM-DD HH:mm:ss'
    const djsNow = _includes(GMT_0_TIMEZONES, safeTimezone)
      ? dayjs.utc()
      : dayjs().tz(safeTimezone)

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

      // TODO:
      // THE FOLLOWING CODE SHOULD BE TIMEZONE SPECIFIC BUT HAS SOME ISSUES WITH DATE SHIFTS
      // IT SHOULD BE REFACTORED AND USED IN THE FUTURE
      // if (from === to) {
      //   // When from and to are the same we need to return timezone specific data for 1 specified day
      //   groupFrom = dayjs.tz(from, safeTimezone).startOf('d')
      //   groupTo = groupFrom.endOf('d')
      //   groupFromUTC = groupFrom.utc().format(formatFrom)
      //   groupToUTC = groupTo.utc().format(formatTo)
      // } else {
      //   groupFrom = dayjs.tz(from, safeTimezone)
      //   groupTo = dayjs.tz(to, safeTimezone)
      //   groupFromUTC = groupFrom.utc().startOf(timeBucket).format(formatFrom)
      //   groupToUTC = groupTo.utc().endOf(timeBucket).format(formatTo)
      // }

      // THIS SHOULD BE REPLACED BY THE CODE ABOVE WHEN IT'S FIXED
      if (from === to) {
        groupFrom = dayjs.tz(from, safeTimezone).startOf('d')
        groupTo = dayjs.tz(from, safeTimezone).endOf('d')
        groupFromUTC = groupFrom.utc().format(formatFrom)
        groupToUTC = groupTo.utc().format(formatFrom)
      } else {
        groupFrom = dayjs.utc(from)
        groupTo = dayjs.utc(to)
        groupFromUTC = groupFrom.utc().startOf(timeBucket).format(formatFrom)
        groupToUTC = groupTo.utc().endOf(timeBucket).format(formatTo)
      }
    } else if (!_isEmpty(period)) {
      if (period === 'today') {
        groupFrom = djsNow.startOf('d')
        groupTo = djsNow
      } else if (period === 'yesterday') {
        groupFrom = djsNow.subtract(1, 'day').startOf('d')
        groupTo = djsNow.subtract(1, 'day').endOf('d')
      } else {
        if (period === '1d') {
          groupFrom = djsNow.subtract(parseInt(period, 10), _last(period))
        } else {
          groupFrom = djsNow.subtract(parseInt(period, 10) - 1, _last(period))
        }

        groupFrom = groupFrom.startOf(timeBucket)
        groupTo = djsNow
      }

      if (!_isEmpty(timeBucket)) {
        checkIfTBAllowed(
          timeBucket,
          groupFrom.format(formatFrom),
          groupTo.format(formatTo),
        )
      }

      groupFromUTC = groupFrom.utc().startOf(timeBucket).format(formatFrom)
      groupToUTC = groupTo.utc().format(formatFrom)
    } else {
      throw new BadRequestException(
        'The timeframe (either from/to pair or period) has to be provided',
      )
    }

    const groupFromFormatted = groupFrom.format(formatFrom)
    const groupToFormatted = groupTo.format(formatTo)

    return {
      // Timezone shifted time
      groupFrom: groupFromFormatted,
      groupTo: groupToFormatted,
      // UTC time
      groupFromUTC,
      groupToUTC,
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

  async getUserFlow(params: unknown, filtersQuery: string): Promise<IUserFlow> {
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
        ${filtersQuery}
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

    await this.getFunnel(params, ['/settings', '/dashboard', '/'])

    return {
      ascending: this.buildUserFlow(ascendingLinks),
      descending: this.buildUserFlow(descendingLinks),
    }
  }

  async getFunnel(params: any, pages: string[]): Promise<any> {
    // Promise<IFunnel> {

    // My 'analytics' table has the following columns: pg and prev
    // Pg is the current page and prev is the previous page
    // I need to calculate the funnel (amount of users that went from page A to page B, to page ... (i.e. A -> B -> C -> D...))
    // I use Clickhouse as my database.
    // - params is an object that contains properties like pid, groupFrom, groupTo, etc.
    // - pages is an array of pages that I need to calculate the funnel for

    // const query = `
    //   SELECT
    //     count() AS count
    //   FROM analytics
    //   WHERE
    //     pid = {pid:FixedString(12)}
    //     AND created BETWEEN {groupFrom:String} AND {groupTo:String}
    //     AND pg = {page:String}
    //     ${prevPage ? `AND prev = {prevPage:String}` : ''}
    // `
    // The following query seems to calculate funnel the following way: A -> B, B -> C, C -> D, etc.
    // that is incorrect, because it's possible that some users went from X -> B, Y -> B and were included in the funnel
    // It should be calculated the following way: A -> B -> C -> D, etc.
    // Let's fix it by using INNER JOINS recursively

    const query = `
      SELECT
        count() AS count
      FROM analytics
      WHERE
        pid = {pid:FixedString(12)}
        AND created BETWEEN {groupFrom:String} AND {groupTo:String}
        AND pg = {page:String}
        ${pages.length > 1 ? `AND prev = {prevPage:String}` : ''}
    `
    const promises = pages.map(async (page, index) => {
      const prevPage = index > 0 ? pages[index - 1] : null
      const result = await clickhouse
        .query(query, { params: { ...params, page, prevPage } })
        .toPromise()
      // @ts-ignore
      return result[0].count
    })

    const funnel = await Promise.all(promises)

    console.log('funnel', funnel)
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

  postProcessParsedFilters(parsedFilters: any[]): any[] {
    return _reduce(
      parsedFilters,
      (prev, curr) => {
        const { column, filter, isExclusive } = curr

        if (_isArray(filter)) {
          const filterArray = _map(filter, f => ({
            column,
            filter: f,
            isExclusive,
          }))
          return [...prev, ...filterArray]
        }

        return [...prev, curr]
      },
      [],
    )
  }

  // returns SQL filters query in a format like 'AND col=value AND ...'
  getFiltersQuery(filters: string, dataType: DataType): GetFiltersQuery {
    const params = {}
    let parsed = []
    let query = ''
    let customEVFilterApplied = false

    if (_isEmpty(filters)) {
      return [query, params, parsed, customEVFilterApplied]
    }

    try {
      parsed = JSON.parse(filters)
    } catch (e) {
      console.error(`Cannot parse the filters array: ${filters}`)
      return [query, params, parsed, customEVFilterApplied]
    }

    if (_isEmpty(parsed)) {
      return [query, params, parsed, customEVFilterApplied]
    }

    if (!_isArray(parsed)) {
      throw new UnprocessableEntityException(
        'The provided filters are not in a valid format',
      )
    }

    const SUPPORTED_COLUMNS = this.getDataTypeColumns(dataType)

    // Converting something like [{"column":"cc","filter":"BG", "isExclusive":false},{"column":"cc","filter":"PL", "isExclusive":false},{"column":"pg","filter":"/hello", "isExclusive":false}]
    // to
    // {cc: [{filter: 'BG', isExclusive: false}, {filter: 'PL', isExclusive: false}], pg: [{filter: '/hello', isExclusive: false}]}
    const converted = _reduce(
      parsed,
      (prev, curr) => {
        const { column, filter, isExclusive = false } = curr

        if (column === 'ev') {
          customEVFilterApplied = true
        } else if (!_includes(SUPPORTED_COLUMNS, column)) {
          throw new UnprocessableEntityException(
            `The provided filter (${column}) is not supported`,
          )
        }

        const res = []

        if (_isArray(filter)) {
          for (const f of filter) {
            res.push({ filter: f, isExclusive })
          }
        } else {
          res.push({ filter, isExclusive })
        }

        if (prev[column]) {
          prev[column].push(...res)
        } else {
          prev[column] = res
        }

        return prev
      },
      {},
    )

    const columns = _keys(converted)

    for (let col = 0; col < _size(columns); ++col) {
      const column = columns[col]
      query += ' AND ('

      for (let f = 0; f < _size(converted[column]); ++f) {
        if (f > 0) {
          query += ' OR '
        }

        const { filter, isExclusive } = converted[column][f]

        const param = `qf_${col}_${f}`

        query += `${isExclusive ? 'NOT ' : ''}${column} = {${param}:String}`

        params[param] = filter
      }

      query += ')'
    }

    return [
      query,
      params,
      this.postProcessParsedFilters(parsed),
      customEVFilterApplied,
    ]
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

  getGeoDetails(ip: string, tz?: string): IPGeoDetails {
    // Stage 1: Using IP address based geo lookup
    const data = lookup.get(ip)

    const country = data?.country?.iso_code
    // TODO: Add city overrides, for example, Colinton -> Edinburgh, etc.
    const city = data?.city?.names?.en
    const region = data?.subdivisions?.[0]?.names?.en

    if (country) {
      return {
        country,
        city,
        region,
      }
    }

    // Stage 2: Using timezone based geo lookup as a fallback
    const tzCountry = timezones.getCountryForTimezone(tz)?.id || null

    return {
      country: tzCountry,
      city: null,
      region: null,
    }
  }

  async getFilters(pid: string, type: string): Promise<Array<string>> {
    if (!_includes(TRAFFIC_COLUMNS, type)) {
      throw new UnprocessableEntityException(
        `The provided type (${type}) is incorrect`,
      )
    }

    const query = `SELECT ${type} FROM analytics WHERE pid={pid:FixedString(12)} AND ${type} IS NOT NULL GROUP BY ${type}`
    const results = await clickhouse
      .query(query, { params: { pid } })
      .toPromise()

    return _map(results, type)
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

    let columns = TRAFFIC_COLUMNS

    if (isCaptcha) {
      columns = CAPTCHA_COLUMNS
    }

    if (isPerformance) {
      columns = PERFORMANCE_COLUMNS
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

      params[col] = res
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
    from: string, // timezone is already applied to the from and to parameters
    to: string,
    safeTimezone: string,
  ): IGenerateXAxis {
    const iterateTo = _includes(GMT_0_TIMEZONES, safeTimezone)
      ? dayjs.utc(to)
      : dayjs.tz(to, safeTimezone)
    let djsFrom = _includes(GMT_0_TIMEZONES, safeTimezone)
      ? dayjs.utc(from)
      : dayjs.tz(from, safeTimezone)

    let format

    switch (timeBucket) {
      case TimeBucketType.HOUR:
        format = 'YYYY-MM-DD HH:mm:ss'
        break

      case TimeBucketType.DAY:
        format = 'YYYY-MM-DD'
        break

      case TimeBucketType.MONTH:
        format = 'YYYY-MM'
        break

      default:
        throw new BadRequestException(
          `The provided time bucket (${timeBucket}) is incorrect`,
        )
    }

    // UTC dates
    const x = []

    // Timezone shifted dates (a hack to map Clickhouse timezone processed data to UTC dates)
    const xShifted = []

    while (djsFrom.isSameOrBefore(iterateTo, timeBucket)) {
      x.push(djsFrom.utc().format(format))
      xShifted.push(djsFrom.format(format))
      djsFrom = djsFrom.add(1, timeBucket)
    }

    if (_includes(GMT_0_TIMEZONES, safeTimezone)) {
      return {
        x,
        xShifted: x,
      }
    }

    return {
      x,
      xShifted,
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

  getSafeTimezone(timezone: string): string {
    if (timezone === DEFAULT_TIMEZONE || !isValidTimezone(timezone)) {
      return DEFAULT_TIMEZONE
    }

    return timezone
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
    timeBucket: TimeBucketType,
    filtersQuery: string,
    safeTimezone: string,
  ): string {
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
        WHERE
          pid = {pid:FixedString(12)}
          AND created BETWEEN ${tzFromDate} AND ${tzToDate}
          ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  generateCustomEventsAggregationQuery(
    timeBucket: TimeBucketType,
    filtersQuery: string,
    safeTimezone: string,
  ): string {
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
        WHERE pid = {pid:FixedString(12)}
          AND created BETWEEN ${tzFromDate} AND ${tzToDate}
          ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  generatePerformanceAggregationQuery(
    timeBucket: TimeBucketType,
    filtersQuery: string,
    safeTimezone,
  ): string {
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
        WHERE
          pid = {pid:FixedString(12)}
          AND created BETWEEN ${tzFromDate} AND ${tzToDate}
          ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}
      ORDER BY ${groupBy}
      `
  }

  generateCaptchaAggregationQuery(
    timeBucket: TimeBucketType,
    filtersQuery: string,
    safeTimezone: string,
  ): string {
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
        WHERE
          pid = {pid:FixedString(12)}
          AND created BETWEEN ${tzFromDate} AND ${tzToDate}
          ${filtersQuery}
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
    safeTimezone: string,
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
          safeTimezone,
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
    safeTimezone: string,
    customEVFilterApplied: boolean,
  ): Promise<object | void> {
    const avgSdur = customEVFilterApplied
      ? 0
      : await this.calculateAverageSessionDuration(subQuery, paramsData)

    const { xShifted } = this.generateXAxis(timeBucket, from, to, safeTimezone)

    if (customEVFilterApplied) {
      const query = this.generateCustomEventsAggregationQuery(
        timeBucket,
        filtersQuery,
        safeTimezone,
      )

      const result = <Array<TrafficCEFilterCHResponse>>(
        await clickhouse.query(query, paramsData).toPromise()
      )

      const uniques =
        this.extractCustomEventsChartData(result, xShifted)?._unknown_event ||
        []

      const sdur = Array(_size(xShifted)).fill(0)

      return Promise.resolve({
        chart: {
          x: xShifted,
          visits: uniques,
          uniques,
          sdur,
        },
        avgSdur,
      })
    }

    const query = this.generateAnalyticsAggregationQuery(
      timeBucket,
      filtersQuery,
      safeTimezone,
    )

    const result = <Array<TrafficCHResponse>>(
      await clickhouse.query(query, paramsData).toPromise()
    )

    const { visits, uniques, sdur } = this.extractChartData(result, xShifted)

    return Promise.resolve({
      chart: {
        x: xShifted,
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
    safeTimezone: string,
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
        const { xShifted } = this.generateXAxis(
          timeBucket,
          from,
          to,
          safeTimezone,
        )

        const query = this.generateCaptchaAggregationQuery(
          timeBucket,
          filtersQuery,
          safeTimezone,
        )

        const result = <Array<TrafficCEFilterCHResponse>>(
          await clickhouse.query(query, paramsData).toPromise()
        )
        const { count } = this.extractCaptchaChartData(result, xShifted)

        chart = {
          x: xShifted,
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

  async getPerfChartData(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    filtersQuery: string,
    paramsData: object,
    safeTimezone: string,
  ) {
    const { xShifted } = this.generateXAxis(timeBucket, from, to, safeTimezone)

    const query = this.generatePerformanceAggregationQuery(
      timeBucket,
      filtersQuery,
      safeTimezone,
    )

    const result = <Array<PerformanceCHResponse>>(
      await clickhouse.query(query, paramsData).toPromise()
    )

    return {
      x: xShifted,
      ...this.extractPerformanceChartData(result, xShifted),
    }
  }

  async groupPerfByTimeBucket(
    timeBucket: TimeBucketType,
    from: string,
    to: string,
    subQuery: string,
    filtersQuery: string,
    paramsData: object,
    safeTimezone: string,
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
        chart = await this.getPerfChartData(
          timeBucket,
          from,
          to,
          filtersQuery,
          paramsData,
          safeTimezone,
        )
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
    safeTimezone: string,
  ): Promise<object | void> {
    const { xShifted } = this.generateXAxis(timeBucket, from, to, safeTimezone)

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
        WHERE
          pid = {pid:FixedString(12)}
          AND created BETWEEN ${tzFromDate} AND ${tzToDate}
          ${filtersQuery}
      ) as subquery
      GROUP BY ${groupBy}, ev
      ORDER BY ${groupBy}
      `

    const result = <Array<CustomsCHAggregatedResponse>>(
      await clickhouse.query(query, paramsData).toPromise()
    )

    const events = this.extractCustomEventsChartData(result, xShifted)

    return Promise.resolve({
      chart: {
        x: xShifted,
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
