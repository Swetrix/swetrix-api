import {
  Controller,
  Get,
  Put,
  Delete,
  UseGuards,
  Query,
  Param,
  Body,
  NotFoundException,
  Post,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { In } from 'typeorm'
import { ApiTags, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import * as _isEmpty from 'lodash/isEmpty'
import * as _map from 'lodash/map'
import * as _omit from 'lodash/omit'
import * as _pick from 'lodash/pick'

import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Gauge } from 'prom-client'
import { UserService } from '../user/user.service'
import { ProjectService } from '../project/project.service'
import { AppLoggerService } from '../logger/logger.service'
import { UserType, ACCOUNT_PLANS, PlanCode } from '../user/entities/user.entity'
import { JwtAccessTokenGuard } from '../auth/guards'
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator'
import { Roles } from '../auth/decorators/roles.decorator'
import { Alert } from './entity/alert.entity'
import { AlertDTO, CreateAlertDTO } from './dto/alert.dto'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AlertService } from './alert.service'

const ALERTS_MAXIMUM = ACCOUNT_PLANS[PlanCode.free].maxAlerts

@ApiTags('Alert')
@Controller('alert')
export class AlertController {
  constructor(
    private readonly alertService: AlertService,
    private readonly projectService: ProjectService,
    private readonly logger: AppLoggerService,
    private readonly userService: UserService,
    @InjectMetric('alert_count')
    private readonly alertCountGauge: Gauge<string>,
  ) {}

  @ApiBearerAuth()
  @Get('/')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN, UserType.CUSTOMER)
  @ApiResponse({ status: 200, type: Alert })
  async getAllAlerts(
    @CurrentUserId() userId: string,
    @Query('take') take: number | undefined,
    @Query('skip') skip: number | undefined,
  ) {
    this.logger.log({ userId, take, skip }, 'GET /alert')

    const projects = await this.projectService.findWhere({ admin: userId })

    if (_isEmpty(projects)) {
      return []
    }

    const pids = _map(projects, project => project.id)

    const result = await this.alertService.paginate(
      { take, skip },
      { project: In(pids) },
      ['project'],
    )

    result.results = _map(result.results, alert => ({
      ..._omit(alert, ['project']),
      pid: alert.project.id,
    }))

    return result
  }

  @ApiBearerAuth()
  @Post('/')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN, UserType.CUSTOMER)
  @ApiResponse({ status: 201, type: Alert })
  async createAlert(
    @Body() alertDTO: CreateAlertDTO,
    @CurrentUserId() uid: string,
  ) {
    this.logger.log({ uid }, 'POST /alert')

    const user = await this.userService.findOneWithRelations(uid, ['projects'])

    const maxAlerts = ACCOUNT_PLANS[user.planCode]?.maxAlerts

    if (!user.isActive) {
      throw new ForbiddenException('Please, verify your email address first')
    }

    const project = await this.projectService.findOneWhere(
      {
        id: alertDTO.pid,
      },
      {
        relations: ['alerts', 'admin'],
      },
    )

    if (_isEmpty(project)) {
      throw new NotFoundException('Project not found')
    }

    this.projectService.allowedToManage(
      project,
      uid,
      user.roles,
      'You are not allowed to add alerts to this project',
    )

    const pids = _map(user.projects, userProject => userProject.id)
    const alertsCount = await this.alertService.count({ project: In(pids) })

    if (user.planCode === PlanCode.none) {
      throw new HttpException(
        'You cannot create new alerts due to no active subscription. Please upgrade your account plan to continue.',
        HttpStatus.PAYMENT_REQUIRED,
      )
    }

    if (user.isAccountBillingSuspended) {
      throw new HttpException(
        'The account that owns this site is currently suspended, this is because of a billing issue. Please resolve the issue to continue.',
        HttpStatus.PAYMENT_REQUIRED,
      )
    }

    if (alertsCount >= (maxAlerts || ALERTS_MAXIMUM)) {
      throw new HttpException(
        `You cannot create more than ${maxAlerts} alerts on your account plan. Please upgrade to be able to create more alerts.`,
        HttpStatus.PAYMENT_REQUIRED,
      )
    }

    try {
      let alert = new Alert()
      Object.assign(alert, alertDTO)
      alert = _omit(alert, ['pid'])

      const newAlert = await this.alertService.create(alert)

      project.alerts.push(newAlert)

      await this.projectService.create(project)

      this.alertCountGauge.inc()

      return {
        ...newAlert,
        pid: alertDTO.pid,
      }
    } catch (e) {
      console.error('Error while creating alert', e)
      throw new BadRequestException('Error occured while creating alert')
    }
  }

  @ApiBearerAuth()
  @Put('/:id')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN, UserType.CUSTOMER)
  @ApiResponse({ status: 200, type: Alert })
  async updateAlert(
    @Param('id') id: string,
    @Body() alertDTO: AlertDTO,
    @CurrentUserId() uid: string,
  ) {
    this.logger.log({ id, uid }, 'PUT /alert/:id')

    let alert = await this.alertService.findOneWithRelations(id)

    if (_isEmpty(alert)) {
      throw new NotFoundException()
    }

    const user = await this.userService.findOne(uid)

    this.projectService.allowedToManage(
      alert.project,
      uid,
      user.roles,
      'You are not allowed to manage this alert',
    )

    alert = {
      ...alert,
      ..._pick(alertDTO, [
        'queryMetric',
        'queryCondition',
        'queryValue',
        'queryTime',
        'active',
        'name',
        'queryCustomEvent',
      ]),
    }

    await this.alertService.update(
      id,
      _omit(alert, ['project', 'lastTriggered']),
    )

    return {
      ..._omit(alert, ['project']),
      pid: alert.project.id,
    }
  }

  @ApiBearerAuth()
  @Delete('/:id')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserType.ADMIN, UserType.CUSTOMER)
  @ApiResponse({ status: 204, description: 'Empty body' })
  async deleteAlert(@Param('id') id: string, @CurrentUserId() uid: string) {
    this.logger.log({ id, uid }, 'DELETE /alert/:id')

    const alert = await this.alertService.findOneWithRelations(id)

    if (_isEmpty(alert)) {
      throw new NotFoundException()
    }

    const user = await this.userService.findOne(uid)

    this.projectService.allowedToManage(
      alert.project,
      uid,
      user.roles,
      'You are not allowed to manage this alert',
    )

    await this.alertService.delete(id)
    this.alertCountGauge.dec()
  }
}
