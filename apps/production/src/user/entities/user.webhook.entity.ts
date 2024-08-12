import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { User } from './user.entity'

@Entity('users_webhooks')
export class UserWebhookEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column('varchar')
  userId: string

  @Column('varchar')
  name: string

  @Column('text', { nullable: true })
  url: string | null

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  @ManyToOne(() => User, user => user.webhooks, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User
}
