import { Project } from "../../../project/entity/project.entity";
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity('views')
export class ViewEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    projectId: string

    @Column({ type: 'bigint', nullable: true })
    psid: string | null

    @Column('varchar')
    pg: string | null

    @Column('varchar')
    ev: string

    @Column('varchar', { nullable: true })
    dv: string | null

    @Column('varchar', { nullable: true })
    br: string | null

    @Column('varchar', { nullable: true })
    os: string | null

    @Column('varchar', { nullable: true })
    lc: string | null

    @Column('varchar', { nullable: true })
    ref: string | null

    @Column('varchar', { nullable: true })
    so: string | null

    @Column('varchar', { nullable: true })
    me: string | null

    @Column('varchar', { nullable: true })
    ca: string | null

    @Column('varchar', { length: 2, nullable: true })
    cc: string

    @Column('varchar', { nullable: true })
    rg: string | null

    @Column('varchar', { nullable: true })
    ct: string | null

    @CreateDateColumn()
    createdAt: Date

    @UpdateDateColumn()
    updatedAt: Date

    @ManyToOne(() => Project, project => project.views)
    project: Project

}

