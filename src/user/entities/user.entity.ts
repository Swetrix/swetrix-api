import { Entity, Column, PrimaryGeneratedColumn, OneToMany, BeforeUpdate } from 'typeorm'
import { ActionToken } from 'src/action-tokens/action-token.entity'
import { Project } from 'src/project/entity/project.entity'
import { ProjectShare } from 'src/project/entity/project-share.entity'

export enum PlanCode {
  free = 'free',
  freelancer = 'freelancer',
  startup = 'startup',
  enterprise = 'enterprise',
}

export const ACCOUNT_PLANS = {
  [PlanCode.free]: {
    id: PlanCode.free,
    displayName: 'Free plan',
    monthlyUsageLimit: 5000,
    maxProjects: 10,
  },
  [PlanCode.freelancer]: {
    id: PlanCode.freelancer,
    displayName: 'Freelancer plan',
    monthlyUsageLimit: 100000,
    maxProjects: 20,
    pid: '752316', // Plan ID
    ypid: '776469', // Plan ID - Yearly billing
  },
  [PlanCode.startup]: {
    id: PlanCode.startup,
    displayName: 'Startup plan',
    monthlyUsageLimit: 1000000,
    maxProjects: 20,
    pid: '752317',
    ypid: '776470',
  },
  [PlanCode.enterprise]: {
    id: PlanCode.enterprise,
    displayName: 'Enterprise plan',
    monthlyUsageLimit: 5000000,
    maxProjects: 30,
    pid: '752318',
    ypid: '776471',
  },
}

export enum UserType {
  CUSTOMER = 'customer',
  ADMIN = 'admin',
}

export enum ReportFrequency {
  Never = 'never',
  Weekly = 'weekly',
  Monthly = 'monthly',
}

export enum BillingFrequency {
  Monthly = 'monthly',
  Yearly = 'yearly',
}

export const MAX_EMAIL_REQUESTS = 4 // 1 confirmation email on sign up + 3 additional ones

export const DEFAULT_TIMEZONE = 'Etc/GMT'

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({
    type: 'set',
    enum: UserType,
    default: UserType.CUSTOMER,
  })
  roles: UserType[]

  @Column({
    type: 'enum',
    enum: PlanCode,
    default: PlanCode.free,
  })
  planCode: PlanCode

  @Column('varchar', { length: 254, unique: true })
  email: string

  @Column('varchar', { length: 60, default: '' })
  password: string

  @Column({ default: false })
  isActive: boolean

  @Column({
    type: 'enum',
    enum: ReportFrequency,
    default: ReportFrequency.Monthly,
  })
  reportFrequency: ReportFrequency

  @Column('int', { default: 1 })
  emailRequests: number

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created: Date

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated: Date

  // the date when the 'you are running out of events' warning email was last sent on
  @Column({ type: 'timestamp', nullable: true })
  evWarningSentOn: Date

  @Column({ type: 'timestamp', nullable: true })
  exportedAt: Date

  @Column('varchar', { length: 15, nullable: true })
  subID: string

  @Column('varchar', { length: 200, nullable: true })
  subUpdateURL: string

  @Column('varchar', { length: 200, nullable: true })
  subCancelURL: string

  @Column('varchar', { length: 50, default: DEFAULT_TIMEZONE })
  timezone: string

  @Column('varchar', { length: 32, nullable: true })
  twoFactorAuthenticationSecret: string

  @Column('varchar', { length: 30, nullable: true })
  twoFactorRecoveryCode: string

  @Column({ default: false })
  isTwoFactorAuthenticationEnabled: boolean

  @BeforeUpdate()
  updateTimestamp() {
    this.updated = new Date
  }

  @OneToMany(() => Project, project => project.admin)
  projects: Project[]

  @OneToMany(() => ProjectShare, sharedProjects => sharedProjects.user)
  sharedProjects: ProjectShare[]

  @OneToMany(() => ActionToken, actionToken => actionToken.user)
  actionTokens: ActionToken[]

  @Column({
    type: 'enum',
    enum: BillingFrequency,
    nullable: true,
  })
  billingFrequency: BillingFrequency

  @Column({ type: 'date', nullable: true })
  nextBillDate: Date

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
    nullable: true,
    default: null,
  })
  apiKey: string | null
}
