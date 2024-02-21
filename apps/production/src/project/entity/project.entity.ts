import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  OneToMany,
  JoinTable,
} from 'typeorm'
import { ApiProperty } from '@nestjs/swagger'

import { Alert } from '../../alert/entity/alert.entity'
import { User } from '../../user/entities/user.entity'
import { ProjectShare } from './project-share.entity'
import { ExtensionToProject } from '../../marketplace/extensions/entities/extension-to-project.entity'
import { ProjectSubscriber } from './project-subscriber.entity'
import { Funnel } from './funnel.entity'
import { CAPTCHA_SECRET_KEY_LENGTH } from '../../common/constants'

// In case of modifying some properties here add them to the GDPR data export email template
@Entity()
export class Project {
  @ApiProperty()
  @PrimaryColumn('varchar', {
    unique: true,
    length: 12,
  })
  id: string

  @ApiProperty()
  @Column('varchar', { length: 50 })
  name: string

  @ApiProperty()
  @Column('simple-array')
  origins: string[]

  @ApiProperty()
  @Column('simple-array', { nullable: true, default: null })
  ipBlacklist: string[]

  @ApiProperty()
  @Column({
    default: true,
  })
  active: boolean

  @ApiProperty()
  @Column({
    default: false,
  })
  public: boolean

  @Column('boolean', { default: false })
  isTransferring: boolean

  // Swetrix CAPTCHA related stuff
  @ApiProperty()
  @Column('boolean', { default: true })
  isAnalyticsProject: boolean

  @ApiProperty()
  @Column('boolean', { default: false })
  isCaptchaProject: boolean

  @ApiProperty()
  @Column('boolean', { default: false })
  isCaptchaEnabled: boolean

  @ApiProperty()
  @Column('varchar', { default: null, length: CAPTCHA_SECRET_KEY_LENGTH })
  captchaSecretKey: string

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, user => user.projects)
  admin: User

  @ApiProperty({ type: () => ProjectShare })
  @OneToMany(() => ProjectShare, share => share.project)
  share: ProjectShare[]

  @ApiProperty({ type: () => Alert })
  @OneToMany(() => Alert, alert => alert.project)
  alerts: Alert[]

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created: Date

  @OneToMany(
    () => ExtensionToProject,
    extensionToProject => extensionToProject.project,
  )
  @JoinTable()
  extensions: ExtensionToProject[]

  @OneToMany(() => ProjectSubscriber, subscriber => subscriber.project, {
    cascade: true,
  })
  subscribers: ProjectSubscriber[]

  @ApiProperty({ type: () => Funnel })
  @OneToMany(() => Funnel, funnel => funnel.project)
  funnels: Funnel[]

  @Column('varchar', {
    default: null,
    length: 60,
    nullable: true,
  })
  passwordHash: string | null

  @Column('boolean', { default: false })
  isPasswordProtected: boolean

  @Column('boolean', { default: false })
  isPinned: boolean
}
