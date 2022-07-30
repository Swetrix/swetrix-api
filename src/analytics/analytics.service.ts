import * as _isEmpty from 'lodash/isEmpty'
import * as _isString from 'lodash/isString'
import * as _split from 'lodash/split'
import * as _filter from 'lodash/filter'
import * as _size from 'lodash/size'
import * as _isNull from 'lodash/isNull'
import * as _includes from 'lodash/includes'
import * as _map from 'lodash/map'
import * as _toUpper from 'lodash/toUpper'
import * as _join from 'lodash/join'
import * as _some from 'lodash/some'
import * as _keys from 'lodash/keys'
import * as _find from 'lodash/find'
import * as _values from 'lodash/values'
import * as dayjs from 'dayjs'
import * as utc from 'dayjs/plugin/utc'
import * as timezone from 'dayjs/plugin/timezone'
import * as ipRangeCheck from 'ip-range-check'
import { isLocale } from 'validator'
import { hash } from 'blake3'
import {
  Injectable, BadRequestException, InternalServerErrorException, ForbiddenException, UnprocessableEntityException,
  PreconditionFailedException,
} from '@nestjs/common'

import { ACCOUNT_PLANS, DEFAULT_TIMEZONE } from '../user/entities/user.entity'
import {
  redis, isValidPID, getRedisProjectKey, redisProjectCacheTimeout, UNIQUE_SESSION_LIFE_TIME, clickhouse,
  getPercentageChange, isSelfhosted, REDIS_SESSION_SALT_KEY,
} from '../common/constants'
import { getProjectsClickhouse } from '../common/utils'
import { PageviewsDTO } from './dto/pageviews.dto'
import { EventsDTO } from './dto/events.dto'
import { ProjectService } from '../project/project.service'
import { Project } from '../project/entity/project.entity'
import { TimeBucketType } from './dto/getData.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

export const getSessionKey = (ip: string, ua: string, pid: string, salt: string = '') => `ses_${hash(`${ua}${ip}${pid}${salt}`).toString('hex')}`

export const cols = [
  'cc', 'pg', 'lc', 'br', 'os', 'dv', 'ref', 'so', 'me', 'ca',
]

interface chartCHResponse {
  index: number
  unique: number
  'count()': number
}

interface customsCHResponse {
  ev: string
  'count()': number
}

const validPeriods = ['today', 'yesterday', '1d', '7d', '4w', '3M', '12M', '24M']
const validTimebuckets = [TimeBucketType.HOUR, TimeBucketType.DAY, TimeBucketType.WEEK, TimeBucketType.MONTH]

// mapping of allowed timebuckets per difference between days
// (e.g. if difference is lower than (lt) (including) -> then the specified timebuckets are allowed to be applied)
const timeBucketToDays = [
  { lt: 7, tb: [TimeBucketType.HOUR, TimeBucketType.DAY] }, // 7 days
  { lt: 28, tb: [TimeBucketType.DAY, TimeBucketType.WEEK] }, // 4 weeks
  { lt: 366, tb: [TimeBucketType.WEEK, TimeBucketType.MONTH] }, // 12 months
  { lt: 732, tb: [TimeBucketType.MONTH] }, // 24 months
]

// Smaller than 64 characters, must start with an English letter and contain only letters (a-z A-Z), numbers (0-9), underscores (_) and dots (.)
const customEVvalidate = /^[a-zA-Z](?:[\w\.]){0,62}$/

interface GetFiltersQuery extends Array<string | object> { 0: string; 1: object }

export const isValidTimezone = (timezone: string): boolean => {
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

export const isValidDate = (date: string, format: string = 'YYYY-MM-DD'): boolean => {
  if (_isEmpty(date)) {
    return false
  }

  return dayjs(date, format).format(format) === date
}

export const checkIfTBAllowed = (timeBucket: TimeBucketType, from: string, to: string): void => {
  const diff = dayjs(to).diff(dayjs(from), 'days')

  const tbMap = _find(timeBucketToDays, ({ lt }) => diff <= lt)

  if (_isEmpty(tbMap)) {
    throw new PreconditionFailedException('The difference between \'from\' and \'to\' is greater than allowed')
  }

  const { tb } = tbMap

  if (!_includes(tb, timeBucket)) {
    throw new PreconditionFailedException('The specified \'timeBucket\' parameter cannot be applied to the date range')
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly projectService: ProjectService,
  ) { }

  async getRedisProject(pid: string): Promise<Project | null> {
    const pidKey = getRedisProjectKey(pid)
    let project: string | Project = await redis.get(pidKey)

    if (_isEmpty(project)) {
      if (isSelfhosted) {
        project = await getProjectsClickhouse(pid)
      } else {
        // todo: optimise the relations - select
        // select only required columns
        // https://stackoverflow.com/questions/59645009/how-to-return-only-some-columns-of-a-relations-with-typeorm
        project = await this.projectService.findOne(pid, {
          relations: ['admin'],
          select: ['origins', 'active', 'admin', 'public', 'ipBlacklist'],
        })
      }
      if (_isEmpty(project)) throw new BadRequestException('The provided Project ID (pid) is incorrect')

      if (!isSelfhosted) {
        const share = await this.projectService.findShare({
          where: {
            project: pid,
          },
          relations: ['user'],
        })
        // @ts-ignore
        project = { ...project, share }
      }

      await redis.set(pidKey, JSON.stringify(project), 'EX', redisProjectCacheTimeout)
    } else {
      try {
        project = JSON.parse(project)
      } catch {
        throw new InternalServerErrorException('Error while processing project')
      }
    }

    // @ts-ignore
    return project
  }

  async checkProjectAccess(pid: string, uid: string | null): Promise<void> {
    if (!isSelfhosted) {
      const project = await this.getRedisProject(pid)
      this.projectService.allowedToView(project, uid)
    }
  }

  checkOrigin(project: Project, origin: string): void {
    if (!_isEmpty(project.origins) && !_isEmpty(origin)) {
      if (origin === 'null') {
        if (!_includes(project.origins, 'null')) {
          throw new BadRequestException('\'null\' origin is not added to your project\'s whitelist. To send requests from this origin either add it to your origins policy or leave it empty.')
        }
      } else {
        const hostname = new URL(origin).hostname
        if (!_includes(project.origins, hostname)) {
          throw new BadRequestException('This origin is prohibited by the project\'s origins policy')
        }
      }
    }
  }

  checkIpBlacklist(project: Project, ip: string): void {
    if (!_isEmpty(project.ipBlacklist) && ipRangeCheck(ip, project.ipBlacklist)) {
      throw new BadRequestException('Incoming analytics is disabled for this IP address')
    }
  }

  validatePID(pid: string): void {
    if (_isEmpty(pid)) throw new BadRequestException('The Project ID (pid) has to be provided')
    if (!isValidPID(pid)) throw new BadRequestException('The provided Project ID (pid) is incorrect')
  }

  async validate(logDTO: PageviewsDTO | EventsDTO, origin: string, type: 'custom' | 'log' = 'log', ip?: string): Promise<string | null> {
    if (_isEmpty(logDTO)) throw new BadRequestException('The request cannot be empty')

    const { pid } = logDTO
    this.validatePID(pid)

    if (type === 'custom') {
      // @ts-ignore
      const { ev } = logDTO

      if (_isEmpty(ev)) {
        throw new BadRequestException('Empty custom events are not allowed')
      }

      if (!customEVvalidate.test(ev)) {
        throw new BadRequestException('An incorrect event name (ev) is provided')
      }
    } else { // the type is 'log'
      // 'tz' does not need validation as it's based on getCountryForTimezone detection
      // @ts-ignore
      const { lc } = logDTO

      // validate locale ('lc' param)
      if (!_isEmpty(lc)) {
        if (isLocale(lc)) {
          // uppercase the locale after '-' char, so for example both 'en-gb' and 'en-GB' in result will be 'en-GB'
          const lcParted = _split(lc, '-')

          if (_size(lcParted) > 1) {
            lcParted[1] = _toUpper(lcParted[1])
          }

          // @ts-ignore
          logDTO.lc = _join(lcParted, '-')
        } else {
          // @ts-ignore
          logDTO.lc = 'NULL'
        }
      }
    }

    const project = await this.getRedisProject(pid)

    this.checkIpBlacklist(project, ip)

    if (!project.active) throw new BadRequestException('Incoming analytics is disabled for this project')

    if (!isSelfhosted) {
      const count = await this.projectService.getRedisCount(project.admin.id)
      const maxCount = ACCOUNT_PLANS[project.admin.planCode].monthlyUsageLimit || 0

      if (count >= maxCount) {
        throw new ForbiddenException('You have exceeded the available monthly request limit for your account. Please upgrade your account plan if you need more requests.')
      }
    }

    this.checkOrigin(project, origin)

    return null
  }

  async validateHB(logDTO: PageviewsDTO, userAgent: string, ip: string): Promise<string | null> {
    if (_isEmpty(logDTO)) throw new BadRequestException('The request cannot be empty')

    const { pid } = logDTO
    this.validatePID(pid)

    const salt = await redis.get(REDIS_SESSION_SALT_KEY)
    const sessionHash = getSessionKey(ip, userAgent, pid, salt)
    const sessionExists = await this.isSessionOpen(sessionHash)

    if (!sessionExists) throw new ForbiddenException('The Heartbeat session does not exist')

    return sessionHash
  }

  validatePeriod(period: string): void {
    if (!_includes(validPeriods, period)) {
      throw new UnprocessableEntityException('The provided period is incorrect')
    }
  }

  // returns SQL filters query in a format like 'AND col=value AND ...'
  getFiltersQuery(filters: string): GetFiltersQuery {
    let parsed = []
    let query = ''
    let params = {}

    if (_isEmpty(filters)) {
      return [query, params]
    }

    try {
      parsed = JSON.parse(filters)
    } catch (e) {
      console.error(`Cannot parse the filters array: ${filters}`)
      return [query, params]
    }

    if (_isEmpty(parsed)) {
      return [query, params]
    }

    for (let i = 0; i < _size(parsed); ++i) {
      const { column, filter, isExclusive } = parsed[i]

      if (!_includes(cols, column)) {
        throw new UnprocessableEntityException(`The provided filter (${column}) is not supported`)
      }
      // working only on 1 filter per 1 column
      const colFilter = `cf_${column}`

      params = {
        ...params,
        [colFilter]: filter,
      }
      query += ` ${isExclusive ? 'AND NOT' : 'AND'} ${column}={${colFilter}:String}`
    }

    return [query, params]
  }

  validateTimebucket(tb: TimeBucketType): void {
    if (!_includes(validTimebuckets, tb)) {
      throw new UnprocessableEntityException('The provided timebucket is incorrect')
    }
  }

  async isUnique(hash: string) {
    const session = await redis.get(hash)
    await redis.set(hash, 1, 'EX', UNIQUE_SESSION_LIFE_TIME)
    return !Boolean(session)
  }

  async isSessionOpen(hash: string) {
    const session = await redis.get(hash)
    return Boolean(session)
  }

  async getSummary(pids: string[], period: 'w' | 'M' = 'w'): Promise<Object> {
    const result = {}

    for (let i = 0; i < _size(pids); ++i) {
      const pid = pids[i]
      if (!isValidPID(pid)) throw new BadRequestException(`The provided Project ID (${pid}) is incorrect`)

      const now = dayjs.utc().format('YYYY-MM-DD HH:mm:ss')
      const oneWRaw = dayjs.utc().subtract(1, period)
      const oneWeek = oneWRaw.format('YYYY-MM-DD HH:mm:ss')
      const twoWeeks = oneWRaw.subtract(1, period).format('YYYY-MM-DD HH:mm:ss')

      const query1 = `SELECT unique, count() FROM analytics WHERE pid = {pid:FixedString(12)} AND created BETWEEN {oneWeek:String} AND {now:String} GROUP BY unique`
      const query2 = `SELECT unique, count() FROM analytics WHERE pid = {pid:FixedString(12)} AND created BETWEEN {twoWeeks:String} AND {oneWeek:String} GROUP BY unique`

      const paramsData = {
        params: {
          pid,
          oneWeek,
          twoWeeks,
          now,
        },
      }

      try {
        const q1res = await clickhouse.query(query1, paramsData).toPromise()
        const q2res = await clickhouse.query(query2, paramsData).toPromise()

        const thisWeekUnique = _find(q1res, ({ unique }) => unique)?.['count()'] || 0
        const thisWeekPV = (_find(q1res, ({ unique }) => !unique)?.['count()'] || 0) + thisWeekUnique
        const lastWeekUnique = _find(q2res, ({ unique }) => unique)?.['count()'] || 0
        const lastWeekPV = (_find(q2res, ({ unique }) => !unique)?.['count()'] || 0) + lastWeekUnique

        result[pid] = {
          thisWeek: thisWeekPV,
          lastWeek: lastWeekPV,
          thisWeekUnique,
          lastWeekUnique,
          percChange: getPercentageChange(thisWeekPV, lastWeekPV),
          percChangeUnique: getPercentageChange(thisWeekUnique, lastWeekUnique),
        }
      } catch {
        throw new InternalServerErrorException('Can\'t process the provided PID. Please, try again later.')
      }
    }

    return result
  }

  async groupByTimeBucket(timeBucket: TimeBucketType, from: string, to: string, subQuery: string, filtersQuery: string, paramsData: object, timezone: string): Promise<object | void> {
    const params = {}

    for (let i of cols) {
      const query1 = `SELECT ${i}, count(*) ${subQuery} AND ${i} IS NOT NULL GROUP BY ${i}`
      const res = await clickhouse.query(query1, paramsData).toPromise()

      params[i] = {}

      const size = _size(res)
      for (let j = 0; j < size; ++j) {
        const key = res[j][i]
        const value = res[j]['count()']
        params[i][key] = value
      }
    }

    if (!_some(_values(params), (val) => !_isEmpty(val))) {
      return Promise.resolve()
    }

    let groupDateIterator
    const now = dayjs.utc().endOf(timeBucket)
    const djsTo = dayjs.utc(to).endOf(timeBucket)
    const iterateTo = djsTo > now ? now : djsTo

    switch (timeBucket) {
      case TimeBucketType.HOUR:
        groupDateIterator = dayjs.utc(from).startOf('hour')
        break

      case TimeBucketType.DAY:
      case TimeBucketType.WEEK:
      case TimeBucketType.MONTH:
        groupDateIterator = dayjs.utc(from).startOf('day')
        break

      default:
        return Promise.reject()
    }

    let x = []

    while (groupDateIterator < iterateTo) {
      const nextIteration = groupDateIterator.add(1, timeBucket)
      x.push(groupDateIterator.format('YYYY-MM-DD HH:mm:ss'))
      groupDateIterator = nextIteration
    }

    const xM = [...x, groupDateIterator.format('YYYY-MM-DD HH:mm:ss')]
    let query = ''

    for (let i = 0; i < _size(x); ++i) {
      if (i > 0) {
        query += ' UNION ALL '
      }

      query += `select ${i} index, unique, count() from analytics where pid = {pid:FixedString(12)} and created between '${xM[i]}' and '${xM[1 + i]}' ${filtersQuery} group by unique`
    }

    // @ts-ignore
    const result: Array<chartCHResponse> = (await clickhouse.query(query, paramsData).toPromise()).sort((a, b) => a.index - b.index)
    const visits = []
    const uniques = []

    let idx = 0
    const resSize = _size(result)

    while (idx < resSize) {
      const index = result[idx].index
      const v = result[idx]['count()']

      if (index === result[1 + idx]?.index) {
        const u = result[1 + idx]['count()']
        visits[index] = v + u
        uniques[index] = u
        idx += 2
        continue
      }

      const unique = result[idx].unique

      if (unique) {
        visits[index] = v
        uniques[index] = v
      } else {
        visits[index] = v
        uniques[index] = 0
      }
      idx++
    }

    for (let i = 0; i < _size(x); ++i) {
      if (!visits[i]) {
        visits[i] = 0
        uniques[i] = 0
      }
    }

    if (timezone !== DEFAULT_TIMEZONE && isValidTimezone(timezone)) {
      x = _map(x, el => dayjs.utc(el).tz(timezone).format('YYYY-MM-DD HH:mm:ss'))
    }

    return Promise.resolve({
      params,
      chart: {
        x,
        visits,
        uniques,
      },
    })
  }

  async processCustomEV(query: string, params: object): Promise<object> {
    const result = {}

    // @ts-ignore
    const rawCustoms: Array<customsCHResponse> = await clickhouse.query(query, params).toPromise()
    const size = _size(rawCustoms)

    for (let i = 0; i < size; ++i) {
      const { ev, 'count()': c } = rawCustoms[i]
      result[ev] = c
    }

    return result
  }
}
