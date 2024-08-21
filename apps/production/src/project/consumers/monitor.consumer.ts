import { Process, Processor } from '@nestjs/bull'
import { Inject, InternalServerErrorException, Logger } from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { Job } from 'bull'
import { firstValueFrom } from 'rxjs'
import { CreateMonitorHttpRequestDTO } from '../dto/create-monitor.dto'
import { clickhouse } from '../../common/integrations/clickhouse'
import { ProjectService } from '../project.service'
import { MailerService } from '../../mailer/mailer.service'
import { LetterTemplate } from '../../mailer/letter'

@Processor('monitor')
export class MonitorConsumer {
  constructor(
    @Inject('MONITOR_EUROPE_SERVICE') private monitorEuropeService: ClientProxy,
    @Inject('MONITOR_US_SERVICE') private monitorUsService: ClientProxy,
    @Inject('MONITOR_ASIA_SERVICE') private monitorAsiaService: ClientProxy,
    private readonly projectService: ProjectService,
    private readonly mailerService: MailerService,
  ) {}

  private readonly logger = new Logger(MonitorConsumer.name)

  @Process('http-request')
  async httpRequestProcess(
    job: Job<CreateMonitorHttpRequestDTO & { monitorId: number }>,
  ): Promise<any> {
    const [resEurope, resUs, resAsia] = await Promise.all([
      firstValueFrom(this.monitorEuropeService.send('http-request', job.data)),
      firstValueFrom(this.monitorUsService.send('http-request', job.data)),
      firstValueFrom(this.monitorAsiaService.send('http-request', job.data)),
    ])

    const monitor = await this.projectService.getMonitor(job.data.monitorId)

    const responses = [resEurope, resUs, resAsia]

    // Collect all promises for email sending and database insertion
    const operations = responses.map(res => {
      const emailPromise = !monitor.acceptedStatusCodes.includes(res.statusCode)
        ? this.mailerService
            .sendEmail(
              monitor.group.project.admin.email,
              LetterTemplate.UptimeMonitoringFailure,
              {
                projectName: monitor.group.project.name,
                monitorName: monitor.name,
                groupName: monitor.group.name,
              },
            )
            .catch(reason => {
              console.error('Monitor failure: sendEmail action failed')
              console.error(reason)
            })
        : Promise.resolve()

      const dbPromise = clickhouse
        .insert({
          table: 'monitor_responses',
          format: 'JSONEachRow',
          values: [
            {
              monitorId: job.data.monitorId,
              region: res.region,
              responseTime: res.responseTime,
              timestamp: res.timestamp,
              statusCode: res.statusCode,
            },
          ],
        })
        .catch(e => {
          this.logger.error(e)
          throw new InternalServerErrorException(
            'Error occurred while saving the monitor data',
          )
        })

      return Promise.all([emailPromise, dbPromise])
    })

    // Execute all operations in parallel
    await Promise.all(operations)
  }
}
