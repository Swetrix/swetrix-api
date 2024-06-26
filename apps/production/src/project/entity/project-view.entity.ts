import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

import { ApiProperty } from '@nestjs/swagger'
import { Project } from './project.entity'
import { ProjectViewCustomEventEntity } from './project-view-custom-event.entity'

export enum ProjectViewType {
  TRAFFIC = 'traffic',
  PERFORMANCE = 'performance',
}

@Entity('projects_views')
export class ProjectViewEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string

  @ApiProperty()
  @Column('varchar')
  projectId: string

  @ApiProperty()
  @Column('varchar')
  name: string

  @ApiProperty({ enum: ProjectViewType })
  @Column('enum', { enum: ProjectViewType })
  type: ProjectViewType

  @ApiProperty()
  @Column('varchar')
  pg: string | null

  @ApiProperty()
  @Column('varchar')
  ev: string

  @ApiProperty()
  @Column('varchar', { nullable: true })
  dv: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  br: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  os: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  lc: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  ref: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  so: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  me: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  ca: string | null

  @ApiProperty()
  @Column('varchar', { length: 2, nullable: true })
  cc: string

  @ApiProperty()
  @Column('varchar', { nullable: true })
  rg: string | null

  @ApiProperty()
  @Column('varchar', { nullable: true })
  ct: string | null

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date

  @ManyToOne(() => Project, project => project.views, { onDelete: 'CASCADE' })
  project: Project

  @ApiProperty({ type: ProjectViewCustomEventEntity, isArray: true })
  @OneToMany(
    () => ProjectViewCustomEventEntity,
    projectViewCustomEvent => projectViewCustomEvent.view,
  )
  customEvents: ProjectViewCustomEventEntity[]
}
