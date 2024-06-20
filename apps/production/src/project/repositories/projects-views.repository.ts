import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ProjectViewEntity } from '../entity/project-view.entity'

@Injectable()
export class ProjectsViewsRepository {
  constructor(
    @InjectRepository(ProjectViewEntity)
    private viewsRepository: Repository<ProjectViewEntity>,
  ) {}

  async findViews(projectId: string) {
    return this.viewsRepository.find({ projectId })
  }
}
