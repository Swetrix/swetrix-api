import { ApiProperty } from '@nestjs/swagger'
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ProjectViewEntity } from './project-view.entity'

export enum MetaValueType {
  STRING = 'string',
  INTEGER = 'integer',
  FLOAT = 'float',
}

@Entity('projects_views_custom_events')
export class ProjectViewCustomEventEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string

  @ApiProperty()
  @Column('varchar')
  viewId: string

  @ApiProperty()
  @Column('varchar')
  customEventName: string

  @ApiProperty()
  @Column('varchar')
  metaKey: string

  @ApiProperty()
  @Column('varchar')
  metaValue: string

  @ApiProperty()
  @Column('enum', { enum: MetaValueType, default: MetaValueType.STRING })
  metaValueType: MetaValueType

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date

  @ManyToOne(() => ProjectViewEntity, projectView => projectView.id, {
    onDelete: 'CASCADE',
  })
  view: ProjectViewEntity
}
